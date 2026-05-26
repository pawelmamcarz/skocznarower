# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Marketing site + bookings app for **skocznarower.pl**, a bicycle service shop in Grodzisk Mazowiecki (PL). Content is Polish. Deployed as a single Cloudflare Worker with the static-assets binding; the Worker handles the apex → www redirect, the booking API, the `/admin` panel, and a daily cron for SMS/email reminders. Static HTML/images fall through to the assets binding.

## Architecture

### Pages (static HTML at the repo root)
- `index.html` — main marketing page. CSS and JS are inlined; do not split into separate files unless asked. Section anchors: `#o-mnie`, `#uslugi`, `#cennik`, `#faq`, `#kontakt`.
- `umow.html` — booking flow, served at `/umow`. Calls `GET /api/availability?date=` then `POST /api/bookings`.
- `serwis-rowerow-pruszkow.html`, `serwis-rowerow-milanowek.html`, `bleeding-hamulcow-shimano.html` — SEO landing pages, each with its own `LocalBusiness` JSON-LD.
- `uploads/` holds every image referenced by the pages. New images go here and are served at `/uploads/<name>`.
- `sitemap.xml` + `robots.txt` are static. The sitemap lists every public page above — when adding/removing a page or meaningfully changing content, update it and bump `<lastmod>`.

### Worker (`src/index.js`)
- Routed to both `skocznarower.pl/*` and `www.skocznarower.pl/*`. Apex requests get a 301 to `www`. Removing either route in `wrangler.jsonc` breaks the redirect.
- `wrangler.jsonc` sets `assets.run_worker_first: true`, so the Worker sees every request first. `/api/*` and `/admin*` are handled in the Worker; everything else falls through to `env.ASSETS.fetch(request)`, which serves the `*.html` files by extensionless path (e.g. `/umow` → `umow.html`).
- **Sources of truth that mirror the UI** live as constants at the top of `src/index.js`:
  - `SERVICES` — service list and price labels. Must match the `<select>` in `umow.html`, the visible cennik in `index.html` (`.price-row` sekcja), **i** dodatkowe powierzchnie marketingowe: `serwis-rowerow-pruszkow.html` (Service+OfferCatalog JSON-LD + visible cennik list + FAQPage answer + visible FAQ), `serwis-rowerow-milanowek.html` (te same 4), `bleeding-hamulcow-shimano.html` (Offer + FAQPage), `llms-full.txt` (sekcje `## Pełna lista usług` i `## Cennik`). SMS templates w `src/index.js` (seasonal blast ok. linii 1058) też mogą cytować ceny/pakiety.
  - `BIKE_TYPES` — bike-type whitelist for the form.
  - `SCHEDULE` — opening-hours map keyed by day-of-week (0=Sun…6=Sat). Changes here change the available slots returned by `/api/availability`. Synchronizuj też `openingHoursSpecification` w LocalBusiness JSON-LD na `index.html` (Google Knowledge Panel) oraz sekcję godzin w `llms-full.txt`.
  Touching any of these means re-checking wszystkie powierzchnie powyżej. Nie dodawaj produktów (np. pakietów) do landingów/llms-full bez wpisu w `SERVICES`, bo klient nie zarezerwuje tego w formularzu.
- Admin auth: HMAC-signed session cookie (`SESSION_SECRET`, falling back to `ADMIN_PASSWORD`). The `/admin` page lists bookings, lets you set final price, mark done/cancel, and block slots/days in `blocked_slots`. A second tab **Współpraca** (anchor `#outreach`) is an outreach tracker over `outreach_contacts`: add/send/respond/close/reopen, status filter by channel (A brand / B distributor / C shop). Routes: `POST /admin/outreach` (action-based, redirects to `/admin#outreach`).
- `scheduled()` runs on the `0 8 * * *` cron (08:00 UTC ≈ 09:00–10:00 Warsaw depending on DST):
  - SMS reminder 24h before each `confirmed` booking (sets `reminder_sent_at`).
  - SMS asking for a Google review 3 days after each `done` booking (sets `feedback_sent_at`, uses `REVIEW_LINK` var).
  - Seasonal email blast on March 15 to everyone in `seasonal_reminders`.
  - Google reviews refresh: pulls up to 5 reviews from Google Places API (New) into `google_reviews` + `google_profile`. `/api/reviews` returns the cache as JSON, `index.html` loads it client-side and shows the `#opinie` section only if reviews exist. Manual refresh button on `/admin`.
  Sending providers: SMS via SMSAPI (`api.smsapi.pl/sms.do`, OAuth bearer token), email via Resend. Reviews via `places.googleapis.com/v1/places/{id}` with `X-Goog-Api-Key`. All three fail soft — without their secrets the Worker logs a dry-run and continues.

### D1 database
- Binding `DB` → `skocznarower-db` (id in `wrangler.jsonc`). Migrations in `migrations/` are applied in order via `npx wrangler d1 migrations apply`.
- Tables: `bookings` (with `status` ∈ pending/confirmed/done/cancelled, plus `final_price`, `reminder_sent_at`, `feedback_sent_at`), `blocked_slots` (PK `(date, time_slot)`; `time_slot='all'` blocks the whole day), `seasonal_reminders` (unique on `email`), `google_reviews` (PK `review_id` from Google Places, upserted), `google_profile` (single row `id='profile'` with current rating + total review count), `outreach_contacts` (brand_name, channel A/B/C, status planned/sent/responded/closed, optional `sent_at`/`response`/`notes`; seeded from `OUTREACH_PLAN.md` in migration 0006).
- New schema changes: add a numbered SQL file in `migrations/`, do not edit historical ones.

### JSON-LD blocks
Each public page has its own JSON-LD. On `index.html` there are two (`FAQPage`, `LocalBusiness`); the landing pages each carry their own `LocalBusiness`. Keep them in sync with the visible FAQ/contact/address/phone whenever those change.

### `.assetsignore` (what does NOT get uploaded as a static asset)
The Worker bundles the whole repo root as assets, so this file is what keeps junk out: large source media (`uploads/*.mp4`, `uploads/*.pdf`, `uploads/FastDL.to_*`), the Worker source (`src/`), migrations, dotfiles (`.wrangler/`, `.git/`, `.claude/`, `.playwright-mcp/`, `.DS_Store`), `node_modules/`, and the dev-only files (`CLAUDE.md`, `OUTREACH_PLAN.md`, `.assetsignore`, `.gitignore`, `.dev.vars*`). When adding new top-level files or directories, decide whether they belong in `.assetsignore`.

### Non-asset top-level directories
- `partners/` — `.doc`/`.docx` reference material for outreach (e.g. `velo ANKIETA.doc`). Not currently in `.assetsignore`; if you keep adding files there, add `partners/` to `.assetsignore` so the Worker stops shipping them as public assets.

## Common commands

```bash
# Local dev: serves the static files + runs the Worker (apex redirect won't trigger on localhost)
npx wrangler dev

# Deploy to Cloudflare (production)
npx wrangler deploy

# D1 migrations
npx wrangler d1 migrations apply skocznarower-db            # remote (production)
npx wrangler d1 migrations apply skocznarower-db --local    # local sqlite during `wrangler dev`

# Ad-hoc D1 query (replace SELECT with what you need)
npx wrangler d1 execute skocznarower-db --remote --command "SELECT date, time_slot, status FROM bookings ORDER BY date DESC LIMIT 20;"

# Production secrets (one-time setup; see .dev.vars.example for local equivalents)
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFY_EMAIL
npx wrangler secret put SMSAPI_TOKEN
npx wrangler secret put SMS_SENDER   # opcjonalne, domyślnie "Info"
npx wrangler secret put GOOGLE_PLACES_API_KEY   # Places API (New); restrict to Places API + your domain
npx wrangler secret put GOOGLE_PLACE_ID          # Google Business profile Place ID

# Verify the apex → www redirect after deploy
curl -sI https://skocznarower.pl/
```

Local dev needs a `.dev.vars` file (gitignored; copy from `.dev.vars.example`). Without `ADMIN_PASSWORD` you can't log into `/admin` locally; without `RESEND_API_KEY` and the SMS pair, notifications log to console instead of going out.

There is no build step, no test suite, no linter. Edits go live on the next `wrangler deploy`.

## Content conventions (load-bearing)

These come from explicit user preference, not house style — apply them to every text change:

1. **No em-dashes (—).** Use a comma, semicolon, colon, or rewrite. This includes JSON-LD answer strings, meta descriptions, visible copy, and any SMS/email text in `src/index.js`.
2. **Avoid "I-slope" narration.** No Polish sentences starting with "Ja" or leaning on first-person interjections as a stylistic device. Keep copy direct and second-person where possible.

Before committing any copy change (HTML or Worker strings), re-scan the diff for `—` characters.

## Deploy / infra notes

- Domain registered at OVH; DNS and proxy on Cloudflare.
- Worker routes bound to both `skocznarower.pl/*` and `www.skocznarower.pl/*`. Both must stay.
- `compatibility_flags: ["nodejs_compat"]` is set but currently unused; leave it unless you're trimming config.
- `observability.enabled: true` is on, so Worker logs (including the SMS/email dry-run output and cron errors) are visible in the Cloudflare dashboard.
