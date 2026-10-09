'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { trackAnalytics } from '@/lib/track.ts'

/** Core Web Vitals to GA4 / PostHog (after consent only — before it, neither exists). */
export default function WebVitals() {
  useReportWebVitals((m) => {
    // CLS is a unitless fraction; ×1000 keeps it an integer like the millisecond metrics.
    trackAnalytics('web_vital', { metric: m.name, value: Math.round(m.name === 'CLS' ? m.value * 1000 : m.value), rating: m.rating })
  })
  return null
}
