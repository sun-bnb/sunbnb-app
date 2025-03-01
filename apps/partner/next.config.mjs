import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '9vo2eopfbefycklx.public.blob.vercel-storage.com',
        port: ''
      },
    ],
  }
};

export default withNextIntl(nextConfig)
