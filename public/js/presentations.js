/* Presentations — fetched live from the public ORCID API, same approach and
 * same client-side-prototype status as js/publications.js.
 *
 * ORCID's /works summary list mixes work types the owner keeps on other
 * pages — journal-article/preprint/etc (→ publications.html) and
 * research-tool (→ repos.html, software projects) — so only the
 * presentation-ish types below are rendered here.
 */
(function () {
  'use strict';

  var ORCID     = '0009-0000-4202-7154';
  var WORKS_URL = 'https://pub.orcid.org/v3.0/' + ORCID + '/works';
  var WORK_URL  = 'https://pub.orcid.org/v3.0/' + ORCID + '/work/';

  var TYPE_LABELS = {
    'conference-presentation': 'Conference Presentation',
    'presentation':            'Presentation',
    'lecture-speech':          'Invited Talk',
    'conference-poster':       'Poster',
    'other-presentation':      'Presentation'
  };

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* { code, url, label } — presentation-type ORCID works often don't carry a
     structured external-id, so fall back to a DOI mentioned in the free-text
     citation (this is where the Zenodo slide-deck DOI usually shows up),
     then to the work's plain url as a last resort. */
  function doiInfo(work) {
    var ids = (work['external-ids'] && work['external-ids']['external-id']) || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i]['external-id-type'] === 'doi') {
        var v = ids[i]['external-id-value'];
        return { code: v, url: ids[i]['external-id-url'].value, label: /zenodo/i.test(v) ? 'Zenodo' : 'DOI' };
      }
    }
    var citation = work.citation && work.citation['citation-value'];
    if (citation) {
      var m = citation.match(/10\.\d{4,9}\/\S+/);
      if (m) {
        var code = m[0].replace(/[.,;]+$/, '');
        return { code: code, url: 'https://doi.org/' + code, label: /zenodo/i.test(code) ? 'Zenodo' : 'DOI' };
      }
    }
    return work.url && work.url.value ? { code: null, url: work.url.value, label: 'Link' } : null;
  }

  function renderCard(work) {
    var year  = (work['publication-date'] && work['publication-date'].year
                 && work['publication-date'].year.value) || '';
    var type  = TYPE_LABELS[work.type] || work.type;
    var title = (work.title && work.title.title && work.title.title.value) || '(untitled)';
    var event = (work['journal-title'] && work['journal-title'].value) || '';
    var doi   = doiInfo(work);

    var html = '<article class="pres-card">';
    html += '<div class="pres-meta"><span class="pres-year">' + esc(year) + '</span>' +
            '<span class="pres-type">' + esc(type) + '</span></div>';
    html += '<h3 class="pres-title">' + esc(title) + '</h3>';
    if (event) html += '<p class="pres-event">' + esc(event) + '</p>';
    if (doi) {
      var tagText = doi.code ? (doi.label + ': ' + doi.code) : doi.label;
      html += '<div class="pres-links"><a class="tag" href="' + esc(doi.url) +
              '" target="_blank" rel="noopener">' + esc(tagText) + '</a></div>';
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

  /* CommonJS export purely for `bun test` to require() the pure helpers
     above without a DOM — never runs in the browser (module is undefined
     there). Must sit before any document.* access below. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc: esc, doiInfo: doiInfo, renderCard: renderCard };
  }

  if (typeof document === 'undefined') return;

  var list   = document.getElementById('pres-list');
  var status = document.getElementById('pres-status');
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
      }));
    });
  }

  window.DataCache.load({
    cacheKey: 'pres-cache-v1',
    snapshotUrl: 'data/presentations.json',
    liveFetch: liveFetch,
    onData: function (fullWorks) {
      if (!fullWorks.length) {
        if (status) status.textContent = 'No presentations on record yet.';
        return;
      }
      list.innerHTML = fullWorks.map(renderCard).join('');
    },
    onError: function (err) {
      if (status) {
        status.innerHTML = 'Could not load presentations right now — see the ' +
          '<a href="https://orcid.org/' + ORCID + '" target="_blank" rel="noopener">ORCID record</a> directly.';
      }
      console.error('presentations fetch failed:', err);
    }
  });
})();
