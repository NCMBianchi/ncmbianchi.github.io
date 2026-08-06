/* Language breakdown bar — renders assets/languages.json (generated
 * server-side by tools/contrib-graph, same build-time pattern as
 * contrib-graph.js/contributions.json — GitHub GraphQL + optional Gitea +
 * GitLab, merged) as a pill-shaped stacked bar above the skills icon grid,
 * plus a legend. Hovering a segment or legend row recolours every
 * data-lang-tagged skill-tile below to that language's own colour —
 * data-lang is a hand-curated mapping baked into skills.html's markup
 * (which tool you use a language *for*, not what the tool's own source is
 * written in), not something the fetched JSON can tell us.
 */
(function () {
  'use strict';

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtPercent(p) {
    return (Math.round(p * 10) / 10).toString().replace(/\.0$/, '');
  }

  function render(root, languages) {
    var segs = languages.map(function (l) {
      var trigger = l.name === 'Other' ? '' : ' data-lang-trigger="' + esc(l.name.toLowerCase()) + '"';
      return '<span class="lang-bar-seg"' + trigger + ' data-color="' + esc(l.color) + '"' +
             ' style="width:' + l.percent + '%; background:' + esc(l.color) + '"></span>';
    }).join('');

    var legend = languages.map(function (l) {
      var trigger = l.name === 'Other' ? '' : ' data-lang-trigger="' + esc(l.name.toLowerCase()) + '"';
      return '<li' + trigger + ' data-color="' + esc(l.color) + '">' +
             '<span class="lang-dot" style="background:' + esc(l.color) + '"></span>' +
             esc(l.name) + ' <b>' + fmtPercent(l.percent) + '%</b></li>';
    }).join('');

    var label = languages.map(function (l) { return l.name + ' ' + fmtPercent(l.percent) + '%'; }).join(', ');

    root.innerHTML =
      '<p class="lang-bar-caption">Languages across repos</p>' +
      '<div class="lang-bar" role="img" aria-label="Language breakdown: ' + esc(label) + '">' + segs + '</div>' +
      '<ul class="lang-bar-legend">' + legend + '</ul>';

    attachHoverHandlers(root);
  }

  function recolor(img, hex) {
    if (!img.dataset.origSrc) img.dataset.origSrc = img.src;
    var hexBare = hex.replace('#', '');
    var src = img.dataset.origSrc;
    if (src.indexOf('cdn.simpleicons.org') !== -1) {
      img.src = src.replace(/\/[0-9a-fA-F]{3,6}$/, '/' + hexBare);
    } else if (src.indexOf('api.iconify.design') !== -1) {
      img.src = src.replace(/color=%23[0-9a-fA-F]{3,6}/, 'color=%23' + hexBare);
    }
  }

  function restore(img) {
    if (img.dataset.origSrc) img.src = img.dataset.origSrc;
  }

  function setLang(lang, hex, on) {
    document.querySelectorAll('.skill-tile[data-lang="' + lang + '"]').forEach(function (tile) {
      tile.classList.toggle('lang-active', on);
      var colorImg = tile.querySelector('.skill-icon--color');
      var placeholder = tile.querySelector('.skill-icon-placeholder');
      if (colorImg) { on ? recolor(colorImg, hex) : restore(colorImg); }
      if (placeholder) {
        placeholder.style.borderColor = on ? hex : '';
        placeholder.style.color = on ? hex : '';
      }
    });
  }

  function attachHoverHandlers(root) {
    root.querySelectorAll('[data-lang-trigger]').forEach(function (el) {
      var lang = el.getAttribute('data-lang-trigger');
      var hex = el.getAttribute('data-color');
      el.addEventListener('mouseenter', function () { setLang(lang, hex, true); });
      el.addEventListener('mouseleave', function () { setLang(lang, hex, false); });
    });
  }

  /* CommonJS export purely for `bun test` to require() the pure helpers
     above without a DOM — never runs in the browser (module is undefined
     there). Must sit before any document.* access below. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc: esc, fmtPercent: fmtPercent };
  }

  if (typeof document === 'undefined') return;

  var root = document.getElementById('lang-bar-root');
  if (!root) return;

  fetch('assets/languages.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (languages) {
      if (!languages || !languages.length) { root.remove(); return; }
      render(root, languages);
    })
    .catch(function () {
      root.remove();
    });
})();
