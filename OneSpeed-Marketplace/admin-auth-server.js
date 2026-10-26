'use strict';

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_BODY_BYTES = 4096;

function secureEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function send(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error('Request too large'));
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid request'));
      }
    });
    request.on('error', reject);
  });
}

function clientAddress(request) {
  return request.headers['x-forwarded-for']?.split(',')[0].trim()
    || request.socket.remoteAddress
    || 'unknown';
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const scheme = request.headers['x-forwarded-proto']?.split(',')[0].trim() || 'http';
  try {
    return new URL(origin).origin === `${scheme}://${request.headers.host}`;
  } catch {
    return false;
  }
}

function createAdminAuthServer({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  maxAttempts = MAX_ATTEMPTS,
  windowMs = WINDOW_MS
} = {}) {
  const attempts = new Map();
  return http.createServer(async (request, response) => {
    if (request.url !== '/api/admin/login') {
      send(response, 404, { error: 'Not found.' });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(response, 405, { error: 'Method not allowed.' });
      return;
    }
    if (!isSameOrigin(request)) {
      send(response, 403, { error: 'Unable to sign in.' });
      return;
    }

    const address = clientAddress(request);
    if (attempts.size > 1000) {
      for (const [key, value] of attempts) {
        if (value.expiresAt <= now()) attempts.delete(key);
      }
    }
    if (attempts.size >= 10000 && !attempts.has(address)) {
      send(response, 429, { error: 'Too many sign-in attempts. Try again later.' });
      return;
    }
    const current = attempts.get(address);
    const record = !current || current.expiresAt <= now()
      ? { count: 0, expiresAt: now() + windowMs }
      : current;
    record.count += 1;
    attempts.set(address, record);
    if (record.count > maxAttempts) {
      send(response, 429, { error: 'Too many sign-in attempts. Try again later.' });
      return;
    }

    const adminEmail = env.ADMIN_EMAIL?.trim();
    const adminPassword = env.ADMIN_PASSWORD;
    const supabaseUrl = env.ONESPEED_SUPABASE_URL?.trim();
    const anonKey = env.ONESPEED_SUPABASE_ANON_KEY?.trim();
    if (!adminEmail || !adminPassword || adminPassword.length < 16 || !supabaseUrl || !anonKey) {
      send(response, 503, { error: 'Administrator sign-in is not configured.' });
      return;
    }
    try {
      if (new URL(supabaseUrl).protocol !== 'https:' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        send(response, 503, { error: 'Administrator sign-in is not configured.' });
        return;
      }
    } catch {
      send(response, 503, { error: 'Administrator sign-in is not configured.' });
      return;
    }

    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      send(response, 415, { error: 'Unable to sign in.' });
      return;
    }
    let credentials;
    try {
      credentials = await readBody(request);
    } catch {
      send(response, 400, { error: 'Unable to sign in.' });
      return;
    }
    if (!credentials || typeof credentials !== 'object'
      || typeof credentials.email !== 'string' || typeof credentials.password !== 'string'
      || !secureEqual(credentials.email.trim().toLowerCase(), adminEmail.toLowerCase())
      || !secureEqual(credentials.password, adminPassword)) {
      send(response, 401, { error: 'Unable to sign in.' });
      return;
    }

    try {
      const authUrl = new URL('/auth/v1/token?grant_type=password', supabaseUrl);
      const authResponse = await fetchImpl(authUrl, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
        signal: AbortSignal.timeout(10000)
      });
      if (!authResponse.ok) {
        send(response, 401, { error: 'Unable to sign in.' });
        return;
      }
      const session = await authResponse.json();
      if (!session.access_token || !session.refresh_token || !session.user?.id
        || session.user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
        send(response, 502, { error: 'Administrator sign-in is unavailable.' });
        return;
      }

      const profileUrl = new URL('/rest/v1/profiles', supabaseUrl);
      profileUrl.search = new URLSearchParams({
        id: `eq.${session.user.id}`,
        select: 'role,is_active'
      }).toString();
      const profileResponse = await fetchImpl(profileUrl, {
        headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!profileResponse.ok) {
        send(response, 401, { error: 'Unable to sign in.' });
        return;
      }
      const profiles = await profileResponse.json();
      if (!Array.isArray(profiles) || profiles.length !== 1
        || profiles[0].role !== 'admin' || profiles[0].is_active !== true) {
        send(response, 401, { error: 'Unable to sign in.' });
        return;
      }

      attempts.delete(address);
      send(response, 200, {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type || 'bearer'
      });
    } catch {
      send(response, 502, { error: 'Administrator sign-in is unavailable.' });
    }
  });
}

if (require.main === module) {
  const server = createAdminAuthServer();
  server.listen(3000, '127.0.0.1', () => {
    console.log('OneSpeed admin auth endpoint listening on localhost:3000');
    const nginx = spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' });
    nginx.on('error', error => {
      console.error('Could not start Nginx:', error.message);
      server.close(() => process.exit(1));
    });
    nginx.on('exit', code => server.close(() => process.exit(code || 0)));
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        nginx.kill(signal);
        server.close(() => process.exit(0));
      });
    }
  });
}

module.exports = { createAdminAuthServer, secureEqual };
