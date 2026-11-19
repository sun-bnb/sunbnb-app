/**
 * Spanish content pages for beach operators (CR-003): /guias/<slug> (generic guides) and
 * /es/<slug> (local landings, e.g. a region). Adding a page = adding one entry to CONTENT_PAGES;
 * the routes, metadata, sitemap and static params all read this list.
 *
 * A typed module, not MDX: the pages are short structured prose (heading + paragraphs, like
 * lib/privacy-content.ts), the app has no MDX pipeline, and a typed entry lets tests check every
 * page's title/description length and slug. Text is supplied by the company side and reviewed by
 * a native speaker before `published: true`.
 */
import type { Locale } from './places.ts'

/** Every content route renders in this language, whatever the cookie or browser says. */
export const CONTENT_LOCALE: Locale = 'es'

export const CONTENT_SECTIONS = ['guias', 'es'] as const
export type ContentSection = (typeof CONTENT_SECTIONS)[number]

export interface ContentPage {
  section: ContentSection
  /** Lower-case ASCII words joined by hyphens. */
  slug: string
  /** <title> and og:title, about 55 characters. */
  title: string
  /** Meta and og description, about 150 characters. */
  description: string
  /** The page's single <h1>. */
  heading: string
  intro: string
  sections: { heading: string; paragraphs: string[] }[]
  /** ISO date of the last content change (sitemap lastModified). */
  updated: string
  /** false → served with noindex and left out of the sitemap (drafts, the placeholder). */
  published: boolean
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const CONTENT_PAGES: readonly ContentPage[] = [
  {
    // Placeholder that proves the mechanism; replace with real pages, never publish this one.
    section: 'guias',
    slug: 'ejemplo',
    title: 'Página de ejemplo para las guías de Sunbnb',
    description:
      'Página de prueba del sistema de guías de Sunbnb para playas y concesiones. El contenido real lo preparará el equipo de Sunbnb.',
    heading: 'Página de ejemplo',
    intro: 'Esta página solo comprueba que las guías se publican en español y en su propia dirección. No está indexada.',
    sections: [
      {
        heading: 'Para qué sirve',
        paragraphs: [
          'Cada guía es una entrada en un único archivo del repositorio: título, descripción, encabezado y apartados.',
          'Las guías se muestran siempre en español, con la cabecera y el pie de la web y un enlace a la página principal.',
        ],
      },
    ],
    updated: '2026-11-19',
    published: false,
  },
]

export function contentPath(page: Pick<ContentPage, 'section' | 'slug'>): string {
  return `/${page.section}/${page.slug}`
}

export function findContentPage(section: ContentSection, slug: string): ContentPage | null {
  return CONTENT_PAGES.find((p) => p.section === section && p.slug === slug) ?? null
}

export function contentSlugs(section: ContentSection): { slug: string }[] {
  return CONTENT_PAGES.filter((p) => p.section === section).map((p) => ({ slug: p.slug }))
}

export function publishedContentPages(): ContentPage[] {
  return CONTENT_PAGES.filter((p) => p.published)
}
