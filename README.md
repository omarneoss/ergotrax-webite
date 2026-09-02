# Ergotrax website

Egypt's first specialised ergonomics company. Bilingual (English / Arabic, RTL), symptom-first, hash-routed single-page site. Built from the September 2026 content brief.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Deployable entry point (same build, with title and meta). |
| `ErgoTrax Site.dc.html` | Source file. Edit this, then re-copy to `index.html`. |
| `support.js` | Runtime. Must sit next to both files. |
| `assets/` | Logo files (full colour for light surfaces, white for navy). |

## Deploy on GitHub Pages

Push the folder, then Settings, Pages, Deploy from a branch, `main`, `/ (root)`. No build step.

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
