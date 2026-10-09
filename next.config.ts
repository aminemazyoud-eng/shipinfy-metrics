import type { NextConfig } from "next";

/**
 * Sprint 18 — en-têtes de sécurité (audit S13 / Annexe B §6).
 * - CSP en mode REPORT-ONLY uniquement : elle ne bloque rien, les violations sont seulement signalées
 *   dans la console du navigateur. Elle sera durcie (puis passée en enforcement) une fois l'app observée
 *   en production ('unsafe-inline'/'unsafe-eval' sont nécessaires aujourd'hui à Next.js sans nonce).
 * - HSTS : n'a d'effet que sur HTTPS (ignoré en HTTP local).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "img-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' https:",
      "frame-ancestors 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron', 'exceljs'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // Sous-modules supprimés ou fusionnés : les anciennes adresses redirigent vers leur remplaçant
  async redirects() {
    return [
      { source: '/onboarding', destination: '/rh/onboarding?tab=recrutement', permanent: false },
      { source: '/dispatch',      destination: '/operations/dispatch',      permanent: false },
      { source: '/picking',       destination: '/operations',               permanent: false },
      { source: '/remuneration',  destination: '/rh/paie',                  permanent: false },
      { source: '/score-ia',      destination: '/livreurs?tab=scoring',     permanent: false },
      { source: '/alertes',       destination: '/incidents?tab=alertes',    permanent: false },
      { source: '/support',       destination: '/incidents?tab=support',    permanent: false },
      { source: '/notifications', destination: '/parametres/notifications', permanent: false },
    ]
  },
};

export default nextConfig;
