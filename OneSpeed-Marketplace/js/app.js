// OneSpeed Market - Shared UI & Navigation
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.dataset.adminAuth) return;
  renderHeader();
  renderFooter();
  updateFooterAccountLink(Boolean(OSM.getSession()));
  updateCartBadge();
  setupCurrencySelector();
  renderMobileNavigation();
  handleMobileSearchRoute();
});

function renderHeader(sessionOverride) {
  if (document.documentElement.dataset.adminAuth) return;
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
      <div class="search-bar" id="search">
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
          <a href="account.html" class="icon-btn" title="Account"><span class="account-glyph" aria-hidden="true"></span></a>
          <button class="btn btn-secondary btn-sm" onclick="logout()">Logout</button>
        ` : `
          <a href="login.html" class="btn btn-primary btn-sm">Login</a>
          <a href="register.html" class="btn btn-secondary btn-sm">Sign Up</a>
        `}
      </div>
    </div>
  `;
  updateFooterAccountLink(Boolean(session));

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
  if (document.documentElement.dataset.adminAuth) return;
  const footerEl = document.getElementById('site-footer');
  if (!footerEl) return;
  footerEl.innerHTML = `
    <div class="footer-inner">
      <section class="footer-brand">
        <a href="index.html" class="footer-logo" aria-label="OneSpeed Marketplace home">
          <img src="assets/images/onespeed-marketplace-brand.webp" alt="OneSpeed Marketplace" width="180" height="45" loading="lazy">
        </a>
        <p>Shop, discover, and connect with trusted sellers in one marketplace.</p>
        <p class="footer-contact">
          <a href="tel:+12105047697">+1 (210) 504-7697</a>
          <a href="mailto:onespeedmail@gmail.com">onespeedmail@gmail.com</a>
        </p>
      </section>
      <details class="footer-section" open>
        <summary>Shop</summary>
        <a href="index.html#products">All products</a>
        <a href="index.html#categories">Categories</a>
        <a href="index.html#products">Browse listings</a>
        <a href="index.html#products">Shop by category</a>
      </details>
      <details class="footer-section" open>
        <summary>Customer service</summary>
        <a href="contact.html">Help & contact</a>
        <a href="contact.html">Contact us</a>
        <a href="track.html">Track order</a>
        <a href="support.html">Customer support</a>
        <a href="contact.html">Shipping, returns & refunds questions</a>
      </details>
      <details class="footer-section" open>
        <summary>Your account</summary>
        <a id="footer-account-link" href="login.html?redirect=account.html">Sign in</a>
        <a href="account.html#orders">My orders</a>
        <a href="wishlist.html">Wishlist</a>
        <a href="addresses.html">Saved addresses</a>
        <a href="cart.html">My cart</a>
      </details>
      <details class="footer-section" open>
        <summary>Sell on OneSpeed</summary>
        <a href="seller.html">Become a seller</a>
        <a href="seller.html">Seller application</a>
        <a href="contact.html">Seller help</a>
      </details>
      <details class="footer-section" open>
        <summary>About OneSpeed</summary>
        <a href="index.html">Our marketplace</a>
        <a href="contact.html">Contact information</a>
      </details>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} OneSpeed Marketplace. All rights reserved.</span>
      <button class="back-to-top" type="button">Back to top ↑</button>
    </div>
  `;
}

function updateFooterAccountLink(signedIn) {
  const link = document.getElementById('footer-account-link');
  if (!link) return;
  link.href = signedIn ? 'account.html' : `login.html?redirect=${encodeURIComponent('account.html')}`;
  link.textContent = signedIn ? 'My account' : 'Sign in';
}

function renderMobileNavigation() {
  if (document.documentElement.dataset.adminAuth || document.getElementById('market-mobile-nav')) return;
  const signedIn = Boolean(OSM.getSession());
  const accountHref = signedIn ? 'account.html' : `login.html?redirect=${encodeURIComponent('account.html')}`;
  const wishlistHref = `login.html?redirect=${encodeURIComponent('wishlist.html')}`;
  const active = getMobileNavState();
  const nav = document.createElement('nav');
  nav.id = 'market-mobile-nav';
  nav.className = 'mobile-bottom-nav';
  document.body.classList.add('has-mobile-bottom-nav');
  nav.setAttribute('aria-label', 'Marketplace navigation');
  nav.innerHTML = `
    <a class="mobile-nav-item ${active === 'home' ? 'is-active' : ''}" href="index.html" ${active === 'home' ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg><span>Home</span>
    </a>
    <a class="mobile-nav-item ${active === 'categories' ? 'is-active' : ''}" href="index.html#categories" ${active === 'categories' ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg><span>Categories</span>
    </a>
    <button class="mobile-nav-item ${active === 'search' ? 'is-active' : ''}" id="mobile-search-open" type="button" aria-haspopup="dialog">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><span>Search</span>
    </button>
    <a id="mobile-wishlist-link" class="mobile-nav-item ${active === 'wishlist' ? 'is-active' : ''}" href="${signedIn ? 'wishlist.html' : wishlistHref}" ${active === 'wishlist' ? 'aria-current="page"' : ''}>
      <span class="mobile-nav-icon-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg><span id="wishlist-nav-count" class="mobile-nav-badge" hidden></span></span><span>Wishlist</span>
    </a>
    <a id="mobile-account-link" class="mobile-nav-item ${active === 'account' ? 'is-active' : ''}" href="${accountHref}" ${active === 'account' ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg><span>Account</span>
    </a>`;
  document.body.append(nav);
  document.getElementById('mobile-search-open').addEventListener('click', openMobileSearch);
  document.querySelector('.back-to-top')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('onespeed:wishlist-updated', () => {
    const isAuthenticated = Boolean(OSM.getSession());
    if (window.OneSpeedBackend?.configured()) {
      OneSpeedBackend.currentUser().then(user => updateWishlistBadge(Boolean(user)))
        .catch(error => console.error('OneSpeed: could not refresh mobile wishlist count.', error));
    } else updateWishlistBadge(isAuthenticated);
  });

  if (window.OneSpeedBackend?.configured()) {
    OneSpeedBackend.currentUser().then(async user => {
      const profile = user ? await OneSpeedBackend.profile() : null;
      const authenticated = Boolean(profile?.is_active && profile.role !== 'admin');
      const accountLink = nav.querySelector('#mobile-account-link');
      const wishlistLink = nav.querySelector('#mobile-wishlist-link');
      if (accountLink) accountLink.href = authenticated ? 'account.html' : `login.html?redirect=${encodeURIComponent('account.html')}`;
      if (wishlistLink) wishlistLink.href = authenticated ? 'wishlist.html' : wishlistHref;
      updateWishlistBadge(authenticated);
    }).catch(error => console.error('OneSpeed: could not load mobile wishlist count.', error));
  }
}

function getMobileNavState() {
  const path = location.pathname.split('/').pop() || 'index.html';
  if (path === 'wishlist.html') return 'wishlist';
  if (path === 'account.html') return 'account';
  if (path === 'index.html' || !path) {
    if (location.hash === '#categories') return 'categories';
    if (location.hash === '#search' || getQueryParam('q')) return 'search';
    return 'home';
  }
  return '';
}

async function updateWishlistBadge(signedIn) {
  const badge = document.getElementById('wishlist-nav-count');
  if (!badge || !signedIn || !window.OneSpeedBackend?.configured()) return;
  try {
    const rows = await OneSpeedBackend.listWishlist();
    if (badge.isConnected && rows.length) {
      badge.textContent = rows.length > 99 ? '99+' : String(rows.length);
      badge.hidden = false;
    }
  } catch (error) {
    console.error('OneSpeed: could not refresh mobile wishlist count.', error);
  }
}

function openMobileSearch() {
  let dialog = document.getElementById('mobile-search-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'mobile-search-dialog';
    dialog.className = 'mobile-search-dialog';
    dialog.setAttribute('aria-labelledby', 'mobile-search-title');
    dialog.innerHTML = `
      <form method="dialog" class="mobile-search-dismiss"><button type="submit" aria-label="Close search">×</button></form>
      <h2 id="mobile-search-title">Search OneSpeed</h2>
      <form id="mobile-search-form" role="search">
        <label class="visually-hidden" for="mobile-search-input">Search products</label>
        <input id="mobile-search-input" type="search" name="q" class="form-control" placeholder="What are you looking for?" required>
        <button class="btn btn-primary" type="submit">Search</button>
      </form>`;
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector('#mobile-search-form').addEventListener('submit', event => {
      event.preventDefault();
      const query = dialog.querySelector('#mobile-search-input').value.trim();
      if (query) location.href = `index.html?q=${encodeURIComponent(query)}#products`;
    });
  }
  dialog.showModal();
  dialog.querySelector('#mobile-search-input').focus();
}

function handleMobileSearchRoute() {
  if (location.hash === '#search') {
    openMobileSearch();
  } else if (location.hash === '#categories') {
    document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' });
  }
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

function getSafeLocalRedirect(candidate, fallback = 'index.html') {
  if (typeof candidate !== 'string' || !candidate || candidate.startsWith('//') || candidate.includes('\\')) {
    return fallback;
  }
  try {
    const destination = new URL(candidate, location.origin);
    if (destination.origin !== location.origin || !/^https?:$/.test(destination.protocol)) return fallback;
    if (/\/(?:login|register)\.html$/i.test(destination.pathname)) return fallback;
    return `${destination.pathname.replace(/^\//, '')}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
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
          <span>${escapeHTML(p.category || 'Marketplace item')}</span>
          <span>${Number(p.stock) > 0 ? `${Number(p.stock)} in stock` : 'Out of stock'}</span>
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
    image: product.image_url || product.images?.[0] || 'assets/images/product-placeholder.svg'
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
