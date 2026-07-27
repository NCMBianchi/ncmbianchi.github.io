const { test, expect, describe } = require('bun:test');
const { esc, timeAgo, langTag, renderCard, SKIP_REPOS } = require('../../public/js/repos.js');

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
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
});
