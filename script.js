// Device + orientation detection
function updateDeviceClasses() {
  const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isLandscape = window.innerWidth > window.innerHeight;
  document.body.classList.toggle('is-mobile', isMobile);
  document.body.classList.toggle('is-landscape', isLandscape);
  document.body.classList.toggle('is-touch', 'ontouchstart' in window);
}
updateDeviceClasses();
window.addEventListener('resize', updateDeviceClasses);
window.addEventListener('orientationchange', () => {
  setTimeout(updateDeviceClasses, 150);
  document.getElementById('navLinks').classList.remove('open');
  document.getElementById('burger').classList.remove('open');
});

// Hero scroll-driven zoom-out — velocity sensitive, instant response
const heroImg = document.getElementById('heroImg');
const heroSection = document.getElementById('hero');

if (heroImg && heroSection) {
  let lastScrollY = window.scrollY;
  let lastScrollTime = performance.now();
  let velBoost = 0;
  let springRaf = null;

  function applyZoom(scale) {
    heroImg.style.transform = `scale(${scale})`;
  }

  function springVelToZero() {
    velBoost *= 0.82; // decay
    if (velBoost < 0.001) {
      velBoost = 0;
      return;
    }
    // Recompute scale with decayed velBoost
    const scrollY = window.scrollY;
    const heroH = heroSection.offsetHeight;
    const posProgress = Math.min(scrollY / (heroH * 0.45), 1);
    const scale = Math.max(1.0, 1.25 - posProgress * 0.25 - velBoost);
    applyZoom(scale);
    springRaf = requestAnimationFrame(springVelToZero);
  }

  window.addEventListener('scroll', () => {
    const now = performance.now();
    const scrollY = window.scrollY;
    const heroH = heroSection.offsetHeight;

    // Only active while hero is in view
    if (scrollY > heroH) {
      lastScrollY = scrollY;
      lastScrollTime = now;
      return;
    }

    const dy = scrollY - lastScrollY;
    const dt = Math.max(now - lastScrollTime, 1);
    const velocity = dy / dt; // px per ms — positive = scrolling down

    // Position baseline: completes zoom within first 45% of hero height
    const posProgress = Math.min(scrollY / (heroH * 0.45), 1);

    // Velocity boost: fast downward scroll adds extra instant zoom-out
    if (velocity > 0) {
      velBoost = Math.min(velBoost + velocity * 0.025, 0.18);
    } else {
      velBoost *= 0.6; // damp quickly when scrolling back up
    }

    const scale = Math.max(1.0, 1.25 - posProgress * 0.25 - velBoost);
    applyZoom(scale);

    lastScrollY = scrollY;
    lastScrollTime = now;

    // Spring velBoost back to zero over next few frames
    cancelAnimationFrame(springRaf);
    springRaf = requestAnimationFrame(springVelToZero);
  }, { passive: true });

  // Set initial state
  applyZoom(1.25);
}

// Mobile burger
document.getElementById('burger').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
  document.getElementById('burger').classList.toggle('open');
});
document.querySelectorAll('.nav__links a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('open');
    document.getElementById('burger').classList.remove('open');
  });
});

// Cart state
let cart = [];

function addToCart(id, name, price) {
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty++;
  else cart.push({ id, name, price, qty: 1 });
  updateCartUI();
  openCart();
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  updateCartUI();
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeFromCart(id);
  else updateCartUI();
}

function updateCartUI() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('cartBadge').textContent = total;

  const itemsEl = document.getElementById('cartItems');
  const footerEl = document.getElementById('cartFooter');

  if (cart.length === 0) {
    itemsEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    footerEl.style.display = 'none';
    return;
  }

  itemsEl.innerHTML = cart.map(i => `
    <div class="cart-item">
      <span class="cart-item__name">${i.name}</span>
      <div class="cart-item__controls">
        <button onclick="changeQty(${i.id},-1)">−</button>
        <span class="cart-item__qty">${i.qty}</span>
        <button onclick="changeQty(${i.id},1)">+</button>
      </div>
      <span class="cart-item__price">$${(i.price * i.qty).toFixed(2)}</span>
      <button class="cart-item__remove" onclick="removeFromCart(${i.id})">×</button>
    </div>
  `).join('');

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('cartSubtotal').textContent = `$${subtotal.toFixed(2)}`;
  footerEl.style.display = 'block';
}

function openCart() {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
}
function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
}
document.getElementById('cartBtn').addEventListener('click', openCart);

function checkout() {
  cart = [];
  updateCartUI();
  closeCart();
  document.getElementById('successOverlay').style.display = 'flex';
}
function closeSuccess() {
  document.getElementById('successOverlay').style.display = 'none';
}

document.getElementById('orderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('successOverlay').style.display = 'flex';
  e.target.reset();
});

// Animated counters
const counters = document.querySelectorAll('.stat__num');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const target = parseInt(el.dataset.target, 10);
    if (target === 0) { el.textContent = '0'; return; }
    const step = target / (1000 / 16);
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = Math.floor(current).toLocaleString();
      if (current >= target) clearInterval(timer);
    }, 16);
    observer.unobserve(el);
  });
}, { threshold: 0.5 });
counters.forEach(c => observer.observe(c));
