import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/pointage?date=2026-04-12  (date = YYYY-MM-DD, defaults to today)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dateStr = searchParams.get('date')

    let from: Date
    let to:   Date

    if (dateStr) {
      from = new Date(dateStr + 'T00:00:00.000Z')
      to   = new Date(dateStr + 'T23:59:59.999Z')
    } else {
      const today = new Date()
      from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      to   = new Date(from.getTime() + 86400000 - 1)
    }

    const records = await prisma.driverAttendance.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { driverName: 'asc' },
    })

    return NextResponse.json(records)
  } catch (e) {
    console.error('[api/pointage GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST /api/pointage — créer ou mettre à jour un pointage
// Body: { driverName, date, hub?, checkIn?, checkOut?, status?, notes? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      driverName: string; date: string
      hub?: string; checkIn?: string; checkOut?: string
      status?: string; notes?: string
    }

    if (!body.driverName || !body.date) {
      return NextResponse.json({ error: 'driverName et date requis' }, { status: 400 })
    }

    const dateKey = new Date(body.date + 'T00:00:00.000Z')

    const record = await prisma.driverAttendance.upsert({
      where:  { driverName_date: { driverName: body.driverName, date: dateKey } },
      create: {
        driverName: body.driverName,
        date:       dateKey,
        hub:        body.hub     ?? null,
        checkIn:    body.checkIn  ? new Date(body.checkIn)  : null,
        checkOut:   body.checkOut ? new Date(body.checkOut) : null,
        status:     body.status  ?? 'present',
        notes:      body.notes   ?? null,
      },
      update: {
        hub:      body.hub     ?? undefined,
        checkIn:  body.checkIn  ? new Date(body.checkIn)  : undefined,
        checkOut: body.checkOut ? new Date(body.checkOut) : undefined,
        status:   body.status  ?? undefined,
        notes:    body.notes   ?? undefined,
      },
    })

    return NextResponse.json(record)
  } catch (e) {
    console.error('[api/pointage POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
