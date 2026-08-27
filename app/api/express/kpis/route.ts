import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

function diffMinutes(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (isNaN(ms) || ms < 0) return null
  return ms / 60000
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

const normStore = (s: string | null): 'supermarket' | 'hypermarket' | null => {
  if (!s) return null
  const v = s.trim().toLowerCase()
  if (v.includes('hyper')) return 'hypermarket'
  if (v.includes('super')) return 'supermarket'
  return null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const reportId = searchParams.get('reportId')
    if (!reportId) {
      return NextResponse.json({ error: 'reportId requis' }, { status: 400 })
    }

    const report = await prisma.expressReport.findUnique({ where: { id: reportId } })
    if (!report) {
      return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 })
    }

    const orders = await prisma.expressOrder.findMany({ where: { reportId } })

    const totalOrders = orders.length
    const st = (s: string) => (v: typeof orders[number]) => (v.status ?? '').toUpperCase().includes(s)
    const delivered = orders.filter(st('DELIVERED')).length
    const cancelled = orders.filter(st('CANCEL')).length
    const pending   = orders.filter(st('PENDING')).length
    const picked    = orders.filter(st('PICKED')).length

    const slaKnown = orders.filter(o => o.slaRespected !== null && o.slaRespected !== undefined)
    const slaRespected = slaKnown.filter(o => o.slaRespected === true).length
    const slaRate = rate(slaRespected, slaKnown.length)

    const pickingTimes = orders.map(o => diffMinutes(o.pickingStartAt, o.pickingEndAt)).filter((n): n is number => n !== null)
    const deliveryTimes = orders.map(o => diffMinutes(o.deliveryStartAt, o.deliveryEndAt)).filter((n): n is number => n !== null)
    const totalTimes = orders.map(o => diffMinutes(o.pickingStartAt, o.deliveryEndAt)).filter((n): n is number => n !== null)

    // ── byDriver ────────────────────────────────────────────────────────────
    const driverMap = new Map<string, typeof orders>()
    for (const o of orders) {
      const key = o.driverName || '—'
      if (!driverMap.has(key)) driverMap.set(key, [])
      driverMap.get(key)!.push(o)
    }
    const byDriver = Array.from(driverMap.entries()).map(([driverName, list]) => {
      const dSlaKnown = list.filter(o => o.slaRespected !== null && o.slaRespected !== undefined)
      const dTimes = list.map(o => diffMinutes(o.pickingStartAt, o.deliveryEndAt)).filter((n): n is number => n !== null)
      return {
        driverName,
        delivered: list.filter(st('DELIVERED')).length,
        slaRate: rate(dSlaKnown.filter(o => o.slaRespected === true).length, dSlaKnown.length),
        avgTime: avg(dTimes),
      }
    }).sort((a, b) => b.delivered - a.delivered)

    // ── byPicker ────────────────────────────────────────────────────────────
    const pickerMap = new Map<string, typeof orders>()
    for (const o of orders) {
      if (!o.pickerId) continue
      if (!pickerMap.has(o.pickerId)) pickerMap.set(o.pickerId, [])
      pickerMap.get(o.pickerId)!.push(o)
    }
    const byPicker = Array.from(pickerMap.entries()).map(([pickerId, list]) => {
      const pTimes = list.map(o => diffMinutes(o.pickingStartAt, o.pickingEndAt)).filter((n): n is number => n !== null)
      return {
        pickerId,
        ordersHandled: list.length,
        avgPickingTime: avg(pTimes),
      }
    }).sort((a, b) => b.ordersHandled - a.ordersHandled)

    // ── bySla (store type comparison) ───────────────────────────────────────
    const buildStoreBucket = (target: 'supermarket' | 'hypermarket') => {
      const list = orders.filter(o => normStore(o.storeType) === target)
      const bSlaKnown = list.filter(o => o.slaRespected !== null && o.slaRespected !== undefined)
      const bTimes = list.map(o => diffMinutes(o.pickingStartAt, o.deliveryEndAt)).filter((n): n is number => n !== null)
      return {
        slaRate: rate(bSlaKnown.filter(o => o.slaRespected === true).length, bSlaKnown.length),
        avgTime: avg(bTimes),
        count: list.length,
      }
    }

    return NextResponse.json({
      totalOrders,
      delivered,
      cancelled,
      pending,
      picked,
      slaRespected,
      slaRate,
      avgPickingTime: avg(pickingTimes),
      avgDeliveryTime: avg(deliveryTimes),
      avgTotalTime: avg(totalTimes),
      byDriver,
      byPicker,
      bySla: {
        supermarket: buildStoreBucket('supermarket'),
        hypermarket: buildStoreBucket('hypermarket'),
      },
    })
  } catch (e) {
    console.error('[express/kpis]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
