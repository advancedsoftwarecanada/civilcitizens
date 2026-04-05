function normalizeHost(value) {
  const raw = (value || '').trim()
  if (!raw) return null

  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
}

function collectAllowedDevHosts() {
  const configuredHosts = [
    'dev.civilcitizens.ca',
    'civilrides.ca',
    'localhost',
    '127.0.0.1',
    process.env.CIVIL_PUBLIC_HOST,
    process.env.NEXT_PUBLIC_BASE_URL,
    ...(process.env.CIVIL_ALLOWED_DEV_ORIGINS || '').split(','),
  ]

  return [...new Set(configuredHosts.map(normalizeHost).filter(Boolean))]
}

const allowedDevHosts = collectAllowedDevHosts()
const mediaRemotePatterns = allowedDevHosts
  .filter((hostname) => hostname !== 'localhost' && hostname !== '127.0.0.1')
  .map((hostname) => ({
    protocol: 'https',
    hostname,
    pathname: '/media/**',
  }))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.CIVIL_NEXT_DIST_DIR || '.next',
  allowedDevOrigins: allowedDevHosts,
  transpilePackages: ['@civil/ui', '@civil/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: mediaRemotePatterns,
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
