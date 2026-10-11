import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOfTz, dayBoundsTz } from '@/lib/tz'

export const dynamic = 'force-dynamic'

// GET /api/ops/preparation?day=today&hub=CAS-MM
// Suivi de la préparation (« picking ») en TEMPS RÉEL, dérivé des commandes OpsOrder et de leur statut — remplace la lecture
// des rapports Express importés. Statut de préparation :  À préparer = READY_PICKUP (reçue, non dispatchée) ·
// Prête = ASSIGNED (assignée, en attente de prise en charge) · Récupérée = IN_TRANSPORT et au-delà.
// Échéance de préparation = début du créneau ; SLA restant = minutes avant ce début (négatif = dépassé).
const WARN_MIN = 30
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = dayOfTz(sp.get('day')), hub = sp.get('hub') || undefined
    const b = dayBoundsTz(day)
    const rows = await prisma.opsOrder.findMany({
      where: { slotStart: { gte: b.from, lt: b.to }, status: { not: 'CANCELLED' }, ...(hub ? { hubCode: hub } : {}) },
      orderBy: { slotStart: 'asc' },
      select: { id: true, externalId: true, reference: true, hubCode: true, sectorCode: true, waveId: true, status: true, slotStart: true, slotLabel: true, createdAtSrc: true, syncedAt: true, assignedAt: true, inTransportAt: true, driver: { select: { code: true, firstName: true, lastName: true } } },
    })
    const now = Date.now()
    const min = (a: number, z: number) => Math.max(0, Math.round((z - a) / 60_000))
    const orders = rows.map(o => {
      const received = (o.createdAtSrc ?? o.syncedAt).getTime()
      const prepStatus = o.status === 'READY_PICKUP' ? 'a_preparer' : o.status === 'ASSIGNED' ? 'prete' : 'recuperee'
      const readyAt = o.assignedAt?.getTime() ?? null
      const pickedAt = o.inTransportAt?.getTime() ?? null
      const slaRemainingMin = Math.round((o.slotStart.getTime() - now) / 60_000)
      const waiting = prepStatus !== 'recuperee'
      return {
        id: o.id, ref: o.reference ?? o.externalId, hubCode: o.hubCode, sector: o.sectorCode, waveId: o.waveId, slot: o.slotLabel, prepStatus,
        receivedAt: new Date(received).toISOString(), readyAt: readyAt ? new Date(readyAt).toISOString() : null, pickedAt: pickedAt ? new Date(pickedAt).toISOString() : null,
        elapsedMin: min(received, prepStatus === 'a_preparer' ? now : readyAt ?? now),
        slaRemainingMin, slaWarn: prepStatus === 'a_preparer' && slaRemainingMin < WARN_MIN,
        driver: o.driver ? `${o.driver.firstName} ${o.driver.lastName}`.trim() : null, waiting,
      }
    })
    const done = orders.filter(o => o.readyAt)
    const kpis = {
      toPrep: orders.filter(o => o.prepStatus === 'a_preparer').length,
      ready: orders.filter(o => o.prepStatus === 'prete').length,
      pickedUp: orders.filter(o => o.prepStatus === 'recuperee').length,
      avgPrepMin: done.length ? Math.round(done.reduce((s, o) => s + o.elapsedMin, 0) / done.length) : 0,
    }
    const byHub = new Map<string, { hubCode: string; handled: number; totalMin: number; onTime: number }>()
    for (const o of rows) {
      if (!o.assignedAt) continue
      const k = o.hubCode ?? '—'
      const c = byHub.get(k) ?? { hubCode: k, handled: 0, totalMin: 0, onTime: 0 }
      c.handled++; c.totalMin += min((o.createdAtSrc ?? o.syncedAt).getTime(), o.assignedAt.getTime()); if (o.assignedAt <= o.slotStart) c.onTime++
      byHub.set(k, c)
    }
    const ranking = [...byHub.values()].map(c => ({ hubCode: c.hubCode, handled: c.handled, avgPrepMin: Math.round(c.totalMin / c.handled), slaRate: Math.round(c.onTime / c.handled * 100) })).sort((a, b) => b.slaRate - a.slaRate)
    return NextResponse.json({ day, hub: hub ?? null, kpis, ranking, alerts: orders.filter(o => o.slaWarn).map(o => o.ref), orders })
  } catch (e) { return fail(e) }
}
