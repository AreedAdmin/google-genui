/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Import the workspace package directly from source (it ships .ts).
  transpilePackages: ["@trellis/shared"],
  eslint: {
    // The design surface is the deliverable; lint is run via the workspace task.
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // @trellis/shared ships TS-ESM with explicit ".js" import specifiers; let
    // webpack resolve those to the ".ts" sources (tsc/tsx already do this).
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
