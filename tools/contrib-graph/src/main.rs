//! Fetches the GitHub contribution calendar via the GraphQL API and writes
//! it as `public/assets/contributions.json`, one entry per week (each an
//! array of `{date, count}` days) — the shape the site's own JS renders
//! directly as a month×weekday grid, styled in Afterglow colours rather
//! than GitHub's.
//!
//! GitHub's `contributionsCollection` caps a single query at a 1-year
//! `from`/`to` span, but the site's grid can grow as wide as `.container`'s
//! own max-width allows (860px, same as the repo-cards grid below it) —
//! at contrib-graph.js's fixed cell size that's up to ~71 columns, more
//! than the ~53 weeks a single year provides. So this fetches
//! `YEARS_OF_HISTORY` one-year windows (oldest first) and concatenates
//! them, giving the client's own width-driven column count room to be the
//! actual limiting factor instead of running out of real data first.
//!
//! Requires CONTRIB_TOKEN (a PAT with `read:user` scope) — GitHub's
//! contribution calendar isn't exposed by the REST API and isn't reachable
//! client-side (no CORS on the public contributions page), so this runs
//! server-side in a scheduled GitHub Action instead. See
//! .github/workflows/contributions.yml.

use chrono::{Duration, Utc};
use serde::Serialize;
use std::env;
use std::error::Error;
use std::fs;

const YEARS_OF_HISTORY: i64 = 2;

const QUERY: &str = r#"
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}
"#;

#[derive(Serialize, Debug, PartialEq, Clone)]
struct Day {
    date: String,
    count: u32,
}

/// Pulls the `weeks[].contributionDays[]` shape out of the raw GraphQL
/// response into `Vec<Vec<Day>>` — split out from `main` so it can be tested
/// against mock JSON without a live network call.
fn parse_weeks(resp: &serde_json::Value) -> Result<Vec<Vec<Day>>, String> {
    let weeks_json = resp["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]
        .as_array()
        .ok_or("unexpected response shape: no weeks array")?;

    let mut weeks: Vec<Vec<Day>> = Vec::with_capacity(weeks_json.len());
    for week in weeks_json {
        let days_json = week["contributionDays"]
            .as_array()
            .ok_or("unexpected response shape: no contributionDays array")?;
        let days = days_json
            .iter()
            .map(|d| {
                Ok(Day {
                    date: d["date"].as_str().ok_or("day missing date")?.to_string(),
                    count: d["contributionCount"].as_u64().ok_or("day missing contributionCount")? as u32,
                })
            })
            .collect::<Result<Vec<Day>, &str>>()
            .map_err(|e| e.to_string())?;
        weeks.push(days);
    }
    Ok(weeks)
}

/// Adjacent 1-year windows can overlap by a few days at the seam (GitHub
/// returns whole calendar weeks containing the requested `from`/`to`, not
/// days clipped exactly to it) — flatten, sort, and dedupe by date so the
/// merged history has no repeated or out-of-order days, then re-chunk into
/// 7-day groups (the client flattens this anyway, but keeping the
/// documented "array of weeks" shape is worth the one extra pass).
fn merge_windows(windows: Vec<Vec<Vec<Day>>>) -> Vec<Vec<Day>> {
    let mut days: Vec<Day> = windows.into_iter().flatten().flatten().collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));
    days.dedup_by(|a, b| a.date == b.date);
    days.chunks(7).map(|c| c.to_vec()).collect()
}

fn main() -> Result<(), Box<dyn Error>> {
    let token = env::var("CONTRIB_TOKEN")
        .map_err(|_| "CONTRIB_TOKEN env var not set (needs a PAT with read:user scope)")?;
    let login = env::var("GITHUB_LOGIN").unwrap_or_else(|_| "NCMBianchi".to_string());
    let output_path =
        env::var("CONTRIB_OUTPUT_PATH").unwrap_or_else(|_| "public/assets/contributions.json".to_string());

    let client = reqwest::blocking::Client::new();
    let now = Utc::now();

    let mut windows: Vec<Vec<Vec<Day>>> = Vec::with_capacity(YEARS_OF_HISTORY as usize);
    for year_idx in (0..YEARS_OF_HISTORY).rev() {   /* oldest window first */
        let to = now - Duration::days(365 * year_idx);
        let from = to - Duration::days(365);
        let body = serde_json::json!({
            "query": QUERY,
            "variables": { "login": login, "from": from.to_rfc3339(), "to": to.to_rfc3339() }
        });

        let resp: serde_json::Value = client
            .post("https://api.github.com/graphql")
            .bearer_auth(&token)
            .header("User-Agent", "ncmbianchi-contrib-graph")
            .json(&body)
            .send()?
            .json()?;

        if let Some(errors) = resp.get("errors") {
            return Err(format!("GraphQL API returned errors: {errors}").into());
        }

        windows.push(parse_weeks(&resp)?);
    }

    let weeks = merge_windows(windows);

    let json = serde_json::to_string(&weeks)?;
    fs::write(&output_path, json)?;
    println!("wrote {} weeks ({} years of history) to {output_path}", weeks.len(), YEARS_OF_HISTORY);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_weeks_reads_dates_and_counts() {
        let resp = json!({
            "data": { "user": { "contributionsCollection": { "contributionCalendar": {
                "weeks": [
                    { "contributionDays": [
                        { "date": "2026-01-01", "contributionCount": 0 },
                        { "date": "2026-01-02", "contributionCount": 3 }
                    ] }
                ]
            } } } }
        });
        let weeks = parse_weeks(&resp).unwrap();
        assert_eq!(weeks, vec![vec![
            Day { date: "2026-01-01".to_string(), count: 0 },
            Day { date: "2026-01-02".to_string(), count: 3 },
        ]]);
    }

    #[test]
    fn parse_weeks_handles_multiple_weeks() {
        let resp = json!({
            "data": { "user": { "contributionsCollection": { "contributionCalendar": {
                "weeks": [
                    { "contributionDays": [ { "date": "2026-01-01", "contributionCount": 1 } ] },
                    { "contributionDays": [ { "date": "2026-01-08", "contributionCount": 2 } ] }
                ]
            } } } }
        });
        let weeks = parse_weeks(&resp).unwrap();
        assert_eq!(weeks.len(), 2);
    }

    #[test]
    fn parse_weeks_errors_on_missing_weeks_array() {
        let resp = json!({ "data": { "user": null } });
        let err = parse_weeks(&resp).unwrap_err();
        assert!(err.contains("no weeks array"));
    }

    #[test]
    fn parse_weeks_errors_on_missing_contribution_days() {
        let resp = json!({
            "data": { "user": { "contributionsCollection": { "contributionCalendar": {
                "weeks": [ { "notContributionDays": [] } ]
            } } } }
        });
        let err = parse_weeks(&resp).unwrap_err();
        assert!(err.contains("no contributionDays array"));
    }

    #[test]
    fn parse_weeks_errors_on_day_missing_count() {
        let resp = json!({
            "data": { "user": { "contributionsCollection": { "contributionCalendar": {
                "weeks": [ { "contributionDays": [ { "date": "2026-01-01" } ] } ]
            } } } }
        });
        let err = parse_weeks(&resp).unwrap_err();
        assert!(err.contains("contributionCount"));
    }

    fn day(date: &str, count: u32) -> Day {
        Day { date: date.to_string(), count }
    }

    #[test]
    fn merge_windows_concatenates_in_order() {
        let older = vec![vec![day("2024-01-01", 1), day("2024-01-02", 2)]];
        let newer = vec![vec![day("2025-01-01", 3), day("2025-01-02", 4)]];
        let merged = merge_windows(vec![older, newer]);
        let flat: Vec<&Day> = merged.iter().flatten().collect();
        assert_eq!(flat.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(),
                   vec!["2024-01-01", "2024-01-02", "2025-01-01", "2025-01-02"]);
    }

    #[test]
    fn merge_windows_dedupes_overlapping_seam_days() {
        let older = vec![vec![day("2024-12-30", 1), day("2024-12-31", 2)]];
        let newer = vec![vec![day("2024-12-31", 2), day("2025-01-01", 3)]]; /* seam overlap */
        let merged = merge_windows(vec![older, newer]);
        let flat: Vec<&Day> = merged.iter().flatten().collect();
        assert_eq!(flat.len(), 3);
        assert_eq!(flat.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(),
                   vec!["2024-12-30", "2024-12-31", "2025-01-01"]);
    }

    #[test]
    fn merge_windows_rechunks_into_sevens() {
        let days: Vec<Day> = (1..=10).map(|n| day(&format!("2026-01-{n:02}"), n)).collect();
        let merged = merge_windows(vec![vec![days]]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].len(), 7);
        assert_eq!(merged[1].len(), 3);
    }
}
