// Nav scroll shadow
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
});

// Mobile burger toggle
const burger = document.querySelector('.nav__burger');
const navLinks = document.querySelector('.nav__links');
burger.addEventListener('click', () => {
  const open = navLinks.style.display === 'flex';
  navLinks.style.display = open ? '' : 'flex';
  navLinks.style.flexDirection = 'column';
  navLinks.style.position = 'absolute';
  navLinks.style.top = '72px';
  navLinks.style.left = '0';
  navLinks.style.right = '0';
  navLinks.style.background = 'var(--clr-bg)';
  navLinks.style.padding = '20px 40px';
  navLinks.style.borderBottom = '1px solid var(--clr-border)';
  if (open) navLinks.style.cssText = '';
});

// Close mobile nav on link click
document.querySelectorAll('.nav__links a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.style.cssText = '';
  });
});

// Fade-in on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.menu-card, .testimonial, .gallery__item, .about__image-wrap, .stat').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity .5s ease, transform .5s ease';
  observer.observe(el);
});

document.querySelectorAll('.menu-card, .testimonial, .gallery__item, .about__image-wrap, .stat').forEach(el => {
  const mutObs = new MutationObserver(() => {
    if (el.classList.contains('visible')) {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }
  });
  mutObs.observe(el, { attributes: true, attributeFilter: ['class'] });
});
