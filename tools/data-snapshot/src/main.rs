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
/// Show every language over this % of a repo's bytes, not just the single
/// GitHub-reported "primary" one — mirrors LANG_THRESHOLD in repos.js.
const LANG_THRESHOLD: f64 = 10.0;

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

/// GitHub's /languages endpoint returns {name: bytes, ...} for a repo —
/// converts that into (name, percent) pairs for every language over
/// `threshold_percent` of the repo's total bytes, highest first. Mirrors
/// computeLanguagePercentages() in repos.js; output feeds directly into a
/// `languages` field on the repo JSON, the same shape the client's own
/// renderCard() already expects from a live fetch.
fn compute_language_percentages(bytes_by_lang: &Value, threshold_percent: f64) -> Vec<(String, f64)> {
    let Some(obj) = bytes_by_lang.as_object() else { return Vec::new() };
    let total: f64 = obj.values().filter_map(|v| v.as_f64()).sum();
    if total == 0.0 {
        return Vec::new();
    }
    let mut langs: Vec<(String, f64)> = obj
        .iter()
        .filter_map(|(name, bytes)| {
            let percent = (bytes.as_f64()? / total) * 100.0;
            (percent > threshold_percent).then(|| (name.clone(), percent))
        })
        .collect();
    langs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    langs
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

fn fetch_orcid(client: &reqwest::blocking::Client, base_url: &str) -> Result<(Vec<Value>, Vec<Value>), Box<dyn Error>> {
    let works_url = format!("{base_url}/v3.0/{ORCID_ID}/works");
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
        let detail_url = format!("{base_url}/v3.0/{ORCID_ID}/work/{put_code}");
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
fn attach_citations(client: &reqwest::blocking::Client, base_url: &str, publications: &mut [Value]) {
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
        let url = format!("{base_url}/graph/v1/paper/DOI:{doi}?fields=citationCount");
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

fn fetch_github(client: &reqwest::blocking::Client, base_url: &str, token: Option<&str>) -> Result<Vec<Value>, Box<dyn Error>> {
    let list_url = format!("{base_url}/users/{GITHUB_OWNER}/repos?sort=updated&per_page=100");
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

        let commits_url = format!("{base_url}/repos/{GITHUB_OWNER}/{name}/commits?per_page=1");
        if let Ok(commits) = get_json(client, &commits_url, token) {
            if let Some(msg) = commits[0]["commit"]["message"].as_str() {
                repo["latestCommit"] = Value::String(truncate_commit_message(msg, MAX_COMMIT_MSG));
            }
        }

        if repo["fork"].as_bool() == Some(true) {
            let repo_url = format!("{base_url}/repos/{GITHUB_OWNER}/{name}");
            if let Ok(full) = get_json(client, &repo_url, token) {
                let parent_stars = full["parent"]["stargazers_count"].as_i64();
                let own_stars = repo["stargazers_count"].as_i64().unwrap_or(0);
                repo["stargazers_count"] = Value::from(total_stars(own_stars, parent_stars));
            }
        }

        let languages_url = format!("{base_url}/repos/{GITHUB_OWNER}/{name}/languages");
        if let Ok(bytes_by_lang) = get_json(client, &languages_url, token) {
            let langs = compute_language_percentages(&bytes_by_lang, LANG_THRESHOLD);
            repo["languages"] = Value::from(
                langs
                    .into_iter()
                    .map(|(name, percent)| serde_json::json!({ "name": name, "percent": percent }))
                    .collect::<Vec<_>>(),
            );
        }
    }

    Ok(repos)
}

fn main() -> Result<(), Box<dyn Error>> {
    let output_dir = env::var("SNAPSHOT_OUTPUT_DIR").unwrap_or_else(|_| "public/data".to_string());
    let github_token = env::var("GITHUB_TOKEN").ok();

    fs::create_dir_all(&output_dir)?;

    let orcid_client = reqwest::blocking::Client::new();
    let (mut publications, presentations) = fetch_orcid(&orcid_client, "https://pub.orcid.org")?;
    attach_citations(&orcid_client, "https://api.semanticscholar.org", &mut publications);
    fs::write(format!("{output_dir}/publications.json"), serde_json::to_string(&publications)?)?;
    fs::write(format!("{output_dir}/presentations.json"), serde_json::to_string(&presentations)?)?;
    println!("wrote {} publications, {} presentations", publications.len(), presentations.len());

    let github_client = reqwest::blocking::Client::new();
    let repos = fetch_github(&github_client, "https://api.github.com", github_token.as_deref())?;
    fs::write(format!("{output_dir}/repos.json"), serde_json::to_string(&repos)?)?;
    println!("wrote {} repos", repos.len());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
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

    #[test]
    fn compute_language_percentages_keeps_only_languages_over_threshold() {
        // real breakdown from umi-pipeline-nf: Python 51.7%, Nextflow 43.7%,
        // Shell 2.6%, Groovy 1.5%, Dockerfile 0.5% — only the first two clear 10%
        let bytes = json!({
            "Python": 57940, "Nextflow": 48995, "Shell": 2865, "Groovy": 1630, "Dockerfile": 606
        });
        let result = compute_language_percentages(&bytes, 10.0);
        let names: Vec<&str> = result.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["Python", "Nextflow"]);
        assert!(result[0].1 > result[1].1);
    }

    #[test]
    fn compute_language_percentages_keeps_a_single_dominant_language() {
        // real breakdown from the "fast" repo: Go 96.5%, Nix 3.5%
        let bytes = json!({ "Go": 21529, "Nix": 791 });
        let result = compute_language_percentages(&bytes, 10.0);
        let names: Vec<&str> = result.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["Go"]);
    }

    #[test]
    fn compute_language_percentages_empty_for_empty_or_non_object_input() {
        assert!(compute_language_percentages(&json!({}), 10.0).is_empty());
        assert!(compute_language_percentages(&json!(null), 10.0).is_empty());
    }

    #[test]
    fn compute_language_percentages_threshold_is_exclusive() {
        let bytes = json!({ "A": 10, "B": 90 });
        let result = compute_language_percentages(&bytes, 10.0);
        let names: Vec<&str> = result.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["B"]);
    }

    #[test]
    fn fetch_orcid_classifies_sorts_and_fetches_detail() {
        let server = MockServer::start();
        let works_mock = server.mock(|when, then| {
            when.method(GET).path(format!("/v3.0/{ORCID_ID}/works"));
            then.status(200).json_body(json!({ "group": [
                { "work-summary": [{ "type": "journal-article", "put-code": 1 }] },
                { "work-summary": [{ "type": "conference-presentation", "put-code": 2 }] },
                { "work-summary": [{ "type": "research-tool", "put-code": 3 }] }
            ] }));
        });
        let work1 = server.mock(|when, then| {
            when.method(GET).path(format!("/v3.0/{ORCID_ID}/work/1"));
            then.status(200).json_body(json!({ "put-code": 1, "publication-date": { "year": { "value": "2023" } } }));
        });
        let work2 = server.mock(|when, then| {
            when.method(GET).path(format!("/v3.0/{ORCID_ID}/work/2"));
            then.status(200).json_body(json!({ "put-code": 2, "publication-date": { "year": { "value": "2024" } } }));
        });
        let client = reqwest::blocking::Client::new();
        let (publications, presentations) = fetch_orcid(&client, &server.base_url()).unwrap();
        works_mock.assert();
        work1.assert();
        work2.assert();
        assert_eq!(publications.len(), 1);
        assert_eq!(publications[0]["put-code"], 1);
        assert_eq!(presentations.len(), 1);
        assert_eq!(presentations[0]["put-code"], 2);
    }

    #[test]
    fn attach_citations_sets_field_from_the_per_doi_lookup() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/graph/v1/paper/DOI:10.1/x");
            then.status(200).json_body(json!({ "citationCount": 3 }));
        });
        let client = reqwest::blocking::Client::new();
        let mut publications = vec![json!({
            "external-ids": { "external-id": [
                { "external-id-type": "doi", "external-id-value": "10.1/x" }
            ] }
        })];
        attach_citations(&client, &server.base_url(), &mut publications);
        mock.assert();
        assert_eq!(publications[0]["_citations"], 3);
    }

    #[test]
    fn attach_citations_skips_works_with_no_doi() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path_contains("/graph/v1/paper");
            then.status(200).json_body(json!({ "citationCount": 3 }));
        });
        let client = reqwest::blocking::Client::new();
        let mut publications = vec![json!({})];
        attach_citations(&client, &server.base_url(), &mut publications);
        assert_eq!(mock.hits(), 0);
        assert!(publications[0].get("_citations").is_none());
    }

    #[test]
    fn fetch_github_skips_repos_enriches_the_rest() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path(format!("/users/{GITHUB_OWNER}/repos"));
            then.status(200).json_body(json!([
                { "name": "ncmbianchi.github.io", "pushed_at": "2026-08-01T00:00:00Z", "fork": false },
                { "name": "umi-pipeline-nf", "pushed_at": "2026-07-01T00:00:00Z", "fork": false, "stargazers_count": 2 }
            ]));
        });
        let commits_mock = server.mock(|when, then| {
            when.method(GET).path(format!("/repos/{GITHUB_OWNER}/umi-pipeline-nf/commits"));
            then.status(200).json_body(json!([{ "commit": { "message": "fix bug\n\nbody" } }]));
        });
        let langs_mock = server.mock(|when, then| {
            when.method(GET).path(format!("/repos/{GITHUB_OWNER}/umi-pipeline-nf/languages"));
            then.status(200).json_body(json!({ "Python": 517, "Nextflow": 437, "Shell": 26 }));
        });
        let client = reqwest::blocking::Client::new();
        let repos = fetch_github(&client, &server.base_url(), None).unwrap();
        commits_mock.assert();
        langs_mock.assert();
        assert_eq!(repos.len(), 1); // profile-README repo skipped
        assert_eq!(repos[0]["name"], "umi-pipeline-nf");
        assert_eq!(repos[0]["latestCommit"], "fix bug");
        let langs: Vec<&str> = repos[0]["languages"].as_array().unwrap().iter()
            .map(|l| l["name"].as_str().unwrap()).collect();
        assert_eq!(langs, vec!["Python", "Nextflow"]); // Shell excluded, under 10%
    }

    #[test]
    fn fetch_github_sums_fork_and_parent_stars() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path(format!("/users/{GITHUB_OWNER}/repos"));
            then.status(200).json_body(json!([
                { "name": "fast", "pushed_at": "2026-08-01T00:00:00Z", "fork": true, "stargazers_count": 2 }
            ]));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/repos/{GITHUB_OWNER}/fast/commits"));
            then.status(404);
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/repos/{GITHUB_OWNER}/fast"));
            then.status(200).json_body(json!({ "parent": { "stargazers_count": 6 } }));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/repos/{GITHUB_OWNER}/fast/languages"));
            then.status(200).json_body(json!({ "Go": 965, "Nix": 35 }));
        });
        let client = reqwest::blocking::Client::new();
        let repos = fetch_github(&client, &server.base_url(), None).unwrap();
        assert_eq!(repos[0]["stargazers_count"], 8); // 2 own + 6 parent
    }
}
