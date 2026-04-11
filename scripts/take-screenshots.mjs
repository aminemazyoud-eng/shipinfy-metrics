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
  // Dashboard
  { file: 'dash-overview.jpg',       url: '/',          fullPage: false, delay: 3000 },
  { file: 'dash-kpi-cards.jpg',      url: '/',          clip: { x: 60, y: 150, width: 1400, height: 185 }, delay: 3000 },
  { file: 'dash-orders-table.jpg',   url: '/',          scroll: 350, clip: { x: 60, y: 160, width: 1400, height: 480 }, delay: 3000 },

  // KPIs
  { file: 'kpis-upload-zone.jpg',    url: '/kpis',      fullPage: false, delay: 2000 },
  { file: 'kpis-filterbar.jpg',      url: '/kpis',      inject: 'window.__DEMO_SKIP_UPLOAD=true', fullPage: false, delay: 2000 },

  // Alertes
  { file: 'alertes-overview.jpg',    url: '/alertes',   fullPage: false, delay: 2000 },
  { file: 'alertes-tabs.jpg',        url: '/alertes',   clip: { x: 60, y: 60, width: 1400, height: 120 }, delay: 2000 },

  // Rapports
  { file: 'rapports-overview.jpg',   url: '/rapports',  fullPage: false, delay: 2000 },

  // Livreurs
  { file: 'livreurs-overview.jpg',   url: '/livreurs',  fullPage: false, delay: 2000 },

  // Onboarding
  { file: 'onboarding-kanban.jpg',   url: '/onboarding', fullPage: false, delay: 2000 },

  // Score IA
  { file: 'score-ia-overview.jpg',   url: '/score-ia',  fullPage: false, delay: 2000 },
  { file: 'score-ia-table.jpg',      url: '/score-ia',  scroll: 200, fullPage: false, delay: 2000 },

  // Academy
  { file: 'academy-formation.jpg',   url: '/academy',   fullPage: false, delay: 2000 },
  { file: 'academy-guides-tab.jpg',  url: '/academy',   fullPage: false, delay: 2000, clickSelector: 'button:has-text("Guides Shipinfy")' },
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1400, height: 700 },
    deviceScaleFactor: 1.5,
  })

  for (const shot of SHOTS) {
    const page = await context.newPage()
    try {
      console.log(`Capturing ${shot.file}...`)
      await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(shot.delay ?? 2000)

      if (shot.scroll) await page.evaluate(y => window.scrollTo(0, y), shot.scroll)
      if (shot.clickSelector) {
        await page.click(shot.clickSelector).catch(() => {})
        await page.waitForTimeout(1000)
      }

      const opts = {
        type: 'jpeg',
        quality: 85,
        ...(shot.clip ? { clip: shot.clip } : {}),
        ...(shot.fullPage ? { fullPage: true } : {}),
      }

      const buf = await page.screenshot(opts)
      writeFileSync(join(OUTPUT_DIR, shot.file), buf)
      console.log(`  ✓ ${shot.file} saved`)
    } catch (e) {
      console.error(`  ✗ ${shot.file} failed: ${e.message}`)
    } finally {
      await page.close()
    }
  }

  await browser.close()
  console.log('\nDone! Screenshots saved to public/guides/')
}

main().catch(console.error)
