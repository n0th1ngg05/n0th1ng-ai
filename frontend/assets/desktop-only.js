/**
 * desktop-only.js
 *
 * Some workspaces (Forge / ForgeX) need a real keyboard and a large screen
 * and simply don't work on a phone. This flags those pages so a blocking
 * message can be shown instead of the workspace.
 *
 * IMPORTANT: we deliberately do NOT rely on navigator.userAgent or on
 * window.innerWidth / CSS media queries. "Request Desktop Site" on a phone
 * rewrites the UA string and widens the reported layout viewport, which
 * would fool both of those checks. window.screen.width/height reflect the
 * device's actual physical display and are not affected by that spoof, so
 * we use that (plus touch/pointer capability) instead.
 */
(function () {
  var PHONE_MAX_SHORT_SIDE = 540; // covers phones/phablets, stays below tablet sizes (iPad mini is ~744)

  function isPhoneDevice() {
    try {
      var s = window.screen || {};
      var shortSide = Math.min(s.width || 0, s.height || 0);
      if (!shortSide) return false;

      var hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
      var coarsePointer = false;
      try {
        coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      } catch (e) { /* ignore */ }

      return shortSide <= PHONE_MAX_SHORT_SIDE && (hasTouch || coarsePointer);
    } catch (e) {
      return false;
    }
  }

  function apply() {
    document.documentElement.classList.toggle('n0-desktop-only', isPhoneDevice());
  }

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
})();
