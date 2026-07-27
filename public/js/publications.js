/* Publications — fetched live from the public ORCID API, client-side prototype
 * (nailing the JSON shape before a planned Rust build-time pipeline that
 * pre-generates static HTML instead).
 *
 * ORCID's /works summary list mixes work types the owner keeps on other
 * pages — conference-presentation (→ presentations.html, via Zenodo) and
 * research-tool (→ repos.html, these are software projects) — so only the
 * "real paper" types below are rendered here.
 */
(function () {
  'use strict';

  var ORCID     = '0009-0000-4202-7154';
  var WORKS_URL = 'https://pub.orcid.org/v3.0/' + ORCID + '/works';
  var WORK_URL  = 'https://pub.orcid.org/v3.0/' + ORCID + '/work/';

  var TYPE_LABELS = {
    'journal-article':    'Journal Article',
    'preprint':           'Preprint',
    'conference-paper':   'Conference Paper',
    'conference-abstract':'Conference Abstract',
    'book-chapter':       'Book Chapter',
    'review':             'Review'
  };

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* { code: '10.1186/...', url: 'https://doi.org/10.1186/...' } — code is null
     when the work has no DOI, falling back to whatever url it does have. */
  function doiInfo(work) {
    var ids = (work['external-ids'] && work['external-ids']['external-id']) || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i]['external-id-type'] === 'doi') {
        return { code: ids[i]['external-id-value'], url: ids[i]['external-id-url'].value };
      }
    }
    return work.url && work.url.value ? { code: null, url: work.url.value } : null;
  }

  function authorsOf(work) {
    var contributors = (work.contributors && work.contributors.contributor) || [];
    return contributors
      .map(function (c) { return c['credit-name'] && c['credit-name'].value; })
      .filter(Boolean)
      .join(', ');
  }

  function renderCard(work) {
    var year    = (work['publication-date'] && work['publication-date'].year
                   && work['publication-date'].year.value) || '';
    var type    = TYPE_LABELS[work.type] || work.type;
    var title   = (work.title && work.title.title && work.title.title.value) || '(untitled)';
    var venue   = (work['journal-title'] && work['journal-title'].value) || '';
    var doi     = doiInfo(work);
    var authors = authorsOf(work);

    var html = '<article class="pub-card">';
    html += '<div class="pub-meta"><span class="pub-year">' + esc(year) + '</span>' +
            '<span class="pub-type">' + esc(type) + '</span></div>';
    html += '<h3 class="pub-title">' +
            (doi ? '<a href="' + esc(doi.url) + '" target="_blank" rel="noopener">' + esc(title) + '</a>'
                 : esc(title)) +
            '</h3>';
    if (authors) html += '<p class="pub-authors">' + esc(authors) + '</p>';
    if (venue)   html += '<p class="pub-venue">' + esc(venue) + '</p>';
    if (doi) {
      var tagText = doi.code ? ('DOI: ' + doi.code) : 'Link';
      html += '<div class="pub-links"><a class="tag" href="' + esc(doi.url) +
              '" target="_blank" rel="noopener">' + esc(tagText) + '</a>';
      if (typeof work._citations === 'number') {
        html += '<span class="pub-citations">' + work._citations +
                ' citation' + (work._citations === 1 ? '' : 's') + '</span>';
      }
      html += '</div>';
    }
    html += '</article>';
    return html;
  }

  function fetchJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* Attaches each work's own citation count (from Semantic Scholar's free,
     CORS-open Academic Graph API) as work._citations, shown next to that
     paper's own DOI tag. Deliberately per-DOI — an exact, unambiguous count
     tied to that specific paper — rather than `authors.citationCount`/
     `hIndex`, which are aggregated across whichever body of work Semantic
     Scholar's own name-based author clustering has merged together. */
  function attachCitations(works) {
    return Promise.all(works.map(function (w) {
      var doi = null;
      var ids = (w['external-ids'] && w['external-ids']['external-id']) || [];
      for (var i = 0; i < ids.length; i++) {
        if (ids[i]['external-id-type'] === 'doi') { doi = ids[i]['external-id-value']; break; }
      }
      if (!doi) return w;
      return fetchJSON('https://api.semanticscholar.org/graph/v1/paper/DOI:' + doi + '?fields=citationCount')
        .then(function (paper) { w._citations = paper.citationCount || 0; return w; })
        .catch(function () { return w; });
    }));
  }

  /* CommonJS export purely for `bun test` to require() the pure helpers
     above without a DOM — never runs in the browser (module is undefined
     there). Must sit before any document.* access below. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc: esc, doiInfo: doiInfo, authorsOf: authorsOf, renderCard: renderCard };
  }

  if (typeof document === 'undefined') return;

  var list   = document.getElementById('pub-list');
  var status = document.getElementById('pub-status');
  if (!list) return;

  function liveFetch() {
    return fetchJSON(WORKS_URL).then(function (data) {
      var summaries = (data.group || [])
        .map(function (g) { return g['work-summary'][0]; })
        .filter(function (w) { return TYPE_LABELS.hasOwnProperty(w.type); })
        .sort(function (a, b) {
          var ay = (a['publication-date'] && a['publication-date'].year.value) || '0';
          var by = (b['publication-date'] && b['publication-date'].year.value) || '0';
          return by - ay;
        });

      if (!summaries.length) return [];

      return Promise.all(summaries.map(function (w) {
        return fetchJSON(WORK_URL + w['put-code']);
      })).then(attachCitations);
    });
  }

  window.DataCache.load({
    cacheKey: 'pub-cache-v4', /* v4: back to a bare works array, citations moved onto each work (_citations) */
    snapshotUrl: 'data/publications.json',
    liveFetch: liveFetch,
    onData: function (works) {
      if (!works.length) {
        if (status) status.textContent = 'No publications on record yet.';
        return;
      }
      list.innerHTML = works.map(renderCard).join('');
    },
    onError: function (err) {
      if (status) {
        status.innerHTML = 'Could not load publications right now — see the ' +
          '<a href="https://orcid.org/' + ORCID + '" target="_blank" rel="noopener">ORCID record</a> directly.';
      }
      console.error('publications fetch failed:', err);
    }
  });
})();
