/**
 * Script de capture d'écran pour les guides Shipinfy
 * Lance: node scripts/take-screenshots.mjs
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'https://metrics.mediflows.shop'
const OUTPUT_DIR = join(__dirname, '..', 'public', 'guides')

mkdirSync(OUTPUT_DIR, { recursive: true })

const SHOTS = [
  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  { file: 'dash-overview.jpg',        url: '/', delay: 3000 },
  { file: 'dash-kpi-cards.jpg',       url: '/', delay: 3000, clip: { x: 60, y: 150, width: 1400, height: 185 } },
  { file: 'dash-orders-table.jpg',    url: '/', delay: 3000, scroll: 350, clip: { x: 60, y: 160, width: 1400, height: 480 } },
  { file: 'dash-livreurs-actifs.jpg', url: '/', delay: 3000, clip: { x: 60, y: 350, width: 700, height: 320 } },
  { file: 'dash-perf-hub.jpg',        url: '/', delay: 3000, clip: { x: 780, y: 350, width: 720, height: 320 } },

  // ── KPIs — avec data réelle ────────────────────────────────────────────────
  { file: 'kpis-upload-zone.jpg',     url: '/kpis', delay: 2000, clip: { x: 60, y: 80, width: 1400, height: 200 } },
  { file: 'kpis-kpi-cards.jpg',       url: '/kpis', delay: 3000, scroll: 200, clip: { x: 60, y: 100, width: 1400, height: 260 } },
  { file: 'kpis-pipeline.jpg',        url: '/kpis', delay: 3000, scroll: 400, clip: { x: 60, y: 100, width: 1400, height: 280 } },
  { file: 'kpis-chart-day.jpg',       url: '/kpis', delay: 3000, scroll: 700, clip: { x: 60, y: 100, width: 700, height: 340 } },
  { file: 'kpis-chart-creneau.jpg',   url: '/kpis', delay: 3000, scroll: 700, clip: { x: 760, y: 100, width: 700, height: 340 } },
  { file: 'kpis-chart-status.jpg',    url: '/kpis', delay: 3000, scroll: 1100, clip: { x: 60, y: 100, width: 700, height: 340 } },
  { file: 'kpis-chart-ontime.jpg',    url: '/kpis', delay: 3000, scroll: 1100, clip: { x: 760, y: 100, width: 700, height: 340 } },
  { file: 'kpis-heatmap.jpg',         url: '/kpis', delay: 4000, scroll: 1500, clip: { x: 60, y: 100, width: 1400, height: 400 } },
  { file: 'kpis-filterbar.jpg',       url: '/kpis', delay: 3000, clip: { x: 60, y: 200, width: 1400, height: 130 } },
  { file: 'kpis-livreur-table.jpg',   url: '/kpis', delay: 3000, scroll: 2000, clip: { x: 60, y: 100, width: 1400, height: 380 } },

  // ── ALERTES ────────────────────────────────────────────────────────────────
  { file: 'alertes-tabs.jpg',         url: '/alertes', delay: 2000, clip: { x: 60, y: 60, width: 1400, height: 120 } },
  { file: 'alertes-overview.jpg',     url: '/alertes', delay: 2000 },
  { file: 'alertes-tickets.jpg',      url: '/alertes', delay: 2000, clickText: 'Tickets' },
  { file: 'alertes-rules.jpg',        url: '/alertes', delay: 2000, clickText: 'Règles' },

  // ── RAPPORTS ───────────────────────────────────────────────────────────────
  { file: 'rapports-overview.jpg',    url: '/rapports', delay: 2000 },
  { file: 'rapports-planif.jpg',      url: '/rapports', delay: 2000, scroll: 200, clip: { x: 60, y: 100, width: 1400, height: 300 } },
  { file: 'rapports-historique.jpg',  url: '/rapports', delay: 2000, scroll: 400, clip: { x: 60, y: 100, width: 1400, height: 300 } },

  // ── LIVREURS ───────────────────────────────────────────────────────────────
  { file: 'livreurs-overview.jpg',    url: '/livreurs', delay: 2000 },

  // ── ONBOARDING ─────────────────────────────────────────────────────────────
  { file: 'onboarding-kanban.jpg',    url: '/onboarding', delay: 2000 },

  // ── SCORE IA ───────────────────────────────────────────────────────────────
  { file: 'score-ia-overview.jpg',    url: '/score-ia', delay: 2000 },
  { file: 'score-ia-table.jpg',       url: '/score-ia', delay: 2000, scroll: 200, clip: { x: 60, y: 100, width: 1400, height: 380 } },

  // ── ACADEMY ────────────────────────────────────────────────────────────────
  { file: 'academy-formation.jpg',    url: '/academy', delay: 2000 },
  { file: 'academy-guides-tab.jpg',   url: '/academy', delay: 2000, clickText: 'Guides Shipinfy' },
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 800 },
    deviceScaleFactor: 1.5,
  })

  for (const shot of SHOTS) {
    const page = await context.newPage()
    try {
      console.log(`Capturing ${shot.file}...`)
      await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(shot.delay ?? 2000)

      if (shot.clickText) {
        await page.getByText(shot.clickText, { exact: false }).first().click().catch(() => {})
        await page.waitForTimeout(1000)
      }
      if (shot.scroll) await page.evaluate(y => window.scrollTo(0, y), shot.scroll)
      if (shot.scroll) await page.waitForTimeout(500)

      const opts = {
        type: 'jpeg',
        quality: 88,
        ...(shot.clip ? { clip: shot.clip } : {}),
      }

      const buf = await page.screenshot(opts)
      writeFileSync(join(OUTPUT_DIR, shot.file), buf)
      console.log(`  ✓ ${shot.file}`)
    } catch (e) {
      console.error(`  ✗ ${shot.file}: ${e.message}`)
    } finally {
      await page.close()
    }
  }

  await browser.close()
  console.log('\nDone!')
}

main().catch(console.error)
