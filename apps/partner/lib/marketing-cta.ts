export const DEFAULT_MARKETING_URL = 'https://try.sunbnb.app'

/** Cross-origin CTA to the marketing app (track 027 D4). Tagged for attribution. */
export function marketingCtaUrl(base?: string): string {
  const root = (base || DEFAULT_MARKETING_URL).replace(/\/+$/, '')
  return `${root}/?utm_source=partner-landing&utm_medium=referral&utm_campaign=landing-hero`
}
