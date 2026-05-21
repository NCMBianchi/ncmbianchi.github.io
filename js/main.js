/* main.js — minimal progressive enhancement, no framework */

(function () {
  'use strict';

  /* ── Typewriter effect — hero section only, page-load ────────────── */
  var typewriterEls = document.querySelectorAll('[data-typewriter]');

  function typewrite(el, text, speed, onDone) {
    var i = 0;
    el.textContent = '';
    el.classList.add('typing');
    (function tick() {
      if (i < text.length) {
        el.textContent += text[i];
        i++;
        setTimeout(tick, speed);
      } else {
        el.classList.remove('typing');
        if (onDone) onDone();
      }
    })();
  }

  function runTypewriters(elements, index) {
    if (!elements || index >= elements.length) return;
    var el = elements[index];
    var text = el.textContent;
    var isFirst = index === 0;
    /* Slightly slower for the name, faster for the subtitle */
    var speed = isFirst ? 55 : 35;
    /* Small pause before each element after the first */
    var delay = isFirst ? 200 : 120;
    setTimeout(function () {
      typewrite(el, text, speed, function () {
        runTypewriters(elements, index + 1);
      });
    }, delay);
  }

  if (typewriterEls.length) {
    runTypewriters(typewriterEls, 0);
  }

  /* ── Sticky nav: highlight active section on scroll ──────────────── */
  var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = Array.prototype.slice.call(navLinks)
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  function onScroll() {
    var scrollY = window.scrollY + 80;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= scrollY) current = sections[i];
    }
    navLinks.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current.id);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Mobile nav toggle ───────────────────────────────────────────── */
  var toggle = document.querySelector('.nav-toggle');
  var linksContainer = document.querySelector('.nav-links');

  if (toggle && linksContainer) {
    toggle.addEventListener('click', function () {
      var isOpen = linksContainer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen);
    });

    linksContainer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        linksContainer.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── Sticky header shadow on scroll ─────────────────────────────── */
  var header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.style.boxShadow = window.scrollY > 4
        ? '0 2px 16px rgba(0,0,0,0.07)'
        : 'none';
    }, { passive: true });
  }

})();
