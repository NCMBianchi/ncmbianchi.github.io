/* Homepage TUI preview text — js/main.js's SECTIONS data used to fetch
 * each section's *real* item list from its own source and hands main.js an
 * items[] array to render instead — the existing per-line fit/truncate
 * logic (fitText() in main.js) already packs as many items as fit the
 * line's width and only adds "…" when it actually had to cut something, so
 * feeding it a real, possibly-multi-item list is all that's needed here.
 *
 * Two kinds of source:
 *  - Publications/Presentations/Repos are API-backed pages (ORCID/GitHub),
 *    so their own HTML has no data in it until their own script runs —
 *    fetched directly from the same APIs those pages use instead.
 *  - Academic Studies/Skills/Interests are static hand-written HTML with
 *    the real content already baked in, so fetching the page itself and
 *    reading its DOM (same-origin, no CORS issue) *is* the real data —
 *    no separate data source to keep in sync.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined' || !document.getElementById('term-body')) return;

  var ORCID      = '0009-0000-4202-7154';
  var WORKS_URL  = 'https://pub.orcid.org/v3.0/' + ORCID + '/works';
  var PUB_TYPES  = ['journal-article', 'preprint', 'conference-paper', 'conference-abstract', 'book-chapter', 'review'];
  var PRES_TYPES = ['conference-presentation', 'presentation', 'lecture-speech', 'conference-poster', 'other-presentation'];

  var GITHUB_OWNER = 'NCMBianchi';
  var SKIP_REPOS   = [GITHUB_OWNER, 'ncmbianchi.github.io'];
  var REPOS_URL    = 'https://api.github.com/users/' + GITHUB_OWNER + '/repos?sort=updated&per_page=100';
  var REPOS_LIMIT  = 6; /* matches repos.html's own LIMIT, so the homepage never advertises a repo that page doesn't show */

  var TIMEOUT_MS = 4000;

  function fetchJSON(url, accept) {
    return fetch(url, { headers: { Accept: accept } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchDoc(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      return new DOMParser().parseFromString(html, 'text/html');
    });
  }

  function textOf(el) { return el.textContent.trim(); }

  function sortedWorks(data, types) {
    return (data.group || [])
      .map(function (g) { return g['work-summary'][0]; })
      .filter(function (w) { return types.indexOf(w.type) !== -1; })
      .sort(function (a, b) {
        var ay = (a['publication-date'] && a['publication-date'].year.value) || '0';
        var by = (b['publication-date'] && b['publication-date'].year.value) || '0';
        return by - ay;
      });
  }

  function yearOf(w) {
    return (w['publication-date'] && w['publication-date'].year && w['publication-date'].year.value) || '';
  }

  /* year + journal/venue, e.g. "2026 BMC Bioinformatics" */
  function publicationsItems() {
    return fetchJSON(WORKS_URL, 'application/json').then(function (data) {
      return sortedWorks(data, PUB_TYPES).map(function (w) {
        var venue = (w['journal-title'] && w['journal-title'].value) || '';
        return { text: [yearOf(w), venue].filter(Boolean).join(' ') };
      });
    });
  }

  /* year + event/location, e.g. "2026 BioSB2026" — journal-title doubles as
     the event name for presentation-type ORCID works (same as pres-event on
     presentations.html) */
  function presentationsItems() {
    return fetchJSON(WORKS_URL, 'application/json').then(function (data) {
      return sortedWorks(data, PRES_TYPES).map(function (w) {
        var event = (w['journal-title'] && w['journal-title'].value) || '';
        return { text: [yearOf(w), event].filter(Boolean).join(' ') };
      });
    });
  }

  /* just the repo name, same filter + sort + limit as repos.html itself */
  function reposItems() {
    return fetchJSON(REPOS_URL, 'application/vnd.github+json').then(function (repos) {
      return repos
        .filter(function (r) { return SKIP_REPOS.indexOf(r.name) === -1; })
        .sort(function (a, b) { return new Date(b.pushed_at) - new Date(a.pushed_at); })
        .slice(0, REPOS_LIMIT)
        .map(function (r) { return { text: r.name }; });
    });
  }

  /* year + degree title per .study-card, from studies.html's own markup */
  function studiesItems() {
    return fetchDoc('studies.html').then(function (doc) {
      var cards = doc.querySelectorAll('.study-card');
      return Array.prototype.map.call(cards, function (card) {
        var years  = card.querySelector('.study-years');
        var degree = card.querySelector('.study-degree');
        var text   = [years && textOf(years), degree && textOf(degree)].filter(Boolean).join(' ');
        return { text: text };
      }).filter(function (item) { return item.text; });
    });
  }

  /* every tile's name, straight from skills.html's own labels — real icons
     and placeholders alike, so a tile added/removed there needs no
     corresponding edit here */
  function skillsItems() {
    return fetchDoc('skills.html').then(function (doc) {
      var labels = doc.querySelectorAll('.skill-label');
      return Array.prototype.map.call(labels, function (el) { return { text: textOf(el) }; });
    });
  }

  /* the tag list from interests.html */
  function interestsItems() {
    return fetchDoc('interests.html').then(function (doc) {
      var tags = doc.querySelectorAll('.tag');
      return Array.prototype.map.call(tags, function (el) { return { text: textOf(el) }; });
    });
  }

  function withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise(function (resolve) { setTimeout(function () { resolve([]); }, TIMEOUT_MS); })
    ]).catch(function () { return []; });
  }

  /* keyed by js/main.js's SECTIONS index — main.js awaits the matching
     promise right before that section's output line is built, replacing
     SECTIONS[i].items wholesale if it resolved to a non-empty list, and
     keeping its own hardcoded fallback items otherwise (offline, timed
     out, or nothing on record). */
  window.HomePreview = {
    0: withTimeout(studiesItems()),
    1: withTimeout(publicationsItems()),
    2: withTimeout(presentationsItems()),
    3: withTimeout(reposItems()),
    4: withTimeout(skillsItems()),
    5: withTimeout(interestsItems())
  };
})();
