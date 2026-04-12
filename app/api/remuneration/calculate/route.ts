import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function livreurName(o: {
  livreurFirstName: string | null
  livreurLastName:  string | null
  sprintName:       string | null
}): string {
  const first = o.livreurFirstName?.trim()
  const last  = o.livreurLastName?.trim()
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return o.sprintName ?? 'Inconnu'
}

// POST /api/remuneration/calculate
// Body: { reportId, mode? }  — mode defaults to "standard"
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { reportId?: string; mode?: string }
    if (!body.reportId) return NextResponse.json({ error: 'reportId requis' }, { status: 400 })

    const mode = body.mode ?? 'standard'

    // 1. Récupérer la config tarifaire
    let config = await prisma.payConfig.findUnique({ where: { mode } })
    if (!config) {
      // Créer la config par défaut si inexistante
      config = await prisma.payConfig.create({
        data: {
          mode,
          label:       mode === 'express' ? 'Express' : 'Standard',
          baseRate:    mode === 'express' ? 25 : 15,
          bonusRate:   mode === 'express' ? 10 : 5,
          penaltyRate: mode === 'express' ? 10 : 5,
        },
      })
    }

    // 2. Récupérer les commandes du rapport
    const orders = await prisma.deliveryOrder.findMany({
      where: { reportId: body.reportId },
      select: {
        shippingWorkflowStatus:  true,
        dateTimeWhenDelivered:   true,
        deliveryTimeEnd:         true,
        livreurFirstName:        true,
        livreurLastName:         true,
        sprintName:              true,
      },
    })

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Aucune commande pour ce rapport' }, { status: 404 })
    }

    // 3. Grouper par livreur
    const driverMap = new Map<string, typeof orders>()
    for (const o of orders) {
      const name = livreurName(o)
      if (!driverMap.has(name)) driverMap.set(name, [])
      driverMap.get(name)!.push(o)
    }

    // 4. Calculer la rémunération par livreur
    const { baseRate, bonusRate, penaltyRate } = config
    const results: {
      driverName: string
      total: number; deliveries: number; onTime: number; noShows: number
      grossPay: number; bonus: number; penalty: number; netPay: number
    }[] = []

    for (const [driverName, dos] of driverMap) {
      const total      = dos.length
      const deliveries = dos.filter(o => o.shippingWorkflowStatus === 'DELIVERED').length
      const onTime     = dos.filter(o =>
        o.shippingWorkflowStatus === 'DELIVERED' &&
        o.dateTimeWhenDelivered != null &&
        o.deliveryTimeEnd != null &&
        o.dateTimeWhenDelivered <= o.deliveryTimeEnd
      ).length
      const noShows = dos.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length

      const grossPay = Math.round(deliveries * baseRate * 100) / 100
      const bonus    = Math.round(onTime     * bonusRate * 100) / 100
      const penalty  = Math.round(noShows    * penaltyRate * 100) / 100
      const netPay   = Math.round((grossPay + bonus - penalty) * 100) / 100

      results.push({ driverName, total, deliveries, onTime, noShows, grossPay, bonus, penalty, netPay })

      // 5. Upsert DriverPay en DB
      await prisma.driverPay.upsert({
        where:  { reportId_driverName_mode: { reportId: body.reportId, driverName, mode } },
        create: { reportId: body.reportId, driverName, mode, total, deliveries, onTime, noShows, grossPay, bonus, penalty, netPay },
        update: { total, deliveries, onTime, noShows, grossPay, bonus, penalty, netPay, calculatedAt: new Date() },
      })
    }

    results.sort((a, b) => b.netPay - a.netPay)

    return NextResponse.json({
      reportId: body.reportId,
      mode,
      config: { baseRate, bonusRate, penaltyRate },
      drivers: results,
      totals: {
        grossPay: Math.round(results.reduce((s, r) => s + r.grossPay, 0) * 100) / 100,
        bonus:    Math.round(results.reduce((s, r) => s + r.bonus,    0) * 100) / 100,
        penalty:  Math.round(results.reduce((s, r) => s + r.penalty,  0) * 100) / 100,
        netPay:   Math.round(results.reduce((s, r) => s + r.netPay,   0) * 100) / 100,
      },
    })
  } catch (e) {
    console.error('[api/remuneration/calculate POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
