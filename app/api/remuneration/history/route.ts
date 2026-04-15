import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const driverName = searchParams.get('driverName')
  if (!driverName) return NextResponse.json({ error: 'driverName requis' }, { status: 400 })

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  try {
    const reports = await (prisma as any).deliveryReport.findMany({
      where: {
        uploadedAt: { gte: sixMonthsAgo },
      },
      select: {
        id: true,
        filename: true,
        uploadedAt: true,
        payValidated: true,
        orders: {
          where: { driverName },
          select: { status: true, cod: true },
        },
      },
      orderBy: { uploadedAt: 'desc' },
      take: 6,
    })

    const history = reports
      .filter((r: any) => r.orders.length > 0)
      .map((r: any) => {
        const total = r.orders.length
        const delivered = r.orders.filter((o: any) =>
          o.status?.toLowerCase().includes('livr')
        ).length
        const totalCOD = r.orders.reduce((s: number, o: any) => s + (o.cod ?? 0), 0)
        const deliveryRate = total > 0 ? (delivered / total) * 100 : 0
        return {
          reportId: r.id,
          filename: r.filename,
          uploadedAt: r.uploadedAt,
          payValidated: r.payValidated ?? false,
          total,
          delivered,
          deliveryRate,
          totalCOD,
        }
      })

    return NextResponse.json({ history })
  } catch (e) {
    return NextResponse.json({ history: [] })
  }
}
