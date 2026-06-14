// Hero fully zoomed out
const heroImg = document.querySelector('#hero .fullscreen__img');
if (heroImg) heroImg.style.transform = 'scale(1.0)';

// Mobile burger
document.getElementById('burger').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});
document.querySelectorAll('.nav__links a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('navLinks').classList.remove('open'));
});

// Bottle showcase label update
function updateShowcase(name) {
  document.getElementById('showcaseLabel').textContent = name;
}

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
