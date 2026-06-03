/* main.js — terminal hero animation + nav behaviour */

(function () {
  'use strict';

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

    /* ── Layout constants ────────────────────────────────────────── */
    /* 2 rows × 3 columns
     *  Row 1: [0] Academic Studies  [1] Publications  [2] Presentations
     *  Row 2: [3] Repos             [4] Skills        [5] Interests
     *  W = C1 + C2 + C3 = 22 + 18 + 19 = 59
     */
    var W = 59, C1 = 22, C2 = 18, C3 = 19;

    /* ── Section data ────────────────────────────────────────────── */
    /* items[] — multi-item sections pick a random entry per load    */
    var SECTIONS = [
      {
        label: 'Academic Studies', href: 'about.html',
        items: [
          { text: '2024 MSc in Bioinformatics for Computational Genomics \u00b7 UniMI, PoliMI, LeidenUniv' }
        ]
      },
      {
        label: 'Publications', href: 'publications.html',
        items: [
          { text: 'doi:10.1186/s12859-026-06376-5 Bianchi et al. \u201cDesign and evaluation of semantically-valid\u2026' }
        ]
      },
      {
        label: 'Presentations', href: 'presentations.html',
        items: [
          { text: 'zenodo:10.5281/zenodo.20322631 BioSB2026 \u201cGraphs & Networks\u201d, invited speaker' }
        ]
      },
      {
        label: 'Repos', href: 'repos.html',
        items: [
          { text: 'PR #92 \u2192 genepi/umi-pipeline-nf (fix dependencies)' }
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
      var pfx    = isSel ? '  \u25b8 ' : '    ';
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
             '<span class="tc-pfx">  \u2713 </span>' + esc(label) +
             '<span class="tc-pad">' + rep(' ', padLen < 0 ? 0 : padLen) + '</span></a>';
    }

    function cell(idx, selIdx, done, width) {
      return done.indexOf(idx) >= 0 ? buildDoneCell(idx, width) : buildIdleCell(idx, selIdx, width);
    }

    /* ── TUI box ─────────────────────────────────────────────────── */
    /* Single persistent element; always includes the header.
     * selIdx < 0 = no cursor (final/pre-animation state).
     */
    function buildTUI(selIdx, done) {
      var top   = '\u256d' + rep('\u2500', W) + '\u256e\n';
      var blank = '\u2502' + rep(' ', W)      + '\u2502\n';
      var bot   = '\u2570' + rep('\u2500', W) + '\u256f';
      var out   = top;

      out += '\u2502' + esc(padR('  Niccol\u00f2 Bianchi', W))                       + '\u2502\n';
      out += '\u2502' + esc(padR('  ncmbianchi.srtiget@proton.me', W))               + '\u2502\n';
      out += '\u2502' + esc(padR('  Bioinformatician & Data Analysis Dev', W))       + '\u2502\n';
      out += blank;

      for (var r = 0; r < 2; r++) {
        var i0 = r * 3, i1 = r * 3 + 1, i2 = r * 3 + 2;
        out += '\u2502' + cell(i0, selIdx, done, C1) +
                          cell(i1, selIdx, done, C2) +
                          cell(i2, selIdx, done, C3) + '\u2502\n';
      }

      return out + bot;
    }

    /* ── Output line ─────────────────────────────────────────────── */
    /* Format:  ❯  [bold clickable Section]   random-item, others, …  */
    function buildOutput(section) {
      var items  = section.items;
      var ri     = items.length > 1 ? Math.floor(Math.random() * items.length) : 0;
      var chosen = items[ri];
      var others = items.filter(function (_, j) { return j !== ri; });

      var text = esc(chosen.text);
      if (others.length) text += ', ' + others.map(function (o) { return esc(o.text); }).join(', ');
      text += ', \u2026';

      var ext  = section.href.startsWith('http') ? ' target="_blank" rel="noopener"' : '';
      var link = '<a class="tc-section-link" href="' + section.href + '"' + ext + '>' +
                 '<strong>' + esc(section.label) + '</strong></a>';

      return '  <span class="tc-gum">\u276f</span>  ' + link + '   ' + text;
    }

    /* ── Prompt HTML ─────────────────────────────────────────────── */
    function promptHTML() {
      return '<span class="tc-host">(ncmbianchi@sr-tiget)</span>' +
             '<span class="tc-fish"> \u22ca\u2261\u00b0></span>' +
             '<span class="tc-path"> ~</span>' +
             '<span class="tc-sep"> on </span>' +
             '<span class="tc-branch">main</span>' +
             '<span class="tc-status"> \u25e6</span>';
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
        if (p) p.textContent = '  \u25b8 ';
      });
      tuiEl.addEventListener('mouseout', function (e) {
        var c = e.target.closest('.tc-cell');
        if (!c) return;
        var p = c.querySelector('.tc-pfx');
        if (c.dataset.state === 'idle') {
          if (p) p.textContent = '    ';
        } else if (c.dataset.state === 'done') {
          if (p) p.textContent = '  \u2713 ';
        }
      });
    }

    /* ── Main animation ──────────────────────────────────────────── */
    async function runAnimation() {

      /* 1 — initial blinking cursor */
      var initCur = document.createElement('span');
      initCur.className = 'tc-cursor';
      initCur.textContent = '\u258c';
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
      cmdCur.textContent = '\u258c';

      pLine.appendChild(document.createTextNode(' '));
      pLine.appendChild(cmdEl);
      pLine.appendChild(cmdCur);
      TERM.appendChild(pLine);

      await wait(400);
      await typeText(cmdEl, 'myself --tui', 55);
      await wait(200);
      cmdCur.style.display = 'none';

      /* 3 — TUI (single, persistent; cursor starts on item 0) */
      var tuiEl = document.createElement('pre');
      tuiEl.className = 'term-tui animating';
      tuiEl.innerHTML = buildTUI(0, []);
      TERM.appendChild(tuiEl);

      /* 4 — shortkeys bar */
      var keysEl = document.createElement('div');
      keysEl.className = 'term-keys';
      keysEl.textContent = '  [\u2191\u2193] navigate  [\u21b5] open  [h] help  [q] quit';
      TERM.appendChild(keysEl);

      /* 5 — output container (lines accumulate here) */
      var outBox = document.createElement('div');
      outBox.className = 'term-outputs';
      TERM.appendChild(outBox);

      await wait(SKIP ? 0 : 350);

      /* 6 — cursor moves through sections */
      var done = [];

      for (var i = 0; i < SECTIONS.length; i++) {
        tuiEl.innerHTML = buildTUI(i, done);        /* cursor on i   */
        await wait(SKIP ? 0 : 950);                 /* ~1 s pause    */

        done.push(i);
        var nextSel = i < SECTIONS.length - 1 ? i + 1 : -1;
        tuiEl.innerHTML = buildTUI(nextSel, done);  /* i done, next  */

        var outEl = document.createElement('pre');
        outEl.className = 'term-out';
        outEl.innerHTML  = buildOutput(SECTIONS[i]);
        outBox.appendChild(outEl);
        outEl.scrollIntoView({ behavior: SKIP ? 'auto' : 'smooth', block: 'nearest' });

        await wait(SKIP ? 0 : 450);
      }

      /* 7 — final state: all done, hover enabled */
      tuiEl.innerHTML = buildTUI(-1, done);
      tuiEl.classList.remove('animating');
      attachHoverListeners(tuiEl);

      /* 8 — prompt reappears (q was pressed inside TUI), then cowsay command */
      await wait(SKIP ? 0 : 700);

      var qLine = document.createElement('div');
      qLine.className = 'term-ln';
      qLine.innerHTML = promptHTML();
      var qCmd = document.createElement('span');
      qCmd.className = 'tc-cmd';
      var qCur = document.createElement('span');
      qCur.className = 'tc-cursor';
      qCur.textContent = '\u258c';
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
      cowEl.textContent = [
        ' ________________________',
        '< thanks for visiting!   >',
        ' ------------------------',
        '        \\   ^__^',
        '         \\  (oo)\\_______',
        '            (__)\\       )\\/\\',
        '                ||----w |',
        '                ||     ||'
      ].join('\n');
      TERM.appendChild(cowEl);
      cowEl.scrollIntoView({ behavior: SKIP ? 'auto' : 'smooth', block: 'nearest' });

      if (SKIP_BTN) SKIP_BTN.style.display = 'none';
    }

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
     Header shadow on scroll
  ══════════════════════════════════════════════════════════════════ */
  var header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.style.boxShadow = window.scrollY > 4
        ? '0 2px 16px rgba(0,0,0,0.07)'
        : 'none';
    }, { passive: true });
  }

})();
