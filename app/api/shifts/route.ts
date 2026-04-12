import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET /api/shifts?zone=xxx&date=YYYY-MM-DD&week=YYYY-MM-DD
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const zone = searchParams.get('zone')
    const date = searchParams.get('date')
    const week = searchParams.get('week') // start of week (Monday)

    let dateFilter: { gte?: Date; lte?: Date; equals?: Date } | undefined

    if (week) {
      const start = new Date(week)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      end.setHours(23, 59, 59, 999)
      dateFilter = { gte: start, lte: end }
    } else if (date) {
      const d = new Date(date)
      d.setHours(0, 0, 0, 0)
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      dateFilter = { gte: d, lte: next }
    }

    const slots = await prisma.shiftSlot.findMany({
      where: {
        ...(zone ? { zone } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      include: { assignments: { orderBy: { scoreIA: 'desc' } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })
    return NextResponse.json(slots)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/shifts — créer un slot
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { zone, date, startTime, endTime, maxDrivers, minDrivers, premiumOnly, tenantId } = body

    if (!zone || !date || !startTime || !endTime) {
      return NextResponse.json({ error: 'zone, date, startTime, endTime requis' }, { status: 400 })
    }

    const slotDate = new Date(date)
    slotDate.setHours(0, 0, 0, 0)

    const slot = await prisma.shiftSlot.create({
      data: {
        zone,
        date:        slotDate,
        startTime,
        endTime,
        maxDrivers:  maxDrivers  ?? 5,
        minDrivers:  minDrivers  ?? 2,
        premiumOnly: premiumOnly ?? false,
        tenantId:    tenantId    ?? null,
      },
      include: { assignments: true },
    })
    return NextResponse.json(slot, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
