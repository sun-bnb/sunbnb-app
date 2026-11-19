import { describe, expect, it } from 'vitest'
import robots from '../app/robots.ts'
import sitemap from '../app/sitemap.ts'
import { CONTENT_PAGES, CONTENT_SECTIONS, SLUG_RE, contentPath } from './content-pages.ts'
import { resolveLocale } from './locale.ts'
import { SITE_URL } from './seo.ts'

describe('robots.txt (app/robots.ts)', () => {
  const r = robots()
  const rules = [r.rules].flat()

  it('blocks /api/ and /m/ only, and points at the sitemap', () => {
    expect(rules).toEqual([{ userAgent: '*', allow: '/', disallow: ['/api/', '/m/'] }])
    expect(r.sitemap).toBe('https://try.sunbnb.app/sitemap.xml')
  })

  it('leaves content pages and /_next/ assets crawlable', () => {
    const disallowed = rules.flatMap((rule) => [rule.disallow ?? []].flat())
    for (const path of ['/guias/', '/es/', '/_next/', '/']) {
      expect(disallowed.some((d) => path.startsWith(d))).toBe(false)
    }
  })
})

describe('sitemap.xml (app/sitemap.ts)', () => {
  const urls = sitemap().map((e) => e.url)

  it('lists the landing first, on the canonical host, with a lastModified on every entry', () => {
    expect(urls[0]).toBe(`${SITE_URL}/`)
    expect(urls.every((u) => u.startsWith(`${SITE_URL}/`))).toBe(true)
    expect(sitemap().every((e) => e.lastModified)).toBe(true)
  })

  it('lists every published content page and no unpublished one', () => {
    for (const p of CONTENT_PAGES) expect(urls.includes(`${SITE_URL}${contentPath(p)}`)).toBe(p.published)
    expect(urls).not.toContain(`${SITE_URL}/guias/ejemplo`)
  })

  it('never lists mockups, API routes or the privacy notice', () => {
    expect(urls.filter((u) => /\/(m|api)\/|\/privacy$/.test(u))).toEqual([])
  })
})

describe('content pages (lib/content-pages.ts)', () => {
  it('have unique, URL-safe slugs in a known section', () => {
    const paths = CONTENT_PAGES.map(contentPath)
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of CONTENT_PAGES) {
      expect(p.slug).toMatch(SLUG_RE)
      expect(CONTENT_SECTIONS).toContain(p.section)
      expect(p.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('keep titles and descriptions within search-result length', () => {
    for (const p of CONTENT_PAGES) {
      expect(p.title.length, p.slug).toBeLessThanOrEqual(60)
      expect(p.description.length, p.slug).toBeLessThanOrEqual(160)
    }
  })

  it('keep the placeholder unpublished', () => {
    expect(CONTENT_PAGES.find((p) => p.slug === 'ejemplo')?.published).toBe(false)
  })
})

describe('page language (lib/locale.ts)', () => {
  it('lets the route language win over cookie and browser', () => {
    expect(resolveLocale({ routeLocale: 'es', cookie: 'en', acceptLanguage: 'en' })).toBe('es')
  })

  it('keeps the landing order: cookie, then Accept-Language, then English', () => {
    expect(resolveLocale({ cookie: 'fi', acceptLanguage: 'es' })).toBe('fi')
    expect(resolveLocale({ cookie: 'xx', acceptLanguage: 'de;q=0.9, es;q=0.8' })).toBe('es')
    expect(resolveLocale({ acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8' })).toBe('es')
    expect(resolveLocale({ acceptLanguage: 'de' })).toBe('en')
    expect(resolveLocale({})).toBe('en')
  })

  it('ignores an unsupported route language', () => {
    expect(resolveLocale({ routeLocale: 'it', cookie: 'fi' })).toBe('fi')
  })
})
