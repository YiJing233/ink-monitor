/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Avoid prerender errors on dev with better-sqlite3
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('better-sqlite3');
    }
    return config;
  },
};

export default nextConfig;
