import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

function splitParam(p: string | null): string[] {
  if (!p || p.trim() === '') return []
  return p.split(',').map(s => s.trim()).filter(Boolean)
}

function buildWhere(params: URLSearchParams): Prisma.DeliveryOrderWhereInput {
  const reportId = params.get('reportId')
  const preset   = params.get('preset') ?? 'all'
  const dateFrom = params.get('dateFrom')
  const dateTo   = params.get('dateTo')
  const hubs     = splitParam(params.get('hubs'))
  const livreurs = splitParam(params.get('livreurs'))

  const where: Prisma.DeliveryOrderWhereInput = {}
  if (reportId) where.reportId = reportId

  let from: Date | undefined
  let to: Date | undefined

  if (dateFrom && dateTo) {
    from = new Date(dateFrom)
    to   = new Date(dateTo)
    to.setHours(23, 59, 59, 999)
  } else if (preset !== 'all') {
    const today    = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    if (preset === 'today')          { from = today; to = tomorrow }
    else if (preset === 'yesterday') { from = new Date(today); from.setDate(from.getDate() - 1); to = today }
    else if (preset === 'week')      { from = new Date(today); from.setDate(from.getDate() - 7);  to = tomorrow }
    else if (preset === 'month')     { from = new Date(today); from.setDate(from.getDate() - 30); to = tomorrow }
  }

  if (from && to) where.dateTimeWhenOrderSent = { gte: from, lte: to }

  if (hubs.length === 1)    where.originHubName = { contains: hubs[0], mode: 'insensitive' }
  else if (hubs.length > 1) where.originHubName = { in: hubs }

  if (livreurs.length > 0)  where.sprintName = { in: livreurs }

  return where
}

function diffMinutes(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null
  const diff = (b.getTime() - a.getTime()) / 60000
  return diff > 0 ? diff : null
}

function avgMinutes(arr: (number | null)[]): number {
  const valid = arr.filter((x): x is number => x !== null)
  if (!valid.length) return 0
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length)
}

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const selectedCreneaux = splitParam(searchParams.get('creneaux'))
    const where = buildWhere(searchParams)

    const orders = await prisma.deliveryOrder.findMany({
      where,
      select: {
        shippingWorkflowStatus:    true,
        paymentOnDeliveryAmount:   true,
        deliveryTimeStart:         true,
        deliveryTimeEnd:           true,
        dateTimeWhenOrderSent:     true,
        dateTimeWhenAssigned:      true,
        dateTimeWhenInTransport:   true,
        dateTimeWhenStartDelivery: true,
        dateTimeWhenDelivered:     true,
        dateTimeWhenNoShow:        true,
        sprintName:                true,
        livreurFirstName:          true,
        livreurLastName:           true,
        originHubName:             true,
        originHubCity:             true,
        originHubLatitude:         true,
        originHubLongitude:        true,
        destinationCityCode:       true,
        destinationLatitude:       true,
        destinationLongitude:      true,
        destinationFirstname:      true,
        destinationLastname:       true,
        externalReference:         true,
      },
    })

    const creneauRanges = selectedCreneaux.map(c => {
      const [start, end] = c.split('-')
      return { startH: parseInt(start.split(':')[0]), endH: parseInt(end.split(':')[0]) }
    })

    const filtered = creneauRanges.length === 0 ? orders : orders.filter(o => {
      if (!o.deliveryTimeStart) return false
      const h = o.deliveryTimeStart.getHours()
      return creneauRanges.some(r => h >= r.startH && h < r.endH)
    })

    const total          = filtered.length
    const delivered      = filtered.filter(o => o.shippingWorkflowStatus === 'DELIVERED')
    const noShowOrds     = filtered.filter(o => o.shippingWorkflowStatus === 'NO_SHOW')
    const readyPickup    = filtered.filter(o => o.shippingWorkflowStatus === 'READY_PICKUP')
    const deliveredCount  = delivered.length
    const noShowCount     = noShowOrds.length
    const readyPickupCount = readyPickup.length
    const deliveryRate    = total > 0 ? Math.round((deliveredCount / total) * 1000) / 10 : 0
    const noShowRate      = total > 0 ? Math.round((noShowCount / total) * 1000) / 10 : 0

    const onTimeCount = delivered.filter(o =>
      o.dateTimeWhenDelivered && o.deliveryTimeEnd && o.dateTimeWhenDelivered <= o.deliveryTimeEnd
    ).length
    const onTimeRate  = deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 1000) / 10 : 0
    const lateCount   = deliveredCount - onTimeCount

    const totalCOD       = filtered.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0)
    const avgCODPerOrder = total > 0 ? Math.round((totalCOD / total) * 100) / 100 : 0

    const daySet   = new Set(filtered.map(o => o.dateTimeWhenOrderSent?.toISOString().slice(0, 10)).filter(Boolean))
    const monthSet = new Set(filtered.map(o => o.dateTimeWhenOrderSent?.toISOString().slice(0, 7)).filter(Boolean))
    const avgOrdersPerDay   = daySet.size   > 0 ? Math.round((total / daySet.size)   * 10) / 10 : 0
    const avgOrdersPerMonth = monthSet.size > 0 ? Math.round((total / monthSet.size) * 10) / 10 : 0

    const timing = {
      orderToAssign:     avgMinutes(filtered.map(o => diffMinutes(o.dateTimeWhenOrderSent,       o.dateTimeWhenAssigned))),
      assignToTransport: avgMinutes(filtered.map(o => diffMinutes(o.dateTimeWhenAssigned,        o.dateTimeWhenInTransport))),
      transportToStart:  avgMinutes(filtered.map(o => diffMinutes(o.dateTimeWhenInTransport,     o.dateTimeWhenStartDelivery))),
      startToDelivered:  avgMinutes(delivered.map(o => diffMinutes(o.dateTimeWhenStartDelivery,  o.dateTimeWhenDelivered))),
      totalDuration:     avgMinutes(delivered.map(o => diffMinutes(o.dateTimeWhenOrderSent,      o.dateTimeWhenDelivered))),
    }

    const creneauxDefs = [
      { label: '09:00 - 12:00', startH: 9,  endH: 12 },
      { label: '12:00 - 15:00', startH: 12, endH: 15 },
      { label: '15:00 - 18:00', startH: 15, endH: 18 },
      { label: '18:00 - 21:00', startH: 18, endH: 21 },
      { label: '20:00 - 23:00', startH: 20, endH: 23 },
    ]
    const byCreneau = creneauxDefs.map(c => {
      const crOrds   = filtered.filter(o => {
        if (!o.deliveryTimeStart) return false
        const h = o.deliveryTimeStart.getHours()
        return h >= c.startH && h < c.endH
      })
      const crDel    = crOrds.filter(o => o.shippingWorkflowStatus === 'DELIVERED')
      const crOnTime = crDel.filter(o => o.dateTimeWhenDelivered && o.deliveryTimeEnd && o.dateTimeWhenDelivered <= o.deliveryTimeEnd)
      const crTotal  = crOrds.length
      return {
        creneau:      c.label,
        total:        crTotal,
        delivered:    crDel.length,
        noShow:       crOrds.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length,
        deliveryRate: crTotal > 0     ? Math.round((crDel.length / crTotal) * 1000) / 10 : 0,
        onTimeRate:   crDel.length > 0 ? Math.round((crOnTime.length / crDel.length) * 1000) / 10 : 0,
        avgDuration:  avgMinutes(crDel.map(o => diffMinutes(o.dateTimeWhenOrderSent, o.dateTimeWhenDelivered))),
      }
    })

    const livreurMap = new Map<string, typeof filtered>()
    for (const o of filtered) {
      const name = livreurName(o)
      if (!livreurMap.has(name)) livreurMap.set(name, [])
      livreurMap.get(name)!.push(o)
    }
    const byLivreur = Array.from(livreurMap.entries())
      .map(([name, los]) => {
        const lDel    = los.filter(o => o.shippingWorkflowStatus === 'DELIVERED')
        const lOnTime = lDel.filter(o => o.dateTimeWhenDelivered && o.deliveryTimeEnd && o.dateTimeWhenDelivered <= o.deliveryTimeEnd)
        const lTotal  = los.length
        return {
          name,
          total:        lTotal,
          delivered:    lDel.length,
          noShow:       los.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length,
          deliveryRate: lTotal > 0     ? Math.round((lDel.length / lTotal) * 1000) / 10 : 0,
          onTimeRate:   lDel.length > 0 ? Math.round((lOnTime.length / lDel.length) * 1000) / 10 : 0,
          avgDuration:  avgMinutes(lDel.map(o => diffMinutes(o.dateTimeWhenOrderSent, o.dateTimeWhenDelivered))),
          totalCOD:     los.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0),
          rank:         0,
        }
      })
      .sort((a, b) => b.deliveryRate - a.deliveryRate)
      .map((l, i) => ({ ...l, rank: i + 1 }))

    const hubMap = new Map<string, typeof filtered>()
    for (const o of filtered) {
      const name = o.originHubName ?? 'Inconnu'
      if (!hubMap.has(name)) hubMap.set(name, [])
      hubMap.get(name)!.push(o)
    }
    const byHub = Array.from(hubMap.entries()).map(([hubName, hos]) => {
      const hDel   = hos.filter(o => o.shippingWorkflowStatus === 'DELIVERED')
      const hTotal = hos.length
      return {
        hubName,
        hubCity:      hos[0]?.originHubCity ?? '',
        total:        hTotal,
        delivered:    hDel.length,
        deliveryRate: hTotal > 0 ? Math.round((hDel.length / hTotal) * 1000) / 10 : 0,
        avgDuration:  avgMinutes(hDel.map(o => diffMinutes(o.dateTimeWhenOrderSent, o.dateTimeWhenDelivered))),
        totalCOD:     hos.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0),
      }
    }).sort((a, b) => b.deliveryRate - a.deliveryRate)

    const cityMap = new Map<string, number>()
    for (const o of filtered) {
      cityMap.set(o.destinationCityCode ?? 'Inconnu', (cityMap.get(o.destinationCityCode ?? 'Inconnu') ?? 0) + 1)
    }
    const byCity = Array.from(cityMap.entries())
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const dayMap = new Map<string, typeof filtered>()
    for (const o of filtered) {
      const day = o.dateTimeWhenOrderSent?.toISOString().slice(0, 10) ?? 'unknown'
      if (!dayMap.has(day)) dayMap.set(day, [])
      dayMap.get(day)!.push(o)
    }
    const byDay = Array.from(dayMap.entries())
      .map(([date, dos]) => {
        const dDel   = dos.filter(o => o.shippingWorkflowStatus === 'DELIVERED')
        const dTotal = dos.length
        return {
          date,
          total:        dTotal,
          delivered:    dDel.length,
          noShow:       dos.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length,
          totalCOD:     dos.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0),
          avgDuration:  avgMinutes(dDel.map(o => diffMinutes(o.dateTimeWhenOrderSent, o.dateTimeWhenDelivered))),
          deliveryRate: dTotal > 0 ? Math.round((dDel.length / dTotal) * 1000) / 10 : 0,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    const eligibleDays = byDay.filter(d => d.total >= 5)
    const bestDay  = eligibleDays.length > 0 ? eligibleDays.reduce((b, d) => d.total > b.total ? d : b)                                : byDay[byDay.length - 1] ?? null
    const worstDay = eligibleDays.length > 0 ? eligibleDays.reduce((b, d) => (d.avgDuration || 0) > (b.avgDuration || 0) ? d : b) : byDay[0] ?? null

    const bestHub     = byHub[0]     ?? null
    const bestLivreur = byLivreur[0] ?? null

    const otherCount = total - deliveredCount - noShowCount - readyPickupCount
    const statusDistribution = [
      { name: 'Livrées',    value: deliveredCount,   color: '#22c55e' },
      { name: 'NO_SHOW',    value: noShowCount,       color: '#ef4444' },
      { name: 'En attente', value: readyPickupCount,  color: '#f59e0b' },
      { name: 'Autres',     value: otherCount > 0 ? otherCount : 0, color: '#94a3b8' },
    ].filter(s => s.value > 0)

    const onTimeDistribution = [
      { name: 'Dans les délais', value: onTimeCount, color: '#22c55e' },
      { name: 'En retard',       value: lateCount,   color: '#ef4444' },
    ].filter(s => s.value > 0)

    const heatmapPoints: [number, number, number][] = filtered
      .filter(o => o.destinationLatitude && o.destinationLongitude &&
                   Math.abs(o.destinationLatitude) > 0.001 && Math.abs(o.destinationLongitude) > 0.001)
      .map(o => [o.destinationLatitude!, o.destinationLongitude!, 0.6])

    const noShowLocations = noShowOrds
      .filter(o => o.destinationLatitude && o.destinationLongitude &&
                   Math.abs(o.destinationLatitude) > 0.001)
      .map(o => ({
        lat:       o.destinationLatitude!,
        lng:       o.destinationLongitude!,
        firstName: o.destinationFirstname ?? undefined,
        lastName:  o.destinationLastname  ?? undefined,
        ref:       o.externalReference    ?? undefined,
      }))

    const hubLocSet = new Map<string, { name: string; lat: number; lng: number }>()
    for (const o of filtered) {
      if (o.originHubName && o.originHubLatitude && o.originHubLongitude &&
          Math.abs(o.originHubLatitude) > 0.001 && !hubLocSet.has(o.originHubName)) {
        hubLocSet.set(o.originHubName, { name: o.originHubName, lat: o.originHubLatitude, lng: o.originHubLongitude })
      }
    }
    const hubLocations = Array.from(hubLocSet.values())

    return NextResponse.json({
      totalOrders: total,
      delivered:   deliveredCount,
      noShow:      noShowCount,
      readyPickup: readyPickupCount,
      deliveryRate, noShowRate, onTimeCount, onTimeRate, lateCount,
      totalCOD, avgCODPerOrder, avgOrdersPerDay, avgOrdersPerMonth,
      timing, byCreneau, byLivreur, byHub, byDay, byCity,
      statusDistribution, onTimeDistribution,
      bestDay:     bestDay  ? { date: bestDay.date,  volume: bestDay.total,  avgDuration: bestDay.avgDuration  ?? 0 } : null,
      worstDay:    worstDay ? { date: worstDay.date, volume: worstDay.total, avgDuration: worstDay.avgDuration ?? 0 } : null,
      bestHub:     bestHub     ? { name: bestHub.hubName,    deliveryRate: bestHub.deliveryRate }                                               : null,
      bestLivreur: bestLivreur ? { name: bestLivreur.name,   deliveryRate: bestLivreur.deliveryRate, avgDuration: bestLivreur.avgDuration } : null,
      heatmapPoints,
      noShowLocations,
      hubLocations,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'KPI computation failed' }, { status: 500 })
  }
}
