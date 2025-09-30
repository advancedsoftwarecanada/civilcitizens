/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@civil/ui', '@civil/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
