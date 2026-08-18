# Repository Guidelines

This is the short operational file for coding agents (Grok, Claude Code, Codex). Architecture, duplicated sources of truth, and gotchas live in `CLAUDE.md`. Read that file before changing content, prices, hours, phone numbers, JSON-LD, `llms*.txt`, or `sitemap.xml`.

## Project Structure

No-build static site + bookings app, deployed as one Cloudflare Worker. Polish pages live at the repo root; `en/` and `ua/` are same-filename translated mirrors (27 public sitemap URLs).

| Path | Role |
|---|---|
| `index.html`, `umow.html`, `warsztaty.html` | Homepage, booking flow, workshop interest form |
| `serwis-rowerow-pruszkow.html`, `serwis-rowerow-milanowek.html`, `bleeding-hamulcow-shimano.html` | Local / service SEO landings |
| `pumptrack-grodzisk-mazowiecki.html` | Pumptrack guide (`Article` JSON-LD) |
| `centrowanie-i-zaplatanie-kol.html` | Wheel trueing / building landing |
| `serwis-rowerow-elektrycznych.html` | E-bike landing: **mechanical only** |
| `src/index.js` | `/api/*`, `/admin*`, `/r`, `/warsztaty/potwierdz`, cron, static fallback |
| `migrations/` | Ordered D1 schema (`NNNN_description.sql`); never edit an applied file |
| `uploads/` | Public media (`/uploads/<name>`) |
| `turnstile.js` | Shared public Turnstile helper (the one allowed extra JS file) |
| `wrangler.jsonc`, `_headers`, `.assetsignore` | Deploy, cache, and what must not be published |

## Commands

- `cp .dev.vars.example .dev.vars`: ignored local config (required for `/admin` login).
- `npm run dev` or `npx wrangler dev`: static files + Worker locally.
- `npm run d1:migrate:local`: apply D1 migrations to local sqlite.
- `npm test`: Vitest Worker/D1 suite (38 tests, Node 22, `npm ci`). Same command as GitHub Actions.
- `npm run deploy`: **only** sanctioned production deploy, and only when explicitly authorized. Applies pending D1 migrations, deploys, then smoke-tests the API.
- Never run a bare `npx wrangler deploy`. Shipping code ahead of its migration broke every public POST for eight days on 2026-07-27. A `PreToolUse` hook (`scripts/pre-deploy-d1-check.sh`) denies that command while production migrations are pending. Wired in `.claude/settings.json` (Claude Code and Grok, via Claude compatibility) and `.codex/hooks.json` (Codex). Grok project hooks stay silent until the folder is trusted (`/hooks-trust`). Self-test: `echo d1-hook-selftest`.
- `curl -sI https://skocznarower.pl/`: verify the apex → `www` redirect after deploy.

There is no build step or linter.

## Coding Style

Two-space indentation, single-quoted JavaScript strings, semicolons. Functions `camelCase`, constants `UPPER_SNAKE_CASE`, CSS classes and page files kebab-case. Keep each page's CSS and JavaScript inline unless the change explicitly calls for restructuring; `turnstile.js` is the existing exception.

Mirror every Polish page change in `en/` and `ua/`. Form `value`s and ids posted to the APIs stay Polish; only labels are translated. Internal links stay inside the language prefix.

## Content Conventions

- No em dashes (`—`). Use a comma, semicolon, colon, or rewrite.
- Avoid first-person "I-slope" narration (no Polish sentences starting with "Ja").
- Never advertise suspension service (forks, dampers, sag, RockShox, Fox, …). "Full suspension" may appear only as a bike type the shop accepts.
- E-bike copy is mechanical only: brakes, drivetrain, wheels, inspection. Never offer battery, controller, motor, or electrical diagnostics.

## Testing

Use `npx wrangler dev` for manual smoke tests. Exercise every changed page and route, including success, validation, and failure paths; use local D1 for mutations. Check relevant responsive layouts and all three language versions. Record these checks in the commit body or pull request.

## Commits and PRs

Short Polish subjects with an optional area prefix, for example `Warsztaty: popraw formularz` or `i18n: dodaj mirror strony`. Keep each commit focused. PRs should summarize affected pages or Worker routes, explain schema or configuration effects, list validation performed, link an issue when one exists, and include before/after screenshots for visual changes.

## Security and Deploy

Never commit `.dev.vars` or credentials; use Wrangler secrets in production. Because Wrangler publishes the repository root, add any new private or development-only path to `.assetsignore` (including `.grok/` if you add project Grok files).
