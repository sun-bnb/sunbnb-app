import type { MetadataRoute } from 'next'
import { robotsConfig } from '../lib/seo.ts'

export default function robots(): MetadataRoute.Robots {
  return robotsConfig()
}
