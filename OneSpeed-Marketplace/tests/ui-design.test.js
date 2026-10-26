const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(project, file), 'utf8');

function htmlFiles(directory = project) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'tests') return htmlFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.html') ? [fullPath] : [];
  });
}

test('all customer, seller, auth, and admin pages use the shared design system', () => {
  const pages = htmlFiles();
  assert.equal(pages.length, 29);

  for (const page of pages) {
    const source = fs.readFileSync(page, 'utf8');
    const stylesheet = source.match(/href="([^"]*css\/styles\.css)"/)?.[1];
    assert.ok(stylesheet, `${path.relative(project, page)} should use the shared stylesheet`);
    assert.ok(fs.existsSync(path.resolve(path.dirname(page), stylesheet)), `${stylesheet} should resolve`);
  }

  for (const page of htmlFiles(path.join(project, 'admin')).filter(file => !file.endsWith('/login.html'))) {
    assert.match(fs.readFileSync(page, 'utf8'), /js\/admin-auth\.js/, `${path.relative(project, page)} should be protected`);
  }
});

test('shared design tokens and compact viewport breakpoints are defined', () => {
  const styles = read('css/styles.css');
  assert.match(styles, /--secondary:\s*#123326/i);
  assert.match(styles, /--primary:\s*#c99b32/i);
  assert.match(styles, /@media\s*\(max-width:\s*620px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*360px\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test('production Nginx sends baseline browser security headers without blocking configured integrations', () => {
  const nginx = read('nginx.conf');
  assert.match(nginx, /X-Content-Type-Options "nosniff"/);
  assert.match(nginx, /Referrer-Policy "strict-origin-when-cross-origin"/);
  assert.match(nginx, /frame-ancestors 'self'/);
  assert.match(nginx, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(nginx, /https:\/\/unpkg\.com/);
  assert.match(nginx, /img-src 'self' data: blob: https:/);
});

test('production HTML, JavaScript and CSS revalidate after deploys instead of retaining stale immutable bundles', () => {
  const nginx = read('nginx.conf');
  assert.match(nginx, /location ~\* \\\.\(html\|css\|js\)\$ \{[\s\S]*?add_header Cache-Control "no-cache" always;/);
  assert.match(nginx, /location ~\* \\\.\(jpg\|jpeg\|png\|webp\|gif\|ico\|svg\|woff2\?\)\$ \{[\s\S]*?expires 7d;[\s\S]*?public, immutable/);
});

test('public pages and shared navigation do not link to or reveal the administrator login', () => {
  const publicPages = htmlFiles().filter(file => !file.startsWith(path.join(project, 'admin') + path.sep));
  for (const page of publicPages) {
    const source = fs.readFileSync(page, 'utf8');
    assert.doesNotMatch(source, /href\s*=\s*["'][^"']*admin(?:\/|\.html)/i, `${path.relative(project, page)} must not link to admin`);
    assert.doesNotMatch(source, /\/admin(?:\/|$)/i, `${path.relative(project, page)} must not expose an admin route`);
    assert.doesNotMatch(source, /(?:Admin Login|Admin Dashboard|Administrator Login|Administrator\?)/i, `${path.relative(project, page)} must not advertise admin access`);
    assert.doesNotMatch(source, /Pending Admin Approval|Admin note/i, `${path.relative(project, page)} must not surface internal admin labels`);
  }
  assert.doesNotMatch(read('js/app.js'), /href=["'][^"']*admin(?:\/|\.html)/i);
  assert.doesNotMatch(read('login.html'), /admin\/login/i);
});

test('shared customer header and footer stay out of administrator layouts', () => {
  const app = read('js/app.js');
  assert.match(app, /function renderHeader\(sessionOverride\) \{\s*if \(document\.documentElement\.dataset\.adminAuth\) return;/);
  assert.match(app, /function renderFooter\(\) \{\s*if \(document\.documentElement\.dataset\.adminAuth\) return;/);
  assert.match(read('js/admin-auth.js'), /function ensureAdminHeader\(\)/);
});

test('mobile marketplace navigation exposes five working destinations and preserves signed-out redirects', () => {
  const source = read('js/app.js');
  const navFunction = source.match(/function renderMobileNavigation\(\) \{[\s\S]*?\n\}/)?.[0];
  const stateFunction = source.match(/function getMobileNavState\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(navFunction, 'mobile navigation renderer should exist');
  assert.ok(stateFunction, 'active navigation state should be determined from the current route');
  const render = (pathname, hash = '', session = null, isAdmin = false) => {
    const elements = {};
    let appended;
    const context = vm.createContext({
      document: {
        documentElement: { dataset: isAdmin ? { adminAuth: 'checking' } : {} },
        body: { classList: { add() {} }, append(node) { appended = node; } },
        getElementById(id) {
          if (id === 'market-mobile-nav') return appended?.id === id ? appended : null;
          return { addEventListener() {} };
        },
        createElement() {
          const node = {
            querySelector() { return { href: '' }; },
            setAttribute() {}
          };
          return node;
        },
        querySelector() { return null; }
      },
      window: { addEventListener() {} },
      OSM: { getSession() { return session; } },
      openMobileSearch() {},
      location: { pathname, hash, search: '' },
      URLSearchParams,
      console
    });
    vm.runInContext(`${stateFunction}; ${navFunction}; globalThis.render = renderMobileNavigation;`, context);
    context.render();
    return appended;
  };

  const guest = render('/account.html');
  assert.equal((guest.innerHTML.match(/class="mobile-nav-item/g) || []).length, 5);
  assert.match(guest.innerHTML, /href="index\.html"/);
  assert.match(guest.innerHTML, /href="index\.html#categories"/);
  assert.match(guest.innerHTML, /id="mobile-search-open"/);
  assert.match(guest.innerHTML, /href="login\.html\?redirect=wishlist\.html"/);
  assert.match(guest.innerHTML, /id="mobile-account-link"[^>]+href="login\.html\?redirect=account\.html"/);
  assert.match(guest.innerHTML, /aria-current="page"/);

  const signedIn = render('/wishlist.html', '', { id: 'customer-1' });
  assert.match(signedIn.innerHTML, /id="mobile-wishlist-link"[^>]+href="wishlist\.html"[^>]+aria-current="page"/);
  const admin = render('/admin/index.html', '', null, true);
  assert.equal(admin, undefined, 'public bottom navigation must not render on admin documents');
});

test('shared marketplace footer only links to implemented routes and avoids placeholder links', () => {
  const source = read('js/app.js');
  const footerFunction = source.match(/function renderFooter\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(footerFunction, 'shared footer renderer should exist');
  let footerHTML = '';
  const context = vm.createContext({
    document: {
      documentElement: { dataset: {} },
      getElementById() { return { set innerHTML(value) { footerHTML = value; } }; }
    },
    Date
  });
  vm.runInContext(`${footerFunction}; globalThis.render = renderFooter;`, context);
  context.render();
  assert.match(footerHTML, /OneSpeed Marketplace/);
  assert.match(footerHTML, /Shop/);
  assert.match(footerHTML, /Customer service/);
  assert.match(footerHTML, /Your account/);
  assert.match(footerHTML, /Sell on OneSpeed/);
  assert.match(footerHTML, /About OneSpeed/);
  assert.doesNotMatch(footerHTML, /href=["']#/);
  assert.doesNotMatch(footerHTML, /\/admin(?:\/|$)/i);
  for (const [, href] of footerHTML.matchAll(/href="([^"]+)"/g)) {
    const route = href.split(/[?#]/, 1)[0];
    if (route && !href.includes(':')) assert.ok(fs.existsSync(path.join(project, route)), `footer route ${route} should exist`);
  }
});

test('cart and wishlist badges reflect the existing cart state and authenticated wishlist rows', async () => {
  const source = read('js/app.js');
  const cartFunction = source.match(/function updateCartBadge\(\) \{[\s\S]*?\n\}/)?.[0];
  const wishlistFunction = source.match(/async function updateWishlistBadge\(signedIn\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(cartFunction, 'shared cart badge updater should exist');
  assert.ok(wishlistFunction, 'wishlist badge updater should exist');
  const cart = { textContent: '', classList: { hidden: null, toggle(name, hidden) { this.hidden = hidden; } } };
  const wishlist = { textContent: '', hidden: true, isConnected: true };
  const context = vm.createContext({
    document: { getElementById(id) { return id === 'cart-badge' ? cart : wishlist; } },
    OSM: { getCartCount() { return 4; } },
    window: { OneSpeedBackend: { configured() { return true; } } },
    OneSpeedBackend: { async listWishlist() { return [{}, {}, {}]; } }
  });
  vm.runInContext(`${cartFunction}; ${wishlistFunction}; globalThis.updateCart = updateCartBadge; globalThis.updateWishlist = updateWishlistBadge;`, context);
  context.updateCart();
  await context.updateWishlist(true);
  assert.equal(String(cart.textContent), '4');
  assert.equal(cart.classList.hidden, false);
  assert.equal(wishlist.textContent, '3');
  assert.equal(wishlist.hidden, false);
});

test('mobile navigation respects safe-area insets, small screens, and accessible focus states', () => {
  const styles = read('css/styles.css');
  assert.match(styles, /\.mobile-bottom-nav\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
  assert.match(styles, /max-width:\s*360px[\s\S]*?\.mobile-nav-item/);
  assert.match(styles, /mobile-nav-item:focus-visible/);
  assert.match(styles, /body\.has-mobile-bottom-nav\s*\{[^}]*padding-bottom/);
});

test('Nginx protects all admin workspace routes and leaves only its login route public', () => {
  const nginx = read('nginx.conf');
  assert.match(nginx, /location = \/admin\/login \{[\s\S]*?try_files \/admin\/login\.html =404;/);
  assert.match(nginx, /location \^~ \/admin\/ \{\s*auth_request \/_internal\/admin-authorize;/);
  assert.match(nginx, /location = \/_internal\/admin-authorize \{\s*internal;/);
  assert.match(nginx, /error_page 401 = @admin_login;/);
  assert.match(nginx, /location = \/api\/admin\/logout/);
  assert.match(nginx, /X-Robots-Tag "noindex, nofollow, noarchive"/);
});

test('production container generates Supabase client config before starting the app', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /40-onespeed-supabase-config\.sh && exec node \/opt\/onespeed\/admin-auth-server\.js/);
});

test('catalog filters are wired and product metrics are not fabricated', () => {
  const homepage = read('index.html');
  const productCard = read('js/app.js');
  const productDetail = read('product.html');
  for (const id of ['sort-products', 'price-currency', 'price-min', 'price-max', 'in-stock-only']) {
    assert.match(homepage, new RegExp(`id="${id}"`));
  }
  assert.match(homepage, /addEventListener\('input', refreshCatalog\)/);
  assert.match(homepage, /addEventListener\('change', refreshCatalog\)/);
  assert.doesNotMatch(productCard, /Number\(p\.rating\)\s*\|\|\s*4\.5/);
  assert.doesNotMatch(productCard, /sold<\/span>/);
  assert.doesNotMatch(productDetail, /\$\{p\.rating\s*\|\|\s*4\.5\}/);
});

test('catalog reports a safe actionable error without exposing Supabase details or recommending unsafe setup', () => {
  const homepage = read('index.html');
  assert.match(homepage, /function catalogLoadErrorMessage\(error\)/);
  assert.match(homepage, /error\?\.code === 'PGRST205' \|\| error\?\.code === '42P01'/);
  assert.match(homepage, /Data API schema exposure, permissions, and schema cache before making database changes/);
  assert.doesNotMatch(homepage, /For a new empty project, apply supabase\/schema\.sql/);
  assert.match(homepage, /Could not load marketplace products right now\. Please try again later\./);
  assert.match(homepage, /console\.error\('OneSpeed: marketplace initialization failed\.'/);
});

test('base database schema is transactional and refuses to rerun when OneSpeed core tables already exist', () => {
  const schema = read('supabase/schema.sql');
  assert.match(schema, /^--[^\n]+\n--[^\n]+\nbegin;/);
  assert.match(schema, /to_regclass\(format\('public\.%I', required_table\.name\)\) is not null/);
  assert.match(schema, /OneSpeed core tables already exist\. Do not rerun the base schema/);
  assert.match(schema.trimEnd(), /commit;$/);
  assert.doesNotMatch(schema, /\b(drop table|truncate|delete from public\.)\b/i);
});

test('production database inspection script contains only read-only queries', () => {
  const inspection = read('supabase/production-read-only-inspection.sql');
  const uncommented = inspection.replace(/--[^\n]*/g, '');
  const statements = uncommented.split(';').map(statement => statement.trim()).filter(Boolean);

  assert.ok(statements.length >= 15, 'inspection should cover all numbered catalog checks');
  for (const statement of statements) {
    assert.match(statement, /^(select|with)\b/i, 'each executable statement must be a SELECT/CTE');
  }
  assert.match(inspection, /information_schema\.columns/);
  assert.match(inspection, /estimated_rows/);
  assert.match(inspection, /reltuples/);
  assert.match(inspection, /constraint_type in \('PRIMARY KEY', 'FOREIGN KEY'\)/);
  assert.match(inspection, /pg_policies/);
  assert.match(inspection, /pg_get_triggerdef/);
  assert.match(inspection, /pg_get_functiondef/);
  assert.match(inspection, /has_table_privilege/);
  assert.match(inspection, /storage\.buckets/);
  assert.doesNotMatch(uncommented, /\b(begin|commit|insert|update|delete|alter|create|drop|truncate|grant|revoke|notify)\b/i);
});

test('catalog price, currency, availability, and sorting filters affect actual products', () => {
  const source = read('index.html');
  const applyFilters = source.match(/function applyFilters\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(applyFilters, 'catalog filter implementation should exist');

  const values = {
    'price-min': { value: '2500' },
    'price-max': { value: '' },
    'price-currency': { value: 'NGN' },
    'sort-products': { value: 'price-asc' },
    'in-stock-only': { checked: true },
    'price-filter-help': { textContent: '' }
  };
  const categoryButtons = [{ dataset: { cat: '' }, classList: { toggle() {} } }];
  const context = vm.createContext({
    allProducts: [
      { id: 'a', title: 'Bag', description: '', category: 'Fashion', currency: 'NGN', price: 3000, stock: 5, created_at: '2026-01-01' },
      { id: 'b', title: 'Shirt', description: '', category: 'Fashion', currency: 'NGN', price: 2000, stock: 0, created_at: '2026-02-01' },
      { id: 'c', title: 'Speaker', description: '', category: 'Electronics', currency: 'USD', price: 10, stock: 5, created_at: '2026-03-01' }
    ],
    document: {
      getElementById(id) { return values[id]; },
      querySelectorAll() { return categoryButtons; }
    },
    getQueryParam() { return ''; },
    OSM: { getCurrency() { return 'USD'; } },
    renderProducts() {}
  });
  vm.runInContext(`${applyFilters}; globalThis.applyCatalogFilters = applyFilters;`, context);
  context.applyCatalogFilters();
  assert.deepEqual(context.filtered.map(product => product.id), ['a']);

  values['price-min'].value = '5000';
  values['price-max'].value = '1000';
  context.applyCatalogFilters();
  assert.deepEqual(context.filtered, []);
  assert.match(values['price-filter-help'].textContent, /Minimum price must not exceed maximum price/);
});

test('inline scripts across all existing routes remain valid JavaScript', () => {
  for (const page of htmlFiles()) {
    const source = fs.readFileSync(page, 'utf8');
    const scripts = source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
    let index = 0;
    for (const [, script] of scripts) {
      if (!script.trim()) continue;
      assert.doesNotThrow(
        () => new vm.Script(script, { filename: `${path.relative(project, page)} inline script ${index}` }),
        `${path.relative(project, page)} inline script ${index} should parse`
      );
      index += 1;
    }
  }
});

test('verified admin pages share responsive navigation and identify the active route', () => {
  const source = read('js/admin-auth.js');
  const navigation = source.match(/function ensureAdminNavigation\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(navigation, 'shared admin navigation should be present');

  const sidebar = {
    attributes: {},
    links: [],
    className: '',
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren(...links) { this.links = links; }
  };
  const main = {
    classList: { values: [], add(value) { this.values.push(value); } },
    closest() { return layout; }
  };
  const layout = { querySelector() { return sidebar; } };
  const context = {
    document: {
      querySelector() { return main; },
      createElement() {
        return {
          attributes: {},
          classList: { values: [], add(value) { this.values.push(value); } },
          setAttribute(name, value) { this.attributes[name] = value; }
        };
      }
    },
    location: { pathname: '/admin/bank-transfers.html' }
  };
  vm.runInNewContext(`${navigation}; ensureAdminNavigation();`, context);

  assert.deepEqual(sidebar.links.map(link => link.href), [
    'index.html', 'products.html', 'orders.html', 'bank-transfers.html', 'payouts.html', 'reviews.html',
    'support.html', 'delivery-zones.html', 'users.html'
  ]);
  assert.equal(sidebar.attributes['aria-label'], 'Administrator navigation');
  assert.equal(sidebar.links[3].attributes['aria-current'], 'page');
  assert.ok(sidebar.links.some(link => link.href === 'payouts.html'));
  assert.ok(sidebar.links.some(link => link.href === 'support.html'));
  assert.ok(sidebar.links.some(link => link.href === 'reviews.html'));
  assert.ok(main.classList.values.includes('admin-content'));
});

test('customer service routes persist data through the authenticated Supabase bridge', () => {
  const bridge = read('js/supabase.js');
  const checkout = read('checkout.html');
  const tracking = read('track.html');
  const adminProducts = read('admin/products.html');

  assert.match(bridge, /async listCustomerAddresses\(\)/);
  assert.match(bridge, /async saveCustomerAddress\(address\)/);
  assert.match(checkout, /OneSpeedBackend\.listCustomerAddresses\(\)/);
  assert.match(checkout, /OneSpeedBackend\.placeOrder\([\s\S]*shippingAddress/);
  assert.match(tracking, /OneSpeedBackend\.listCustomerOrders\(user\.id\)/);
  assert.match(tracking, /OneSpeedBackend\.getOrder\(match\.id\)/);
  assert.match(adminProducts, /from\('products'\)[\s\S]*\.update\(/);
  assert.doesNotMatch(adminProducts, /OSM\.(getProducts|updateProduct|deleteProduct|addProduct)/);
});

test('operations migration keeps customer records private and sensitive admin RPCs guarded', () => {
  const migration = read('supabase/marketplace-operations-migration.sql');
  const schema = read('supabase/schema.sql');
  assert.match(migration, /alter table public\.customer_addresses enable row level security/);
  assert.match(migration, /customer_id = auth\.uid\(\) and public\.is_active_user\(\)/);
  assert.match(migration, /create or replace function public\.admin_set_order_status/);
  assert.match(migration, /create or replace function public\.admin_review_seller_payout/);
  assert.match(migration, /p_action is null or p_action not in/);
  assert.match(migration, /revoke insert, update, delete on public\.seller_payouts/);
  assert.match(schema, /search_document tsvector generated always as/);
  assert.match(migration, /products_search_document_idx[\s\S]*using gin\(search_document\)/);
  assert.match(read('js/supabase.js'), /textSearch\('search_document'/);
});

test('admin product management paginates persistent listings and records moderation reasons', () => {
  const adminProducts = read('admin/products.html');
  const seller = read('seller.html');
  assert.match(adminProducts, /\.range\(productPage \* pageSize, productPage \* pageSize \+ pageSize - 1\)/);
  assert.match(adminProducts, /count: 'exact'/);
  assert.match(adminProducts, /moderation_note: nextStatus === 'rejected' \? moderationNote : null/);
  assert.match(adminProducts, /nextStatus === 'rejected' && moderationNote\.length < 5/);
  assert.match(seller, /product\.moderation_note/);
});

test('Supabase catalog requests use server-side search, filtering, sorting and offset pagination', async () => {
  const calls = [];
  const response = { data: [{ id: 'product-1' }], count: 81, error: null };
  const query = {
    select(...args) { calls.push(['select', ...args]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    textSearch(...args) { calls.push(['textSearch', ...args]); return this; },
    gte(...args) { calls.push(['gte', ...args]); return this; },
    lte(...args) { calls.push(['lte', ...args]); return this; },
    gt(...args) { calls.push(['gt', ...args]); return this; },
    order(...args) { calls.push(['order', ...args]); return this; },
    range(...args) { calls.push(['range', ...args]); return this; },
    then(resolve) { return Promise.resolve(response).then(resolve); }
  };
  const window = { supabase: { createClient: () => ({ from: table => { calls.push(['from', table]); return query; } }) },
    ONESPEED_SUPABASE_CONFIG: { url: 'https://project.supabase.co', anonKey: 'public-key' } };
  vm.runInNewContext(read('js/supabase.js'), { window, console });
  const result = await window.OneSpeedBackend.listProducts({
    query: 'cotton shirt',
    category: 'Fashion',
    currency: 'NGN',
    minPrice: '1000',
    maxPrice: '10000',
    inStockOnly: true,
    sort: 'price-asc',
    limit: 60,
    offset: 60
  });
  assert.equal(result.count, 81);
  assert.ok(calls.some(call => call[0] === 'textSearch' && call[1] === 'search_document'));
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'category' && call[2] === 'Fashion'));
  assert.ok(calls.some(call => call[0] === 'gte' && call[1] === 'price' && call[2] === '1000'));
  assert.ok(calls.some(call => call[0] === 'gt' && call[1] === 'stock' && call[2] === 0));
  assert.ok(calls.some(call => call[0] === 'order' && call[1] === 'price' && call[2].ascending));
  assert.deepEqual(calls.find(call => call[0] === 'range'), ['range', 60, 119]);
});

test('storefront catalog uses 60-item backend pages and honors shareable search and category URLs', () => {
  const homepage = read('index.html');
  assert.match(homepage, /const catalogPageSize = 60/);
  assert.match(homepage, /OneSpeedBackend\.listProducts\(\{[\s\S]*query: getQueryParam\('q'\)[\s\S]*category: getQueryParam\('cat'\)/);
  assert.match(homepage, /else if \(supabaseCatalog && catalogHasMore\) void loadCatalog\(false\)/);
  assert.match(homepage, /addEventListener\('change', refreshCatalog\)/);
});
