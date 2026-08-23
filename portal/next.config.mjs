/** @type {import('next').NextConfig} */
const nextConfig = {
  // The portal reads the control plane on every request. Nothing it renders is
  // cacheable, and a stale checkpoint is worse than a slow one.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
