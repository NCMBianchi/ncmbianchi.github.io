/* main.js — terminal hero animation + nav behaviour */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     Terminal hero animation
  ══════════════════════════════════════════════════════════════════ */

  var TERM     = document.getElementById('term-body');
  var INIT_CUR = document.getElementById('init-cursor');
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
    var W  = 59;  /* TUI inner width                  */
    var C1 = 22;  /* col 1 (Academic Studies / Repos) */
    var C2 = 18;  /* col 2 (Publications / Skills)    */
    var C3 = 19;  /* col 3 (Presentations / Interests)*/
    /* Layout: 2 rows × 3 columns
     *  Row 1: [0] Academic Studies  [1] Publications  [2] Presentations
     *  Row 2: [3] Repos             [4] Skills        [5] Interests
     */

    /* ── Section data ────────────────────────────────────────────── */
    /*
     * Sections are arranged in 2 columns of 3 rows:
     *   Col 1 (indices 0-2): Academic Studies | Publications | Presentations
     *   Col 2 (indices 3-5): Repos            | Skills        | Interests
     */
    var SECTIONS = [
      {
        label: 'Academic Studies',
        href: 'about.html',
        output: {
          href: 'about.html',
          itemText: '2024 MSc in Bioinformatics for Computational Genomics',
          restText: ' \u00b7 UniMI, PoliMI, LeidenUniv'
        }
      },
      {
        label: 'Publications',
        href: 'publications.html',
        output: {
          href: 'https://doi.org/10.1186/s12859-026-06376-5',
          itemText: 'doi:10.1186/s12859-026-06376-5',
          restText: ' Bianchi et al. \u201cDesign and evaluation of semantically-valid\u2026'
        }
      },
      {
        label: 'Presentations',
        href: 'presentations.html',
        output: {
          href: 'https://doi.org/10.5281/zenodo.20322631',
          itemText: 'zenodo:10.5281/zenodo.20322631',
          restText: ' BioSB2026 \u201cGraphs & Networks\u201d, invited speaker'
        }
      },
      {
        label: 'Repos',
        href: 'repos.html',
        output: {
          href: 'https://github.com/genepi/umi-pipeline-nf/pull/92',
          itemText: 'PR #92',
          restText: ' \u2192 genepi/umi-pipeline-nf (fix dependencies)'
        }
      },
      {
        label: 'Skills',
        href: 'skills.html',
        output: {
          href: 'skills.html',
          itemText: 'scRNAseq',
          restText: ', Alphagenome, Snakemake, Nextflow, Python, R'
        }
      },
      {
        label: 'Interests',
        href: 'interests.html',
        output: {
          href: 'interests.html',
          itemText: 'photography',
          restText: ', cooking, drawing, cinema'
        }
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
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    /* ── Single TUI cell ─────────────────────────────────────────── */
    function buildCell(idx, selIdx, done, width) {
      var isDone = done.indexOf(idx) >= 0;
      var isSel  = idx === selIdx;
      var pfx    = isSel ? '  \u25b8 ' : (isDone ? '  \u2713 ' : '    ');
      var label  = SECTIONS[idx].label;
      var content = pfx + label;
      var padding = rep(' ', width - content.length);
      var link = '<a class="tc-nav" href="' + SECTIONS[idx].href + '">';
      if (isSel) {
        return '<span class="tc-sel">' + esc(pfx) + link + esc(label) + '</a></span>' + padding;
      }
      if (isDone) {
        return '<span class="tc-done">' + esc(pfx) + link + esc(label) + '</a></span>' + padding;
      }
      return esc(pfx) + link + esc(label) + '</a>' + padding;
    }

    /* ── Full TUI box ────────────────────────────────────────────── */
    /*
     * isFirst = true  → show name/email/title header above menu
     * isFirst = false → compact 2-row menu only
     * Layout: 2 rows × 3 cols
     */
    function buildTUI(selIdx, done, isFirst) {
      var top   = '\u256d' + rep('\u2500', W) + '\u256e\n';
      var blank = '\u2502' + rep(' ', W) + '\u2502\n';
      var bot   = '\u2570' + rep('\u2500', W) + '\u256f';
      var out   = top;

      if (isFirst) {
        out += '\u2502' + esc(padR('  Niccol\u00f2 Bianchi', W)) + '\u2502\n';
        out += '\u2502' + esc(padR('  ncmbianchi.srtiget@proton.me', W)) + '\u2502\n';
        out += '\u2502' + esc(padR('  Bioinformatician & Data Analysis Dev', W)) + '\u2502\n';
        out += blank;
      }

      /* 2 rows × 3 columns */
      for (var r = 0; r < 2; r++) {
        out += '\u2502' + buildCell(r * 3 + 0, selIdx, done, C1)
                        + buildCell(r * 3 + 1, selIdx, done, C2)
                        + buildCell(r * 3 + 2, selIdx, done, C3)
                        + '\u2502\n';
      }

      out += bot;
      return out;
    }

    /* ── Section output line ─────────────────────────────────────── */
    function buildOutput(section) {
      var o = section.output;
      var ext = o.href.startsWith('http');
      var tgt = ext ? ' target="_blank" rel="noopener"' : '';
      return '  <a class="tc-item" href="' + o.href + '"' + tgt + '>' +
             esc(o.itemText) + '</a>' + esc(o.restText) + ', \u2026';
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

    /* ── Type a plain string into a text node ────────────────────── */
    async function typeText(el, text, speed) {
      for (var i = 0; i < text.length; i++) {
        if (SKIP) { el.textContent += text.slice(i); return; }
        el.textContent += text[i];
        await wait(speed);
      }
    }

    /* ── Main animation sequence ─────────────────────────────────── */
    async function runAnimation() {
      var done = [];

      for (var i = 0; i < SECTIONS.length; i++) {

        /* Prompt + command line */
        var block  = document.createElement('div');
        block.className = 'term-block';

        var pLine  = document.createElement('div');
        pLine.className = 'term-ln';
        pLine.innerHTML = promptHTML();

        var cmdEl  = document.createElement('span');
        cmdEl.className = 'tc-cmd';
        var cur    = document.createElement('span');
        cur.className = 'tc-cursor';
        cur.textContent = '\u258c';

        pLine.appendChild(document.createTextNode(' '));
        pLine.appendChild(cmdEl);
        pLine.appendChild(cur);
        block.appendChild(pLine);
        TERM.appendChild(block);

        /* Hide static initial cursor on first iteration */
        if (i === 0 && INIT_CUR) {
          INIT_CUR.style.animation = 'none';
          INIT_CUR.style.opacity   = '0';
        }

        await wait(i === 0 ? 900 : 250);
        await typeText(cmdEl, 'myself -h', i === 0 ? 55 : 28);
        await wait(180);
        cur.style.display = 'none';

        /* TUI — header only on first appearance */
        var tuiEl  = document.createElement('pre');
        tuiEl.className = 'term-tui';
        tuiEl.innerHTML = buildTUI(i, done, i === 0);
        block.appendChild(tuiEl);

        await wait(SKIP ? 0 : 1000); /* ~1 s pause — TUI visible before cursor selects */

        /* Output line */
        var outEl  = document.createElement('pre');
        outEl.className = 'term-out';
        outEl.innerHTML = buildOutput(SECTIONS[i]);
        block.appendChild(outEl);
        done.push(i);

        block.scrollIntoView({ behavior: SKIP ? 'auto' : 'smooth', block: 'nearest' });
        await wait(SKIP ? 0 : 500);
      }

      if (SKIP_BTN) SKIP_BTN.style.display = 'none';
    }

    runAnimation().catch(function () {});
  }

  /* ══════════════════════════════════════════════════════════════════
     Sticky nav: scroll-spy (in-page anchors only)
  ══════════════════════════════════════════════════════════════════ */
  var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = [];
  navLinks.forEach(function (a) {
    var el = document.querySelector(a.getAttribute('href'));
    if (el) sections.push(el);
  });

  function onScroll() {
    if (!sections.length) return;
    var scrollY  = window.scrollY + 80;
    var current  = sections[0];
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
