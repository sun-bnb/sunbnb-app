/**
 * Technical SEO for try.sunbnb.app (CR-003): the one canonical origin, robots rules and the
 * sitemap entries. Pure data, so `app/robots.ts` and `app/sitemap.ts` stay one-liners and the
 * output is unit-tested (lib/seo.test.ts).
 */
import type { MetadataRoute } from 'next'
import { contentPath, publishedContentPages } from './content-pages.ts'

/** The canonical host. Every canonical, og:url and sitemap URL is built on it, whatever host served the request. */
export const SITE_URL = 'https://try.sunbnb.app'

/**
 * When the landing's indexable content last changed (sitemap `lastModified`). Bump it with a
 * landing copy change; a build timestamp would claim a change on every deploy.
 */
export const LANDING_UPDATED = '2026-11-19'

/** `/api/` is machinery, `/m/<token>` is a prospect's private mockup. `/_next/` assets stay crawlable. */
export function robotsConfig(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/m/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}

/**
 * The landing and every published content page. Not listed: `/m/*` and `/api/*` (blocked),
 * unpublished content pages (noindex placeholders), and `/privacy` (a legal notice, indexable but
 * with no search value worth asking a crawler to prioritise).
 */
export function sitemapEntries(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: LANDING_UPDATED, changeFrequency: 'monthly', priority: 1 },
    ...publishedContentPages().map((p) => ({
      url: `${SITE_URL}${contentPath(p)}`,
      lastModified: p.updated,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]
}

/** OpenGraph locale tag per page language. */
export const OG_LOCALE = { en: 'en_GB', es: 'es_ES', fi: 'fi_FI' } as const

/**
 * The shared share image (app/opengraph-image.tsx). The file convention only reaches the landing's
 * own segment: any other page that sets `openGraph` must list it, or it ships without og:image.
 */
export const OG_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: 'Sunbnb' }
