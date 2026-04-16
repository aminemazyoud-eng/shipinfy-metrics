import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await ctx.params
  const driverName = decodeURIComponent(id)

  // Get last 6 months of data
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  try {
    const orders = await (prisma as any).deliveryOrder.findMany({
      where: {
        driverName,
        createdAt: { gte: sixMonthsAgo },
      },
      select: {
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    // Group by month YYYY-MM
    const byMonth: Record<string, { total: number; delivered: number; noShow: number }> = {}
    for (const o of orders) {
      const d = new Date(o.createdAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!byMonth[key]) byMonth[key] = { total: 0, delivered: 0, noShow: 0 }
      byMonth[key].total++
      if (o.status === 'LIVREE' || o.status === 'livree' || o.status === 'Livrée' || o.status?.toLowerCase() === 'livree') {
        byMonth[key].delivered++
      }
      if (o.status === 'NO_SHOW' || o.status === 'no_show' || o.status?.toLowerCase() === 'no_show') {
        byMonth[key].noShow++
      }
    }

    const months = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        ...data,
        deliveryRate: data.total > 0 ? (data.delivered / data.total) * 100 : 0,
      }))

    return NextResponse.json({ months })
  } catch (e) {
    // Table might not exist — return empty
    return NextResponse.json({ months: [] })
  }
}
