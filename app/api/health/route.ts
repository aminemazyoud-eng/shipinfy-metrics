import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/health — public, SANS donnée sensible (healthcheck Docker / Dokploy / supervision externe).
//   ok        : base joignable et rapide, dernière synchro réussie il y a moins de 15 min
//   degraded  : base lente (> 1 s) OU synchro trop ancienne / jamais exécutée  (HTTP 200 : le service répond)
//   down      : base injoignable (HTTP 503)
export const dynamic = 'force-dynamic'

const SYNC_MAX_AGE_MIN = 15
const DB_SLOW_MS = 1000
const DB_TIMEOUT_MS = 3000

export async function GET() {
  const t0 = performance.now()
  let dbMs: number | null = null, dbOk = false
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), DB_TIMEOUT_MS)),
    ])
    dbOk = true; dbMs = Math.round(performance.now() - t0)
  } catch { /* base injoignable */ }

  let syncAgeMin: number | null = null
  if (dbOk) {
    try {
      const last = await prisma.opsSyncRun.findFirst({ where: { ok: true }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, finishedAt: true } })
      if (last) syncAgeMin = Math.round(((Date.now() - (last.finishedAt ?? last.startedAt).getTime()) / 60_000) * 10) / 10
    } catch { /* table absente : traité comme « jamais synchronisé » */ }
  }

  const status: 'ok' | 'degraded' | 'down' = !dbOk ? 'down' : (dbMs! > DB_SLOW_MS || syncAgeMin == null || syncAgeMin > SYNC_MAX_AGE_MIN) ? 'degraded' : 'ok'
  return NextResponse.json(
    { status, db: { ok: dbOk, ms: dbMs }, sync: { lastOkAgeMin: syncAgeMin, maxAgeMin: SYNC_MAX_AGE_MIN }, uptimeS: Math.round(process.uptime()), ts: new Date().toISOString() },
    { status: dbOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
