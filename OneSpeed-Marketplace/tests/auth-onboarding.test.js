const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createAdminAuthServer } = require('../admin-auth-server');

const project = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(project, file), 'utf8');

async function startAdminAuthServer(options) {
  const server = createAdminAuthServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/api/admin/login`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

const env = {
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'a-very-long-unique-admin-password',
  ONESPEED_SUPABASE_URL: 'https://project.supabase.co',
  ONESPEED_SUPABASE_ANON_KEY: 'public-anon-key'
};

test('customer registration omits any client-selectable role', async () => {
  const source = read('js/supabase.js');
  let signupArgs;
  let applicationRpc;
  const window = {
    ONESPEED_SUPABASE_CONFIG: { url: 'https://project.supabase.co', anonKey: 'public-anon-key' },
    supabase: {
      createClient() {
        return {
          auth: { async signUp(args) { signupArgs = args; return { data: { user: {}, session: {} }, error: null }; } },
          async rpc(name, args) { applicationRpc = { name, args }; return { data: { application_status: 'pending' }, error: null }; }
        };
      }
    }
  };
  vm.runInNewContext(source, { window });
  await window.OneSpeedBackend.signUp({
    email: 'customer@example.test',
    password: 'customer-password',
    name: 'New Customer',
    role: 'admin'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(signupArgs.options.data)), {
    full_name: 'New Customer',
    phone: ''
  });
  assert.doesNotMatch(read('register.html'), /name="accountType"/);
  await window.OneSpeedBackend.applySellerApplication({
    storeName: 'Forest Goods',
    description: 'Locally sourced household items.',
    email: 'seller@example.test',
    phone: '+2348000000000',
    address: { store_address: 'Lagos' }
  });
  assert.equal(applicationRpc.name, 'apply_seller_application');
  assert.equal(applicationRpc.args.p_store_name, 'Forest Goods');
  assert.equal(applicationRpc.args.p_address.store_address, 'Lagos');
});

test('customer login redirects are restricted to the same origin', () => {
  const source = read('js/app.js');
  const helper = source.match(/function getSafeLocalRedirect\(candidate, fallback = 'index\.html'\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'safe redirect helper should exist');
  const context = vm.createContext({ location: { origin: 'https://onespeed.example' }, URL });
  vm.runInContext(`${helper}; globalThis.safeRedirect = getSafeLocalRedirect;`, context);
  assert.equal(context.safeRedirect('https://attacker.example', 'account.html'), 'account.html');
  assert.equal(context.safeRedirect('//attacker.example', 'account.html'), 'account.html');
  assert.equal(context.safeRedirect('javascript:alert(1)', 'account.html'), 'account.html');
  assert.equal(context.safeRedirect('cart.html?step=2', 'account.html'), 'cart.html?step=2');
});

test('admin login endpoint only returns a verified Supabase admin session', async t => {
  const calls = [];
  const server = await startAdminAuthServer({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/auth/v1/token')) {
        return new Response(JSON.stringify({
          access_token: 'access-session-token',
          refresh_token: 'refresh-session-token',
          expires_in: 3600,
          user: { id: 'admin-user-id', email: env.ADMIN_EMAIL }
        }), { status: 200 });
      }
      return new Response(JSON.stringify([{ role: 'admin', is_active: true }]), { status: 200 });
    }
  });
  t.after(server.close);

  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.access_token, 'access-session-token');
  assert.equal(payload.refresh_token, 'refresh-session-token');
  assert.equal(Object.hasOwn(payload, 'password'), false);
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.headers.Authorization, /^Bearer access-session-token$/);
});

test('admin login refuses a valid Supabase account without the administrator profile role', async t => {
  const server = await startAdminAuthServer({
    env,
    fetchImpl: async url => String(url).includes('/auth/v1/token')
      ? new Response(JSON.stringify({
          access_token: 'customer-token',
          refresh_token: 'customer-refresh',
          user: { id: 'customer-id', email: env.ADMIN_EMAIL }
        }), { status: 200 })
      : new Response(JSON.stringify([{ role: 'customer', is_active: true }]), { status: 200 })
  });
  t.after(server.close);
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unable to sign in.' });
});

test('admin login uses generic credential errors and fails closed without environment configuration', async t => {
  let calls = 0;
  const active = await startAdminAuthServer({
    env,
    fetchImpl: async () => { calls += 1; throw new Error('must not be called'); }
  });
  t.after(active.close);
  const invalid = await fetch(active.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-admin@example.test', password: 'wrong-password' })
  });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: 'Unable to sign in.' });
  assert.equal(calls, 0);

  const missing = await startAdminAuthServer({ env: { ...env, ADMIN_PASSWORD: '' } });
  t.after(missing.close);
  const response = await fetch(missing.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  });
  assert.equal(response.status, 503);
});

test('admin login endpoint rate limits attempts and rejects cross-origin requests', async t => {
  const server = await startAdminAuthServer({
    env,
    maxAttempts: 2,
    fetchImpl: async () => new Response('{}', { status: 401 })
  });
  t.after(server.close);
  const attempt = headers => fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: 'wrong' })
  });

  assert.equal((await attempt({ Origin: 'https://attacker.example' })).status, 403);
  const host = new URL(server.url).host;
  assert.equal((await attempt({ Origin: `https://${host}`, 'X-Forwarded-Proto': 'https' })).status, 401);
  assert.equal((await attempt({})).status, 401);
  assert.equal((await attempt({})).status, 429);
});

test('database definitions default registration to customer and gate seller privileges on approval', () => {
  const schema = read('supabase/schema.sql');
  const migration = read('supabase/auth-onboarding-migration.sql');
  for (const sql of [schema, migration]) {
    assert.match(sql, /insert into public\.profiles\(id, full_name, phone\)/i);
    assert.match(sql, /apply_seller_application/i);
    assert.match(sql, /admin_review_seller_application/i);
    assert.match(sql, /public\.is_approved_seller\(\)/i);
  }
  assert.match(schema, /public\.is_active_user\(\).*raise exception/s);
  assert.match(migration, /require_active_order_customer/i);
  assert.match(schema, /role public\.app_role not null default 'customer'/i);
  assert.match(migration, /drop policy if exists "seller can request own store"/i);
  assert.match(read('seller.html'), /Submit seller application/);
  assert.match(read('admin\/login.html'), /\/api\/admin\/login/);
  assert.match(read('admin\/users.html'), /adminReviewSellerApplication/);
});
