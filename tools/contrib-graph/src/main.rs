//! Fetches contribution activity — GitHub always, Gitea and GitLab optionally
//! — and writes it as `public/assets/contributions.json`, one entry per week
//! (each an array of `{date, count}` days) — the shape the site's own JS
//! renders directly as a month×weekday grid, styled in Afterglow colours
//! rather than GitHub's.
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
//!
//! Gitea and GitLab are optional additions on top of that, off by default:
//! set GITEA_URL (+ optional GITEA_TOKEN, GITEA_USERNAME) and/or GITLAB_URL
//! (+ required GITLAB_TOKEN) to fold in private/work activity — day counts
//! only, not repo listings. Their per-day counts are *summed* with GitHub's
//! (not deduped) since a commit to a home Gitea repo and one to GitHub on
//! the same day are both genuinely separate work. The Gitea host in
//! particular is expected to be reachable only via a Tailscale-joined
//! runner (see .github/workflows/contributions.yml) — if either source
//! isn't configured or its fetch fails, it's skipped with a warning rather
//! than failing the whole run; GitHub-only output is still valid output.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs;

const YEARS_OF_HISTORY: i64 = 2;

const GITHUB_QUERY: &str = r#"
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

/// Pulls the `weeks[].contributionDays[]` shape out of the raw GitHub
/// GraphQL response into `Vec<Vec<Day>>` — split out from `main` so it can
/// be tested against mock JSON without a live network call.
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

/// Adjacent 1-year GitHub windows can overlap by a few days at the seam
/// (GitHub returns whole calendar weeks containing the requested
/// `from`/`to`, not days clipped exactly to it) — flatten, sort, and dedupe
/// by date (keeping one entry per date) so the merged history has no
/// repeated or out-of-order days. Same-source dedup, not cross-source sum —
/// see `sum_sources` for the latter.
fn merge_and_dedupe(windows: Vec<Vec<Vec<Day>>>) -> Vec<Day> {
    let mut days: Vec<Day> = windows.into_iter().flatten().flatten().collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));
    days.dedup_by(|a, b| a.date == b.date);
    days
}

/// Re-chunks a flat, date-sorted day list into 7-day groups. The client
/// flattens this anyway, but keeping the documented "array of weeks" shape
/// is worth the one extra pass.
fn rechunk_weeks(days: Vec<Day>) -> Vec<Vec<Day>> {
    days.chunks(7).map(|c| c.to_vec()).collect()
}

/// Sums per-day counts across multiple *sources* (GitHub + Gitea + GitLab)
/// — unlike `merge_and_dedupe`, which dedupes overlapping windows of the
/// *same* source, this adds counts together: a commit to the home Gitea and
/// one to GitHub on the same day are both real, separate work, not the same
/// event counted twice. `BTreeMap` gives sorted-by-date output for free.
fn sum_sources(sources: Vec<Vec<Day>>) -> Vec<Day> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for day in sources.into_iter().flatten() {
        *counts.entry(day.date).or_insert(0) += day.count;
    }
    counts.into_iter().map(|(date, count)| Day { date, count }).collect()
}

/// Converts a Unix timestamp (seconds) to a "YYYY-MM-DD" UTC date string.
fn timestamp_to_date(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Buckets Gitea's heatmap entries (fine-grained, often several per day)
/// into one `Day` per calendar date, summing `contributions`.
fn bucket_gitea_heatmap(entries: &[(i64, u32)]) -> Vec<Day> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for &(ts, contributions) in entries {
        *counts.entry(timestamp_to_date(ts)).or_insert(0) += contributions;
    }
    counts.into_iter().map(|(date, count)| Day { date, count }).collect()
}

/// Buckets a list of ISO8601 `created_at` strings (GitLab events) into one
/// `Day` per calendar date — each event counts as 1 contribution.
fn bucket_gitlab_events(created_ats: &[String]) -> Vec<Day> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for ts in created_ats {
        let date = ts.get(0..10).unwrap_or(ts).to_string(); // "YYYY-MM-DDT..." -> "YYYY-MM-DD"
        *counts.entry(date).or_insert(0) += 1;
    }
    counts.into_iter().map(|(date, count)| Day { date, count }).collect()
}

fn fetch_gitea_heatmap(
    client: &reqwest::blocking::Client,
    base_url: &str,
    username: &str,
    token: Option<&str>,
) -> Result<Vec<Day>, Box<dyn Error>> {
    let url = format!("{base_url}/api/v1/users/{username}/heatmap");
    let mut req = client.get(&url).header("User-Agent", "ncmbianchi-contrib-graph");
    if let Some(t) = token {
        req = req.header("Authorization", format!("token {t}"));
    }
    let raw: Vec<serde_json::Value> = req.send()?.json()?;
    let entries: Vec<(i64, u32)> = raw
        .iter()
        .filter_map(|e| {
            let ts = e["timestamp"].as_i64()?;
            let contributions = e["contributions"].as_u64()? as u32;
            Some((ts, contributions))
        })
        .collect();
    Ok(bucket_gitea_heatmap(&entries))
}

fn fetch_gitlab_events(
    client: &reqwest::blocking::Client,
    base_url: &str,
    token: &str,
    after: &str,
    before: &str,
) -> Result<Vec<Day>, Box<dyn Error>> {
    let mut created_ats = Vec::new();
    let mut page = 1;
    loop {
        let url = format!("{base_url}/api/v4/events?after={after}&before={before}&per_page=100&page={page}");
        let resp: Vec<serde_json::Value> = client
            .get(&url)
            .header("PRIVATE-TOKEN", token)
            .header("User-Agent", "ncmbianchi-contrib-graph")
            .send()?
            .json()?;
        if resp.is_empty() {
            break;
        }
        for e in &resp {
            if let Some(ts) = e["created_at"].as_str() {
                created_ats.push(ts.to_string());
            }
        }
        page += 1;
        if page > 50 {
            break; // safety cap (~5,000 events) against a runaway loop
        }
    }
    Ok(bucket_gitlab_events(&created_ats))
}

/// Fetches and parses one GitHub `contributionsCollection` window. Split out
/// of `main` (base_url injectable) so it's testable against a mock HTTP
/// server instead of the real GitHub API.
fn fetch_github_window(
    client: &reqwest::blocking::Client,
    base_url: &str,
    token: &str,
    login: &str,
    from: &DateTime<Utc>,
    to: &DateTime<Utc>,
) -> Result<Vec<Vec<Day>>, Box<dyn Error>> {
    let body = serde_json::json!({
        "query": GITHUB_QUERY,
        "variables": { "login": login, "from": from.to_rfc3339(), "to": to.to_rfc3339() }
    });

    let resp: serde_json::Value = client
        .post(format!("{base_url}/graphql"))
        .bearer_auth(token)
        .header("User-Agent", "ncmbianchi-contrib-graph")
        .json(&body)
        .send()?
        .json()?;

    if let Some(errors) = resp.get("errors") {
        return Err(format!("GraphQL API returned errors: {errors}").into());
    }

    Ok(parse_weeks(&resp)?)
}

fn main() -> Result<(), Box<dyn Error>> {
    let token = env::var("CONTRIB_TOKEN")
        .map_err(|_| "CONTRIB_TOKEN env var not set (needs a PAT with read:user scope)")?;
    let login = env::var("GITHUB_LOGIN").unwrap_or_else(|_| "NCMBianchi".to_string());
    let output_path =
        env::var("CONTRIB_OUTPUT_PATH").unwrap_or_else(|_| "public/assets/contributions.json".to_string());

    let client = reqwest::blocking::Client::new();
    let now = Utc::now();

    let github_api = env::var("GITHUB_API_URL").unwrap_or_else(|_| "https://api.github.com".to_string());

    let mut windows: Vec<Vec<Vec<Day>>> = Vec::with_capacity(YEARS_OF_HISTORY as usize);
    for year_idx in (0..YEARS_OF_HISTORY).rev() {   /* oldest window first */
        let to = now - Duration::days(365 * year_idx);
        let from = to - Duration::days(365);
        windows.push(fetch_github_window(&client, &github_api, &token, &login, &from, &to)?);
    }

    let github_days = merge_and_dedupe(windows);
    println!("fetched {} days from GitHub", github_days.len());

    let mut sources: Vec<Vec<Day>> = vec![github_days];

    // GitHub Actions sets a secret's env var to an empty string (not unset)
    // when the secret doesn't exist, so `env::var(...).ok().filter(|v|
    // !v.is_empty())` is needed here, not a bare `Ok(...)` check, or an
    // unconfigured secret would still attempt (and fail) a fetch instead of
    // cleanly skipping.
    let gitea_url = env::var("GITEA_URL").ok().filter(|v| !v.is_empty());
    let gitlab_url = env::var("GITLAB_URL").ok().filter(|v| !v.is_empty());

    if let Some(gitea_url) = gitea_url {
        let username = env::var("GITEA_USERNAME").unwrap_or_else(|_| "kuroi".to_string());
        let gitea_token = env::var("GITEA_TOKEN").ok().filter(|v| !v.is_empty());
        match fetch_gitea_heatmap(&client, &gitea_url, &username, gitea_token.as_deref()) {
            Ok(days) => {
                println!("fetched {} days from Gitea", days.len());
                sources.push(days);
            }
            Err(e) => eprintln!("warning: Gitea fetch failed, skipping: {e}"),
        }
    }

    if let Some(gitlab_url) = gitlab_url {
        match env::var("GITLAB_TOKEN").ok().filter(|v| !v.is_empty()) {
            Some(gitlab_token) => {
                let after = (now - Duration::days(365 * YEARS_OF_HISTORY)).format("%Y-%m-%d").to_string();
                let before = now.format("%Y-%m-%d").to_string();
                match fetch_gitlab_events(&client, &gitlab_url, &gitlab_token, &after, &before) {
                    Ok(days) => {
                        println!("fetched {} days from GitLab", days.len());
                        sources.push(days);
                    }
                    Err(e) => eprintln!("warning: GitLab fetch failed, skipping: {e}"),
                }
            }
            None => eprintln!("warning: GITLAB_URL is set but GITLAB_TOKEN is missing, skipping GitLab"),
        }
    }

    let source_count = sources.len();
    let weeks = rechunk_weeks(sum_sources(sources));

    let json = serde_json::to_string(&weeks)?;
    fs::write(&output_path, json)?;
    println!("wrote {} weeks ({} source(s) merged) to {output_path}", weeks.len(), source_count);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
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
    fn merge_and_dedupe_concatenates_in_order() {
        let older = vec![vec![day("2024-01-01", 1), day("2024-01-02", 2)]];
        let newer = vec![vec![day("2025-01-01", 3), day("2025-01-02", 4)]];
        let merged = merge_and_dedupe(vec![older, newer]);
        assert_eq!(merged.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(),
                   vec!["2024-01-01", "2024-01-02", "2025-01-01", "2025-01-02"]);
    }

    #[test]
    fn merge_and_dedupe_dedupes_overlapping_seam_days() {
        let older = vec![vec![day("2024-12-30", 1), day("2024-12-31", 2)]];
        let newer = vec![vec![day("2024-12-31", 2), day("2025-01-01", 3)]]; /* seam overlap */
        let merged = merge_and_dedupe(vec![older, newer]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(),
                   vec!["2024-12-30", "2024-12-31", "2025-01-01"]);
    }

    #[test]
    fn rechunk_weeks_splits_into_sevens() {
        let days: Vec<Day> = (1..=10).map(|n| day(&format!("2026-01-{n:02}"), n)).collect();
        let weeks = rechunk_weeks(days);
        assert_eq!(weeks.len(), 2);
        assert_eq!(weeks[0].len(), 7);
        assert_eq!(weeks[1].len(), 3);
    }

    #[test]
    fn sum_sources_adds_counts_on_matching_dates() {
        let github = vec![day("2026-08-04", 5), day("2026-08-05", 0)];
        let gitea = vec![day("2026-08-04", 2), day("2026-08-06", 1)];
        let summed = sum_sources(vec![github, gitea]);
        assert_eq!(summed, vec![
            day("2026-08-04", 7), // 5 + 2, not deduped/overwritten
            day("2026-08-05", 0),
            day("2026-08-06", 1),
        ]);
    }

    #[test]
    fn sum_sources_sorts_by_date() {
        let a = vec![day("2026-08-05", 1)];
        let b = vec![day("2026-08-03", 1), day("2026-08-04", 1)];
        let summed = sum_sources(vec![a, b]);
        assert_eq!(summed.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(),
                   vec!["2026-08-03", "2026-08-04", "2026-08-05"]);
    }

    #[test]
    fn timestamp_to_date_converts_unix_seconds() {
        assert_eq!(timestamp_to_date(1785242700), "2026-07-28");
    }

    #[test]
    fn bucket_gitea_heatmap_sums_same_day_entries() {
        // first two entries same UTC day, third a different day
        let entries = vec![(1785242700, 1), (1785243600, 8), (1785331200, 2)];
        let bucketed = bucket_gitea_heatmap(&entries);
        assert_eq!(bucketed, vec![day("2026-07-28", 9), day("2026-07-29", 2)]);
    }

    #[test]
    fn bucket_gitlab_events_counts_one_per_event() {
        let created_ats = vec![
            "2026-08-04T06:04:35.123Z".to_string(),
            "2026-08-04T09:12:00.000Z".to_string(),
            "2026-08-05T00:00:01.000Z".to_string(),
        ];
        let bucketed = bucket_gitlab_events(&created_ats);
        assert_eq!(bucketed, vec![day("2026-08-04", 2), day("2026-08-05", 1)]);
    }

    #[test]
    fn fetch_gitea_heatmap_bucketed_from_mock_server() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/users/kuroi/heatmap");
            then.status(200).json_body(json!([
                { "timestamp": 1785242700, "contributions": 1 },
                { "timestamp": 1785243600, "contributions": 8 }
            ]));
        });
        let client = reqwest::blocking::Client::new();
        let days = fetch_gitea_heatmap(&client, &server.base_url(), "kuroi", None).unwrap();
        mock.assert();
        assert_eq!(days, vec![day("2026-07-28", 9)]);
    }

    #[test]
    fn fetch_gitea_heatmap_sends_auth_header_when_token_given() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/users/kuroi/heatmap")
                .header("Authorization", "token secret123");
            then.status(200).json_body(json!([]));
        });
        let client = reqwest::blocking::Client::new();
        let days = fetch_gitea_heatmap(&client, &server.base_url(), "kuroi", Some("secret123")).unwrap();
        mock.assert();
        assert_eq!(days, Vec::<Day>::new());
    }

    #[test]
    fn fetch_gitlab_events_paginates_until_an_empty_page() {
        let server = MockServer::start();
        let page1 = server.mock(|when, then| {
            when.method(GET).path("/api/v4/events").query_param("page", "1");
            then.status(200).json_body(json!([
                { "created_at": "2026-08-04T06:04:35.000Z" }
            ]));
        });
        let page2 = server.mock(|when, then| {
            when.method(GET).path("/api/v4/events").query_param("page", "2");
            then.status(200).json_body(json!([]));
        });
        let client = reqwest::blocking::Client::new();
        let days = fetch_gitlab_events(&client, &server.base_url(), "tok", "2026-01-01", "2026-12-31").unwrap();
        page1.assert();
        page2.assert();
        assert_eq!(days, vec![day("2026-08-04", 1)]);
    }

    #[test]
    fn fetch_github_window_parses_a_successful_response() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/graphql");
            then.status(200).json_body(json!({
                "data": { "user": { "contributionsCollection": { "contributionCalendar": {
                    "weeks": [ { "contributionDays": [ { "date": "2026-01-01", "contributionCount": 4 } ] } ]
                } } } }
            }));
        });
        let client = reqwest::blocking::Client::new();
        let now = Utc::now();
        let weeks = fetch_github_window(&client, &server.base_url(), "tok", "NCMBianchi", &(now - Duration::days(365)), &now).unwrap();
        mock.assert();
        assert_eq!(weeks, vec![vec![day("2026-01-01", 4)]]);
    }

    #[test]
    fn fetch_github_window_errors_on_a_graphql_errors_field() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/graphql");
            then.status(200).json_body(json!({ "errors": [{ "message": "bad token" }] }));
        });
        let client = reqwest::blocking::Client::new();
        let now = Utc::now();
        let err = fetch_github_window(&client, &server.base_url(), "tok", "NCMBianchi", &(now - Duration::days(365)), &now).unwrap_err();
        assert!(err.to_string().contains("bad token"));
    }
}
