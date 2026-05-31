import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '9vo2eopfbefycklx.public.blob.vercel-storage.com',
        port: ''
      },
    ],
  },
  env: {
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
    NEXT_PUBLIC_APP_ENV: process.env.VERCEL_ENV || 'development',
    NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY,
  },
  async headers() {
    const baseSecurity = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
    ]
    return [
      // The embeddable booking widget must be framable on any venue's site, so
      // it opts out of the global X-Frame-Options: DENY and allows all framing
      // ancestors via CSP (the modern, multi-origin-capable replacement).
      {
        source: '/embed/:path*',
        headers: [
          ...baseSecurity,
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
      // Everything except /embed keeps the strict no-framing posture.
      {
        source: '/((?!embed).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          ...baseSecurity,
        ],
      },
    ]
  },
};

// Picked up by Vercel's per-app path filter on redeploy.
export default withNextIntl(nextConfig)
