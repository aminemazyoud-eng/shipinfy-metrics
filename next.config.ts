import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdfkit', 'fontkit', 'nodemailer', 'node-cron', 'xlsx'],
  // Sous-modules supprimés ou fusionnés : les anciennes adresses redirigent vers leur remplaçant
  async redirects() {
    return [
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
