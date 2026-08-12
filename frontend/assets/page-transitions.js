/**
 * page-transitions.js
 * n0th1ng AI Workstation — Butter-smooth page navigation
 *
 * Responsibilities:
 *  1. Animated loading progress bar on every navigation
 *  2. Progressive enhancement via View Transitions API
 *  3. Handles MPA cross-document navigation events
 *  4. Mobile & reduced-motion safe
 */
(function () {
  'use strict';

  /* ── Progress Bar Setup ───────────────────────────────────── */
  const bar = document.getElementById('vt-bar') || (() => {
    const el = document.createElement('div');
    el.id = 'vt-bar';
    document.documentElement.appendChild(el);
    return el;
  })();

  let _progressRaf = null;
  let _progressTimeout = null;
  let _stuckTimer = null;

  function _clearTimers() {
    cancelAnimationFrame(_progressRaf);
    clearTimeout(_progressTimeout);
    clearTimeout(_stuckTimer);
  }

  /** Show bar and animate toward 70% to fake progress */
  function showBar() {
    _clearTimers();
    bar.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease';
    bar.style.transform   = 'scaleX(0)';
    bar.classList.add('vt-loading');

    _progressRaf = requestAnimationFrame(() => {
      _progressRaf = requestAnimationFrame(() => {
        bar.style.transform = 'scaleX(0.65)';

        /* Slowly crawl toward 90% if navigation takes long */
        _stuckTimer = setTimeout(() => {
          bar.style.transition = 'transform 3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease';
          bar.style.transform   = 'scaleX(0.90)';
        }, 400);
      });
    });
  }

  /** Snap bar to full width then fade out */
  function completeBar() {
    _clearTimers();
    bar.style.transition = 'transform 0.18s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease 0.18s';
    bar.style.transform  = 'scaleX(1)';
    _progressTimeout = setTimeout(() => {
      bar.classList.remove('vt-loading');
      /* Reset after fade-out so next navigation starts clean */
      setTimeout(() => { bar.style.transform = 'scaleX(0)'; }, 350);
    }, 180);
  }

  /* ── Cross-Document View Transition Events ────────────────── */
  /*   pageswap  — fires on the OLD page just before it unloads  */
  /*   pagereveal — fires on the NEW page when first painted     */

  window.addEventListener('pageswap', () => {
    showBar();
  });

  window.addEventListener('pagereveal', () => {
    completeBar();
  });

  /* ── Fallback for browsers without Navigation API ─────────── */
  /*   Show bar on any same-origin link click, complete on load  */
  const _hasNavAPI = typeof navigation !== 'undefined';

  if (!_hasNavAPI) {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');

      /* Skip: hash-only, external, mailto/tel, download, new-tab, modifier keys */
      if (
        !href                          ||
        href.startsWith('#')           ||
        /^(https?:)?\/\//i.test(href)  ||
        /^(mailto|tel):/i.test(href)   ||
        link.hasAttribute('download')  ||
        link.target === '_blank'       ||
        e.ctrlKey || e.metaKey || e.shiftKey || e.altKey
      ) return;

      showBar();
    });

    /* Complete the bar when the new page is loaded */
    window.addEventListener('load', completeBar);
    window.addEventListener('DOMContentLoaded', completeBar);
  }

  /* ── Apply view-transition-name to navbar (for morph effect) ─ */
  /*   This is done in JS so it doesn't require per-page CSS edits */
  const nav = document.getElementById('navWrap');
  if (nav) nav.style.viewTransitionName = 'n0-nav';

  /* ── Preload adjacent pages on hover (desktop, fast connection) ─ */
  if (window.matchMedia('(min-width: 901px)').matches &&
      navigator.connection?.effectiveType !== '2g') {

    const preloadedHrefs = new Set();

    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (
        !href                          ||
        href.startsWith('#')           ||
        /^(https?:)?\/\//i.test(href)  ||
        /^(mailto|tel):/i.test(href)   ||
        link.target === '_blank'       ||
        preloadedHrefs.has(href)
      ) return;

      preloadedHrefs.add(href);
      const rel = document.createElement('link');
      rel.rel  = 'prefetch';
      rel.href = href;
      document.head.appendChild(rel);
    }, { passive: true });
  }

})();
