/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.CIVIL_NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['dev.civilcitizens.ca'],
  transpilePackages: ['@civil/ui', '@civil/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'dev.civilcitizens.ca',
        pathname: '/media/**',
      },
    ],
  },
  webpack: (config) => {
    config.resolve = config.resolve || {}
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    return config
  },

  async rewrites() {
    // Local dev convenience:
    // When `NEXT_PUBLIC_API_BASE` is `/api`, client + SSR fetches hit the web origin.
    // If the web server is running directly on localhost (not behind nginx), proxy to the API dev port.
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || '/api'
    const normalized = apiBase.replace(/\/+$/, '')
    if (normalized !== '/api') return []

    const apiPort = process.env.CIVIL_API_PORT || '3012'
    return [
      {
        source: '/api/:path*',
        destination: `http://127.0.0.1:${apiPort}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
