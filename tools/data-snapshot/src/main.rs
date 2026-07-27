//! Deploy-time fallback snapshots for the client-side ORCID/GitHub fetches
//! (publications.js, presentations.js, repos.js). Runs as a step in
//! deploy.yml on every push to main, writing public/data/*.json — a
//! same-origin fallback the client reaches for only when *both* the live
//! API call and its own localStorage cache have failed/expired. Never
//! committed (public/data/ is gitignored); each deploy just regenerates it
//! fresh.
//!
//! Deliberately mirrors the client's own enrichment (ORCID work-detail
//! fan-out, GitHub commit/fork-star lookups) so the output shape is exactly
//! what publications.js/presentations.js/repos.js's existing renderCard()
//! functions already expect — the client reuses that same code unchanged
//! for cached data, no special-casing needed.

use serde_json::Value;
use std::env;
use std::error::Error;
use std::fs;

const ORCID_ID: &str = "0009-0000-4202-7154";
const GITHUB_OWNER: &str = "NCMBianchi";
const REPO_LIMIT: usize = 6;
const MAX_COMMIT_MSG: usize = 60;

/// Repos to skip: the profile README repo, and this portfolio
/// site's own repo (mirrors SKIP_REPOS in repos.js).
const SKIP_REPOS: &[&str] = &[GITHUB_OWNER, "ncmbianchi.github.io"];

const PUB_TYPES: &[&str] = &[
    "journal-article",
    "preprint",
    "conference-paper",
    "conference-abstract",
    "book-chapter",
    "review",
];
const PRES_TYPES: &[&str] = &[
    "conference-presentation",
    "presentation",
    "lecture-speech",
    "conference-poster",
    "other-presentation",
];

/// `Some(true)` = publication, `Some(false)` = presentation, `None` = neither
/// (the type belongs on repos.html instead, e.g. `research-tool`).
fn classify_work_type(work_type: &str) -> Option<bool> {
    if PUB_TYPES.contains(&work_type) {
        Some(true)
    } else if PRES_TYPES.contains(&work_type) {
        Some(false)
    } else {
        None
    }
}

/// Sort key (descending) for a work's `publication-date.year.value` — missing
/// or unparseable years sort last.
fn year_of(w: &Value) -> i64 {
    w["publication-date"]["year"]["value"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

/// Mirrors `repos.js`'s own truncation of a commit's first line to
/// `MAX_COMMIT_MSG` chars, `…`-suffixed at a trimmed boundary.
fn truncate_commit_message(msg: &str, max_len: usize) -> String {
    let first_line = msg.split('\n').next().unwrap_or("");
    if first_line.len() > max_len {
        format!("{}…", &first_line[..max_len - 1].trim_end())
    } else {
        first_line.to_string()
    }
}

/// A fork's own star count plus its parent's, if it has one — mirrors
/// `attachForkParentStars()` in `repos.js`.
fn total_stars(own: i64, parent_stars: Option<i64>) -> i64 {
    match parent_stars {
        Some(p) => own + p,
        None => own,
    }
}

/// True for repos that aren't real projects to show (the profile README
/// repo, this portfolio site's own repo) — mirrors SKIP_REPOS in repos.js.
fn is_skipped_repo(name: &str) -> bool {
    SKIP_REPOS.contains(&name)
}

fn get_json(client: &reqwest::blocking::Client, url: &str, token: Option<&str>) -> Result<Value, Box<dyn Error>> {
    let mut req = client
        .get(url)
        .header("User-Agent", "ncmbianchi-data-snapshot")
        .header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    Ok(req.send()?.json()?)
}

fn fetch_orcid(client: &reqwest::blocking::Client) -> Result<(Vec<Value>, Vec<Value>), Box<dyn Error>> {
    let works_url = format!("https://pub.orcid.org/v3.0/{ORCID_ID}/works");
    let works: Value = client
        .get(&works_url)
        .header("Accept", "application/json")
        .send()?
        .json()?;

    let mut publications = Vec::new();
    let mut presentations = Vec::new();

    for group in works["group"].as_array().ok_or("no group array")? {
        let summary = &group["work-summary"][0];
        let work_type = summary["type"].as_str().unwrap_or("");
        let Some(is_pub) = classify_work_type(work_type) else { continue };
        let put_code = summary["put-code"].as_i64().ok_or("no put-code")?;
        let detail_url = format!("https://pub.orcid.org/v3.0/{ORCID_ID}/work/{put_code}");
        let detail: Value = client
            .get(&detail_url)
            .header("Accept", "application/json")
            .send()?
            .json()?;
        if is_pub {
            publications.push(detail);
        } else {
            presentations.push(detail);
        }
    }

    publications.sort_by_key(|w| -year_of(w));
    presentations.sort_by_key(|w| -year_of(w));

    Ok((publications, presentations))
}

/* Mirrors attachCitations() in publications.js — attaches each publication's
   own (unambiguous, per-DOI) citationCount from Semantic Scholar's free
   public API as a "_citations" field, rather than using
   authors.citationCount/hIndex. Those are aggregated across whichever body
   of work Semantic Scholar's own name-based author clustering has merged
   together, which for a name as common as "Niccolò Bianchi" turned out to
   be unreliable — see the longer note in publications.js. No h-index: it's
   inherently an author-level aggregate, so there's no per-paper equivalent
   to use instead. */
fn attach_citations(client: &reqwest::blocking::Client, publications: &mut [Value]) {
    for work in publications.iter_mut() {
        let doi = work["external-ids"]["external-id"]
            .as_array()
            .and_then(|ids| {
                ids.iter().find_map(|id| {
                    (id["external-id-type"].as_str() == Some("doi"))
                        .then(|| id["external-id-value"].as_str())
                        .flatten()
                })
            })
            .map(str::to_string);

        let Some(doi) = doi else { continue };
        let url = format!("https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=citationCount");
        if let Some(count) = client
            .get(&url)
            .send()
            .ok()
            .and_then(|r| r.json::<Value>().ok())
            .and_then(|p| p["citationCount"].as_i64())
        {
            work["_citations"] = Value::from(count);
        }
    }
}

fn fetch_github(client: &reqwest::blocking::Client, token: Option<&str>) -> Result<Vec<Value>, Box<dyn Error>> {
    let list_url = format!("https://api.github.com/users/{GITHUB_OWNER}/repos?sort=updated&per_page=100");
    let all_repos: Vec<Value> = get_json(client, &list_url, token)?
        .as_array()
        .ok_or("expected repos array")?
        .clone();

    let mut repos: Vec<Value> = all_repos
        .into_iter()
        .filter(|r| !is_skipped_repo(r["name"].as_str().unwrap_or("")))
        .collect();
    repos.sort_by(|a, b| b["pushed_at"].as_str().cmp(&a["pushed_at"].as_str()));
    repos.truncate(REPO_LIMIT);

    for repo in repos.iter_mut() {
        let name = repo["name"].as_str().ok_or("repo missing name")?.to_string();

        let commits_url = format!("https://api.github.com/repos/{GITHUB_OWNER}/{name}/commits?per_page=1");
        if let Ok(commits) = get_json(client, &commits_url, token) {
            if let Some(msg) = commits[0]["commit"]["message"].as_str() {
                repo["latestCommit"] = Value::String(truncate_commit_message(msg, MAX_COMMIT_MSG));
            }
        }

        if repo["fork"].as_bool() == Some(true) {
            let repo_url = format!("https://api.github.com/repos/{GITHUB_OWNER}/{name}");
            if let Ok(full) = get_json(client, &repo_url, token) {
                let parent_stars = full["parent"]["stargazers_count"].as_i64();
                let own_stars = repo["stargazers_count"].as_i64().unwrap_or(0);
                repo["stargazers_count"] = Value::from(total_stars(own_stars, parent_stars));
            }
        }
    }

    Ok(repos)
}

fn main() -> Result<(), Box<dyn Error>> {
    let output_dir = env::var("SNAPSHOT_OUTPUT_DIR").unwrap_or_else(|_| "public/data".to_string());
    let github_token = env::var("GITHUB_TOKEN").ok();

    fs::create_dir_all(&output_dir)?;

    let orcid_client = reqwest::blocking::Client::new();
    let (mut publications, presentations) = fetch_orcid(&orcid_client)?;
    attach_citations(&orcid_client, &mut publications);
    fs::write(format!("{output_dir}/publications.json"), serde_json::to_string(&publications)?)?;
    fs::write(format!("{output_dir}/presentations.json"), serde_json::to_string(&presentations)?)?;
    println!("wrote {} publications, {} presentations", publications.len(), presentations.len());

    let github_client = reqwest::blocking::Client::new();
    let repos = fetch_github(&github_client, github_token.as_deref())?;
    fs::write(format!("{output_dir}/repos.json"), serde_json::to_string(&repos)?)?;
    println!("wrote {} repos", repos.len());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classify_work_type_publications() {
        assert_eq!(classify_work_type("journal-article"), Some(true));
        assert_eq!(classify_work_type("preprint"), Some(true));
    }

    #[test]
    fn classify_work_type_presentations() {
        assert_eq!(classify_work_type("conference-presentation"), Some(false));
        assert_eq!(classify_work_type("lecture-speech"), Some(false));
    }

    #[test]
    fn classify_work_type_neither() {
        assert_eq!(classify_work_type("research-tool"), None);
        assert_eq!(classify_work_type(""), None);
    }

    #[test]
    fn year_of_reads_publication_date() {
        let w = json!({ "publication-date": { "year": { "value": "2024" } } });
        assert_eq!(year_of(&w), 2024);
    }

    #[test]
    fn year_of_defaults_to_zero_when_missing() {
        assert_eq!(year_of(&json!({})), 0);
        assert_eq!(year_of(&json!({ "publication-date": { "year": { "value": "not-a-year" } } })), 0);
    }

    #[test]
    fn truncate_commit_message_short_untouched() {
        assert_eq!(truncate_commit_message("fix bug", 60), "fix bug");
    }

    #[test]
    fn truncate_commit_message_takes_first_line_only() {
        assert_eq!(truncate_commit_message("fix bug\n\nlonger body here", 60), "fix bug");
    }

    #[test]
    fn truncate_commit_message_truncates_long_line() {
        let msg = "a".repeat(80);
        let result = truncate_commit_message(&msg, 60);
        assert_eq!(result.chars().count(), 60); // 59 'a's + '…'
        assert!(result.ends_with('…'));
    }

    #[test]
    fn total_stars_sums_when_fork_has_parent() {
        assert_eq!(total_stars(2, Some(6)), 8);
    }

    #[test]
    fn total_stars_own_only_when_no_parent() {
        assert_eq!(total_stars(5, None), 5);
    }

    #[test]
    fn is_skipped_repo_matches_profile_and_site_repos() {
        assert!(is_skipped_repo("NCMBianchi"));
        assert!(is_skipped_repo("ncmbianchi.github.io"));
    }

    #[test]
    fn is_skipped_repo_leaves_real_projects_alone() {
        assert!(!is_skipped_repo("umi-pipeline-nf"));
    }
}
