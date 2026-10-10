/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/data'],
  // Dev is served over mkcert HTTPS on this host (server.js); Next 16 blocks
  // cross-origin /_next/* dev requests unless the origin is listed.
  allowedDevOrigins: ['local.sunbnb.app'],
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
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

// Picked up by Vercel's per-app path filter on redeploy.
export default nextConfig;
