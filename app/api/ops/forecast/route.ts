import { NextRequest, NextResponse } from 'next/server'
import { opsAuth } from '@/lib/ops-auth'
import { loadOrders, loadHubs, loadDrivers, opsNow } from '@/lib/ops-data'
import { forecastDay, resolveDay } from '@/lib/ops-analytics'
import { dayStartUtc, addDays } from '@/lib/tz'
import { forecastWithSpecialDays } from '@/lib/ops-special-days'
import { cached } from '@/lib/ops-cache'

// GET /api/ops/forecast?day=today|tomorrow|YYYY-MM-DD|+N &city=CASABLANCA &perDriver=3
// Prévision du nombre de commandes par hub × créneau + charge vs capacité livreurs.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const now = await opsNow()
    const day = resolveDay(sp.get('day'), now)
    const histFrom = new Date(dayStartUtc(addDays(day, -43))), dayEnd = new Date(dayStartUtc(addDays(day, 1))) // bornes en heure locale réelle
    const perDriver = Number(sp.get('perDriver')) || undefined
    const city = sp.get('city')
    // Même résultat pour tous les utilisateurs : une seule requête SQL pour N onglets (TTL 45 s, invalidé par bumpOpsEpoch)
    const result = await cached(`forecast|${day}|${city ?? ''}|${perDriver ?? ''}`, 45_000, async () => {
      const [orders, hubs, drivers] = await Promise.all([loadOrders(histFrom, dayEnd), loadHubs(), loadDrivers()])
      return forecastWithSpecialDays(forecastDay(orders, hubs, drivers, day, now, { city, perDriverPerSlot: perDriver }), day)
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 })
  }
}
