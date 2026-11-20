---
id: CR-003
title: Make try.sunbnb.app crawlable and able to host Spanish content pages
status: done
priority: 3
company_ref: A-15 (approved prompt), A-29 (build approval), A-32 (read access), T-102, T-81, T-63
created: 2026-11-19
track:
outcome: Done on co/CR-003-try-sunbnb-seo (committed only, nothing pushed). robots.txt, sitemap.xml, canonicals, noindex on /m/<token> (meta + X-Robots-Tag), Spanish-by-URL content routes /guias/<slug> and /es/<slug> from one typed registry (lib/content-pages.ts) with the noindex placeholder /guias/ejemplo, shared 1200x630 og:image + Twitter card, /privacy title, JSON-LD Organization + SoftwareApplication. Answers to the open questions are below.
---

# CR-003: try.sunbnb.app technical SEO

The approved prompt (share A-15) is copied verbatim under **Prompt** at the end. The engineer's findings come first.

## Re-verification (run 1, against `app/main` @ ece5f0c6)

Every "current behaviour" claim held: no robots/sitemap, cookie → Accept-Language → `en` locale, no
canonical/hreflang/og:image/Twitter card, `/privacy` without its own metadata, `/m/[token]` public and
indexable, no content routes. **`?lang=` does nothing**: no code reads it and there is no language
switcher; the comment in `i18n/request.ts` was wrong and is replaced.

## What was built

| File | What |
|---|---|
| `app/robots.ts`, `app/sitemap.ts`, `lib/seo.ts` | Allow `/`, disallow `/api/` and `/m/`, sitemap line; sitemap = landing + published content pages, `lastModified` from data (`LANDING_UPDATED`, each page's `updated`) |
| `app/page.tsx` | Canonical + og:url to the origin, JSON-LD (no invented facts: name, url, logo, category, `Web`, the Meta description). `?a=` angles unchanged |
| `app/m/[token]/page.tsx`, `next.config.mjs` | `robots: noindex, nofollow` via `generateMetadata`; `X-Robots-Tag: noindex, nofollow` on `/m/:path*` |
| `lib/content-pages.ts` | The content registry: one entry per page (section, slug, title, description, h1, intro, sections, updated, published) |
| `app/guias/[slug]/page.tsx`, `app/es/[slug]/page.tsx`, `components/ContentPage.tsx` | The two routes; header + footer, no map, one `<h1>`, CTA block linking to `/`; unknown slugs 404 (`dynamicParams = false`) |
| `proxy.ts`, `lib/locale.ts`, `i18n/request.ts` | Route language: the proxy stamps `x-sunbnb-route-locale: es` on `/guias/*` and `/es/*`; it wins over cookie and Accept-Language, so `<html lang="es">` and Spanish messages. Landing order unchanged |
| `app/opengraph-image.tsx`, `app/layout.tsx` | Shared 1200x630 PNG (logo + wordmark on sand), `metadataBase`, og locale/type, `twitter: summary_large_image` |
| `app/privacy/page.tsx` | Own title (`Privacy notice · Sunbnb` / localized), canonical, og |
| `messages/{en,es,fi}.json` | `Content.ctaTitle/ctaBody/ctaButton` (CTA reuses the landing's Meta wording; only `es` renders today) |
| `lib/seo.test.ts` | robots and sitemap output, registry invariants (slugs, title ≤ 60, description ≤ 160, placeholder unpublished), locale order |

**Why a typed TS module, not MDX:** the pages are short structured prose like `lib/privacy-content.ts`, the app
has no MDX pipeline (it would add `@next/mdx` and config), and typed entries let a test enforce title and
description length and slug shape on every page. Adding a page = adding one entry; set `published: true` once
the native-speaker review is done, and it enters the sitemap and loses `noindex`.

**Deviations, small:** the CTA links to `/` (relative) rather than the absolute `https://try.sunbnb.app/`; it is
the same URL in production and keeps previews on their own host. Next renders the root canonical as
`https://try.sunbnb.app` (it drops the trailing slash of a bare origin); search engines treat both as the same URL.
No hreflang: the landing is one URL whose language follows the visitor, so there is no per-language URL to point at.

**Rendering:** the root layout reads cookies/headers for the locale, so the whole site, content pages included,
is server-rendered per request (as the landing already was), not prerendered. The HTML a crawler gets is
complete; making content pages fully static would need a separate root layout per route group (moving the
landing, `/privacy` and `/m` into a group). Not done; worth it only if TTFB on the guides matters.

## Verification (local production build, `next build && next start`)

- `robots.txt`: `Allow: /`, `Disallow: /api/`, `Disallow: /m/`, `Sitemap: https://try.sunbnb.app/sitemap.xml`; nothing on `/guias/`, `/es/`, `/_next/`.
- `sitemap.xml`: valid urlset with only `https://try.sunbnb.app/` (lastmod 2026-11-19). Placeholder absent, no `/m/`, `/api/`, `/privacy`.
- `/?a=online&utm_source=meta`: `<link rel="canonical" href="https://try.sunbnb.app"/>`, og:image, twitter card, JSON-LD.
- `/m/<valid token>`: 200, `X-Robots-Tag: noindex, nofollow`, `<meta name="robots" content="noindex, nofollow"/>`. Invalid token: 404.
- `/guias/ejemplo` with `Accept-Language: en` and with `NEXT_LOCALE=en`: `<html lang="es">`, Spanish title, canonical to itself, og:locale `es_ES`, og:image, one `<h1>`, `noindex, nofollow`. Unknown slugs on both prefixes: 404.
- Landing: cookie `es` → `lang="es"`, `Accept-Language: fi` → `lang="fi"`, nothing → `en`; `?a=online` with cookie `es` shows the Spanish angle headline.
- `/privacy`: own title and canonical. `/opengraph-image`: 1200x630 PNG.
- `npm run typecheck` clean; `npm run lint` 0 errors (31 pre-existing warnings, none in the new files); `npm run test` 29 files / 284 tests pass.

## Answers to the open questions

- **Does `?lang=` switch language?** No. Nothing reads it. Not built (the prompt says not to invent one). Ads
  that must show Spanish can point at a Spanish content page (`/es/<slug>`), which is Spanish by URL; a
  `?lang=` that sets the cookie would be a separate decision.
- **Are Vercel previews indexable?** Not checkable from the engineer sandbox (no Vercel access). My
  understanding is that Vercel sends `X-Robots-Tag: noindex` on preview deployments that are not served from a
  production domain; confirm with `curl -sI <preview-url>`. robots.txt was deliberately not made
  environment-dependent so the acceptance checks pass on a preview. Every canonical points at
  `https://try.sunbnb.app` whatever host serves the page, so even an indexed preview would consolidate to it.
- **Other hosts (`www`, `*.vercel.app`)?** Not checkable here (DNS and Vercel domain settings). The repo has no
  host redirect for this app. Recommendation: in Vercel domains, redirect any extra host to `try.sunbnb.app`
  (308); canonicals already name it.
- **`/guias/` + `/es/` prefix convention?** The app has no prefix convention (all apps use cookie locale, no
  URL prefixes), so nothing conflicts. Built as proposed; adding another section is one line in
  `CONTENT_SECTIONS` + a route file + the proxy matcher.
- **`/privacy` in the sitemap?** Left out: indexable (own title and canonical), but a legal notice is not
  something to ask a crawler to prioritise.

## User-facing copy to read before release

- `messages/{en,es,fi}.json` `Content.*` — the CTA on content pages (es: "Mira tu playa en Sunbnb" / Meta
  description / "Prueba Sunbnb").
- The placeholder text of `/guias/ejemplo` in `lib/content-pages.ts` (noindex, not in sitemap).
- `/privacy` title now reads "<Privacy title> · Sunbnb".

## Prompt (A-15, verbatim)

## Task: make try.sunbnb.app indexable, and give it somewhere to publish Spanish pages

**App:** `apps/marketing` (try.sunbnb.app). Company-side refs: initiative 001 (web campaign), SEO plan T-63, request T-81.

### Why
We plan nine Spanish pages for beach operators (how to take online sunbed bookings, QR booking without an account, beach concessions in Palma and the Balearics, a Costa del Sol page, and so on). The aim is not mass traffic. Operators in Spain barely search for this, so these pages are mainly something credible to link from outreach emails, Instagram messages and ads, so that an operator who googles Sunbnb finds substance. They also need to be indexed by Google early: we want 4–5 pages live by **15 January 2027**, and the routes need to be in place by about **mid-December 2026** so the copy can be reviewed in place. Today the site cannot host or index them. Operators choose their tools in March–April 2027.

### Current behaviour (read from the repo on 2026-11-18, commit 55bb6369; re-verify before editing)
- **No robots.txt, no sitemap.** `apps/marketing/app/` contains `actions.ts`, `api/`, `fonts/`, `globals.css`, `layout.tsx`, `m/`, `page.tsx`, `privacy/`. `public/` holds only `logo.ico` and `sunbnb-logo.svg`. No `robots.*` or `sitemap.*` file exists.
- **Locale is a cookie, not a URL.** `apps/marketing/i18n/request.ts` picks the locale from the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en`. Supported locales: `en`, `es`, `fi` (`lib/places.ts`). A crawler sends no language preference, so `/` is indexed in English only, and the Spanish title and description in `messages/es.json` (`Meta`) can never be indexed. The comment in `i18n/request.ts` says ad links can force a locale with `?lang=`; I found no code in `app/` or `components/` that reads a `lang` query parameter (only the cookie is read), so check whether that actually works.
- **No canonical or hreflang.** `app/layout.tsx` `generateMetadata` sets only title, description, icon and OpenGraph title/description/url (hard-coded `https://try.sunbnb.app`), all from one `Meta` namespace. No `alternates`, no `og:image`, no Twitter card. Ad URLs carry `?a=<angle>` (read in `app/page.tsx` via `parseAngle`) and UTM parameters, so every ad URL is a duplicate of `/`.
- **No content routes.** There is no blog, guides section or per-segment page. `app/privacy/page.tsx` has no metadata of its own, so it shares the landing's title.
- **Mockup pages are public and indexable.** `app/m/[token]/page.tsx` is `force-dynamic`, public to anyone holding the link, and sets no `robots` metadata. It shows a prospect's beach and layout. Per the file comment no contact data is selected.
- **Fine already, leave alone:** security headers in `next.config.mjs`; consent-gated tracking.

### The change
1. **`app/robots.ts`.** Allow `/`; disallow `/api/` and `/m/`; point to the sitemap at `https://try.sunbnb.app/sitemap.xml`. Don't block `/_next/` assets.
2. **`app/sitemap.ts`.** List the landing and every content page (item 5), with `lastModified`. Don't list `/m/*`, `/api/*` or `/privacy` unless you think it should be there (say so in your report).
3. **Canonical on the landing.** Add `alternates.canonical` to the landing's metadata so `/?a=...&utm_...` all point to `https://try.sunbnb.app/`. Keep the `?a=` ad-scent behaviour unchanged.
4. **`noindex` on `/m/[token]`.** Add `robots: { index: false, follow: false }` via `generateMetadata` on that page, and also send an `X-Robots-Tag: noindex` header for `/m/:path*` in `next.config.mjs`.
5. **Content routes with Spanish at the URL.** Add statically rendered, server-rendered pages under a prefix, proposed `/guias/<slug>` (generic guides) and `/es/<slug>` (local landings, e.g. Costa del Sol, Baleares). Slug list is for the founder to confirm (see open questions); build the mechanism so adding a page means adding one file or one entry, with nothing else to wire up. Requirements:
   - The page language is fixed by the route (Spanish), regardless of the `NEXT_LOCALE` cookie and `Accept-Language`, and `<html lang="es">` is set. Don't redirect crawlers by language.
   - Each page has its own `generateMetadata`: title (≈55 characters), description (≈150), canonical to itself, OpenGraph with `locale: es_ES`.
   - One `<h1>` per page; the layout is the existing site header and footer, without the Google Maps `Experience` (these pages must be light).
   - One call-to-action block linking to the landing (`https://try.sunbnb.app/`), reusing existing components where possible.
   - The page body comes from a simple content source (MDX or a typed TS/JSON module in the repo). Choose what fits the repo and say why. The company side will supply the Spanish text per page, reviewed by a native speaker; for this task add **one placeholder page** at `/guias/ejemplo` marked `noindex` and left out of the sitemap, to prove the mechanism.
6. **Share image and default metadata.** One shared `og:image` (reuse the Sunbnb logo or a simple 1200×630 image) and a Twitter card, as defaults in `app/layout.tsx`. Give `/privacy` its own title.
7. **Optional, last:** JSON-LD `Organization` and `SoftwareApplication` on the landing. Skip if it needs invented facts (no ratings, prices or customer counts). Do it only if it is small.

### Acceptance criteria and how to test
Run against a preview deployment or local build (`npm run build && npm run start` in `apps/marketing`).
- `curl -s https://<host>/robots.txt` returns `Disallow: /api/`, `Disallow: /m/` and a `Sitemap:` line; it does not disallow `/guias/` or `/es/`.
- `curl -s https://<host>/sitemap.xml` is valid XML and lists the landing and every published content page, and no `/m/` or `/api/` URL. The placeholder page is absent.
- `curl -s "https://<host>/?a=online&utm_source=meta" | grep -i canonical` shows `https://try.sunbnb.app/` (no parameters).
- `curl -sI https://<host>/m/<a valid token>` shows `X-Robots-Tag: noindex`, and the HTML has `<meta name="robots" content="noindex, nofollow">`. An invalid token still returns 404.
- `curl -s -H "Accept-Language: en" https://<host>/guias/ejemplo` returns Spanish content, `<html lang="es">` and its own `<title>`; same with a `NEXT_LOCALE=en` cookie.
- The landing at `/` still behaves as before for each locale (cookie first, then `Accept-Language`, then English) and for `?a=` angles.
- Page source of a content page has one `<h1>`, a canonical to itself and `og:` tags with `og:image`.
- `cd apps/marketing && npm run typecheck && npm run lint && npm run test` pass; add tests for `robots.ts` and `sitemap.ts` output.
- Founder checks after deploy (not for you): Google Search Console URL Inspection on `/` and on one content page shows "URL is on Google" or "can be indexed", with the Spanish title for the content page.

### Out of scope
Landing copy changes (device slide, invoice slide, payments wording are tracked separately), writing the real Spanish page content, adding Italian or Finnish pages, pricing pages, analytics changes, hosting a separate blog, changes to the lead agent or the mockup logic. Don't set up Search Console or DNS (the founder does that).

### Open questions (answer in your report, or stop and ask)
- Does `?lang=` really switch language today? If not, should ad links force Spanish another way? Don't invent a mechanism here; report it.
- Are Vercel preview deployments for `apps/marketing` publicly reachable and indexable? If so, say how to noindex them.
- Do other hosts (`www`, a Vercel default domain) answer for this app? Report, so we can pick one canonical host.
- Is `/guias/` + `/es/` the right prefix convention, or does the app have a convention already?
- Is `/privacy` better left out of the sitemap? State your choice.

### Report back
What you changed (file list), the curl outputs for each acceptance check, the answers to the open questions, and anything in the code that contradicts this prompt.
