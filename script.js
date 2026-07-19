// ─── Nav scroll shadow ──────────────────────────────────
// Throttled with requestAnimationFrame + a passive listener so momentum
// scrolling on mobile doesn't peg the main thread (each toggle repaints the
// backdrop-filtered nav, which is expensive on phones).
const nav = document.querySelector('.nav');
let scrollScheduled = false;
window.addEventListener('scroll', () => {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
    scrollScheduled = false;
  });
}, { passive: true });

// ─── Mobile burger toggle ───────────────────────────────
// State lives in a single CSS class instead of a pile of inline styles.
const burger = document.querySelector('.nav__burger');
const navLinks = document.querySelector('.nav__links');
burger.addEventListener('click', () => {
  navLinks.classList.toggle('nav__links--open');
});

// Close the mobile nav after tapping a link
document.querySelectorAll('.nav__links a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('nav__links--open');
  });
});

// ─── Fade-in on scroll ──────────────────────────────────
// Elements start hidden via the `.reveal` class and get `.visible` when they
// scroll into view (CSS handles the transition). If IntersectionObserver is
// unavailable, everything is shown immediately so content is never stuck
// invisible.
const revealEls = document.querySelectorAll(
  '.menu-card, .testimonial, .gallery__item, .about__image-wrap, .stat'
);

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealEls.forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });
} else {
  revealEls.forEach(el => el.classList.add('visible'));
}
