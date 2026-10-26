# OneSpeed Marketplace

Premium OneSpeed Marketplace frontend with the original forest-green / metallic-gold identity. The current site is a static HTML/CSS/JavaScript application. This upgrade adds a Supabase production foundation, multi-seller schema and policies, seller centre, secure manual bank-transfer submission/review flows, and setup documentation. **It is not yet a fully migrated production marketplace:** legacy storefront, cart, checkout, and several admin screens still use browser `localStorage` until their data operations are migrated to the Supabase APIs/RPCs.

## Quick start (frontend preview)

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Without Supabase configured, the original local demo mode remains for preview only. Do not publish or use demo/localStorage accounts for real customers.

## Supabase setup

1. Create a Supabase project and configure Authentication email confirmation, password rules, production Site URL, redirect URLs and SMTP.
2. In Supabase SQL Editor, run `supabase/schema.sql` in one go. It creates profiles, seller stores, categories, products, orders, order items, bank transfer submissions, seller payouts, reviews, support tickets, audit logs, RLS policies, storage buckets, and transactional RPCs.
   If the original schema is already installed, run `supabase/delivery-zones-migration.sql` instead to add the delivery-zone table and update the order/fee RPCs.
3. Copy the project URL and the **publishable/anon key only** into `js/supabase-config.js`:

   ```js
   window.ONESPEED_SUPABASE_CONFIG = {
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY'
   };
   ```

   Never use a `service_role` key in browser code or commit private secrets.
4. Sign up using the login/register pages. Seller sign-ups are flagged as pending; platform admin must approve them. A seller must have `profiles.role='seller'` and `profiles.seller_status='approved'` before product insert policies allow their product uploads.
5. Promote the first administrator from SQL Editor after the admin user has signed up (replace the email):

   ```sql
   update public.profiles
   set role = 'admin', is_active = true
   where id = (select id from auth.users where email = 'YOUR-ADMIN-EMAIL');
   ```

6. Configure the bank transfer instructions (bank name, account name, account number, supported currency and reference format) in a trusted business configuration before accepting payments. This repo intentionally does not invent bank details. Transfer submissions remain unpaid until an admin verifies the money has actually arrived and approves the submission in `admin/bank-transfers.html`.
7. Set up production hosting with HTTPS, correct SPA/static routes, security headers, monitoring, backups and a verified domain.

## New backend foundation

- `js/supabase-config.js` — public client configuration placeholders.
- `js/supabase.js` — browser client bridge for Auth, profile lookup, product image uploads and transfer submission.
- `supabase/schema.sql` — PostgreSQL schema, Row Level Security policies, storage buckets and transactional RPCs. `place_order` calculates prices on the server and reserves stock; `submit_bank_transfer` validates the customer's order total; `admin_review_bank_transfer` performs an admin-only atomic review and audit entry.
- `seller.html` — approved seller centre with image upload and product/order overview.
- `bank-transfer.html` — customer transfer submission with private receipt upload.
- `admin/bank-transfers.html` — admin review UI with short-lived signed receipt links.
- `delivery-address.html` and `js/delivery-address.js` — reusable customer address form, saved-address prefill and Leaflet map selection.
- `admin/delivery-zones.html` — administrator management of country/state/city delivery zones and fees. The most specific active match is used; zone fees must use the order currency.
- `supabase/delivery-zones-migration.sql` — additive migration for projects that already applied the original schema.

The map uses Leaflet 1.9.4 and `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, with visible `© OpenStreetMap contributors` attribution. Address fields are entered manually; no geocoder or public Nominatim autocomplete is used. If the map or tile service is unavailable, manual address confirmation remains available. Confirmed address fields and optional latitude/longitude are included in `orders.shipping_address`; order reads continue to use the existing order RLS policy, including seller access only for sellers with an item in that order.

When Supabase is configured, the storefront and product detail load active catalog products through RLS, and the cart resolves its product IDs against Supabase before checkout. Supabase checkout calls the transactional `place_order` RPC, which stores the address JSON, computes delivery fees server-side and uses database product prices/stock. Existing demo carts with numeric IDs are not converted into live orders. Without Supabase configuration, the preview continues to use the local demo catalog and store demo orders in localStorage only.

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

## Important migration work still required before production

- Migrate storefront product listing/detail, cart, checkout, orders, account, admin product/user/order pages from `localStorage` to Supabase queries and RPCs.
- Configure and exercise the complete storefront/cart/order/payment flow against a dedicated Supabase staging project, including the SQL migration, admin fee zones and RLS checks; never trust client-supplied totals, product price or stock.
- Finish seller application review and seller profile management in the admin UI; promote approved sellers using protected admin operations.
- Configure official bank instructions and customer notifications; add a secure admin UI for maintaining payment instructions.
- Implement fulfilment updates, refund/return workflows, payout settlement and idempotent notifications.
- Complete browser-based end-to-end testing against a dedicated Supabase staging project, plus SQL policy tests and security review.

## Local demo credentials

The legacy `js/data.js` includes seeded local demo credentials for offline preview. These are stored in browser storage and are **not secure authentication**. Do not use them in production; configure Supabase Auth and remove demo mode for public launch.
