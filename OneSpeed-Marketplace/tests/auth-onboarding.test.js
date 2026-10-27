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
    emailRedirectTo: 'https://onespeed.example/auth-callback.html',
    role: 'admin'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(signupArgs.options.data)), {
    full_name: 'New Customer',
    phone: ''
  });
  assert.equal(signupArgs.options.emailRedirectTo, 'https://onespeed.example/auth-callback.html');
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

test('signup messages do not claim an email was sent and document the Auth confirmation gate', () => {
  const login = read('login.html');
  const registration = read('register.html');
  const readme = read('README.md');
  const callback = read('auth-callback.html');
  assert.doesNotMatch(login, /Please verify your email using the link we sent/);
  assert.doesNotMatch(registration, /Check your email to verify your address/);
  assert.match(registration, /Disable email confirmation in Supabase Auth settings/);
  assert.match(registration, /auth-callback\.html/);
  assert.match(callback, /OneSpeedBackend\.currentUser/);
  assert.match(callback, /email_confirmed_at/);
  assert.match(callback, /Request a new confirmation email/);
  assert.match(readme, /turn off \*\*Confirm email\*\*/);
  assert.match(readme, /localhost:3000\/auth-callback\.html/);
  assert.match(readme, /repository's checked-in browser URL\/key are blank/);
});

test('confirmation callback verifies the signed-in user and rejects Supabase callback errors', async () => {
  const callback = read('auth-callback.html');
  const script = [...callback.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script, 'callback page should contain its confirmation handler');

  async function run(search, user) {
    const elements = {
      'auth-callback-status': { textContent: '' },
      'auth-callback-login': { href: 'login.html' }
    };
    const calls = [];
    const backend = {
      configured: () => true,
      async currentUser() { return user; }
    };
    vm.runInNewContext(script, {
      document: { getElementById: id => elements[id] },
      location: { search, pathname: '/auth-callback.html' },
      history: { replaceState: (...args) => calls.push(args) },
      URLSearchParams,
      window: { OneSpeedBackend: backend },
      OneSpeedBackend: backend
    });
    await new Promise(resolve => setImmediate(resolve));
    return { elements, calls };
  }

  const confirmed = await run('', { email_confirmed_at: '2026-10-27T06:00:00Z' });
  assert.equal(confirmed.elements['auth-callback-status'].textContent, 'Your email is confirmed. You can now sign in.');
  assert.equal(confirmed.calls.length, 1);

  const failed = await run('?error=access_denied', null);
  assert.equal(failed.elements['auth-callback-status'].textContent, 'Confirmation link was not accepted.');
});

test('missing Supabase auth session is treated as a signed-out visitor, while other auth errors propagate', async () => {
  let authError = { name: 'AuthSessionMissingError', message: 'Auth session missing!' };
  const window = {
    ONESPEED_SUPABASE_CONFIG: { url: 'https://project.supabase.co', anonKey: 'public-anon-key' },
    supabase: {
      createClient() {
        return { auth: { async getUser() { return { data: { user: null }, error: authError }; } } };
      }
    }
  };
  vm.runInNewContext(read('js/supabase.js'), { window });
  assert.equal(await window.OneSpeedBackend.currentUser(), null);

  authError = { message: 'Auth service unavailable', code: 'unexpected_failure' };
  await assert.rejects(window.OneSpeedBackend.currentUser(), error => error.message === 'Auth service unavailable');
  authError = { message: 'Auth session missing!', code: 'session_not_found' };
  assert.equal(await window.OneSpeedBackend.currentUser(), null);
});

test('customer password recovery uses the same-origin reset route and updates through Supabase Auth', async () => {
  const calls = [];
  const window = {
    location: { origin: 'https://onespeed.example' },
    ONESPEED_SUPABASE_CONFIG: { url: 'https://project.supabase.co', anonKey: 'public-anon-key' },
    supabase: {
      createClient() {
        return {
          auth: {
            async resetPasswordForEmail(email, options) {
              calls.push({ method: 'resetPasswordForEmail', email, options });
              return { error: null };
            },
            async updateUser(attributes) {
              calls.push({ method: 'updateUser', attributes });
              return { data: { user: { id: 'customer-id' } }, error: null };
            }
          }
        };
      }
    }
  };
  vm.runInNewContext(read('js/supabase.js'), { window });
  await window.OneSpeedBackend.requestPasswordReset('customer@example.test');
  await window.OneSpeedBackend.updatePassword('new-customer-password');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: 'resetPasswordForEmail',
      email: 'customer@example.test',
      options: { redirectTo: 'https://onespeed.example/reset-password.html' }
    },
    { method: 'updateUser', attributes: { password: 'new-customer-password' } }
  ]);
});

test('standard Supabase environment aliases keep server-verified admin login functional', async t => {
  const { ONESPEED_SUPABASE_URL, ONESPEED_SUPABASE_ANON_KEY, ...standardEnv } = env;
  const aliasSets = [
    { SUPABASE_URL: ONESPEED_SUPABASE_URL, SUPABASE_ANON_KEY: ONESPEED_SUPABASE_ANON_KEY },
    {
      NEXT_PUBLIC_SUPABASE_URL: ONESPEED_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ONESPEED_SUPABASE_ANON_KEY
    }
  ];
  for (const aliases of aliasSets) {
    const server = await startAdminAuthServer({
      env: { ...standardEnv, ...aliases },
      fetchImpl: async url => String(url).includes('/auth/v1/token')
        ? new Response(JSON.stringify({
            access_token: 'access-session-token',
            refresh_token: 'refresh-session-token',
            user: { id: 'admin-user-id', email: env.ADMIN_EMAIL }
          }), { status: 200 })
        : new Response(JSON.stringify([{ role: 'admin', is_active: true }]), { status: 200 })
    });
    t.after(server.close);
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `https://${new URL(server.url).host}`,
        'X-Forwarded-Proto': 'https'
      },
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
    });
    assert.equal(response.status, 200);
  }
});

test('customer recovery is linked from customer login and does not disclose account existence', () => {
  assert.match(read('login.html'), /href="reset-password\.html"/);
  const recovery = read('reset-password.html');
  const bridge = read('js/supabase.js');
  assert.match(recovery, /If an account can be recovered with that email, a reset link will be sent/);
  assert.match(recovery, /backend\.requestPasswordReset/);
  assert.match(recovery, /backend\.updatePassword/);
  assert.match(bridge, /auth\.resetPasswordForEmail/);
  assert.match(bridge, /auth\.updateUser\(\{ password \}\)/);
  assert.match(recovery, /role="status" aria-live="polite"/);
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
    headers: {
      'Content-Type': 'application/json',
      Origin: `https://${new URL(server.url).host}`,
      'X-Forwarded-Proto': 'https'
    },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.access_token, 'access-session-token');
  assert.equal(payload.refresh_token, 'refresh-session-token');
  assert.equal(Object.hasOwn(payload, 'password'), false);
  assert.match(response.headers.get('set-cookie'), /__Host-onespeed_admin_session=.*HttpOnly.*Secure.*SameSite=Strict/);
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.headers.Authorization, /^Bearer access-session-token$/);
});

test('admin page authorization validates the HttpOnly session against Supabase and clears it on logout', async t => {
  const calls = [];
  let profileRole = 'admin';
  const server = await startAdminAuthServer({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'admin-user-id' }), { status: 200 });
      }
      return new Response(JSON.stringify([{ role: profileRole, is_active: true }]), { status: 200 });
    }
  });
  t.after(server.close);
  const authorizationUrl = server.url.replace('/api/admin/login', '/api/admin/authorize');
  const authorized = await fetch(authorizationUrl, {
    headers: { Cookie: 'other=value; __Host-onespeed_admin_session=verified-access-token' }
  });
  assert.equal(authorized.status, 204);
  assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers.Authorization, /^Bearer verified-access-token$/);
  assert.match(calls[1].options.headers.Authorization, /^Bearer verified-access-token$/);

  profileRole = 'customer';
  const customer = await fetch(authorizationUrl, {
    headers: { Cookie: '__Host-onespeed_admin_session=valid-customer-token' }
  });
  assert.equal(customer.status, 401);
  assert.equal(calls.length, 4);

  profileRole = 'seller';
  const seller = await fetch(authorizationUrl, {
    headers: { Cookie: '__Host-onespeed_admin_session=valid-seller-token' }
  });
  assert.equal(seller.status, 401);
  assert.equal(calls.length, 6);

  const rejected = await fetch(authorizationUrl);
  assert.equal(rejected.status, 401);
  assert.equal(calls.length, 6);

  const logout = await fetch(server.url.replace('/api/admin/login', '/api/admin/logout'), {
    method: 'POST'
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /__Host-onespeed_admin_session=;.*Secure.*SameSite=Strict.*Max-Age=0/);
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
