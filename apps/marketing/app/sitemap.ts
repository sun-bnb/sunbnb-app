import type { MetadataRoute } from 'next'
import { sitemapEntries } from '../lib/seo.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries()
}
