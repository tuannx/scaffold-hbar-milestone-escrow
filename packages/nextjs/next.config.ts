import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: (config, { dev }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // wagmi's Coinbase connector statically imports @coinbase/cdp-sdk, which
    // imports the optional peer @x402/evm. npm does not install that peer, so
    // a fresh npm scaffold fails `next build` with "Can't resolve '@x402/evm'".
    // This template does not use the Coinbase connector, so stub every
    // @x402/* module (evm, svm, core, ...) instead of chasing them one by one.
    config.resolve.alias = { ...config.resolve.alias, "@x402": false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

module.exports = nextConfig;
