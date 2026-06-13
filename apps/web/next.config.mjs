/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Import the workspace package directly from source (it ships .ts).
  transpilePackages: ["@trellis/shared"],
  eslint: {
    // The design surface is the deliverable; lint is run via the workspace task.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
