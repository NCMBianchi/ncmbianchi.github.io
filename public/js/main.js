/* main.js — terminal hero animation + nav behaviour */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     Pure logic — no DOM dependency. Kept at this scope (rather than
     nested inside `if (TERM)` below, where it's actually used) purely so
     it's reachable for `bun test` without a DOM; behaviour and call sites
     are unchanged, everything below still closes over these normally.
  ══════════════════════════════════════════════════════════════════ */

  /* ── Layout constants ────────────────────────────────────────── */
  /* Responsive grid: sections flow row-major into N columns, N chosen by
   * the available width (3 → 2 → 1). Column widths and the box width W are
   * derived per layout; the header lines set a floor on W.
   *
   *   3 cols: Academic|Publications|Presentations / Repos|Skills|Interests
   *   2 cols: Academic|Publications / Presentations|Repos / Skills|Interests
   *   1 col : one section per row
   */
  var PFX = 4, GAP = 2;                     /* prefix cols + trailing gap per cell */
  var HEADER = [
    '  Niccolò Bianchi',
    '  ncmbianchi.srtiget@proton.me',
    '  Bioinformatician & Data Analysis Dev'
  ];
  var HEADMAX = 0;
  for (var _h = 0; _h < HEADER.length; _h++) HEADMAX = Math.max(HEADMAX, HEADER[_h].length);

  var LAYOUT = null;                        /* current {ncols, rows, colW[], W} */
  var TUI_EL = null, TUI_DONE = [], ANIM_DONE = false;   /* refs for resize rebuild */
  var BOX_CORRECTION = 2;                   /* live-measured; see measureBoxCorrection() */

  /* ── Section data ────────────────────────────────────────────── */
  /* items[] — multi-item sections pick a random entry per load    */
  var SECTIONS = [
    {
      label: 'Academic Studies', href: 'studies.html',
      items: [
        { text: '2024 MSc in Bioinformatics for Computational Genomics · UniMI, PoliMI, LeidenUniv' }
      ]
    },
    {
      label: 'Publications', href: 'publications.html',
      items: [
        { text: 'doi:10.1186/s12859-026-06376-5 Bianchi et al. “Design and evaluation of semantically-valid…' }
      ]
    },
    {
      label: 'Presentations', href: 'presentations.html',
      items: [
        { text: 'zenodo:10.5281/zenodo.20322631 BioSB2026 “Graphs & Networks”, invited speaker' }
      ]
    },
    {
      label: 'Repos', href: 'repos.html',
      items: [
        { text: 'PR #92 → genepi/umi-pipeline-nf (fix dependencies)' }
      ]
    },
    {
      label: 'Skills', href: 'skills.html',
      items: [
        { text: 'scRNAseq'    }, { text: 'Alphagenome' }, { text: 'Snakemake' },
        { text: 'Nextflow'    }, { text: 'Python'       }, { text: 'R'         }
      ]
    },
    {
      label: 'Interests', href: 'interests.html',
      items: [
        { text: 'photography' }, { text: 'cooking' },
        { text: 'drawing'     }, { text: 'cinema'  }
      ]
    }
  ];

  /* ── Utilities ───────────────────────────────────────────────── */
  function rep(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  function padR(str, len) {
    var s = str;
    while (s.length < len) s += ' ';
    return s;
  }

  function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* pin a box-drawing run (─ ╭ ╮ ╰ ╯ │) to its exact character count so a
     fallback-font substitution mid-glyph can't drift the row's total width
     — see .tc-glyph in style.css */
  function glyphRun(str, n) {
    return '<span class="tc-glyph" style="width:' + n + 'ch">' + esc(str) + '</span>';
  }

  /* ── TUI cell builders ───────────────────────────────────────── */
  /*
   * Each cell renders as:
   *   <a class="tc-cell tc-cell--STATE" href="…" data-state="STATE">
   *     <span class="tc-pfx">  ▸ </span>Label<span class="tc-pad">   </span>
   *   </a>
   *
   * The .tc-pfx span is swapped by hover listeners (idle → ▸, back to spaces).
   * Padding fills the remaining column width so box characters align.
   */
  function buildIdleCell(idx, selIdx, width) {
    var isSel  = (selIdx >= 0 && idx === selIdx);
    var pfx    = isSel ? '  ▸ ' : '    ';
    var label  = SECTIONS[idx].label;
    var padLen = width - 4 - label.length;
    var state  = isSel ? 'sel' : 'idle';
    return '<a class="tc-cell tc-cell--' + state + '" href="' + SECTIONS[idx].href +
           '" data-state="' + state + '">' +
           '<span class="tc-pfx">' + esc(pfx) + '</span>' + esc(label) +
           '<span class="tc-pad">' + rep(' ', padLen < 0 ? 0 : padLen) + '</span></a>';
  }

  function buildDoneCell(idx, width) {
    var label  = SECTIONS[idx].label;
    var padLen = width - 4 - label.length;
    return '<a class="tc-cell tc-cell--done" href="' + SECTIONS[idx].href +
           '" data-state="done">' +
           '<span class="tc-pfx">  ✓ </span>' + esc(label) +
           '<span class="tc-pad">' + rep(' ', padLen < 0 ? 0 : padLen) + '</span></a>';
  }

  function cell(idx, selIdx, done, width) {
    return done.indexOf(idx) >= 0 ? buildDoneCell(idx, width) : buildIdleCell(idx, selIdx, width);
  }

  /* ── Responsive layout ──────────────────────────────────────────── */
  /* Build {ncols, rows, colW[], W} for a given column count. Each column
   * is sized to its widest label; the header sets a floor on total W and
   * any surplus is added to the last column so cells still fill the box. */
  function computeLayout(nc) {
    var rows = Math.ceil(SECTIONS.length / nc);
    var colW = [];
    for (var c = 0; c < nc; c++) {
      var maxL = 0;
      for (var r = 0; r < rows; r++) {
        var idx = r * nc + c;
        if (idx < SECTIONS.length) maxL = Math.max(maxL, SECTIONS[idx].label.length);
      }
      colW.push(PFX + maxL + GAP);
    }
    var sum = 0;
    for (var k = 0; k < colW.length; k++) sum += colW[k];
    var W = Math.max(sum, HEADMAX);
    if (W > sum) colW[nc - 1] += (W - sum);   /* pad last col to fill header width */
    return { ncols: nc, rows: rows, colW: colW, W: W };
  }

  /* Pick the widest column count whose box (W + 2 borders) fits `cols`;
   * 1 column is the hard floor. */
  function layoutFor(cols) {
    var tries = [3, 2, 1];
    for (var i = 0; i < tries.length; i++) {
      var L = computeLayout(tries[i]);
      if (L.W + 2 <= cols || tries[i] === 1) return L;
    }
    return computeLayout(1);
  }

  /* ── TUI box ─────────────────────────────────────────────────── */
  /* Single persistent element; always includes the header.
   * selIdx < 0 = no cursor (final/pre-animation state).
   * L defaults to the current global LAYOUT.
   */
  function buildTUI(selIdx, done, L) {
    L = L || LAYOUT;
    var W     = L.W;
    var pipe  = glyphRun('│', 1);
    /* the border rows' "+ 2" is structural (2 corner glyphs either side of
       the W dashes, always correct) — NOT the same "+2" historically used
       for content-row padding below, which was a browser-tuned fudge
       factor. That one is now BOX_CORRECTION, live-measured per browser
       (see measureBoxCorrection()) instead of a value tuned to one. */
    var top   = glyphRun('╭' + rep('─', W) + '╮', W + 2) + '\n';
    var blank = pipe + rep(' ', W + BOX_CORRECTION) + pipe + '\n';
    var bot   = glyphRun('╰' + rep('─', W) + '╯', W + 2);
    var out   = top;

    for (var h = 0; h < HEADER.length; h++) out += pipe + esc(padR(HEADER[h], W + BOX_CORRECTION)) + pipe + '\n';
    out += blank;

    for (var r = 0; r < L.rows; r++) {
      out += pipe;
      for (var c = 0; c < L.ncols; c++) {
        var idx = r * L.ncols + c;
        out += idx < SECTIONS.length ? cell(idx, selIdx, done, L.colW[c])
                                     : rep(' ', L.colW[c]);   /* trailing empty cell */
      }
      out += rep(' ', BOX_CORRECTION) + pipe + '\n';
    }

    return out + bot;
  }

  /* ── Output line ─────────────────────────────────────────────── */
  /* Format:  ❯  [bold clickable Section]   item, others, …
   *
   * Lines are truncated to fit the current render on a single line: the
   * section name is always shown in full; the trailing item text is cut to
   * the columns that actually fit (measured live) and closed with an ellipsis.
   * Re-fitted on resize and once the webfont finishes loading.
   */

  /* join every item in the order given — Studies/Publications/Presentations
     are chronological (latest first) and Repos is by recency, all from
     js/home-preview.js, so this must not reshuffle them. fitText() below
     packs however many fit the line's width and only cuts (with the
     fallback hardcoded items, single-entry, this is just that one item. */
  function makeOutput(section) {
    var full = section.items.map(function (o) { return o.text; }).join(', ');
    return { label: section.label, href: section.href, full: full };
  }

  /* fit raw `full` (already every available item, joined) into `avail`
     columns: shown as-is if it all fits — no "…" when there's nothing
     left out — else cut at a word boundary and mark the cut with " …". */
  function fitText(full, avail) {
    if (full.length <= avail) return esc(full);
    var cut = avail - 2;                                           /* reserve " …"   */
    if (cut < 1) cut = 1;
    var t  = full.slice(0, cut);
    var sp = t.lastIndexOf(' ');
    if (sp > cut - 12 && sp > 0) t = t.slice(0, sp);               /* avoid mid-word cut */
    t = t.replace(/[ ,]+$/, '');
    return esc(t) + ' …';
  }

  /* CommonJS export purely for `bun test` to require() the pure logic
     above without a DOM — never runs in the browser (module is undefined
     there). Must sit before any document.* access below. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      rep: rep, padR: padR, esc: esc, glyphRun: glyphRun,
      buildIdleCell: buildIdleCell, buildDoneCell: buildDoneCell, cell: cell,
      computeLayout: computeLayout, layoutFor: layoutFor, buildTUI: buildTUI,
      makeOutput: makeOutput, fitText: fitText, SECTIONS: SECTIONS
    };
  }

  if (typeof document === 'undefined') return;

  /* ══════════════════════════════════════════════════════════════════
     Terminal hero animation
  ══════════════════════════════════════════════════════════════════ */

  var TERM     = document.getElementById('term-body');
  var SKIP_BTN = document.getElementById('term-skip');

  if (TERM) {

    /* ── Skip mechanism ──────────────────────────────────────────── */
    var SKIP = false;
    var skipCbs = [];

    function wait(ms) {
      if (SKIP) return Promise.resolve();
      return new Promise(function (res) {
        var id = setTimeout(res, ms);
        skipCbs.push(function () { clearTimeout(id); res(); });
      });
    }

    function doSkip() {
      if (SKIP) return;
      SKIP = true;
      var cbs = skipCbs.splice(0);
      for (var i = 0; i < cbs.length; i++) cbs[i]();
      if (SKIP_BTN) SKIP_BTN.style.display = 'none';
    }

    if (SKIP_BTN) SKIP_BTN.addEventListener('click', doSkip);
    document.addEventListener('keydown', doSkip, { once: true });

    /* available character columns for the TUI (viewport-clamped) */
    function availCols() {
      var cw   = charW();
      var left = TERM.getBoundingClientRect().left;
      var vw   = window.innerWidth - 2 * left;
      var px   = Math.min(TERM.clientWidth || vw, vw > 0 ? vw : (TERM.clientWidth || 320));
      return Math.floor(px / cw);
    }

    /* width of one monospace char, measured live (webfont may load late) */
    function charW() {
      var s = document.createElement('span');
      s.className = 'term-out';
      s.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;';
      s.textContent = rep('0', 100);
      TERM.appendChild(s);
      var w = s.getBoundingClientRect().width / 100;
      s.remove();
      return w || 8;
    }

    /* Live per-browser replacement for the old fixed box-drawing fudge
       factors: rather than a fudge value tuned to one browser (and one
       width), render a small hidden probe *at the actual width being
       corrected* (a border-style glyph run next to a plain-text run of the
       same declared width), compare their real rendered pixel widths, and
       use the difference —in character units— as the correction, on
       whatever browser and whatever width is actually in use. Falls back
       to `fallback` if measurement ever comes back non-finite. */
    function measureBoxCorrection(width, fallback) {
      var borderProbe = document.createElement('span');
      borderProbe.className = 'term-tui';
      borderProbe.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;';
      borderProbe.innerHTML = glyphRun(rep('─', width), width);
      TERM.appendChild(borderProbe);
      var borderWidth = borderProbe.getBoundingClientRect().width;
      borderProbe.remove();

      var contentProbe = document.createElement('span');
      contentProbe.className = 'term-tui';
      contentProbe.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;';
      contentProbe.textContent = rep(' ', width);
      TERM.appendChild(contentProbe);
      var contentWidth = contentProbe.getBoundingClientRect().width;
      contentProbe.remove();

      var cw = charW();
      var diff = Math.round((borderWidth - contentWidth) / cw);
      return isFinite(diff) ? diff : fallback;
    }

    /* render one output <pre> from its stored dataset, truncated to fit */
    function renderOutputEl(el) {
      var label = el.dataset.label, href = el.dataset.href, full = el.dataset.full;
      /* clamp to the viewport: a too-wide TUI box can stretch the shared
         container past the screen, so el.clientWidth alone would over-measure.
         window.innerWidth − 2×left ≈ content width inside the page padding. */
      var left  = el.getBoundingClientRect().left;
      var vw     = window.innerWidth - 2 * left;
      var px    = Math.min(el.clientWidth, vw > 0 ? vw : el.clientWidth);
      var cols  = Math.floor(px / charW());
      var avail = cols - (label.length + 8) - 1;   /* "  ❯  LABEL   " + 1 col slack */
      if (avail < 6) avail = 6;
      var ext   = href.indexOf('http') === 0 ? ' target="_blank" rel="noopener"' : '';
      var link  = '<a class="tc-section-link" href="' + href + '"' + ext +
                  '><strong>' + esc(label) + '</strong></a>';
      el.innerHTML = '  <span class="tc-gum">❯</span>  ' + link + '   ' + fitText(full, avail);
    }

    /* re-fit every output line (resize / late font load) */
    function refitOutputs() {
      var els = document.querySelectorAll('.term-out:not(.tc-cow)');
      for (var i = 0; i < els.length; i++) {
        if (els[i].dataset.full !== undefined) renderOutputEl(els[i]);
      }
    }

    /* ── Prompt HTML ─────────────────────────────────────────────── */
    function promptHTML() {
      return '<span class="tc-host">(ncmbianchi@sr-tiget)</span>' +
             '<span class="tc-fish"> ⋊≡°></span>' +
             '<span class="tc-path"> ~</span>' +
             '<span class="tc-sep"> on </span>' +
             '<span class="tc-branch">main</span>' +
             '<span class="tc-status"> ◦</span>';
    }

    /* ── Type plain text into a span ─────────────────────────────── */
    async function typeText(el, text, speed) {
      for (var i = 0; i < text.length; i++) {
        if (SKIP) { el.textContent += text.slice(i); return; }
        el.textContent += text[i];
        await wait(speed);
      }
    }

    /* ── Hover listeners (added after animation ends) ────────────── */
    function attachHoverListeners(tuiEl) {
      tuiEl.addEventListener('mouseover', function (e) {
        var c = e.target.closest('.tc-cell');
        if (!c) return;
        var state = c.dataset.state;
        if (state !== 'idle' && state !== 'done') return;
        var p = c.querySelector('.tc-pfx');
        if (p) p.textContent = '  ▸ ';
      });
      tuiEl.addEventListener('mouseout', function (e) {
        var c = e.target.closest('.tc-cell');
        if (!c) return;
        var p = c.querySelector('.tc-pfx');
        if (c.dataset.state === 'idle') {
          if (p) p.textContent = '    ';
        } else if (c.dataset.state === 'done') {
          if (p) p.textContent = '  ✓ ';
        }
      });
    }

    /* ── Main animation ──────────────────────────────────────────── */
    async function runAnimation() {

      /* 1 — initial blinking cursor */
      var initCur = document.createElement('span');
      initCur.className = 'tc-cursor';
      initCur.textContent = '▌';
      TERM.appendChild(initCur);
      await wait(650);

      /* 2 — prompt line + typed command */
      initCur.remove();

      var pLine  = document.createElement('div');
      pLine.className = 'term-ln';
      pLine.innerHTML = promptHTML();

      var cmdEl  = document.createElement('span');
      cmdEl.className = 'tc-cmd';
      var cmdCur = document.createElement('span');
      cmdCur.className = 'tc-cursor';
      cmdCur.textContent = '▌';

      pLine.appendChild(document.createTextNode(' '));
      pLine.appendChild(cmdEl);
      pLine.appendChild(cmdCur);
      TERM.appendChild(pLine);

      await wait(400);
      await typeText(cmdEl, 'myself --tui', 55);
      await wait(200);
      cmdCur.style.display = 'none';

      /* 3 — TUI (single, persistent; cursor starts on item 0) */
      LAYOUT = layoutFor(availCols());        /* choose column count for this width */
      BOX_CORRECTION = measureBoxCorrection(LAYOUT.W, 2);
      var tuiEl = document.createElement('pre');
      tuiEl.className = 'term-tui animating';
      tuiEl.innerHTML = buildTUI(0, []);
      TERM.appendChild(tuiEl);
      TUI_EL = tuiEl;

      /* 4 — shortkeys bar */
      var keysEl = document.createElement('div');
      keysEl.className = 'term-keys';
      keysEl.textContent = '  [↑↓] navigate  [↵] open  [h] help  [q] quit';
      TERM.appendChild(keysEl);

      /* 5 — output container (lines accumulate here) */
      var outBox = document.createElement('div');
      outBox.className = 'term-outputs';
      TERM.appendChild(outBox);

      await wait(SKIP ? 0 : 350);

      /* 6 — cursor moves through sections */
      var done = [];
      TUI_DONE = done;                        /* shared ref for resize rebuilds */

      for (var i = 0; i < SECTIONS.length; i++) {
        tuiEl.innerHTML = buildTUI(i, done);        /* cursor on i   */
        await wait(SKIP ? 0 : 700);                 /* ~0.7 s pause  */

        /* Swap in the real, live-fetched item list for this section (see
           js/home-preview.js) if one arrived in time, replacing the
           hardcoded fallback items baked into SECTIONS[i] above. The fetch
           started as early as possible (home-preview.js loads before this
           script), so by the time the loop reaches each index the await
           below is usually already resolved. */
        if (window.HomePreview && window.HomePreview[i]) {
          var preview = await window.HomePreview[i];   /* never rejects — see withTimeout() */
          if (preview && preview.length) SECTIONS[i].items = preview;
        }

        done.push(i);
        var nextSel = i < SECTIONS.length - 1 ? i + 1 : -1;
        tuiEl.innerHTML = buildTUI(nextSel, done);  /* i done, next  */

        var outEl = document.createElement('pre');
        outEl.className = 'term-out';
        var od = makeOutput(SECTIONS[i]);
        outEl.dataset.label = od.label;
        outEl.dataset.href  = od.href;
        outEl.dataset.full  = od.full;
        outBox.appendChild(outEl);
        renderOutputEl(outEl);                      /* truncate to fit render */
        outEl.scrollIntoView({ behavior: SKIP ? 'auto' : 'smooth', block: 'nearest' });

        await wait(SKIP ? 0 : 300);
      }

      /* 7 — final state: all done, hover enabled */
      LAYOUT = layoutFor(availCols());
      BOX_CORRECTION = measureBoxCorrection(LAYOUT.W, 2);  /* re-measure: webfont is loaded by now */
      tuiEl.innerHTML = buildTUI(-1, done);
      tuiEl.classList.remove('animating');
      attachHoverListeners(tuiEl);
      ANIM_DONE = true;

      /* 8 — prompt reappears (q was pressed inside TUI), then cowsay command */
      await wait(SKIP ? 0 : 700);

      var qLine = document.createElement('div');
      qLine.className = 'term-ln term-ln--gap';
      qLine.innerHTML = promptHTML();
      var qCmd = document.createElement('span');
      qCmd.className = 'tc-cmd';
      var qCur = document.createElement('span');
      qCur.className = 'tc-cursor';
      qCur.textContent = '▌';
      qLine.appendChild(document.createTextNode(' '));
      qLine.appendChild(qCmd);
      qLine.appendChild(qCur);
      TERM.appendChild(qLine);
      qLine.scrollIntoView({ behavior: SKIP ? 'auto' : 'smooth', block: 'nearest' });

      await wait(SKIP ? 0 : 380);
      await typeText(qCmd, 'cowsay "$(cat many_thanks.txt)"', 42);
      await wait(SKIP ? 0 : 200);
      qCur.style.display = 'none';

      var cowEl = document.createElement('pre');
      cowEl.className = 'term-out tc-cow';
      var cowPipe = glyphRun('│', 1);
      var cowW = 26;
      var cowCorrection = measureBoxCorrection(cowW, 1);   /* measured at its own
                                                               width — see the note
                                                               on measureBoxCorrection() */
      var cowMsg = '  thanks for visiting!';
      cowEl.innerHTML = [
        glyphRun('╭' + rep('─', cowW) + '╮', cowW + 2),
        cowPipe + esc(cowMsg + rep(' ', cowW + cowCorrection - cowMsg.length)) + cowPipe,
        glyphRun('╰' + rep('─', cowW) + '╯', cowW + 2),
        esc('        \\   ^__^'),
        esc('         \\  (oo)\\_______'),
        esc('            (__)\\       )\\/\\'),
        esc('                ||----w |'),
        esc('                ||     ||')
      ].join('\n');
      TERM.appendChild(cowEl);
      cowEl.scrollIntoView({ behavior: SKIP ? 'auto' : 'smooth', block: 'nearest' });

      if (SKIP_BTN) SKIP_BTN.style.display = 'none';
    }

    /* re-flow the TUI column count + re-fit output lines on resize and once
       the webfont settles (char width shifts when the real font loads) */
    function reflow() {
      LAYOUT = layoutFor(availCols());
      BOX_CORRECTION = measureBoxCorrection(LAYOUT.W, 2);
      if (TUI_EL && ANIM_DONE) TUI_EL.innerHTML = buildTUI(-1, TUI_DONE);
      refitOutputs();
    }
    var reflowT;
    window.addEventListener('resize', function () {
      clearTimeout(reflowT);
      reflowT = setTimeout(reflow, 120);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(reflow);

    runAnimation().catch(function () {});
  }

  /* ══════════════════════════════════════════════════════════════════
     Sticky nav scroll-spy (in-page anchors only)
  ══════════════════════════════════════════════════════════════════ */
  var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = [];
  navLinks.forEach(function (a) {
    var el = document.querySelector(a.getAttribute('href'));
    if (el) sections.push(el);
  });

  function onScroll() {
    if (!sections.length) return;
    var scrollY = window.scrollY + 80;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= scrollY) current = sections[i];
    }
    navLinks.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current.id);
    });
  }

  if (sections.length) {
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ══════════════════════════════════════════════════════════════════
     Mobile nav toggle
  ══════════════════════════════════════════════════════════════════ */
  var toggle       = document.querySelector('.nav-toggle');
  var navContainer = document.querySelector('.nav-links');

  if (toggle && navContainer) {
    toggle.addEventListener('click', function () {
      var open = navContainer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    navContainer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navContainer.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     Custom nav scroll indicator (.nav-scrollbar / .nav-scrollbar-thumb)
     Native OS scrollbars auto-hide regardless of CSS on most platforms, so
     this is a JS-driven stand-in: thumb width = visible/total proportion,
     thumb left = scroll-position proportion. Hidden entirely when nothing
     overflows — no need for a scroll affordance if every item already fits.
  ══════════════════════════════════════════════════════════════════ */
  function updateNavScrollbar(links) {
    var track = links.parentElement.querySelector('.nav-scrollbar');
    var thumb = links.parentElement.querySelector('.nav-scrollbar-thumb');
    if (!track || !thumb) return;
    var max = links.scrollWidth - links.clientWidth;
    if (max <= 0) {
      track.style.display = 'none';
      return;
    }
    track.style.display = 'block';
    var visibleFrac = links.clientWidth / links.scrollWidth;
    var scrolledFrac = links.scrollLeft / max;
    thumb.style.width = (visibleFrac * 100) + '%';
    thumb.style.left  = (scrolledFrac * (100 - visibleFrac * 100)) + '%';
  }

  if (navContainer) {
    updateNavScrollbar(navContainer);
    navContainer.addEventListener('scroll', function () {
      updateNavScrollbar(navContainer);
    }, { passive: true });
    window.addEventListener('resize', function () {
      updateNavScrollbar(navContainer);
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { updateNavScrollbar(navContainer); });
    }
  }

})();
