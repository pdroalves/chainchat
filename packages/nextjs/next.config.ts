import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: config => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

const isStaticExport = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

if (isStaticExport) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.images = {
    unoptimized: true,
  };
  // Set basePath for GitHub Pages subdirectory deployment (e.g., /chainchat)
  if (basePath) {
    nextConfig.basePath = basePath;
    nextConfig.assetPrefix = basePath;
  }
}

module.exports = nextConfig;
