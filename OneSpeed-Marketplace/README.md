# OneSpeed Marketplace

Premium OneSpeed Marketplace frontend with the original forest-green / metallic-gold identity. The existing application is static HTML/CSS/JavaScript with Supabase authentication, data, storage and RLS. Legacy demo mode remains available only for local preview.

## Quick start (frontend preview)

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Without Supabase configured, the original local demo mode remains for preview only. Do not publish or use demo/localStorage accounts for real customers.

## Supabase setup

1. Create a Supabase project and configure Authentication email confirmation, password rules, production Site URL, redirect URLs and SMTP.
2. In Supabase SQL Editor, run `supabase/schema.sql` in one go. It creates profiles, seller stores/applications, categories, products, orders, order items, bank transfer submissions, seller payouts, reviews, support tickets, audit logs, RLS policies, storage buckets, and transactional RPCs.
   Then run `supabase/marketplace-operations-migration.sql` for both fresh and existing projects. It adds persistent customer addresses, wishlist and notifications; order history; review moderation; support operations; audited payouts; product full-text search; and seller-visible product moderation notes.
   On an existing project, apply any missing delivery-zone migration, then `supabase/auth-onboarding-migration.sql`, then `supabase/marketplace-operations-migration.sql`. Review and test migrations in staging before production.
3. For local static preview, the Supabase configuration can be entered in `js/supabase-config.js`. For Docker or Render, use the runtime environment variables described below instead:

   ```js
   window.ONESPEED_SUPABASE_CONFIG = {
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY'
   };
   ```

   Never use a `service_role` key in browser code or commit private secrets.
4. Customers can register and shop without administrator approval. Customers submit seller applications from `/seller.html`; approval is required before seller-only actions, and database RLS enforces that gate.
5. Promote the first administrator from SQL Editor after the intended admin has created and verified their Supabase Auth account (replace the email). This is a trusted, one-time operator action; never expose this operation to browser users:

   ```sql
   update public.profiles
   set role = 'admin', is_active = true
   where id = (select id from auth.users where email = 'YOUR-ADMIN-EMAIL');
   ```

6. Configure bank-transfer instructions through your trusted business process before accepting payments. This repo intentionally does not invent bank details. Transfer submissions remain unpaid until an admin verifies the money has actually arrived and approves the submission in `admin/bank-transfers.html`.
7. Set up production hosting with HTTPS, correct SPA/static routes, security headers, monitoring, backups and a verified domain.

## Deploy to Render

This repository includes a root-level `render.yaml` Blueprint for the existing Docker/Nginx site. In Render, create a **Blueprint** from this GitHub repository and select the branch to deploy. Render reads the Blueprint and builds the Dockerfile from `OneSpeed-Marketplace/`; do not create a separate app or replace the existing site. Nginx sends a baseline Content Security Policy, frame/content-type protections, a referrer policy, and a permissions policy; inline scripts remain permitted because existing pages use inline handlers.

When prompted, set these environment variables on the Render service:

- `ONESPEED_SUPABASE_URL`: your Supabase project URL, for example `https://YOUR-PROJECT.supabase.co`.
- `ONESPEED_SUPABASE_ANON_KEY`: the project's **public anon/publishable key**.
- `ADMIN_EMAIL`: the email of the verified, active administrator in Supabase Auth.
- `ADMIN_PASSWORD`: that administrator's Supabase Auth password; use a unique password of at least 16 characters.

Set both Supabase public values together. They are used by the existing browser client; the admin credentials are read only by a server-side Node endpoint in the Docker Web Service. The admin endpoint compares credentials to the deployment environment, rate-limits attempts, then verifies the resulting Supabase Auth session and database admin role before returning a normal Supabase session. The password itself is never sent back to the browser. `ADMIN_EMAIL` and `ADMIN_PASSWORD` must match the Supabase Auth account; this does not create or promote an admin account. Promotion remains a trusted SQL Editor operation. Missing admin environment settings fail closed for admin sign-in.

Never add a Supabase `service_role` or secret key to Render, browser config, or repository files. The generated public config endpoint is served with `Cache-Control: no-store`.

If both Supabase public variables are omitted, the container stays in the existing demo/preview mode; do not use that mode for real customer orders or authentication. Admin login remains unavailable unless its server environment is configured. The same optional variables can be supplied when running `docker compose` locally.

Before using the live site, also:

1. Apply `supabase/schema.sql` to the Supabase project, or apply `supabase/delivery-zones-migration.sql` if the original schema is already installed. Render does not run Supabase migrations.
2. In Supabase Authentication settings, set the production Site URL to the Render URL (or your custom domain) and add the corresponding login/register redirect URLs.
3. Configure and verify your admin account, delivery zones/fees and any payment instructions in Supabase before accepting real orders.
4. Confirm the Supabase project's RLS policies and test the live checkout against a staging project first. Browser requests use the public key and rely on those policies.

Render's health check requests `/`. Use Render's generated HTTPS URL initially; a custom domain can be configured later in the Render service settings.

## Registration, seller onboarding, and admin routes

- Customer registration: `/register.html`. Customers receive the default customer role and can shop without administrator approval. When Supabase email confirmation is enabled, they must verify the email before signing in.
- Customer account: `/account.html`; saved addresses `/addresses.html`; wishlist `/wishlist.html`; notifications `/notifications.html`; bank transfer history `/payment-history.html`; support requests `/support.html`. Persistent customer services require Supabase and the operations migration.
- Seller application and workspace: `/seller.html` (also linked from the signed-in account page). Customers can apply and continue shopping while pending. Rejected applications can be edited and resubmitted. Admin review is in `/admin/users.html`.
- Administrator login: `/admin/login.html`.
- Administrator dashboard: `/admin/index.html`; payouts `/admin/payouts.html`; review moderation `/admin/reviews.html`; support queue `/admin/support.html`.

Admin login requires all four Render variables above. First create and verify the intended administrator in Supabase Auth, promote the profile with the trusted SQL statement in Supabase setup step 5, then configure the matching `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Render. Existing Supabase admin accounts remain in place; do not run a role update for an account unless authorized.

For local Codespaces testing, add the four values under **Codespaces → Settings → Secrets and variables → Codespaces**, then restart the Codespace so they are available to its environment. Alternatively, create a local `OneSpeed-Marketplace/.env` from `.env.example` and fill in local-only test values, then run `cd OneSpeed-Marketplace && docker compose up --build`. Never commit `.env`; it is excluded by both `.dockerignore` and the repository `.gitignore`. Supabase URL and anon key are public client configuration; admin credentials are passed only to the server process.

Run the regression tests and build the production Docker image with:

```bash
cd OneSpeed-Marketplace
node --test tests/*.test.js
docker compose build
```

## New backend foundation

- `js/supabase-config.js` — public client configuration placeholders.
- `js/supabase.js` — browser client bridge for Auth, customer profiles, seller application/review, product image uploads and transfer submission.
- `admin-auth-server.js` — server-only admin credential verification and rate limiting; exchanges verified credentials for a Supabase Auth session only after checking the user's active admin profile.
- `supabase/schema.sql` — PostgreSQL schema, Row Level Security policies, storage buckets and transactional RPCs. `place_order` calculates prices on the server and reserves stock; seller role/status changes are protected and seller actions require approval.
- `seller.html` — seller application, application status, and approved seller product/order centre.
- `admin/login.html` — separate environment-credential administrator login.
- `supabase/auth-onboarding-migration.sql` — additive customer/seller auth hardening migration for existing Supabase installations.
- `bank-transfer.html` — customer transfer submission with private receipt upload.
- `admin/bank-transfers.html` — admin review UI with short-lived signed receipt links.
- `delivery-address.html` and `js/delivery-address.js` — reusable customer address form, saved-address prefill and Leaflet map selection.
- `admin/delivery-zones.html` — administrator management of country/state/city delivery zones and fees. The most specific active match is used; zone fees must use the order currency.
- `supabase/delivery-zones-migration.sql` — additive migration for projects that already applied the original schema.

The map uses Leaflet 1.9.4 and `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, with visible `© OpenStreetMap contributors` attribution. Address fields are entered manually; no geocoder or public Nominatim autocomplete is used. If the map or tile service is unavailable, manual address confirmation remains available. Confirmed address fields and optional latitude/longitude are included in `orders.shipping_address`; order reads continue to use the existing order RLS policy, including seller access only for sellers with an item in that order.

When Supabase is configured, the storefront loads the catalog in 60-product pages and applies full-text search, category, currency, price, stock, and sort filters through the database; product detail and the cart resolve product IDs against Supabase before checkout. Admin product listings are paginated, and rejection notes are persisted for sellers. Supabase checkout calls the transactional `place_order` RPC, which stores the address JSON, computes delivery fees server-side and uses database product prices/stock. Existing demo carts with numeric IDs are not converted into live orders. Without Supabase configuration, the preview continues to use the local demo catalog and store demo orders in localStorage only.

Run the focused address/map/backend payload tests with:

```bash
node --test tests/*.test.js
```

Build the production static site with:

```bash
docker compose build
```

## Existing frontend

- `index.html`, `product.html`, `cart.html`, `checkout.html`, `track.html`, `account.html`, `login.html`, `register.html`
- `admin/` dashboard and management screens
- `assets/images/` original brand artwork, hero, category illustrations and placeholder
- `css/styles.css`, `js/data.js`, `js/app.js`

## Remaining production work

- Apply the operations migration in a dedicated Supabase staging project and verify the resulting SQL/RLS behavior before production. No live Supabase project was available for this implementation session.
- Run end-to-end customer, seller, administrator, checkout, payment-review and mobile-browser tests against configured staging credentials; the checked-in tests are local regression tests, not live-service tests.
- Add trusted bank-instruction configuration before accepting transfers. A payout marked paid records an administrator-supplied transfer reference; it does not transfer funds.
- Refund processing and external payout settlement remain manual business operations. The order status workflow records administrative decisions but does not initiate a bank refund.
- Local preview still contains the legacy `localStorage` demo fallback; it is not used as the source of truth when Supabase is configured and must not be used for production transactions.

## Local demo credentials

The legacy `js/data.js` includes a seeded local demo customer for offline preview. This is stored in browser storage and is **not secure authentication**. There is no seeded demo administrator; admin routes require the server-verified Supabase admin login. Do not use local demo accounts in production.
