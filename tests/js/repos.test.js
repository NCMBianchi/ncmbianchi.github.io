const { test, expect, describe, beforeEach, afterEach } = require('bun:test');
const {
  esc, timeAgo, langTag, renderCard, SKIP_REPOS, computeLanguagePercentages,
  attachLatestCommit, attachForkParentStars, attachLanguageBreakdown, enrichRepo, liveFetch
} = require('../../public/js/repos.js');

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/* Fetch-mocking helper for the orchestration functions below — none of them
   touch the DOM (confirmed: they're defined before repos.js's own document
   guard), just fetch(), which is already a real global under Bun. `handler`
   maps a requested URL to a plain JS value that gets JSON-wrapped into a
   fetch Response-alike. */
var originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

function mockFetch(handler) {
  globalThis.fetch = (url) => {
    const body = handler(url);
    if (body === null) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

describe('esc', () => {
  test('escapes html-sensitive characters', () => {
    expect(esc('Rock & Roll <tag>')).toBe('Rock &amp; Roll &lt;tag&gt;');
  });
});

describe('timeAgo', () => {
  test('reports "today" for less than a day ago', () => {
    expect(timeAgo(isoDaysAgo(0))).toBe('today');
  });

  test('reports singular "1 day ago"', () => {
    expect(timeAgo(isoDaysAgo(1))).toBe('1 day ago');
  });

  test('reports N days ago under a month', () => {
    expect(timeAgo(isoDaysAgo(5))).toBe('5 days ago');
  });

  test('reports N months ago under a year', () => {
    expect(timeAgo(isoDaysAgo(65))).toBe('2 months ago');
  });

  test('reports singular "1 year ago"', () => {
    expect(timeAgo(isoDaysAgo(370))).toBe('1 year ago');
  });

  test('reports N years ago', () => {
    expect(timeAgo(isoDaysAgo(800))).toBe('2 years ago');
  });
});

describe('langTag', () => {
  test('gives known languages their own tag class', () => {
    expect(langTag('Python')).toBe('<span class="tag tag--python">Python</span>');
    expect(langTag('Rust')).toBe('<span class="tag tag--rust">Rust</span>');
    expect(langTag('Go')).toBe('<span class="tag tag--go">Go</span>');
  });

  test('matches language names case-insensitively', () => {
    expect(langTag('JavaScript')).toContain('tag--js');
  });

  test('falls back to the plain tag for unlisted languages', () => {
    expect(langTag('Ruby')).toBe('<span class="tag">Ruby</span>');
  });
});

describe('computeLanguagePercentages', () => {
  test('keeps only languages over the threshold, sorted highest first', () => {
    // real breakdown from umi-pipeline-nf: Python 51.7%, Nextflow 43.7%,
    // Shell 2.6%, Groovy 1.5%, Dockerfile 0.5% — only the first two clear 10%
    const bytes = { Python: 57940, Nextflow: 48995, Shell: 2865, Groovy: 1630, Dockerfile: 606 };
    const result = computeLanguagePercentages(bytes, 10);
    expect(result.map((l) => l.name)).toEqual(['Python', 'Nextflow']);
    expect(result[0].percent).toBeGreaterThan(result[1].percent);
  });

  test('keeps a single dominant language on its own', () => {
    // real breakdown from the "fast" repo: Go 96.5%, Nix 3.5%
    const bytes = { Go: 21529, Nix: 791 };
    const result = computeLanguagePercentages(bytes, 10);
    expect(result.map((l) => l.name)).toEqual(['Go']);
  });

  test('returns an empty array for an empty or missing breakdown', () => {
    expect(computeLanguagePercentages({}, 10)).toEqual([]);
    expect(computeLanguagePercentages(null, 10)).toEqual([]);
  });

  test('threshold is exclusive — exactly the threshold value does not qualify', () => {
    const bytes = { A: 10, B: 90 };
    expect(computeLanguagePercentages(bytes, 10).map((l) => l.name)).toEqual(['B']);
  });
});

describe('SKIP_REPOS', () => {
  test('excludes the profile README repo and the portfolio site repo itself', () => {
    expect(SKIP_REPOS).toContain('NCMBianchi');
    expect(SKIP_REPOS).toContain('ncmbianchi.github.io');
  });
});

describe('renderCard', () => {
  const repo = {
    name: 'my-repo',
    html_url: 'https://github.com/NCMBianchi/my-repo',
    description: 'A <cool> project',
    language: 'Python',
    topics: ['bioinformatics', 'genomics'],
    fork: true,
    stargazers_count: 8,
    pushed_at: isoDaysAgo(2),
    license: { spdx_id: 'MIT' },
    latestCommit: 'Fix the thing'
  };

  test('shows the fork badge and summed star count', () => {
    const html = renderCard(repo);
    expect(html).toContain('proj-fork-badge">fork<');
    expect(html).toContain('★ 8');
  });

  test('shows the latest commit line and license', () => {
    const html = renderCard(repo);
    expect(html).toContain('Fix the thing');
    expect(html).toContain('MIT');
  });

  test('escapes the description and lists topic tags', () => {
    const html = renderCard(repo);
    expect(html).toContain('A &lt;cool&gt; project');
    expect(html).toContain('bioinformatics');
    expect(html).toContain('genomics');
  });

  test('omits the star badge when there are no stars', () => {
    const html = renderCard(Object.assign({}, repo, { stargazers_count: 0 }));
    expect(html).not.toContain('proj-star-badge');
  });

  test('omits the fork badge for non-forks', () => {
    const html = renderCard(Object.assign({}, repo, { fork: false }));
    expect(html).not.toContain('proj-fork-badge');
  });

  test('falls back to a placeholder description when none is provided', () => {
    const html = renderCard(Object.assign({}, repo, { description: null }));
    expect(html).toContain('No description provided.');
  });

  test('uses repo.language as a fallback when there is no languages breakdown', () => {
    const html = renderCard(repo); // no `languages` field on the base fixture
    expect(html).toContain('tag--python');
  });

  test('renders one tag per language in the breakdown, taking precedence over repo.language', () => {
    const withBreakdown = Object.assign({}, repo, {
      languages: [{ name: 'Python', percent: 51.7 }, { name: 'Nextflow', percent: 43.7 }]
    });
    const html = renderCard(withBreakdown);
    expect(html).toContain('tag--python');
    expect(html).toContain('tag--nextflow');
  });

  test('shows no language tag when the breakdown is empty and repo.language is absent', () => {
    const noLang = Object.assign({}, repo, { languages: [], language: null });
    const html = renderCard(noLang);
    expect(html).not.toContain('tag--');
  });
});

describe('attachLatestCommit', () => {
  test('sets latestCommit to the first line of the latest commit message', () => {
    mockFetch(() => [{ commit: { message: 'Fix the thing\n\nLonger body here' } }]);
    return attachLatestCommit({ name: 'my-repo' }).then((repo) => {
      expect(repo.latestCommit).toBe('Fix the thing');
    });
  });

  test('truncates a long first line with an ellipsis', () => {
    const longLine = 'a'.repeat(80);
    mockFetch(() => [{ commit: { message: longLine } }]);
    return attachLatestCommit({ name: 'my-repo' }).then((repo) => {
      expect(repo.latestCommit.endsWith('…')).toBe(true);
      expect(repo.latestCommit.length).toBeLessThanOrEqual(60);
    });
  });

  test('leaves the repo unchanged (no throw) when the fetch fails', () => {
    mockFetch(() => null);
    return attachLatestCommit({ name: 'my-repo' }).then((repo) => {
      expect(repo.latestCommit).toBeUndefined();
    });
  });
});

describe('attachForkParentStars', () => {
  test('sums own and parent stars for a fork', () => {
    mockFetch(() => ({ parent: { stargazers_count: 6 } }));
    return attachForkParentStars({ name: 'my-repo', fork: true, stargazers_count: 2 }).then((repo) => {
      expect(repo.stargazers_count).toBe(8);
    });
  });

  test('skips the fetch entirely for a non-fork', () => {
    let called = false;
    mockFetch(() => { called = true; return {}; });
    return attachForkParentStars({ name: 'my-repo', fork: false, stargazers_count: 3 }).then((repo) => {
      expect(called).toBe(false);
      expect(repo.stargazers_count).toBe(3);
    });
  });
});

describe('attachLanguageBreakdown', () => {
  test('attaches the computed language breakdown', () => {
    mockFetch(() => ({ Python: 57940, Nextflow: 48995, Shell: 2865 }));
    return attachLanguageBreakdown({ name: 'my-repo' }).then((repo) => {
      expect(repo.languages.map((l) => l.name)).toEqual(['Python', 'Nextflow']);
    });
  });

  test('leaves the repo unchanged (no throw) when the fetch fails', () => {
    mockFetch(() => null);
    return attachLanguageBreakdown({ name: 'my-repo' }).then((repo) => {
      expect(repo.languages).toBeUndefined();
    });
  });
});

describe('enrichRepo', () => {
  test('runs all three enrichments and returns the same repo object', () => {
    mockFetch((url) => {
      if (url.includes('/commits')) return [{ commit: { message: 'Initial commit' } }];
      if (url.includes('/languages')) return { Go: 100 };
      return { parent: { stargazers_count: 5 } };
    });
    return enrichRepo({ name: 'my-repo', fork: true, stargazers_count: 1 }).then((repo) => {
      expect(repo.latestCommit).toBe('Initial commit');
      expect(repo.stargazers_count).toBe(6);
      expect(repo.languages.map((l) => l.name)).toEqual(['Go']);
    });
  });
});

describe('liveFetch', () => {
  test('filters out SKIP_REPOS, sorts by recency, and limits to 6', () => {
    var repos = [];
    for (var i = 0; i < 8; i++) {
      repos.push({ name: 'repo' + i, pushed_at: isoDaysAgo(i), stargazers_count: 0, fork: false });
    }
    repos.push({ name: SKIP_REPOS[0], pushed_at: isoDaysAgo(0), stargazers_count: 0, fork: false });

    mockFetch((url) => {
      if (url.includes('/repos?sort=updated')) return repos;
      if (url.includes('/commits')) return [];
      return {};
    });

    return liveFetch().then((result) => {
      expect(result.length).toBe(6);
      expect(result.map((r) => r.name)).not.toContain(SKIP_REPOS[0]);
      // most recently pushed (repo0, 0 days ago) should come first
      expect(result[0].name).toBe('repo0');
    });
  });

  test('resolves to an empty array when nothing is left after filtering', () => {
    mockFetch(() => [{ name: SKIP_REPOS[0], pushed_at: isoDaysAgo(0) }]);
    return liveFetch().then((result) => {
      expect(result).toEqual([]);
    });
  });
});
