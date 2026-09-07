# Ergotrax website

Egypt's first specialised ergonomics company. Bilingual (English / Arabic, RTL), symptom-first, hash-routed single-page site. Built from the September 2026 content brief.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Deployable entry point (same build, with title and meta). Also carries the embedded account/dashboard app (see below). |
| `ErgoTrax Site.dc.html` | Source file. Edit this, then re-copy to `index.html`. |
| `support.js` | Runtime for the marketing site's reactive template. Must sit next to both HTML files. |
| `assets/` | Logos, event photos, downloadable resources (RULA, REBA, NMQ, etc.), founder photo. |
| `src/index.js` | Cloudflare Worker: serves the static site AND the `/api/*` accounts + content backend (D1). |
| `wrangler.toml` | Worker config — binds the `assets` directory (repo root) and the `ergotrax-accounts` D1 database. |
| `.assetsignore` | Keeps `src/`, config, and doc files out of the served static-asset bundle. |

## Deploy

Live on Cloudflare Workers (assets + Worker in one deployment), not GitHub Pages:

```
npx wrangler deploy
```

Requires `wrangler login` once (Cloudflare account with access to the `ergotrax-webite` Worker and `ergotrax-accounts` D1 database, id `2e530974-059b-436f-b96d-5116be84e911`). This repo is the source of truth — always edit here and redeploy, rather than editing live.

## Accounts & dashboard

The site has a database-backed accounts system (D1: `users`, `clients`, `reports`, `bookings`, `sessions`, `content_items`), reachable at `/api/*` and driven from `src/index.js`. There is no separate login/dashboard URL — click the account icon in the site header (or go to `#/account`) to sign in as staff or a client. Staff get a dashboard (tabs: Clients, Bookings, Reports, Accounts, Site content, My account) embedded directly in `index.html`, hidden behind auth and toggled via the `#/account` hash route so it never appears to a signed-out visitor. Passwords are PBKDF2-hashed, salted per user; staff create both staff and client accounts from the Accounts tab.

**The Site content tab is live-wired**: edits to `tracks`, `events`, `articles`, `programmes`, `certificates`, and `resources` in D1 (via `/api/content/<collection>`) are injected into `index.html`'s `TRACKS`/`EVENTS`/`ARTICLES`/`PROGRAMMES`/`CERTS`/`RESOURCES` consts **on every request** to `/` — see `injectLiveContent()` in `src/index.js`. This uses a bracket-depth scanner (`replaceConst`) to safely splice fresh JSON in place of the hardcoded literals; it's tested to round-trip byte-for-byte with the original data (see the test in the project's working notes) and returns `cache-control: no-store` so edits show immediately. `[assets] run_worker_first = ["/", "/index.html"]` in `wrangler.toml` is required for this — without it Cloudflare serves those two paths directly from the static asset CDN and never runs the Worker at all. Editing content in the dashboard is now the primary way to update the live site; editing this file's consts directly still works too (it's just the seed/fallback now) but the two can drift, so prefer the dashboard.

**Certificates** get their own dashboard panel (not just raw JSON): a manual add-one form, and bulk import from an Excel/CSV sheet. Recognised columns (case-insensitive, any order, only `code` and `name_en` required): `code, name_en, name_ar, workshop_en, workshop_ar, date, track, trainer, duration_en, duration_ar, email, whatsapp number`. `email`/`whatsapp` are stored for internal record-keeping only — `/api/verify-certificate` and the live-injected `CERTS` const both strip them before they ever reach the public page, and `GET /api/content/certificates` (list/read) is staff-only for the same reason (the only content collection restricted like this). `scripts/import-certs.js` does the same import from Node for large batches (`npm run import-certs -- <file.xlsx> <site-url> <staff-token>`).

**Reports are PDFs**, not text: staff upload a PDF per client from the Reports tab (stored in R2, see below); clients open/download it from their account view via an authenticated `/api/reports/file/:id` fetch (not a plain link, so the file isn't publicly guessable).

**File storage (R2)**: uploads (report PDFs, and any image/file attached from the content editor's "Upload & insert URL" button) go to an R2 bucket, `ergotrax-media`, bound as `env.MEDIA`. **R2 is not yet enabled on this Cloudflare account** — enable it once in the dashboard (R2 → accept terms), create the bucket (`npx wrangler r2 bucket create ergotrax-media` or via the dashboard), then uncomment the `[[r2_buckets]]` block in `wrangler.toml` and redeploy. Until then, `/api/upload` and `/media/*` will 500 — everything else works.

## Routes

`#/` · `#/ergonomics` · `#/tracks` · `#/tracks/worktrack|spacetrack|protrack` · `#/about` · `#/events` · `#/events/<slug>` · `#/insights` · `#/insights/<slug>` · `#/verify` · `#/contact`

## Content model

All content is plain data at the top of the logic block. Every string is `{ en: "...", ar: "..." }`.

- **A track** — append to `TRACKS`: `slug`, `name`, `audience`, `surface`/`border`/`ink`/`body`/`accent` (its own colour scheme), `headline`, `summary`, `problems[]`, `includes[[num,title,body]]`, `outputs[]`, `excludes[]`, `ctaTitle`. It appears on the home cards, the tracks page, its filter chip, the contact form dropdown, the footer and its own detail page.
- **A session** — append to `EVENTS` with `status: "upcoming" | "past"` and a `track` name.
- **An article** — append to `ARTICLES`; `body` is an array of `[heading, text]`.
- **A certificate programme** — append to `PROGRAMMES`; records live in `CERTS`, keyed by ID. Replace the lookup inside `doVerify()` when a real registry exists.

## Brief compliance

- Symptom-first home: pain, then the workspace cause, then the science, then the service.
- One primary CTA everywhere: send **ASSESS** on WhatsApp, 24 hour reply promise.
- No pricing, no client names, no testimonials, no case studies, no registration numbers.
- No invented statistics. The WHO figure is deliberately left out until verified.
- No posture silhouette graphics, no stock desk photography. Founder photo is a marked placeholder.
- No em dashes anywhere in the copy, in either language.
- SpaceTrack copy is Arabic-led; ProTrack keeps clinical terms (RULA, REBA, workstation) in English; WorkTrack is English-led. The toggle switches the whole site cleanly, never mixing scripts inside a block.

## Open placeholders

WhatsApp Business number (currently 01043225505), TikTok handle, founder photograph, domain email, WHO statistic, Arabic slogan approval, form backend.

## Brand

Navy `#1D3D5C` · teal `#3DB5A0` · dark teal `#1D9E75` · SpaceTrack green `#085041` (SpaceTrack surfaces only) · coral `#D85A30` (wrong states only) · off-white `#F7F7F5` · body gray `#3D3D3A`.

Raleway headlines, DM Sans body, IBM Plex Mono for all numbers, Cairo for Arabic. Slogan set in Raleway Light Italic teal. Layout is fluid (`clamp()`, `auto-fit` grids) with a mobile nav drawer below 1160px (the point where the full nav row stops fitting).

*Ergonomics that works.*
