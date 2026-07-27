/* Repos — dynamic grid of public GitHub repos by recency, client-side
 * prototype (same "nail the JSON shape first" step as
 * publications.js/presentations.js before a planned Rust build-time
 * pipeline). Single fetch — unlike ORCID's works/work split, the repo list
 * endpoint already has everything a card needs.
 */
(function () {
  'use strict';

  var OWNER      = 'NCMBianchi';
  var REPOS_URL  = 'https://api.github.com/users/' + OWNER + '/repos?sort=updated&per_page=100';
  var LIMIT      = 6;
  var MAX_TOPICS = 4;
  var MAX_COMMIT_MSG = 60;

  /* not real projects to show in the grid: the profile README repo, and
     this portfolio site's own repo (its own contributions still show up in
     the contribution graph above — just clutter as a "project" card). */
  var SKIP_REPOS = [OWNER, 'ncmbianchi.github.io'];

  /* only these languages get a coloured tag (text + tinted background, both
     from the language's own accent token) — everything else (topics, and
     any other language) stays the plain default .tag */
  var LANG_TAG_CLASS = {
    'python':     'tag--python',
    'r':          'tag--r',
    'javascript': 'tag--js',
    'rust':       'tag--rust',
    'shell':      'tag--shell',
    'go':         'tag--go'
  };

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function timeAgo(iso) {
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1)  return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return days + ' days ago';
    var months = Math.floor(days / 30);
    if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');
    var years = Math.floor(months / 12);
    return years + (years === 1 ? ' year ago' : ' years ago');
  }

  function langTag(language) {
    var cls = LANG_TAG_CLASS[language.toLowerCase()];
    return '<span class="tag' + (cls ? ' ' + cls : '') + '">' + esc(language) + '</span>';
  }

  function renderCard(repo) {
    var tags = [];
    if (repo.language) tags.push(langTag(repo.language));
    (repo.topics || []).slice(0, MAX_TOPICS).forEach(function (t) {
      tags.push('<span class="tag">' + esc(t) + '</span>');
    });

    var html = '<article class="proj-card">';
    html += '<h3 class="proj-name"><a href="' + esc(repo.html_url) +
            '" target="_blank" rel="noopener">' + esc(repo.name) + '</a>';
    if (repo.fork) html += '<span class="proj-fork-badge">fork</span>';
    if (repo.stargazers_count > 0) html += '<span class="proj-star-badge">★ ' + repo.stargazers_count + '</span>';
    html += '</h3>';
    if (repo.latestCommit) html += '<p class="proj-commit">' + esc(repo.latestCommit) + '</p>';
    html += '<p class="proj-updated">Updated ' + timeAgo(repo.pushed_at) +
            (repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
              ? ' • ' + esc(repo.license.spdx_id) : '') + '</p>';
    html += '<p class="proj-desc">' + esc(repo.description || 'No description provided.') + '</p>';
    if (tags.length) html += '<div class="proj-tags">' + tags.join('') + '</div>';
    html += '</article>';
    return html;
  }

  function fetchJSON(url) {
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* one extra request per shown card (6 total, in parallel) — fine within
     the 60/hr unauthenticated limit for a low-traffic personal site, but
     worth remembering if this ever needs to scale. Failure on any single
     repo's commit fetch just omits that one card's commit line rather than
     breaking the whole grid. */
  function attachLatestCommit(repo) {
    var url = 'https://api.github.com/repos/' + OWNER + '/' + repo.name + '/commits?per_page=1';
    return fetchJSON(url).then(function (commits) {
      var msg = commits[0] && commits[0].commit && commits[0].commit.message;
      if (msg) {
        var firstLine = msg.split('\n')[0];
        repo.latestCommit = firstLine.length > MAX_COMMIT_MSG
          ? firstLine.slice(0, MAX_COMMIT_MSG - 1).trim() + '…'
          : firstLine;
      }
      return repo;
    }).catch(function () { return repo; });
  }

  /* forks only: the list endpoint's stargazers_count is just the fork's own
     stars, not the original's — fetch the single-repo endpoint (which
     includes `parent`) and add the upstream repo's stars in too. */
  function attachForkParentStars(repo) {
    if (!repo.fork) return Promise.resolve(repo);
    var url = 'https://api.github.com/repos/' + OWNER + '/' + repo.name;
    return fetchJSON(url).then(function (full) {
      if (full.parent) repo.stargazers_count += full.parent.stargazers_count;
      return repo;
    }).catch(function () { return repo; });
  }

  function enrichRepo(repo) {
    return Promise.all([attachLatestCommit(repo), attachForkParentStars(repo)])
      .then(function () { return repo; });
  }

  /* CommonJS export purely for `bun test` to require() the pure helpers
     above without a DOM — never runs in the browser (module is undefined
     there). Must sit before any document.* access below. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc: esc, timeAgo: timeAgo, langTag: langTag, renderCard: renderCard, SKIP_REPOS: SKIP_REPOS };
  }

  if (typeof document === 'undefined') return;

  var list   = document.getElementById('repo-list');
  var status = document.getElementById('repo-status');
  if (!list) return;

  function liveFetch() {
    return fetchJSON(REPOS_URL).then(function (repos) {
      var filtered = repos
        .filter(function (r) { return SKIP_REPOS.indexOf(r.name) === -1; })
        .sort(function (a, b) { return new Date(b.pushed_at) - new Date(a.pushed_at); })
        .slice(0, LIMIT);

      if (!filtered.length) return [];

      return Promise.all(filtered.map(enrichRepo));
    });
  }

  window.DataCache.load({
    cacheKey: 'repos-cache-v1',
    snapshotUrl: 'data/repos.json',
    liveFetch: liveFetch,
    onData: function (repos) {
      if (!repos.length) {
        if (status) status.textContent = 'No public repos on record yet.';
        return;
      }
      list.innerHTML = '<div class="projects-grid">' + repos.map(renderCard).join('') + '</div>' +
        '<p class="projects-more"><a href="https://github.com/' + OWNER +
        '?tab=repositories" target="_blank" rel="noopener">→ more repositories on GitHub</a></p>';
    },
    onError: function (err) {
      if (status) {
        status.innerHTML = 'Could not load repositories right now — see ' +
          '<a href="https://github.com/' + OWNER + '" target="_blank" rel="noopener">the GitHub profile</a> directly.';
      }
      console.error('repos fetch failed:', err);
    }
  });
})();
