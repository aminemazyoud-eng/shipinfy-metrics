import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ── Helpers ────────────────────────────────────────────────────────────────

function movingAvg(data: number[], window: number): number[] {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((s, v) => s + v, 0) / slice.length
  })
}

// Régression linéaire simple — retourne slope + intercept
function linearRegression(y: number[]): { slope: number; intercept: number } {
  const n = y.length
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0 }
  const x  = Array.from({ length: n }, (_, i) => i)
  const xm = (n - 1) / 2
  const ym = y.reduce((s, v) => s + v, 0) / n
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0)
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0)
  const slope     = den === 0 ? 0 : num / den
  const intercept = ym - slope * xm
  return { slope, intercept }
}

// Saisonnalité jour de semaine (0=Dim..6=Sam) — ratio vs moyenne
function weekdayFactors(days: { date: string; total: number }[]): number[] {
  const byDow = Array.from({ length: 7 }, () => [] as number[])
  for (const d of days) {
    const dow = new Date(d.date).getDay()
    if (d.total > 0) byDow[dow].push(d.total)
  }
  const avgByDow = byDow.map(arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0)
  const globalAvg = avgByDow.filter(v => v > 0).reduce((s, v, _, a) => s + v / a.length, 0) || 1
  return avgByDow.map(v => v > 0 ? v / globalAvg : 1)
}

// RMSE pour bande de confiance
function rmse(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length)
  if (n === 0) return 0
  const mse = actual.slice(0, n).reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0) / n
  return Math.sqrt(mse)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    // Récupère le rapport actif
    const reports = await prisma.deliveryReport.findMany({
      where: { isActive: true },
      orderBy: { uploadedAt: 'desc' },
      take: 1,
      select: { id: true, filename: true, uploadedAt: true },
    })
    const reportId = searchParams.get('reportId') || reports[0]?.id
    if (!reportId) return NextResponse.json({ error: 'Aucun rapport actif' }, { status: 404 })

    const orders = await prisma.deliveryOrder.findMany({
      where: { reportId },
      select: {
        dateTimeWhenOrderSent:    true,
        dateTimeWhenDelivered:    true,
        shippingWorkflowStatus:   true,
        paymentOnDeliveryAmount:  true,
        originHubName:            true,
        livreurFirstName:         true,
        livreurLastName:          true,
        sprintName:               true,
      },
    })

    if (orders.length === 0) return NextResponse.json({ error: 'Aucune commande' }, { status: 404 })

    // ── Agréger par jour ────────────────────────────────────────────────────
    const dayMap = new Map<string, typeof orders>()
    for (const o of orders) {
      const day = o.dateTimeWhenOrderSent?.toISOString().slice(0, 10) ?? null
      if (!day) continue
      if (!dayMap.has(day)) dayMap.set(day, [])
      dayMap.get(day)!.push(o)
    }

    const byDay = Array.from(dayMap.entries())
      .map(([date, dos]) => {
        const delivered = dos.filter(o => o.shippingWorkflowStatus === 'DELIVERED').length
        const noShow    = dos.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length
        const total     = dos.length
        return {
          date,
          total,
          delivered,
          noShow,
          deliveryRate: total > 0 ? Math.round(delivered / total * 1000) / 10 : 0,
          cod: dos.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0),
        }
      })
      .filter(d => d.total >= 1)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (byDay.length < 3) return NextResponse.json({ error: 'Données insuffisantes (< 3 jours)' }, { status: 422 })

    // ── Prévisions 7 prochains jours ─────────────────────────────────────────
    const HORIZON = 7
    const LOOKBACK = Math.min(byDay.length, 30) // 30 derniers jours max

    const recent = byDay.slice(-LOOKBACK)
    const volumes = recent.map(d => d.total)
    const rates   = recent.map(d => d.deliveryRate)
    const cods    = recent.map(d => d.cod)

    const volMA  = movingAvg(volumes, 7)
    const rateMA = movingAvg(rates,   7)
    const codMA  = movingAvg(cods,    7)

    const volReg  = linearRegression(volumes)
    const rateReg = linearRegression(rates)
    const codReg  = linearRegression(cods)

    const dowFactors = weekdayFactors(recent)

    const lastDate = new Date(byDay[byDay.length - 1].date)
    const lastIdx  = volumes.length - 1

    // Erreur de prévision (sur les 7 derniers jours connus)
    const volErr  = rmse(volumes.slice(-7), volMA.slice(-7).map((_, i) => volReg.slope * (lastIdx - 6 + i) + volReg.intercept))
    const rateErr = rmse(rates.slice(-7),  rateMA.slice(-7))
    const codErr  = rmse(cods.slice(-7),   codMA.slice(-7))

    const forecast = Array.from({ length: HORIZON }, (_, i) => {
      const futureDate = new Date(lastDate)
      futureDate.setDate(futureDate.getDate() + i + 1)
      const dateStr = futureDate.toISOString().slice(0, 10)
      const dow     = futureDate.getDay()
      const idx     = lastIdx + i + 1

      const trendVol  = volReg.slope * idx + volReg.intercept
      const trendRate = Math.max(0, Math.min(100, rateReg.slope * idx + rateReg.intercept))
      const trendCod  = codReg.slope  * idx + codReg.intercept

      const seasonFactor = dowFactors[dow]

      const vol  = Math.max(0, Math.round(trendVol * seasonFactor))
      const rate = Math.max(0, Math.min(100, Math.round(trendRate * 10) / 10))
      const cod  = Math.max(0, Math.round(trendCod * seasonFactor))

      // Intervalles de confiance ±1σ
      const volLow  = Math.max(0, vol  - Math.round(volErr  * seasonFactor))
      const volHigh = vol  + Math.round(volErr  * seasonFactor)
      const rateLow = Math.max(0, rate - Math.round(rateErr * 10) / 10)
      const rateHigh= Math.min(100, rate + Math.round(rateErr * 10) / 10)
      const codLow  = Math.max(0, cod  - Math.round(codErr  * seasonFactor))
      const codHigh = cod  + Math.round(codErr  * seasonFactor)

      const noShowEst = Math.round(vol * (100 - rate) / 100)
      const risk: 'low' | 'medium' | 'high' =
        rate < 65 ? 'high' : rate < 75 ? 'medium' : 'low'

      return { date: dateStr, dow, vol, volLow, volHigh, rate, rateLow, rateHigh, cod, codLow, codHigh, noShowEst, risk }
    })

    // ── Tendances par hub (7 derniers jours vs 7 précédents) ─────────────────
    const hubMap = new Map<string, { recent: number[]; prev: number[]; rates: number[] }>()
    const cutoff = byDay.length >= 14 ? byDay[byDay.length - 8]?.date : byDay[0]?.date

    for (const o of orders) {
      const hub  = o.originHubName ?? 'Inconnu'
      const day  = o.dateTimeWhenOrderSent?.toISOString().slice(0, 10) ?? null
      if (!day) continue
      if (!hubMap.has(hub)) hubMap.set(hub, { recent: [], prev: [], rates: [] })
      const bucket = hubMap.get(hub)!
      if (day > (cutoff ?? '')) bucket.recent.push(o.shippingWorkflowStatus === 'DELIVERED' ? 1 : 0)
      else bucket.prev.push(o.shippingWorkflowStatus === 'DELIVERED' ? 1 : 0)
      bucket.rates.push(o.shippingWorkflowStatus === 'DELIVERED' ? 1 : 0)
    }

    const hubTrends = Array.from(hubMap.entries())
      .filter(([, v]) => v.recent.length + v.prev.length >= 10)
      .map(([hub, v]) => {
        const rRate = v.recent.length ? v.recent.reduce((s, x) => s + x, 0) / v.recent.length * 100 : 0
        const pRate = v.prev.length   ? v.prev.reduce((s, x) => s + x, 0)   / v.prev.length   * 100 : rRate
        const trend = rRate - pRate
        return {
          hub,
          recentRate: Math.round(rRate * 10) / 10,
          prevRate:   Math.round(pRate * 10) / 10,
          trend:      Math.round(trend * 10) / 10,
          direction:  trend > 2 ? 'up' : trend < -2 ? 'down' : 'stable' as 'up' | 'down' | 'stable',
          volume:     v.recent.length + v.prev.length,
        }
      })
      .sort((a, b) => a.trend - b.trend)

    // ── Livreurs à risque ───────────────────────────────────────────────────
    const livreurMap = new Map<string, { delivered: number; total: number; noShow: number }>()
    for (const o of orders) {
      const name = [o.livreurFirstName, o.livreurLastName].filter(Boolean).join(' ') || o.sprintName || 'Inconnu'
      if (!livreurMap.has(name)) livreurMap.set(name, { delivered: 0, total: 0, noShow: 0 })
      const l = livreurMap.get(name)!
      l.total++
      if (o.shippingWorkflowStatus === 'DELIVERED') l.delivered++
      if (o.shippingWorkflowStatus === 'NO_SHOW') l.noShow++
    }

    const atRisk = Array.from(livreurMap.entries())
      .filter(([, v]) => v.total >= 10)
      .map(([name, v]) => ({
        name,
        total:        v.total,
        deliveryRate: Math.round(v.delivered / v.total * 1000) / 10,
        noShowRate:   Math.round(v.noShow / v.total * 1000) / 10,
        risk:         v.delivered / v.total < 0.65 ? 'high'
                    : v.delivered / v.total < 0.78 ? 'medium' : 'low' as 'high' | 'medium' | 'low',
      }))
      .filter(l => l.risk !== 'low')
      .sort((a, b) => a.deliveryRate - b.deliveryRate)
      .slice(0, 10)

    // ── Résumé global ───────────────────────────────────────────────────────
    const totalOrders   = orders.length
    const delivered     = orders.filter(o => o.shippingWorkflowStatus === 'DELIVERED').length
    const globalRate    = Math.round(delivered / totalOrders * 1000) / 10
    const avgDaily      = Math.round(totalOrders / byDay.length)
    const forecastTotal = forecast.reduce((s, f) => s + f.vol, 0)
    const forecastRate  = Math.round(forecast.reduce((s, f) => s + f.rate, 0) / HORIZON * 10) / 10
    const forecastCOD   = forecast.reduce((s, f) => s + f.cod, 0)

    return NextResponse.json({
      reportId,
      totalOrders,
      globalRate,
      avgDaily,
      forecastTotal,
      forecastRate,
      forecastCOD,
      byDay,       // historique complet
      forecast,    // 7 jours à venir
      hubTrends,
      atRisk,
    })
  } catch (e) {
    console.error('[previsions]', e)
    return NextResponse.json({ error: 'Calcul prévisions échoué' }, { status: 500 })
  }
}
