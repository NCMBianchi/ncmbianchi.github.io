//! Fetches and caches skills.html's real icon SVGs — grey default,
//! fixed hover colour, and (for tiles tagged data-lang) the language-bar
//! hover colour — into public/assets/icons/, once, so a visitor's
//! browser never hotlinks the third-party icon CDNs (cdn.simpleicons.org,
//! api.iconify.design) directly. `skills.html` and `js/skills-languages.js`
//! reference these local files instead of the CDNs.
//!
//! Skip-if-exists: a file already committed from a previous run is never
//! re-fetched. Manual-only: needs (re-)running via
//! .github/workflows/icon-cache.yml's dispatch.

use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

struct IconSpec {
    name: &'static str,
    grey_url: &'static str,
    color_url: &'static str,
    lang_hex: Option<&'static str>,
}

const ICONS: &[IconSpec] = &[
    IconSpec {
        name: "pandas",
        grey_url: "https://cdn.simpleicons.org/pandas/9a9a95",
        color_url: "https://cdn.simpleicons.org/pandas/9f4e85",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "numpy",
        grey_url: "https://cdn.simpleicons.org/numpy/9a9a95",
        color_url: "https://cdn.simpleicons.org/numpy/6c99bb",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "scipy",
        grey_url: "https://cdn.simpleicons.org/scipy/9a9a95",
        color_url: "https://cdn.simpleicons.org/scipy/6c99bb",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "plotly",
        grey_url: "https://cdn.simpleicons.org/plotly/9a9a95",
        color_url: "https://cdn.simpleicons.org/plotly/6c99bb",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "matplotlib",
        grey_url: "https://api.iconify.design/devicon-plain/matplotlib.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/devicon-plain/matplotlib.svg?color=%236c99bb",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "seaborn",
        grey_url: "https://api.iconify.design/devicon-plain/seaborn.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/devicon-plain/seaborn.svg?color=%236c99bb",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "deepmind",
        grey_url: "https://cdn.simpleicons.org/deepmind/9a9a95",
        color_url: "https://cdn.simpleicons.org/deepmind/6c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "python",
        grey_url: "https://cdn.simpleicons.org/python/9a9a95",
        color_url: "https://cdn.simpleicons.org/python/6c99bb",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "jupyter",
        grey_url: "https://cdn.simpleicons.org/jupyter/9a9a95",
        color_url: "https://cdn.simpleicons.org/jupyter/ff8800",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "r",
        grey_url: "https://cdn.simpleicons.org/r/9a9a95",
        color_url: "https://cdn.simpleicons.org/r/6c99bb",
        lang_hex: Some("6c99bb"),
    },
    IconSpec {
        name: "git",
        grey_url: "https://cdn.simpleicons.org/git/9a9a95",
        color_url: "https://cdn.simpleicons.org/git/ac4142",
        lang_hex: None,
    },
    IconSpec {
        name: "mysql",
        grey_url: "https://api.iconify.design/tabler/brand-mysql.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/tabler/brand-mysql.svg?color=%236c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "mariadb",
        grey_url: "https://cdn.simpleicons.org/mariadb/9a9a95",
        color_url: "https://cdn.simpleicons.org/mariadb/6c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "dbeaver",
        grey_url: "https://cdn.simpleicons.org/dbeaver/9a9a95",
        color_url: "https://cdn.simpleicons.org/dbeaver/ac4142",
        lang_hex: None,
    },
    IconSpec {
        name: "pytorch",
        grey_url: "https://cdn.simpleicons.org/pytorch/9a9a95",
        color_url: "https://cdn.simpleicons.org/pytorch/ac4142",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "html5",
        grey_url: "https://cdn.simpleicons.org/html5/9a9a95",
        color_url: "https://cdn.simpleicons.org/html5/ff8800",
        lang_hex: None,
    },
    IconSpec {
        name: "css",
        grey_url: "https://cdn.simpleicons.org/css/9a9a95",
        color_url: "https://cdn.simpleicons.org/css/9f4e85",
        lang_hex: Some("9f4e85"),
    },
    IconSpec {
        name: "javascript",
        grey_url: "https://cdn.simpleicons.org/javascript/9a9a95",
        color_url: "https://cdn.simpleicons.org/javascript/e5b567",
        lang_hex: Some("e5b567"),
    },
    IconSpec {
        name: "apachespark",
        grey_url: "https://cdn.simpleicons.org/apachespark/9a9a95",
        color_url: "https://cdn.simpleicons.org/apachespark/ff8800",
        lang_hex: None,
    },
    IconSpec {
        name: "flask",
        grey_url: "https://cdn.simpleicons.org/flask/9a9a95",
        color_url: "https://cdn.simpleicons.org/flask/7dd6cf",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "graphql",
        grey_url: "https://cdn.simpleicons.org/graphql/9a9a95",
        color_url: "https://cdn.simpleicons.org/graphql/9f4e85",
        lang_hex: None,
    },
    IconSpec {
        name: "rust",
        grey_url: "https://cdn.simpleicons.org/rust/9a9a95",
        color_url: "https://cdn.simpleicons.org/rust/f2f2ee",
        lang_hex: Some("ac4142"),
    },
    IconSpec {
        name: "bun",
        grey_url: "https://cdn.simpleicons.org/bun/9a9a95",
        color_url: "https://cdn.simpleicons.org/bun/f2f2ee",
        lang_hex: Some("e5b567"),
    },
    IconSpec {
        name: "tensorflow",
        grey_url: "https://cdn.simpleicons.org/tensorflow/9a9a95",
        color_url: "https://cdn.simpleicons.org/tensorflow/ff8800",
        lang_hex: Some("7e8e50"),
    },
    IconSpec {
        name: "nextflow",
        grey_url: "https://cdn.simpleicons.org/nextflow/9a9a95",
        color_url: "https://cdn.simpleicons.org/nextflow/7dd6cf",
        lang_hex: Some("7dd6cf"),
    },
    IconSpec {
        name: "go",
        grey_url: "https://api.iconify.design/grommet-icons/golang.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/grommet-icons/golang.svg?color=%237dd6cf",
        lang_hex: Some("7dd6cf"),
    },
    IconSpec {
        name: "photoshop",
        grey_url: "https://api.iconify.design/basil/adobe-photoshop-solid.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/basil/adobe-photoshop-solid.svg?color=%236c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "illustrator",
        grey_url: "https://api.iconify.design/basil/adobe-illustrator-solid.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/basil/adobe-illustrator-solid.svg?color=%23ff8800",
        lang_hex: None,
    },
    IconSpec {
        name: "indesign",
        grey_url: "https://api.iconify.design/basil/adobe-indesign-solid.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/basil/adobe-indesign-solid.svg?color=%239f4e85",
        lang_hex: None,
    },
    IconSpec {
        name: "lightroom",
        grey_url: "https://api.iconify.design/basil/adobe-lightroom-solid.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/basil/adobe-lightroom-solid.svg?color=%236c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "premiere",
        grey_url: "https://api.iconify.design/basil/adobe-premiere-solid.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/basil/adobe-premiere-solid.svg?color=%239f4e85",
        lang_hex: None,
    },
    IconSpec {
        name: "apple",
        grey_url: "https://cdn.simpleicons.org/apple/9a9a95",
        color_url: "https://cdn.simpleicons.org/apple/f2f2ee",
        lang_hex: None,
    },
    IconSpec {
        name: "archlinux",
        grey_url: "https://cdn.simpleicons.org/archlinux/9a9a95",
        color_url: "https://cdn.simpleicons.org/archlinux/6c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "ubuntu",
        grey_url: "https://cdn.simpleicons.org/ubuntu/9a9a95",
        color_url: "https://cdn.simpleicons.org/ubuntu/ff8800",
        lang_hex: None,
    },
    IconSpec {
        name: "linuxmint",
        grey_url: "https://cdn.simpleicons.org/linuxmint/9a9a95",
        color_url: "https://cdn.simpleicons.org/linuxmint/7e8e50",
        lang_hex: None,
    },
    IconSpec {
        name: "tails",
        grey_url: "https://cdn.simpleicons.org/tails/9a9a95",
        color_url: "https://cdn.simpleicons.org/tails/9f4e85",
        lang_hex: None,
    },
    IconSpec {
        name: "windows",
        grey_url: "https://api.iconify.design/ri/windows-line.svg?color=%239a9a95",
        color_url: "https://api.iconify.design/ri/windows-line.svg?color=%236c99bb",
        lang_hex: None,
    },
    IconSpec {
        name: "fishshell",
        grey_url: "https://cdn.simpleicons.org/fishshell/9a9a95",
        color_url: "https://cdn.simpleicons.org/fishshell/7e8e50",
        lang_hex: Some("ff8800"),
    },
    IconSpec {
        name: "gnubash",
        grey_url: "https://cdn.simpleicons.org/gnubash/9a9a95",
        color_url: "https://cdn.simpleicons.org/gnubash/7e8e50",
        lang_hex: Some("ff8800"),
    },
];

/// Rewrites a `color_url`'s hex to `hex`, same substitution shape as
/// js/skills-languages.js's `recolor()` — cdn.simpleicons.org embeds the
/// hex as the last path segment, api.iconify.design as a `color=%23`
/// query param. Falls back to the original URL unchanged if neither
/// pattern matches (defensive; every entry in ICONS is one or the other).
fn recolor_url(color_url: &str, hex: &str) -> String {
    if color_url.contains("cdn.simpleicons.org") {
        if let Some(idx) = color_url.rfind('/') {
            return format!("{}/{hex}", &color_url[..idx]);
        }
    } else if color_url.contains("api.iconify.design") {
        if let Some(idx) = color_url.find("color=%23") {
            return format!("{}color=%23{hex}", &color_url[..idx]);
        }
    }
    color_url.to_string()
}

/// The (url, output path) pairs to attempt for one icon: always grey +
/// colour, plus a lang variant when `lang_hex` is set.
fn targets_for(spec: &IconSpec, dir: &Path) -> Vec<(String, PathBuf)> {
    let mut targets = vec![
        (
            spec.grey_url.to_string(),
            dir.join(format!("{}-grey.svg", spec.name)),
        ),
        (
            spec.color_url.to_string(),
            dir.join(format!("{}-color.svg", spec.name)),
        ),
    ];
    if let Some(hex) = spec.lang_hex {
        targets.push((
            recolor_url(spec.color_url, hex),
            dir.join(format!("{}-lang.svg", spec.name)),
        ));
    }
    targets
}

enum FetchOutcome {
    Skipped,
    Fetched,
    Failed(String),
}

/// Skip-if-exists: never touches the network for a path that's already on
/// disk. A failed fetch is reported, not panicked on — the file simply
/// stays missing, retryable on a later run.
fn fetch_or_skip(client: &reqwest::blocking::Client, url: &str, path: &Path) -> FetchOutcome {
    if path.exists() {
        return FetchOutcome::Skipped;
    }
    let resp = match client
        .get(url)
        .header("User-Agent", "ncmbianchi-icon-cache")
        .send()
    {
        Ok(r) => r,
        Err(e) => return FetchOutcome::Failed(e.to_string()),
    };
    if !resp.status().is_success() {
        return FetchOutcome::Failed(format!("HTTP {}", resp.status()));
    }
    let bytes = match resp.bytes() {
        Ok(b) => b,
        Err(e) => return FetchOutcome::Failed(e.to_string()),
    };
    match fs::write(path, &bytes) {
        Ok(_) => FetchOutcome::Fetched,
        Err(e) => FetchOutcome::Failed(e.to_string()),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let output_dir =
        env::var("ICON_OUTPUT_DIR").unwrap_or_else(|_| "public/assets/icons".to_string());
    fs::create_dir_all(&output_dir)?;
    let dir = Path::new(&output_dir);

    let client = reqwest::blocking::Client::new();
    let (mut fetched, mut skipped, mut failed) = (0u32, 0u32, 0u32);

    for spec in ICONS {
        for (url, path) in targets_for(spec, dir) {
            match fetch_or_skip(&client, &url, &path) {
                FetchOutcome::Skipped => skipped += 1,
                FetchOutcome::Fetched => {
                    fetched += 1;
                    println!("fetched {}", path.display());
                }
                FetchOutcome::Failed(e) => {
                    failed += 1;
                    eprintln!("warning: failed to fetch {url} -> {}: {e}", path.display());
                }
            }
        }
    }

    println!("icon-cache: {fetched} fetched, {skipped} already cached, {failed} failed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A fresh, uniquely-named temp dir per test — avoids cross-test
    /// interference without adding a tempfile dependency this project
    /// doesn't otherwise need.
    fn temp_dir() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = env::temp_dir().join(format!("icon-cache-test-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recolor_url_rewrites_simpleicons_trailing_hex() {
        let out = recolor_url("https://cdn.simpleicons.org/pandas/9f4e85", "7e8e50");
        assert_eq!(out, "https://cdn.simpleicons.org/pandas/7e8e50");
    }

    #[test]
    fn recolor_url_rewrites_iconify_color_param() {
        let out = recolor_url(
            "https://api.iconify.design/devicon-plain/matplotlib.svg?color=%236c99bb",
            "7e8e50",
        );
        assert_eq!(
            out,
            "https://api.iconify.design/devicon-plain/matplotlib.svg?color=%237e8e50"
        );
    }

    #[test]
    fn targets_for_includes_lang_variant_only_when_set() {
        let dir = PathBuf::from("/tmp/x");
        let with_lang = IconSpec {
            name: "pandas",
            grey_url: "g",
            color_url: "c",
            lang_hex: Some("7e8e50"),
        };
        let without_lang = IconSpec {
            name: "git",
            grey_url: "g",
            color_url: "c",
            lang_hex: None,
        };
        assert_eq!(targets_for(&with_lang, &dir).len(), 3);
        assert_eq!(targets_for(&without_lang, &dir).len(), 2);
    }

    #[test]
    fn targets_for_names_files_by_variant() {
        let dir = PathBuf::from("/tmp/x");
        let spec = IconSpec {
            name: "pandas",
            grey_url: "g",
            color_url: "c",
            lang_hex: Some("7e8e50"),
        };
        let targets = targets_for(&spec, &dir);
        assert_eq!(targets[0].1, dir.join("pandas-grey.svg"));
        assert_eq!(targets[1].1, dir.join("pandas-color.svg"));
        assert_eq!(targets[2].1, dir.join("pandas-lang.svg"));
    }

    #[test]
    fn fetch_or_skip_skips_when_file_already_exists() {
        let dir = temp_dir();
        let path = dir.join("already-there.svg");
        fs::write(&path, "cached content").unwrap();

        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/should-not-be-called.svg");
            then.status(200).body("<svg></svg>");
        });

        let client = reqwest::blocking::Client::new();
        let outcome = fetch_or_skip(
            &client,
            &format!("{}/should-not-be-called.svg", server.base_url()),
            &path,
        );
        assert!(matches!(outcome, FetchOutcome::Skipped));
        mock.assert_hits(0);
        assert_eq!(fs::read_to_string(&path).unwrap(), "cached content"); // untouched

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fetch_or_skip_fetches_and_writes_when_missing() {
        let dir = temp_dir();
        let path = dir.join("new-icon.svg");

        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/new-icon.svg");
            then.status(200).body("<svg>real</svg>");
        });

        let client = reqwest::blocking::Client::new();
        let outcome = fetch_or_skip(
            &client,
            &format!("{}/new-icon.svg", server.base_url()),
            &path,
        );
        assert!(matches!(outcome, FetchOutcome::Fetched));
        mock.assert();
        assert_eq!(fs::read_to_string(&path).unwrap(), "<svg>real</svg>");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fetch_or_skip_reports_failure_and_leaves_file_missing_on_http_error() {
        let dir = temp_dir();
        let path = dir.join("broken.svg");

        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/broken.svg");
            then.status(404);
        });

        let client = reqwest::blocking::Client::new();
        let outcome = fetch_or_skip(&client, &format!("{}/broken.svg", server.base_url()), &path);
        assert!(matches!(outcome, FetchOutcome::Failed(_)));
        assert!(!path.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn every_icon_manifest_url_is_a_known_cdn() {
        for spec in ICONS {
            for url in [spec.grey_url, spec.color_url] {
                assert!(
                    url.contains("cdn.simpleicons.org") || url.contains("api.iconify.design"),
                    "unexpected CDN in manifest entry {}: {url}",
                    spec.name
                );
            }
        }
    }

    #[test]
    fn every_icon_manifest_name_is_unique() {
        let mut names: Vec<&str> = ICONS.iter().map(|s| s.name).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), before, "duplicate basename in ICONS manifest");
    }
}
