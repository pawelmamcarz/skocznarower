# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Marketing site + bookings app for **skocznarower.pl**, a bicycle service shop in Grodzisk Mazowiecki (PL). Content is Polish. Deployed as a single Cloudflare Worker with the static-assets binding; the Worker handles the apex → www redirect, the booking API, the `/admin` panel, and a daily cron for SMS/email reminders. Static HTML/images fall through to the assets binding.

## Architecture

### Pages (static HTML at the repo root)
- `index.html` — main marketing page. CSS and JS are inlined; do not split into separate files unless asked. Section anchors: `#o-mnie`, `#uslugi`, `#cennik`, `#faq`, `#kontakt`.
- `umow.html` — booking flow, served at `/umow`. Calls `GET /api/availability?date=` then `POST /api/bookings`.
- `index.html` also calls `GET /api/next-slot` to show a "najbliższy wolny termin" nudge pill in the hero (reuses `SCHEDULE`/booking/`blocked_slots`; scans ~21 days, skips today's past hours). The pill stays hidden on error or when nothing is free.
- `serwis-rowerow-pruszkow.html`, `serwis-rowerow-milanowek.html`, `bleeding-hamulcow-shimano.html` — SEO landing pages, each with its own JSON-LD. The two `serwis-rowerow-*` pages use a `LocalBusiness` root (plus `BreadcrumbList`, a nested `Service`/`OfferCatalog`, and `FAQPage`); `bleeding-hamulcow-shimano.html` instead uses a `Service` root that nests `LocalBusiness` as its provider (plus `Offer`, `BreadcrumbList`, `FAQPage`).
- `uploads/` holds every image referenced by the pages. New images go here and are served at `/uploads/<name>`.
- `sitemap.xml` + `robots.txt` are static. The sitemap lists every public page above — when adding/removing a page or meaningfully changing content, update it and bump `<lastmod>`.
- `llms.txt` + `llms-full.txt` are static AI/LLM index files served as-is. `llms.txt` is the short index (intro blurb with a service/price summary, e.g. bleeding od 100 zł, plus a linked list of the main pages) and points at `llms-full.txt`, the self-contained long-form copy (full service list, cennik, FAQ, contact). Keep both in sync when services, prices, hours, or pages change.

### Worker (`src/index.js`)
- Routed to both `skocznarower.pl/*` and `www.skocznarower.pl/*`. Apex requests get a 301 to `www`. Both routes must stay: drop `skocznarower.pl/*` and apex requests never reach the Worker (the 301 never fires); drop `www.skocznarower.pl/*` and `www` traffic stops being handled.
- `wrangler.jsonc` sets `assets.run_worker_first: true`, so the Worker sees every request first. `/api/*`, `/admin*`, and `/r` are handled in the Worker; everything else falls through to a plain `env.ASSETS.fetch(request)` passthrough. The extensionless resolution (e.g. `/umow` → `umow.html`) is done by the Cloudflare ASSETS binding itself, not by code in `src/index.js`, so do not go hunting for that routing logic in the Worker.
- **Sources of truth that mirror the UI** live as constants at the top of `src/index.js`:
  - `SERVICES` — service list and price labels (14 entries; this is the bookable-form whitelist). Gotcha: `umow.html` carries its **own** copy of `SERVICES` (and `BIKE_TYPES`) as JS arrays near the top of its `<script>`, rendered as a radio-group (`#services`, `renderChoices`), **not** a `<select>`. So editing `SERVICES` in `src/index.js` alone does **not** update the form; ids and prices must match across both, while `umow.html` deliberately uses shortened display labels (e.g. `Odbiór i odwóz roweru` vs `...(adres podaj w notatce)`, `Wymiana części` vs `...(klocki, linki, dętka...)`, `Inne (opisz niżej)` vs `Inne (opisz w notatce)`). Also keep in sync: the visible cennik in `index.html` (`.price-row` sekcja; a finer-grained breakdown of ~26 line items, so the `SERVICES` names appear inside it but the cennik adds sub-items), **i** dodatkowe powierzchnie marketingowe: `serwis-rowerow-pruszkow.html` (Service+OfferCatalog JSON-LD + visible cennik list + FAQPage answer + visible FAQ), `serwis-rowerow-milanowek.html` (te same 4), `bleeding-hamulcow-shimano.html` (Offer + FAQPage), `llms-full.txt` (sekcje `## Pełna lista usług` i `## Cennik`) oraz `llms.txt` (krótkie podsumowanie usług/cen w intro). Notification text in `src/index.js` (SMS reminder/review templates, the seasonal email blast in `sendSeasonalReminders`) currently does **not** quote prices, but if you add a price to any of them, keep it in sync here too.
  - `BIKE_TYPES` — bike-type whitelist for the form (also duplicated as its own array in `umow.html`, alongside that page's copy of `SERVICES`; see the gotcha above).
  - `SCHEDULE` — opening-hours map keyed by day-of-week (0=Sun…6=Sat). Changes here change the available slots returned by `/api/availability`. Synchronizuj też `openingHoursSpecification` w LocalBusiness JSON-LD na `index.html` (Google Knowledge Panel), sekcję godzin w `llms-full.txt` oraz listę slotów w `llms.txt`.
  Touching any of these means re-checking wszystkie powierzchnie powyżej. Nie dodawaj produktów (np. pakietów) do landingów/llms-full bez wpisu w `SERVICES`, bo klient nie zarezerwuje tego w formularzu.
- New-booking alerts: on each `POST /api/bookings` the owner gets an SMS (to `OWNER_PHONE`, fallback `600370810`) plus the owner email (`NOTIFY_EMAIL`); both fail soft. The booking stays `pending` until Mateusz confirms.
- Voice channel (`/api/voice/*`): server-to-server endpoints an external voice-AI platform calls as "tools" so an AI agent on the virtual phone number can take bookings. The whole namespace is gated by a shared secret `VOICE_API_SECRET` (constant-time compared via `timingSafeEqual`); if the secret is unset every route returns 401, so the channel is off by default and production behavior is unchanged. Routes: `GET /api/voice/availability?date=` (free slots only), `GET /api/voice/next-slot` (reuses `apiNextSlot`), `GET /api/voice/config` (returns `SERVICES`/`BIKE_TYPES`/`SCHEDULE` so the agent prompt stays in sync with the sources of truth), `POST /api/voice/bookings`. Booking creation goes through the shared `createBookingCore` (same validation, conflict checks, `idx_bookings_active_slot` race backstop, and owner SMS+email as the web form), so phone bookings land as `pending` and behave identically; the voice endpoint just adds a `[tel]` notes prefix and a TTS-friendly `confirmation` string. `OWNER_PHONE` (owner alert target) is unrelated to the public/virtual number and stays on the cell.
- Quick action from the SMS: the SMS carries a link `/r?id=<id>&t=<token>` where the token is a truncated (24-char) HMAC of the string `r:<id>` over the session secret (`bookingToken`). `GET /r` renders a small page (booking details + Potwierdź/Odrzuć buttons); the action runs only via `POST /r`, so SMS link scanners can't trigger it. Confirm/cancel reuse the shared `confirmBooking`/`cancelBooking` helpers (same path as `/admin`), so confirming via the link also creates the calendar event.
- Google Calendar: confirming a booking (via `/admin` `action=confirm` **or** the SMS quick-action `POST /r`, both call the shared `confirmBooking`) creates a Calendar event in the "pyszczka" calendar and stores its id in `bookings.gcal_event_id`; cancelling/deleting removes the event. Auth is a Google service account (JWT bearer, RS256 via Web Crypto) needing `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID` (calendar must be shared with the service-account address). Without these it logs a dry-run.
- Admin auth: login authenticates against `ADMIN_PASSWORD` only; the session cookie is HMAC-signed with `SESSION_SECRET` (falling back to `ADMIN_PASSWORD` if unset). `ADMIN_PASSWORD` is therefore required to log in, with only `SESSION_SECRET` set you cannot authenticate. The `/admin` page lists bookings, lets you set final price, mark done/cancel, and block slots/days in `blocked_slots`. A second tab **Współpraca** (anchor `#outreach`) is an outreach tracker over `outreach_contacts`: add/send/respond/close/reopen, with two independent filters, status (planned/sent/responded/closed) and channel (A = brand/dealer, B = dystrybutor/program serwisowy, C = sklep bez warsztatu). Routes: `POST /admin/outreach` (action-based, redirects to `/admin#outreach`).
- `scheduled()` runs on the `0 8 * * *` cron (08:00 UTC ≈ 09:00–10:00 Warsaw depending on DST):
  - SMS reminder 24h before each `confirmed` booking (sets `reminder_sent_at`).
  - SMS asking for a Google review 3 to 30 days after a `done` booking (selection is `date <= -3d AND date >= -30d AND feedback_sent_at IS NULL`; sets `feedback_sent_at`). The link comes from the `REVIEW_LINK` var (a `wrangler.jsonc` var, not a secret); the SMS falls back to the homepage if it is unset, while `/api/reviews` exposes `REVIEW_LINK` only when it is not the `CHANGE_TO_` placeholder.
  - Seasonal email blast on March 15 to everyone in `seasonal_reminders`.
  - Google reviews refresh: pulls up to 5 reviews from Google Places API (New) into `google_reviews` + `google_profile`. `/api/reviews` returns the cache as JSON (up to 6 rows, newest first), `index.html` loads it client-side and shows the `#opinie` section only if reviews exist. Manual refresh button on `/admin`.
  Sending providers: SMS via SMSAPI (`api.smsapi.pl/sms.do`, OAuth bearer token), email via Resend. Reviews via `places.googleapis.com/v1/places/{id}` with `X-Goog-Api-Key`. All three fail soft — without their secrets the Worker logs a dry-run and continues.

### D1 database
- Binding `DB` → `skocznarower-db` (id in `wrangler.jsonc`). Migrations in `migrations/` are applied in order via `npx wrangler d1 migrations apply`.
- Tables: `bookings` (with `status` ∈ pending/confirmed/done/cancelled, plus `final_price`, `reminder_sent_at`, `feedback_sent_at`, `gcal_event_id`), `blocked_slots` (PK `(date, time_slot)`; `time_slot='all'` blocks the whole day), `seasonal_reminders` (unique on `email`, plus `signed_up_at` and `sent_at` timestamps; the cron selects rows where `sent_at IS NULL` and stamps `sent_at` after sending), `google_reviews` (PK `review_id` from Google Places, upserted), `google_profile` (single row `id='profile'` with current rating + total review count), `outreach_contacts` (brand_name, channel A/B/C, status planned/sent/responded/closed, plus `contact_method`, optional `sent_at`/`response`/`notes`, and `created_at`/`updated_at`; seeded from `OUTREACH_PLAN.md` in migration 0006).
- New schema changes: add a numbered SQL file in `migrations/`, do not edit historical ones.

### JSON-LD blocks
Each public page has its own JSON-LD. On `index.html` there are two (`FAQPage`, `LocalBusiness`); the landing pages each carry their own `LocalBusiness`. Keep them in sync with the visible FAQ/contact/address/phone whenever those change.

### `.assetsignore` (what does NOT get uploaded as a static asset)
The Worker bundles the whole repo root as assets, so this file is what keeps junk out: large source media (`uploads/*.mp4`, `uploads/*.pdf`, `uploads/FastDL.to_*`), the Worker source (`src/`), migrations, dotfiles (`.wrangler/`, `.git/`, `.claude/`, `.playwright-mcp/`, `.DS_Store`), `node_modules/`, the `partners/` outreach docs, and the dev-only files (`CLAUDE.md`, `OUTREACH_PLAN.md`, `.assetsignore`, `.gitignore`, `.dev.vars*`). When adding new top-level files or directories, decide whether they belong in `.assetsignore`.

### Non-asset top-level directories
- `partners/` — `.doc`/`.docx` reference material for outreach (e.g. `velo ANKIETA.doc`). Already in `.assetsignore`, so the Worker does not ship it as a public asset; keep new outreach docs here rather than at the repo root.

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
npx wrangler secret put GOOGLE_SA_EMAIL          # Google Calendar service-account address
npx wrangler secret put GOOGLE_SA_PRIVATE_KEY    # service-account private key (RS256 JWT signing)
npx wrangler secret put GOOGLE_CALENDAR_ID       # "pyszczka" calendar id, shared with the SA address
npx wrangler secret put FROM_EMAIL               # opcjonalne, domyślnie rezerwacje@skocznarower.pl
npx wrangler secret put OWNER_PHONE              # opcjonalne, fallback 600370810 (SMS o nowej rezerwacji)
npx wrangler secret put VOICE_API_SECRET         # opcjonalne, chroni /api/voice/* (agent głosowy); bez niego trasy zwracają 401
# REVIEW_LINK to nie sekret, tylko var w `wrangler.jsonc` (Google review URL).

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
