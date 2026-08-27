import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET /api/picking?reportId=xxx&date=YYYY-MM-DD (date optional)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reportId = searchParams.get('reportId')
    const dateStr  = searchParams.get('date')

    if (!reportId) {
      return NextResponse.json({ error: 'reportId requis' }, { status: 400 })
    }

    const where: { reportId: string; createdAt?: { gte: Date; lte: Date } } = { reportId }
    if (dateStr) {
      where.createdAt = {
        gte: new Date(dateStr + 'T00:00:00.000Z'),
        lte: new Date(dateStr + 'T23:59:59.999Z'),
      }
    }

    const rows = await prisma.expressOrder.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    })

    const now = Date.now()

    const orders = rows.map(o => {
      const start = o.pickingStartAt ? o.pickingStartAt.getTime() : null
      const end   = o.pickingEndAt ? o.pickingEndAt.getTime() : null
      let elapsedMin = 0
      if (start) {
        elapsedMin = Math.round(((end ?? now) - start) / 60000)
        if (elapsedMin < 0) elapsedMin = 0
      }
      const slaTarget = o.slaTarget ?? 45
      const slaRemainingMin = slaTarget - elapsedMin
      const slaWarn = start != null && slaTarget > 0 && (elapsedMin / slaTarget) > 0.8 && o.pickingStatus !== 'recupere'

      return {
        id:             o.id,
        orderId:        o.orderId,
        pickerId:       o.pickerId,
        pickingStatus:  o.pickingStatus,
        pickingStartAt: o.pickingStartAt,
        pickingEndAt:   o.pickingEndAt,
        elapsedMin,
        slaTarget,
        slaRemainingMin,
        slaWarn,
        driverName:     o.driverName,
        zone:           o.zone,
      }
    })

    // ─── KPIs ────────────────────────────────────────────────────────────────
    const toPick     = orders.filter(o => o.pickingStatus === 'a_picker').length
    const inProgress = orders.filter(o => o.pickingStatus === 'en_cours').length
    const ready      = orders.filter(o => o.pickingStatus === 'pret' || o.pickingStatus === 'recupere').length

    const completed = orders.filter(o => o.pickingStartAt && o.pickingEndAt)
    const avgPickingMin = completed.length > 0
      ? Math.round(completed.reduce((s, o) => s + o.elapsedMin, 0) / completed.length)
      : 0

    // ─── By picker ───────────────────────────────────────────────────────────
    const pickerMap = new Map<string, { handled: number; totalMin: number; done: number; slaOk: number }>()
    for (const o of orders) {
      if (!o.pickerId) continue
      const cur = pickerMap.get(o.pickerId) ?? { handled: 0, totalMin: 0, done: 0, slaOk: 0 }
      cur.handled += 1
      if (o.pickingStartAt && o.pickingEndAt) {
        cur.done += 1
        cur.totalMin += o.elapsedMin
        if (o.elapsedMin <= o.slaTarget) cur.slaOk += 1
      }
      pickerMap.set(o.pickerId, cur)
    }
    const byPicker = [...pickerMap.entries()].map(([pickerId, v]) => ({
      pickerId,
      handled:        v.handled,
      avgPickingMin:  v.done > 0 ? Math.round(v.totalMin / v.done) : 0,
      slaRate:        v.done > 0 ? Math.round((v.slaOk / v.done) * 100) : 0,
    })).sort((a, b) => b.slaRate - a.slaRate || a.avgPickingMin - b.avgPickingMin)

    const slaAlerts = orders.filter(o => o.slaWarn)

    return NextResponse.json({
      orders,
      kpis: { toPick, inProgress, ready, avgPickingMin },
      byPicker,
      slaAlerts,
    })
  } catch (e) {
    console.error('[api/picking GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
