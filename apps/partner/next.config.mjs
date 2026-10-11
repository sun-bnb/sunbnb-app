import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @repo/agent ships TypeScript source (track 030).
  transpilePackages: ['@repo/agent'],
  // The `run_js` sandbox (G4) uses QuickJS's single-file build: the WASM is embedded in its JS, so
  // there is no asset to trace; it stays external so the 3 MB module is required once from
  // node_modules instead of being parsed through the bundler.
  serverExternalPackages: ['quickjs-emscripten-core', '@jitl/quickjs-singlefile-cjs-release-sync'],
  // The assistant's how-to markdown is read from disk at runtime; trace it into the function bundle.
  outputFileTracingIncludes: {
    '/api/assistant': [
      './lib/assistant/knowledge/**',
    ],
  },
  // Dev is served over mkcert HTTPS on this host (server.js); Next 16 blocks
  // cross-origin /_next/* dev requests unless the origin is listed.
  allowedDevOrigins: ['local.sunbnb.app'],
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
    NEXT_PUBLIC_APP_ENV: process.env.VERCEL_ENV || 'development'
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ]
  },
};

export default withNextIntl(nextConfig)
