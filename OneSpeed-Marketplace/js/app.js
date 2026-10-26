// OneSpeed Market - Shared UI & Navigation
document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  updateCartBadge();
  setupCurrencySelector();
});

function renderHeader(sessionOverride) {
  const headerEl = document.getElementById('site-header');
  if (!headerEl) return;

  const session = sessionOverride === undefined ? OSM.getSession() : sessionOverride;
  const cartCount = OSM.getCartCount();
  const currency = OSM.getCurrency();

  let currencyOptions = '';
  for (const [code, cur] of Object.entries(OSM.currencies)) {
    currencyOptions += `<option value="${code}" ${code === currency ? 'selected' : ''}>${code} (${cur.symbol})</option>`;
  }

  headerEl.innerHTML = `
    <div class="header-inner">
      <a href="index.html" class="logo" aria-label="OneSpeed Marketplace home"><img src="assets/images/onespeed-marketplace-brand.webp" alt="OneSpeed Marketplace" width="180" height="45"></a>
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search millions of products..." value="${getQueryParam('q') || ''}">
        <button onclick="doSearch()" aria-label="Search"><span class="search-glyph" aria-hidden="true"></span></button>
      </div>
      <div class="nav-actions">
        <select class="currency-select" id="currency-select" onchange="changeCurrency(this.value)">
          ${currencyOptions}
        </select>
        <a href="cart.html" class="icon-btn" title="Cart">
          <span class="cart-glyph" aria-hidden="true"></span>
          <span class="cart-count ${cartCount ? '' : 'hidden'}" id="cart-badge">${cartCount}</span>
        </a>
        ${session ? `
          <a href="${session.role === 'admin' ? 'admin/index.html' : 'account.html'}" class="icon-btn" title="Account"><span class="account-glyph" aria-hidden="true"></span></a>
          <button class="btn btn-secondary btn-sm" onclick="logout()">Logout</button>
        ` : `
          <a href="login.html" class="btn btn-primary btn-sm">Login</a>
          <a href="register.html" class="btn btn-secondary btn-sm">Sign Up</a>
        `}
      </div>
    </div>
  `;

  // Search on enter
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') doSearch();
    });
  }

  if (sessionOverride === undefined && window.OneSpeedBackend?.configured()) {
    OneSpeedBackend.currentUser().then(async user => {
      if (!user) {
        if (OSM.getSession()) renderHeader(null);
        return;
      }
      const profile = await OneSpeedBackend.profile();
      if (!profile || !profile.is_active) {
        renderHeader(null);
        return;
      }
      renderHeader({ id: user.id, email: user.email, name: profile.full_name, role: profile.role });
    }).catch(error => console.error('OneSpeed: could not refresh the signed-in header.', error));
  }
}

function renderFooter() {
  const footerEl = document.getElementById('site-footer');
  if (!footerEl) return;
  footerEl.innerHTML = `
    <div class="footer-inner">
      <div>
        <h4>OneSpeed Marketplace</h4>
        <p style="font-size:0.9rem;line-height:1.6;color:#999;">Everything you need, all in one place. Premium marketplace with global shipping and multi-currency support.</p>
        <p style="font-size:0.9rem;margin-top:12px;color:#ccc;">
          <span class="footer-contact-icon" aria-hidden="true">TEL</span> <a href="tel:+12105047697" style="color:var(--primary);">+1 (210) 504-7697</a><br>
          <span class="footer-contact-icon" aria-hidden="true">@</span> <a href="mailto:onespeedmail@gmail.com" style="color:var(--primary);">onespeedmail@gmail.com</a>
        </p>
      </div>
      <div>
        <h4>Shop</h4>
        <a href="index.html">Marketplace</a>
        <a href="index.html?cat=Electronics">Electronics</a>
        <a href="index.html?cat=Fashion">Fashion</a>
        <a href="index.html?cat=Home">Home & Living</a>
        <a href="index.html?cat=Sports">Sports</a>
      </div>
      <div>
        <h4>Customer</h4>
        <a href="track.html">Track Order</a>
        <a href="account.html">My Account</a>
        <a href="delivery-address.html">Delivery Address</a>
        <a href="cart.html">Cart</a>
        <a href="login.html">Login / Register</a>
      </div>
      <div>
        <h4>Support</h4>
        <a href="contact.html">Contact Us</a>
        <a href="contact.html">Help Center</a>
        <a href="#">Shipping Policy</a>
        <a href="#">Returns & Refunds</a>
      </div>
    </div>
    <div class="footer-bottom">
      © ${new Date().getFullYear()} OneSpeed Market. All rights reserved.<br>
      Contact: +1 (210) 504-7697 · onespeedmail@gmail.com
    </div>
  `;
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (badge) {
    const count = OSM.getCartCount();
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
}

function setupCurrencySelector() {
  // Already handled in render
}

function changeCurrency(code) {
  OSM.setCurrency(code);
  location.reload();
}

function doSearch() {
  const q = document.getElementById('search-input')?.value?.trim() || '';
  if (q) {
    location.href = `index.html?q=${encodeURIComponent(q)}`;
  } else {
    location.href = 'index.html';
  }
}

function getQueryParam(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

async function logout() {
  if (window.OneSpeedBackend?.configured()) {
    try {
      await OneSpeedBackend.signOut();
    } catch (error) {
      OSM.toast('Could not log out: ' + error.message);
      return;
    }
  }
  OSM.logout();
  OSM.toast('Logged out successfully');
  setTimeout(() => location.href = 'index.html', 500);
}

function requireLogin(redirect = 'login.html') {
  if (!OSM.isLoggedIn()) {
    OSM.toast('Please login to continue');
    setTimeout(() => location.href = redirect + '?redirect=' + encodeURIComponent(location.pathname + location.search), 800);
    return false;
  }
  return true;
}

function requireAdmin() {
  if (!OSM.isAdmin()) {
    OSM.toast('Admin access only');
    setTimeout(() => location.href = '../index.html', 800);
    return false;
  }
  return true;
}

// Product card HTML
function productCardHTML(p, showPrice = true) {
  const session = window.OneSpeedAuthenticated ?? OSM.getSession();
  const canSeePrice = session || showPrice === false ? false : true; // wait, logic:
  // Guests cannot see price. Logged in can.
  const isGuest = !session;
  const priceHTML = isGuest
    ? `<div class="product-price locked"><span aria-hidden="true">●</span> Login to see price</div>`
    : `<div class="product-price">${formatProductPrice(p)}</div>`;

  return `
    <div class="card product-card">
      <a href="product.html?id=${encodeURIComponent(p.id)}">
        <img src="${escapeHTML(safeImageURL(p.image))}" alt="${escapeHTML(p.title)}" class="product-img" loading="lazy" onerror="this.src='assets/images/product-placeholder.svg'">
      </a>
      <div class="product-info">
        <a href="product.html?id=${encodeURIComponent(p.id)}" style="text-decoration:none;color:inherit;">
          <div class="product-title">${escapeHTML(p.title)}</div>
        </a>
        ${priceHTML}
        <div class="product-meta">
          <span><span class="rating-star" aria-hidden="true">★</span> ${Number(p.rating) || 4.5}</span>
          <span>${(Number(p.sales) || 0).toLocaleString()} sold</span>
        </div>
        ${!isGuest ? `
          <button class="btn btn-primary btn-sm btn-block mt-2" onclick="addToCartQuick('${escapeHTML(p.id)}')">Add to Cart</button>
        ` : `
          <a href="login.html" class="btn btn-secondary btn-sm btn-block mt-2">Login to Buy</a>
        `}
      </div>
    </div>
  `;
}

function toStorefrontProduct(product) {
  return {
    ...product,
    id: product.id,
    image: product.image_url || product.images?.[0] || 'assets/images/product-placeholder.svg',
    sales: product.sales || 0,
    rating: product.rating || 4.5
  };
}

function formatProductPrice(product, amount = product.price) {
  return product.currency
    ? `${product.currency.trim()} ${Number(amount).toFixed(2)}`
    : OSM.formatPrice(amount);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function safeImageURL(value) {
  try {
    const url = new URL(value || 'assets/images/product-placeholder.svg', location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : 'assets/images/product-placeholder.svg';
  } catch {
    return 'assets/images/product-placeholder.svg';
  }
}

async function addToCartQuick(id) {
  if (window.OneSpeedBackend?.configured()) {
    try {
      const user = await OneSpeedBackend.currentUser();
      if (!user) {
        location.href = 'login.html?redirect=' + encodeURIComponent('product.html?id=' + id);
        return;
      }
    } catch (error) {
      OSM.toast('Could not verify your account: ' + error.message);
      return;
    }
  } else if (!requireLogin()) {
    return;
  }
  OSM.addToCart(id, 1);
  updateCartBadge();
  OSM.toast('Added to cart!');
}

// Simple image placeholder fallback
function imgFallback(img) {
  img.onerror = null;
  img.src = 'assets/images/product-placeholder.svg';
}
