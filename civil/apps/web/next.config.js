/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.CIVIL_NEXT_DIST_DIR || '.next',
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
}

module.exports = nextConfig
