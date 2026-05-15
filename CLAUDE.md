# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-page marketing site for **skocznarower.pl**, a bicycle service shop in Grodzisk Mazowiecki (PL). Content is Polish. The site is deployed as a Cloudflare Worker with the static assets binding; the Worker itself only handles the apex → www 301 redirect.

## Architecture

- `index.html` (~2k lines) is the entire site. CSS and JS are inlined; do not split into separate files unless asked. Section anchors: `#o-mnie`, `#uslugi`, `#cennik`, `#faq`, `#kontakt`.
- `uploads/` holds every image referenced by `index.html` (logo, favicons, photos). New images go here and are served at `/uploads/<name>`. The `.mp4`/`.pdf`/`FastDL.to_*` exclusions in `.assetsignore` keep large source files in the repo without uploading them as assets.
- `src/index.js` is the Worker entrypoint. It redirects `skocznarower.pl` → `www.skocznarower.pl` and otherwise delegates to `env.ASSETS.fetch(request)`. Both hostnames are bound in `wrangler.jsonc`.
- `wrangler.jsonc` declares `"assets": { "directory": "." }`, so the repo root is the asset bundle. `.assetsignore` is what keeps junk out of the upload — large `.mp4`/`.pdf`/`FastDL.to_*` files, `src/`, `.git/`, `.claude/`, `.wrangler/`, `node_modules/`. When adding new top-level files or directories, decide whether they belong in `.assetsignore`.
- Two JSON-LD blocks at the top of `<head>` (`FAQPage`, `LocalBusiness`) must stay in sync with the visible FAQ and contact info. Update both whenever questions/answers, address, or phone change.
- `sitemap.xml` + `robots.txt` are static. Bump `<lastmod>` when content meaningfully changes.

## Common commands

```bash
# Local dev (serves index.html + runs the Worker)
npx wrangler dev

# Deploy to Cloudflare (production)
npx wrangler deploy

# Verify the apex → www redirect after deploy
curl -sI https://skocznarower.pl/
```

There is no build step, no test suite, no linter. Edits to `index.html` go live on the next `wrangler deploy`.

## Content conventions (load-bearing)

These come from explicit user preference, not house style — apply them to every text change:

1. **No em-dashes (—).** Use a comma, semicolon, colon, or rewrite. This includes JSON-LD answer strings, meta descriptions, and visible copy.
2. **Avoid "I-slope" narration.** No Polish sentences starting with "Ja" or leaning on first-person interjections as a stylistic device. Keep copy direct and second-person where possible.

Before committing any copy change, re-scan the diff for `—` characters.

## Deploy / infra notes

- Domain registered at OVH; DNS and proxy on Cloudflare.
- Worker routes bound to both `skocznarower.pl/*` and `www.skocznarower.pl/*`. Removing either route will break the redirect.
- `compatibility_flags: ["nodejs_compat"]` is set but the Worker doesn't currently need it — leave it unless you're trimming config.
