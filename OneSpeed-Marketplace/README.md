# OneSpeed Marketplace

Premium OneSpeed Marketplace frontend with the original forest-green / metallic-gold identity. The existing application is static HTML/CSS/JavaScript with Supabase authentication, data, storage and RLS. Legacy demo mode remains available only for local preview.

## Quick start (frontend preview)

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Without Supabase configured, the original local demo mode remains for preview only. Do not publish or use demo/localStorage accounts for real customers.

## Next.js migration (stage 1)

The incremental Next.js app is in `next-app/`; the existing HTML/Nginx marketplace remains the production deployment while routes are migrated and parity is tested. To run the Next.js homepage and preserved legacy routes locally, use Node.js 20.9 or later:

```bash
cd next-app
npm ci
npm run dev
```

Open `http://localhost:3000`. The Next.js root route is the new marketplace landing page; existing storefront, customer, seller, and checkout HTML pages continue to be served from their existing `.html` paths. Those pages keep using the current browser Supabase bridge. Administrator pages are intentionally not mirrored into Next.js public assets because they currently rely on server-side Nginx authorization. The static production Docker image excludes `next-app/`, so the scaffold does not change Render's current production routing.

## Supabase setup

1. Create a Supabase project and configure password rules, production Site URL, redirect URLs and email delivery. To let customers register and sign in immediately without email verification, turn off **Confirm email** in the Supabase Dashboard under **Authentication → Sign In / Providers → Email**. This is a project-wide Auth setting that also applies to seller applicants; the browser app cannot change it. With confirmation enabled, Supabase blocks sign-in until the address is confirmed.
2. Before installing or repairing any production schema, follow [Safe production database inspection and recovery](#safe-production-database-inspection-and-recovery). Do not infer that the database is empty from a failed product query.
3. For a **new, verified empty project only**, open that project's SQL Editor and run `supabase/schema.sql`, followed by `supabase/marketplace-operations-migration.sql`. The base schema has a transaction and aborts before making changes if any OneSpeed core table exists. Do not run it on an existing or partially initialized project.
4. For an existing project, inspect its objects first and use only a migration reviewed for that exact state. The delivery-zone, auth-onboarding, and marketplace-operations scripts are not a universal repair for an unknown partial schema; each has prerequisites.
5. For local static preview, the Supabase configuration can be entered in `js/supabase-config.js`. For Docker or Render, use the runtime environment variables described below instead:

   ```js
   window.ONESPEED_SUPABASE_CONFIG = {
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY'
   };
   ```

   Never use a `service_role` key in browser code or commit private secrets.
6. Customers can register and shop without administrator approval. Customers submit seller applications from `/seller.html`; approval is required before seller-only actions, and database RLS enforces that gate. With **Confirm email** disabled, customer signup returns an active session immediately. Seller applicants use the same customer signup and Auth confirmation policy.
7. Promote the first administrator from SQL Editor after the intended admin has created and verified their Supabase Auth account (replace the email). This is a trusted, one-time operator action; never expose this operation to browser users:

   ```sql
   update public.profiles
   set role = 'admin', is_active = true
   where id = (select id from auth.users where email = 'YOUR-ADMIN-EMAIL');
   ```

8. Configure bank-transfer instructions through your trusted business process before accepting payments. This repo intentionally does not invent bank details. Transfer submissions remain unpaid until an admin verifies the money has actually arrived and approves the submission in `admin/bank-transfers.html`.
9. Set up production hosting with HTTPS, correct SPA/static routes, security headers, monitoring, backups and a verified domain.

### Safe production database inspection and recovery

The storefront reads active rows from `public.products` through the Supabase Data API, selecting `id,title,description,price,currency,category,stock,image_url,images,seller_id,created_at`, filtering `status = 'active'`, and optionally using `search_document` for full-text search. Product detail reads use the same product fields and active-status filter. Public RLS permits only active products; approved sellers can read their own allowed listings and administrators can read/manage listings. The schema also defines the profile, seller, category, delivery, order, payment, review, support, and audit tables, policies, indexes, triggers, functions, and storage buckets used across the application.

The production Data API previously returned PostgREST `PGRST205` (“table not found in the schema cache”) for the core public tables. This means the API schema cache could not resolve those relation names; it does **not**, by itself, prove that the physical PostgreSQL tables are absent. Direct PostgreSQL inspection was unavailable, so the live physical schema, RLS state, migration history, backups, and product data have **not** been verified. No production SQL has been run.

1. In Render, open the `onespeed-2` web service's environment settings and use the configured Supabase URL **host/project reference only**; never copy or post the anon key, database password, or full environment values. In Supabase, open the Dashboard project whose reference matches that host, then open **SQL Editor** in that same project. Do not use a second project or guess from a project display name.
2. Confirm a current backup or recovery point in Supabase's backup/PITR settings and note its time/status. Do not proceed with production DDL until an authorized operator confirms a suitable recovery point. A backup is not assumed just because the project is on Supabase.
3. Open `supabase/production-read-only-inspection.sql`. Run each numbered `SELECT` separately in the SQL Editor and save the results securely. The catalog checks include approximate table row counts and primary/foreign-key columns. The script does not read user/product rows except the optional count query, does not change schema/data, and does not include credentials. The SQL Editor project reference must match Render.
4. Interpret the table inventory before choosing a path:
   - **No OneSpeed core tables physically exist:** only if the project is verified as the intended, empty database and a recovery point is confirmed, run `supabase/schema.sql` once, then `supabase/marketplace-operations-migration.sql`. The base installer wraps its DDL in a transaction and its preflight guard aborts if any listed core table exists. Inspect the SQL editor result for success; PostgreSQL transactional errors roll back that script.
   - **Some core tables exist:** stop. Do not run `schema.sql` or guess at a partial repair. Compare the inspection results to `schema.sql` and migration definitions, preserve data, and prepare/review an additive migration targeted to the confirmed differences. No generic partial migration is supplied because the actual production state is unknown.
   - **All expected tables/columns exist:** do not recreate them. Check `public` is included among the project's exposed Data API schemas, check the `anon` role has `SELECT` grants on `products` and `categories`, and review RLS policies for active-product public reads. If tables were just created/changed and the schema cache alone is stale, use Supabase's supported schema-cache reload procedure only after verifying the tables/policies; then retry the anonymous query.
   - **Tables exist and API reads work but no active rows exist:** the catalog is empty by data state, not a missing-file problem. Review existing product statuses and seller approval via the authorized admin workflow; do not invent or bulk-insert sample products.
5. Verify with the query results and the storefront after recovery: anonymous `GET /rest/v1/products?select=id&status=eq.active&limit=1`, a product detail page, a category filter, and search. Do not test using a service-role key. Product listing and detail use the public anon/publishable key plus RLS.
6. If the migration-history relation is present, the inspection script shows how to read it. Supabase SQL Editor manual runs may not appear in CLI migration history, so absence of a history row is not evidence that a migration was never applied.

The read-only inspection script intentionally does not contain `CREATE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, or `TRUNCATE`. Do not combine a diagnosis run with installer execution. Keep the preflight guard and transaction in `supabase/schema.sql`; neither substitutes for a confirmed backup.

## Deploy to Render

This repository includes a root-level `render.yaml` Blueprint for the existing Docker/Nginx site. In Render, create a **Blueprint** from this GitHub repository and select the branch to deploy. Render reads the Blueprint and builds the Dockerfile from `OneSpeed-Marketplace/`; do not create a separate app or replace the existing site. Nginx sends a baseline Content Security Policy, frame/content-type protections, a referrer policy, and a permissions policy; inline scripts remain permitted because existing pages use inline handlers.

When prompted, set these environment variables on the Render service:

- `ONESPEED_SUPABASE_URL`: your Supabase project URL, for example `https://YOUR-PROJECT.supabase.co`.
- `ONESPEED_SUPABASE_ANON_KEY`: the project's **public anon/publishable key**.
- `ADMIN_EMAIL`: the email of the verified, active administrator in Supabase Auth.
- `ADMIN_PASSWORD`: that administrator's Supabase Auth password; use a unique password of at least 16 characters.

Set both Supabase public values together. Docker Compose also accepts `SUPABASE_URL` with `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`, and the existing Next.js-style `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` names. Explicit `ONESPEED_*` names take precedence. Render's existing `ONESPEED_*` configuration remains supported. The admin endpoint accepts the same aliases server-side. Administrator pages are gated by Nginx `auth_request`; a successful login issues a short-lived `__Host-` Secure, HttpOnly, SameSite=Strict session cookie and each admin page request is revalidated against Supabase Auth and the active admin profile. The login endpoint rate-limits attempts and verifies the database admin role. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are server-only and must match the Supabase Auth account; they do not create or promote an admin account. Promotion remains a trusted SQL Editor operation. Missing admin environment settings fail closed for admin sign-in.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ONESPEED_SUPABASE_URL`, and `ONESPEED_SUPABASE_ANON_KEY` are public-client configuration (only anon/publishable keys are accepted in browser config). `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and any Supabase secret/service-role key are server-only. This application does not use a Supabase service-role key. Never add a Supabase secret/service-role key to browser config or repository files. The generated public config endpoint is served with `Cache-Control: no-store`.

### Runtime environment variables

- Required for the Supabase-backed customer and marketplace features: one project URL (`ONESPEED_SUPABASE_URL`, `SUPABASE_URL`, or `NEXT_PUBLIC_SUPABASE_URL`) and one public anon/publishable key (`ONESPEED_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, or `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Both must be set. If neither is configured, Docker deliberately starts in local demo/preview mode.
- Required only for administrator login: `ADMIN_EMAIL` and `ADMIN_PASSWORD`, server-side, matching an active admin identity in Supabase Auth. They are not needed for customer registration, login, or seller applications.
- Optional for this app's existing flow: no Supabase secret/service-role variable. `SUPABASE_SECRET_KEY` is not consumed by this static frontend, Docker service, or admin endpoint and must remain server-only if configured elsewhere.
- Email verification and password reset delivery are configured in Supabase Auth (SMTP/provider, Site URL, and redirect allowlist). This repository's checked-in browser URL/key are blank until configured, so the app cannot currently reach a Supabase project from that default config. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` by themselves do not enable email in this app.
- This deployment uses Supabase for database and product-image storage. `POSTGRES_*` values without a database host/URL, plus `MEILI_*`, `CLOUDINARY_*`, `SHIPPO_*`, `PAYSTACK_*`, Google Maps, and Sentry variables are not wired into this static deployment; do not rely on those integrations being active. Leaflet/OpenStreetMap delivery selection does not need a map API key.

Configure public runtime values and server-only admin credentials in **Codespaces → Settings → Secrets and variables → Codespaces** or the current Render service's Environment settings; restart/redeploy after changing them. For local Docker only, use the ignored `.env` file based on `.env.example`. The committed example contains names and placeholders only. Validate variable presence with Compose and `docker compose build`; neither command prints credential values when run as documented.

If both Supabase public variables are omitted, the container stays in the existing demo/preview mode; do not use that mode for real customer orders or authentication. Admin login remains unavailable unless its server environment is configured. The same optional variables can be supplied when running `docker compose` locally.

Before using the live site, also:

1. Apply `supabase/schema.sql` to the Supabase project, or apply `supabase/delivery-zones-migration.sql` if the original schema is already installed. Render does not run Supabase migrations.
2. In Supabase Authentication settings, set the production Site URL to the Render URL (or your custom domain) and add the corresponding login/register redirect URLs.
3. To enable password recovery and verification redirects, configure Supabase Auth email delivery/SMTP, set the production Site URL, and allow the exact `/reset-password.html` and `/login.html` redirect URLs. This app requests recovery emails through Supabase Auth; a separately configured `RESEND_API_KEY` alone does not send those messages.
4. Configure and verify your admin account, delivery zones/fees and any payment instructions in Supabase before accepting real orders.
5. Confirm the Supabase project's RLS policies and test the live checkout against a staging project first. Browser requests use the public key and rely on those policies.

Render's health check requests `/`. Use Render's generated HTTPS URL initially; a custom domain can be configured later in the Render service settings.

## Registration, seller onboarding, and admin routes

- Customer registration: `/register.html`. Customers receive the default customer role and can shop without administrator approval. When Supabase email confirmation is enabled, they must confirm the email before signing in; disable **Confirm email** in the Dashboard for immediate signup.
- Customer login/logout: `/login.html` and the signed-in account controls. Password recovery starts at `/reset-password.html`; email sending and redirect allowlisting must be configured in Supabase Auth.
- Customer account: `/account.html`; saved addresses `/addresses.html`; wishlist `/wishlist.html`; notifications `/notifications.html`; bank transfer history `/payment-history.html`; support requests `/support.html`. Persistent customer services require Supabase and the operations migration.
- Seller application and workspace: `/seller.html` (also linked from the signed-in account page). Customers can apply and continue shopping while pending. Rejected applications can be edited and resubmitted.
- Authorized administrators use the deployment's protected administrator login and workspace. Those routes are intentionally not linked from public pages or advertised in this guide. Admin pages require a server-validated session cookie; Supabase RLS and admin-only database functions continue to authorize privileged data operations.

Admin login requires the public Supabase URL and anon/publishable key plus `ADMIN_EMAIL` and `ADMIN_PASSWORD`. First create and verify the intended administrator in Supabase Auth, promote the profile with the trusted SQL statement in Supabase setup step 5, then configure the matching credentials in Render. Existing Supabase admin accounts remain in place; do not run a role update for an account unless authorized.

For local Codespaces testing, add the four Render values under **Codespaces → Settings → Secrets and variables → Codespaces**, then restart the Codespace so they are available to its environment. Alternatively, create a local `OneSpeed-Marketplace/.env` from `.env.example` and fill in local-only test values, then run `cd OneSpeed-Marketplace && docker compose up --build`. Never commit `.env`; it is excluded by `.dockerignore` and the repository ignore rules. Supabase URL and anon/publishable key are public client configuration; admin credentials are passed only to the server process. Configure any production email delivery separately in Supabase Auth settings.

Run the regression tests and build the production Docker image with:

```bash
cd OneSpeed-Marketplace
node --test tests/*.test.js
docker compose build
```

## New backend foundation

- `js/supabase-config.js` — public client configuration placeholders.
- `js/supabase.js` — browser client bridge for Auth, customer profiles, seller application/review, product image uploads and transfer submission.
- `admin-auth-server.js` — server-only admin credential verification, rate limiting, and session-cookie validation against Supabase Auth and the active admin profile.
- `supabase/schema.sql` — PostgreSQL schema, Row Level Security policies, storage buckets and transactional RPCs. `place_order` calculates prices on the server and reserves stock; seller role/status changes are protected and seller actions require approval.
- `seller.html` — seller application, application status, and approved seller product/order centre.
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
