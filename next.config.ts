import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron'],
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
