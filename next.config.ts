import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron', 'xlsx'],
};

export default nextConfig;
