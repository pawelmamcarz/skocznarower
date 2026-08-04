# Repository Guidelines

## Project Structure & Module Organization

This is a no-build static site and booking application deployed as one Cloudflare Worker. Polish pages live as root-level HTML files; `en/` and `ua/` contain same-name translated mirrors. `src/index.js` implements `/api/*`, `/admin*`, scheduled jobs, and static-asset fallback. Ordered D1 schema changes live in `migrations/`. Public media belongs in `uploads/`; deployment behavior is configured by `wrangler.jsonc`, `_headers`, and `.assetsignore`. Read `CLAUDE.md` before changing content or shared business data because it documents all duplicated sources of truth.

## Build, Test, and Development Commands

- `cp .dev.vars.example .dev.vars`: create ignored local configuration.
- `npx wrangler dev`: serve the static files and Worker locally.
- `npx wrangler d1 migrations apply skocznarower-db --local`: update the local D1 database.
- `npm run deploy`: the only sanctioned production deploy; run only when explicitly authorized. It applies pending D1 migrations, then deploys, then smoke-tests the API. Never run a bare `npx wrangler deploy`: shipping code ahead of its migration broke every public POST for eight days on 2026-07-27, and a `PreToolUse` hook (`scripts/pre-deploy-d1-check.sh`, wired in `.codex/hooks.json`) now denies that command while migrations are pending.
- `curl -sI https://skocznarower.pl/`: verify the production apex-to-`www` redirect after deployment.

There is no build step or linter. `npm test` runs the Vitest Worker/D1 integration suite.

## Coding Style & Naming Conventions

Use two-space indentation, single-quoted JavaScript strings, and semicolons. Name functions in `camelCase`, constants in `UPPER_SNAKE_CASE`, CSS classes and page files in kebab-case, and migrations as `NNNN_description.sql`. Never edit an applied migration. Keep each page's CSS and JavaScript inline unless a change explicitly calls for restructuring.

Mirror every Polish page change in `en/` and `ua/`, preserving Polish API form values. Keep services, prices, hours, phone numbers, JSON-LD, `llms*.txt`, and `sitemap.xml` synchronized as described in `CLAUDE.md`. Customer-facing copy must avoid em dashes and must never advertise suspension service.

## Testing Guidelines

Use `npx wrangler dev` for manual smoke tests. Exercise every changed page and route, including success, validation, and failure paths; use local D1 for mutations. Check relevant responsive layouts and all three language versions. Record these checks in the commit body or pull request.

## Commit & Pull Request Guidelines

History favors short Polish subjects with an optional area prefix, for example `Warsztaty: popraw formularz` or `i18n: dodaj mirror strony`. Keep each commit focused. Pull requests should summarize affected pages or Worker routes, explain schema or configuration effects, list validation performed, link an issue when one exists, and include before/after screenshots for visual changes.

## Security & Deployment

Never commit `.dev.vars` or credentials; use Wrangler secrets in production. Because Wrangler publishes the repository root, add any new private or development-only path to `.assetsignore`.
