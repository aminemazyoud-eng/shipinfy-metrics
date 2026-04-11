import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron'],

  // xlsx (SheetJS) uses Node.js built-ins (fs, crypto, stream…).
  // Tell webpack to ignore them when bundling for the browser.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs:     false,
        path:   false,
        crypto: false,
        stream: false,
        buffer: false,
        os:     false,
      }
    }
    return config
  },
};

export default nextConfig;
