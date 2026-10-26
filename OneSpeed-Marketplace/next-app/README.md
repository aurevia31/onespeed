# OneSpeed Next.js migration (stage 1)

This is the first incremental migration stage. The current HTML/CSS/JavaScript marketplace remains the production app. The Next.js app provides a migrated homepage at `/` and serves the existing HTML routes and their public assets unchanged during the transition.

## Requirements

- Node.js 20.9 or later
- npm

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. To use the existing Supabase browser bridge in legacy pages, copy `.env.example` to `.env.local` and set both public Supabase variables. These values are intentionally public client configuration; never put service-role or secret keys in either variable. The sync script also accepts the existing `ONESPEED_*`, `SUPABASE_*`, and `NEXT_PUBLIC_SUPABASE_*` public variable aliases.

To build and serve the production bundle:

```bash
npm run build
npm start
```

The dev, build, and start scripts run `scripts/sync-legacy-assets.mjs`, which copies only existing HTML pages and the public `assets`, `css`, and `js` directories into the ignored `public/` staging directory. It excludes admin pages, environment files, tests, and dependency folders. It validates Supabase settings for the current environment and writes only the public key into the generated browser config.

## Migration boundaries

- Existing customer and seller HTML routes remain available (for example `/index.html`, `/login.html`, and `/checkout.html`).
- The new homepage links into those routes; customer auth, checkout, sellers, and the admin workspace are not converted in this stage.
- Administrator HTML pages are deliberately not copied into Next.js public assets because the current production server applies server-side admin authorization; they remain on the existing protected Nginx service until equivalent Next.js authorization is implemented.
- Existing pages continue using the existing Supabase browser bridge and public runtime configuration. No service-role key or private credential is used by Next.js.
- Render continues using the current Nginx Docker service. Switching production traffic to Next.js is a separate release step after routes are migrated and parity is verified.
