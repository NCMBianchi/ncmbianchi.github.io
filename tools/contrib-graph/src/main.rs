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
//!
//! Also writes `public/assets/languages.json` — an aggregate language
//! breakdown across every owned repo on all three sources (GitHub, Gitea,
//! GitLab; forks excluded), for skills.html's language bar. Only
//! languages over LANG_THRESHOLD% of a given repo's own bytes are kept
//! (per repo, same as repos.js/data-snapshot's per-card tags), then summed
//! across every repo before computing the final aggregate percentages —
//! so a language can legitimately show under LANG_THRESHOLD% here even
//! though it cleared it in at least one contributing repo.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs;

const YEARS_OF_HISTORY: i64 = 2;

/// Only languages over this % of a REPO'S OWN bytes are kept — mirrors
/// LANG_THRESHOLD in repos.js/data-snapshot exactly. Applied per repo,
/// before summing across repos/sources, so a language can legitimately
/// end up under this threshold in the final aggregate (it only needs to
/// have cleared it in at least one individual repo along the way) — not a
/// second cutoff applied to the aggregate itself.
const LANG_THRESHOLD: f64 = 10.0;

/// Same Afterglow tokens already assigned to each language's `.tag--*`
/// class in style.css/repos.js — reused here rather than re-picked, so a
/// language's colour means the same thing on repos.html and skills.html.
/// HTML/CSS have no existing `.tag--*` (no repo has shown them over
/// threshold yet) — picked the same accent tokens their own skill-icon
/// hover colours already use, for the same reason.
const LANG_COLORS: &[(&str, &str)] = &[
    ("Python", "#7e8e50"),
    ("R", "#6c99bb"),
    ("JavaScript", "#e5b567"),
    ("Rust", "#ac4142"),
    ("Shell", "#ff8800"),
    ("Go", "#7dd6cf"),
    ("Nextflow", "#7dd6cf"),
    ("Groovy", "#6c99bb"),
    ("Dockerfile", "#6c99bb"),
    ("Nix", "#6c99bb"),
    ("HTML", "#ff8800"),
    ("CSS", "#9f4e85"),
];
const OTHER_COLOR: &str = "#4d4d4d";

#[derive(Serialize, Debug, PartialEq, Clone)]
struct LangSlice {
    name: String,
    percent: f64,
    color: String,
}

/// From one repo's raw {language: bytes} map, keeps only languages over
/// `LANG_THRESHOLD`% of THAT repo's own total, returning their original
/// byte counts (not re-percentaged) alongside the repo's true total byte
/// count — callers sum both across many repos before computing final
/// percentages, so the true total (not just survivors) has to travel
/// along too.
fn repo_languages_over_threshold(bytes_by_lang: &BTreeMap<String, f64>, threshold_percent: f64) -> (Vec<(String, f64)>, f64) {
    let total: f64 = bytes_by_lang.values().sum();
    if total == 0.0 {
        return (Vec::new(), 0.0);
    }
    let survivors = bytes_by_lang
        .iter()
        .filter(|(_, &bytes)| (bytes / total) * 100.0 > threshold_percent)
        .map(|(name, &bytes)| (name.clone(), bytes))
        .collect();
    (survivors, total)
}

/// Sums each repo's already-filtered survivor bytes per language, and each
/// repo's true total (not just survivors), across every repo from every
/// source — then converts to final percentages of that grand total, so a
/// language can end up under `LANG_THRESHOLD`% here even though every one
/// of its contributing repos individually cleared it. Sorted descending;
/// "Other" (whatever the per-repo filter dropped) is pinned last
/// regardless of size, same convention GitHub's own language bar uses.
fn aggregate_languages(per_repo: Vec<(Vec<(String, f64)>, f64)>) -> Vec<LangSlice> {
    let mut totals: BTreeMap<String, f64> = BTreeMap::new();
    let mut grand_total = 0.0;
    for (survivors, repo_total) in per_repo {
        grand_total += repo_total;
        for (name, bytes) in survivors {
            *totals.entry(name).or_insert(0.0) += bytes;
        }
    }
    if grand_total == 0.0 {
        return Vec::new();
    }

    let color_for = |name: &str| -> String {
        LANG_COLORS
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, c)| c.to_string())
            .unwrap_or_else(|| OTHER_COLOR.to_string())
    };

    let mut slices: Vec<LangSlice> = totals
        .iter()
        .map(|(name, &bytes)| LangSlice { name: name.clone(), percent: (bytes / grand_total) * 100.0, color: color_for(name) })
        .collect();
    slices.sort_by(|a, b| b.percent.partial_cmp(&a.percent).unwrap_or(std::cmp::Ordering::Equal));

    let survivors_total: f64 = slices.iter().map(|s| s.percent).sum();
    let other_percent = (100.0 - survivors_total).max(0.0);
    if other_percent > 0.01 {
        slices.push(LangSlice { name: "Other".to_string(), percent: other_percent, color: OTHER_COLOR.to_string() });
    }
    slices
}

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

const LANGUAGES_QUERY: &str = r#"
query($login: String!, $after: String) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, isFork: false, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        languages(first: 20, orderBy: {field: SIZE, direction: DESC}) {
          totalSize
          edges { size node { name } }
        }
      }
    }
  }
}
"#;

/// One (bytes-by-language, repo's true total bytes) pair per repo — raw,
/// unfiltered, so every fetcher below returns the same shape regardless of
/// source and `repo_languages_over_threshold` gets applied once, centrally,
/// in `main`. Owner repos only, forks excluded — mirrors the GitHub
/// top-languages approach already scoped for a future Skills feature.
/// Paginates (GraphQL caps a single page at 100 repos) since a personal
/// account can exceed 50 repos over time.
fn fetch_github_repo_languages(
    client: &reqwest::blocking::Client,
    base_url: &str,
    token: &str,
    login: &str,
) -> Result<Vec<(BTreeMap<String, f64>, f64)>, Box<dyn Error>> {
    let mut repos = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let body = serde_json::json!({
            "query": LANGUAGES_QUERY,
            "variables": { "login": login, "after": after }
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

        let repos_json = resp["data"]["user"]["repositories"]["nodes"]
            .as_array()
            .ok_or("unexpected response shape: no repositories.nodes array")?;

        for node in repos_json {
            let total = node["languages"]["totalSize"].as_f64().unwrap_or(0.0);
            let mut bytes_by_lang = BTreeMap::new();
            if let Some(edges) = node["languages"]["edges"].as_array() {
                for edge in edges {
                    let name = edge["node"]["name"].as_str().unwrap_or("").to_string();
                    let size = edge["size"].as_f64().unwrap_or(0.0);
                    if !name.is_empty() {
                        bytes_by_lang.insert(name, size);
                    }
                }
            }
            repos.push((bytes_by_lang, total));
        }

        let page_info = &resp["data"]["user"]["repositories"]["pageInfo"];
        if page_info["hasNextPage"].as_bool() == Some(true) {
            after = page_info["endCursor"].as_str().map(|s| s.to_string());
        } else {
            break;
        }
    }
    Ok(repos)
}

/// Gitea's REST API mirrors GitHub's shape closely — a repo list, then a
/// per-repo `{language: bytes}` map. Paginates the repo list the same way
/// `fetch_gitlab_events` already does.
fn fetch_gitea_repo_languages(
    client: &reqwest::blocking::Client,
    base_url: &str,
    username: &str,
    token: Option<&str>,
) -> Result<Vec<(BTreeMap<String, f64>, f64)>, Box<dyn Error>> {
    let mut repos = Vec::new();
    let mut page = 1;
    loop {
        let list_url = format!("{base_url}/api/v1/users/{username}/repos?limit=50&page={page}");
        let mut req = client.get(&list_url).header("User-Agent", "ncmbianchi-contrib-graph");
        if let Some(t) = token {
            req = req.header("Authorization", format!("token {t}"));
        }
        let page_repos: Vec<serde_json::Value> = req.send()?.json()?;
        if page_repos.is_empty() {
            break;
        }

        for repo in &page_repos {
            let Some(full_name) = repo["full_name"].as_str() else { continue };
            let lang_url = format!("{base_url}/api/v1/repos/{full_name}/languages");
            let mut lang_req = client.get(&lang_url).header("User-Agent", "ncmbianchi-contrib-graph");
            if let Some(t) = token {
                lang_req = lang_req.header("Authorization", format!("token {t}"));
            }
            let Ok(bytes_by_lang) = lang_req.send().and_then(|r| r.json::<BTreeMap<String, f64>>()) else { continue };
            let total = bytes_by_lang.values().sum();
            repos.push((bytes_by_lang, total));
        }

        page += 1;
        if page > 20 {
            break; // safety cap, same spirit as fetch_gitlab_events
        }
    }
    Ok(repos)
}

/// GitLab's languages endpoint returns *percentages* per project, not raw
/// bytes — the one real asymmetry across the three sources (documented in
/// CLAUDE.md before this was built). Approximates each language's bytes as
/// `repository_size * percent / 100` using the project's own
/// `statistics.repository_size` (needs `statistics=true` + at least
/// Reporter role, which an owner's own token always has for owned
/// projects) — an honest approximation, not exact, but puts GitLab on the
/// same bytes-summed footing as GitHub/Gitea rather than being left out or
/// weighted as "1 project = 1 unit" against differently-sized repos.
fn fetch_gitlab_repo_languages(
    client: &reqwest::blocking::Client,
    base_url: &str,
    token: &str,
) -> Result<Vec<(BTreeMap<String, f64>, f64)>, Box<dyn Error>> {
    let mut repos = Vec::new();
    let mut page = 1;
    loop {
        let list_url = format!("{base_url}/api/v4/projects?owned=true&statistics=true&per_page=100&page={page}");
        let page_projects: Vec<serde_json::Value> = client
            .get(&list_url)
            .header("PRIVATE-TOKEN", token)
            .header("User-Agent", "ncmbianchi-contrib-graph")
            .send()?
            .json()?;
        if page_projects.is_empty() {
            break;
        }

        for project in &page_projects {
            let Some(id) = project["id"].as_i64() else { continue };
            let Some(repo_size) = project["statistics"]["repository_size"].as_f64() else { continue };
            if repo_size <= 0.0 {
                continue;
            }
            let lang_url = format!("{base_url}/api/v4/projects/{id}/languages");
            let Ok(percents) = client
                .get(&lang_url)
                .header("PRIVATE-TOKEN", token)
                .header("User-Agent", "ncmbianchi-contrib-graph")
                .send()
                .and_then(|r| r.json::<BTreeMap<String, f64>>())
            else {
                continue;
            };
            let bytes_by_lang: BTreeMap<String, f64> =
                percents.into_iter().map(|(name, pct)| (name, repo_size * pct / 100.0)).collect();
            repos.push((bytes_by_lang, repo_size));
        }

        page += 1;
        if page > 20 {
            break;
        }
    }
    Ok(repos)
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
    let gitea_username = env::var("GITEA_USERNAME").unwrap_or_else(|_| "kuroi".to_string());
    let gitea_token = env::var("GITEA_TOKEN").ok().filter(|v| !v.is_empty());
    let gitlab_token = env::var("GITLAB_TOKEN").ok().filter(|v| !v.is_empty());

    let mut per_repo_languages: Vec<(Vec<(String, f64)>, f64)> = Vec::new();

    match fetch_github_repo_languages(&client, &github_api, &token, &login) {
        Ok(repos) => {
            println!("fetched language data from {} GitHub repos", repos.len());
            for (bytes_map, total) in repos {
                per_repo_languages.push((repo_languages_over_threshold(&bytes_map, LANG_THRESHOLD).0, total));
            }
        }
        Err(e) => eprintln!("warning: GitHub language fetch failed, skipping: {e}"),
    }

    if let Some(gitea_url) = &gitea_url {
        match fetch_gitea_heatmap(&client, gitea_url, &gitea_username, gitea_token.as_deref()) {
            Ok(days) => {
                println!("fetched {} days from Gitea", days.len());
                sources.push(days);
            }
            Err(e) => eprintln!("warning: Gitea fetch failed, skipping: {e}"),
        }
        match fetch_gitea_repo_languages(&client, gitea_url, &gitea_username, gitea_token.as_deref()) {
            Ok(repos) => {
                println!("fetched language data from {} Gitea repos", repos.len());
                for (bytes_map, total) in repos {
                    per_repo_languages.push((repo_languages_over_threshold(&bytes_map, LANG_THRESHOLD).0, total));
                }
            }
            Err(e) => eprintln!("warning: Gitea language fetch failed, skipping: {e}"),
        }
    }

    if let Some(gitlab_url) = &gitlab_url {
        match &gitlab_token {
            Some(gitlab_token) => {
                let after = (now - Duration::days(365 * YEARS_OF_HISTORY)).format("%Y-%m-%d").to_string();
                let before = now.format("%Y-%m-%d").to_string();
                match fetch_gitlab_events(&client, gitlab_url, gitlab_token, &after, &before) {
                    Ok(days) => {
                        println!("fetched {} days from GitLab", days.len());
                        sources.push(days);
                    }
                    Err(e) => eprintln!("warning: GitLab fetch failed, skipping: {e}"),
                }
                match fetch_gitlab_repo_languages(&client, gitlab_url, gitlab_token) {
                    Ok(repos) => {
                        println!("fetched language data from {} GitLab repos", repos.len());
                        for (bytes_map, total) in repos {
                            per_repo_languages.push((repo_languages_over_threshold(&bytes_map, LANG_THRESHOLD).0, total));
                        }
                    }
                    Err(e) => eprintln!("warning: GitLab language fetch failed, skipping: {e}"),
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

    let languages = aggregate_languages(per_repo_languages);
    let lang_output_path = env::var("LANGUAGES_OUTPUT_PATH")
        .unwrap_or_else(|_| "public/assets/languages.json".to_string());
    let lang_json = serde_json::to_string(&languages)?;
    fs::write(&lang_output_path, lang_json)?;
    println!("wrote {} language slices to {lang_output_path}", languages.len());

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
    fn repo_languages_over_threshold_keeps_only_survivors_and_returns_true_total() {
        // same real umi-pipeline-nf breakdown used in data-snapshot's tests
        let mut bytes = BTreeMap::new();
        bytes.insert("Python".to_string(), 57940.0);
        bytes.insert("Nextflow".to_string(), 48995.0);
        bytes.insert("Shell".to_string(), 2865.0);
        let (survivors, total) = repo_languages_over_threshold(&bytes, LANG_THRESHOLD);
        let names: Vec<&str> = survivors.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["Nextflow", "Python"]); // BTreeMap iteration order (alphabetical)
        assert_eq!(total, 57940.0 + 48995.0 + 2865.0); // true total, not just survivors
    }

    #[test]
    fn repo_languages_over_threshold_empty_for_zero_bytes() {
        let (survivors, total) = repo_languages_over_threshold(&BTreeMap::new(), LANG_THRESHOLD);
        assert!(survivors.is_empty());
        assert_eq!(total, 0.0);
    }

    #[test]
    fn aggregate_languages_can_show_a_language_under_threshold_overall() {
        // Python clears 10% in repo A (60%) but the grand total (dominated by
        // repo B's Rust) pushes Python's own aggregate share under 10% —
        // exactly the case the per-repo-then-sum design is meant to allow.
        let repo_a = (vec![("Python".to_string(), 60.0)], 100.0);
        let repo_b = (vec![("Rust".to_string(), 950.0)], 1000.0);
        let slices = aggregate_languages(vec![repo_a, repo_b]);
        let python = slices.iter().find(|s| s.name == "Python").unwrap();
        assert!(python.percent < 10.0);
        assert!(python.percent > 0.0);
    }

    #[test]
    fn aggregate_languages_sums_across_repos_and_sorts_descending() {
        let repo_a = (vec![("Python".to_string(), 80.0)], 100.0);
        let repo_b = (vec![("Python".to_string(), 20.0), ("Rust".to_string(), 90.0)], 100.0);
        let slices = aggregate_languages(vec![repo_a, repo_b]);
        assert_eq!(slices[0].name, "Python"); // (80+20)/200 = 50%
        assert_eq!(slices[0].percent, 50.0);
        assert_eq!(slices[1].name, "Rust"); // 90/200 = 45%
        assert_eq!(slices[1].percent, 45.0);
    }

    #[test]
    fn aggregate_languages_pins_other_last_regardless_of_size() {
        // repo has 95% Python (survives), 5% Shell (dropped by the per-repo
        // filter) — Other should represent that dropped 5%, sorted last
        // even though 5% would otherwise sort before nothing else here.
        let repo = (vec![("Python".to_string(), 95.0)], 100.0);
        let slices = aggregate_languages(vec![repo]);
        assert_eq!(slices.last().unwrap().name, "Other");
        assert!((slices.last().unwrap().percent - 5.0).abs() < 0.01);
    }

    #[test]
    fn aggregate_languages_assigns_known_colors_and_falls_back_for_unknown() {
        let repo = (vec![("Python".to_string(), 100.0)], 100.0);
        let slices = aggregate_languages(vec![repo]);
        assert_eq!(slices[0].color, "#7e8e50"); // matches .tag--python
    }

    #[test]
    fn aggregate_languages_empty_input_yields_empty_output() {
        assert!(aggregate_languages(Vec::new()).is_empty());
    }

    #[test]
    fn fetch_github_repo_languages_paginates_and_reads_totalsize() {
        let server = MockServer::start();
        let page1 = server.mock(|when, then| {
            when.method(POST).path("/graphql").body_contains("\"after\":null");
            then.status(200).json_body(json!({
                "data": { "user": { "repositories": {
                    "pageInfo": { "hasNextPage": true, "endCursor": "CURSOR1" },
                    "nodes": [ { "languages": { "totalSize": 1000, "edges": [
                        { "size": 900, "node": { "name": "Python" } },
                        { "size": 100, "node": { "name": "Shell" } }
                    ] } } ]
                } } }
            }));
        });
        let page2 = server.mock(|when, then| {
            when.method(POST).path("/graphql").body_contains("CURSOR1");
            then.status(200).json_body(json!({
                "data": { "user": { "repositories": {
                    "pageInfo": { "hasNextPage": false, "endCursor": null },
                    "nodes": [ { "languages": { "totalSize": 500, "edges": [
                        { "size": 500, "node": { "name": "Rust" } }
                    ] } } ]
                } } }
            }));
        });
        let client = reqwest::blocking::Client::new();
        let repos = fetch_github_repo_languages(&client, &server.base_url(), "tok", "NCMBianchi").unwrap();
        page1.assert();
        page2.assert();
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].1, 1000.0);
        assert_eq!(repos[0].0.get("Python"), Some(&900.0));
        assert_eq!(repos[1].1, 500.0);
    }

    #[test]
    fn fetch_gitea_repo_languages_lists_then_fetches_each_repo() {
        let server = MockServer::start();
        let list = server.mock(|when, then| {
            when.method(GET).path("/api/v1/users/kuroi/repos").query_param("page", "1");
            then.status(200).json_body(json!([ { "full_name": "kuroi/myrepo" } ]));
        });
        let empty_page = server.mock(|when, then| {
            when.method(GET).path("/api/v1/users/kuroi/repos").query_param("page", "2");
            then.status(200).json_body(json!([]));
        });
        let langs = server.mock(|when, then| {
            when.method(GET).path("/api/v1/repos/kuroi/myrepo/languages");
            then.status(200).json_body(json!({ "Python": 800.0, "Shell": 200.0 }));
        });
        let client = reqwest::blocking::Client::new();
        let repos = fetch_gitea_repo_languages(&client, &server.base_url(), "kuroi", None).unwrap();
        list.assert();
        empty_page.assert();
        langs.assert();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].1, 1000.0);
    }

    #[test]
    fn fetch_gitlab_repo_languages_converts_percent_to_approx_bytes() {
        let server = MockServer::start();
        let list = server.mock(|when, then| {
            when.method(GET).path("/api/v4/projects").query_param("page", "1");
            then.status(200).json_body(json!([
                { "id": 42, "statistics": { "repository_size": 2000 } }
            ]));
        });
        let empty_page = server.mock(|when, then| {
            when.method(GET).path("/api/v4/projects").query_param("page", "2");
            then.status(200).json_body(json!([]));
        });
        let langs = server.mock(|when, then| {
            when.method(GET).path("/api/v4/projects/42/languages");
            then.status(200).json_body(json!({ "Ruby": 75.0, "JavaScript": 25.0 }));
        });
        let client = reqwest::blocking::Client::new();
        let repos = fetch_gitlab_repo_languages(&client, &server.base_url(), "tok").unwrap();
        list.assert();
        empty_page.assert();
        langs.assert();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].1, 2000.0);
        assert_eq!(repos[0].0.get("Ruby"), Some(&1500.0)); // 75% of 2000
        assert_eq!(repos[0].0.get("JavaScript"), Some(&500.0)); // 25% of 2000
    }

    #[test]
    fn fetch_gitlab_repo_languages_skips_projects_missing_statistics() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/api/v4/projects").query_param("page", "1");
            then.status(200).json_body(json!([ { "id": 7 } ])); // no statistics field
        });
        server.mock(|when, then| {
            when.method(GET).path("/api/v4/projects").query_param("page", "2");
            then.status(200).json_body(json!([]));
        });
        let client = reqwest::blocking::Client::new();
        let repos = fetch_gitlab_repo_languages(&client, &server.base_url(), "tok").unwrap();
        assert!(repos.is_empty());
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
