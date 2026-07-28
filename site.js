/* ElectroTek Consultants — shared behaviour.
   Kept deliberately small: entrances are CSS, this only supplies the trigger. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Below-the-fold reveals. If the observer is unavailable — or the visitor
     asked for reduced motion — everything is shown immediately rather than
     being stranded at opacity 0. That failure mode is how a "polished" site
     ships with invisible content. */
  var revealables = document.querySelectorAll('.reveal');

  if (reduced || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });

    revealables.forEach(function (el) { observer.observe(el); });
  }

  /* Mobile menu. Real button semantics, correct ARIA, Escape to dismiss and
     focus returned to the trigger — the keyboard path is part of the craft,
     not a compliance afterthought. */
  var menu = document.getElementById('mobMenu');
  var openBtn = document.querySelector('[data-menu-open]');
  var closeBtn = document.querySelector('[data-menu-close]');

  if (menu && openBtn) {
    var setMenu = function (open) {
      menu.classList.toggle('is-open', open);
      openBtn.setAttribute('aria-expanded', String(open));
      document.documentElement.style.overflow = open ? 'hidden' : '';
      if (open) {
        (closeBtn || menu).focus();
      } else {
        openBtn.focus();
      }
    };

    openBtn.addEventListener('click', function () { setMenu(true); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setMenu(false); });

    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setMenu(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) setMenu(false);
    });
  }
})();
