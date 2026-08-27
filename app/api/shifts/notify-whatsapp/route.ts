import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendWhatsApp, formatShiftPlanning, type ShiftSlotLite } from '@/lib/whatsapp'

export const runtime = 'nodejs'

// POST /api/shifts/notify-whatsapp
// Body: { week: string (ISO date of any day in the week), driverNames?: string[] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { week?: string; driverNames?: string[] }
    if (!body.week) {
      return NextResponse.json({ error: 'week requis' }, { status: 400 })
    }

    // Monday..Sunday range for that week
    const ref = new Date(body.week)
    if (isNaN(ref.getTime())) {
      return NextResponse.json({ error: 'week invalide' }, { status: 400 })
    }
    const day = ref.getDay()
    const monday = new Date(ref)
    monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1))
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)

    const driverNames = body.driverNames && body.driverNames.length > 0 ? body.driverNames : null

    const assignments = await prisma.shiftAssignment.findMany({
      where: {
        slot: { date: { gte: monday, lte: sunday } },
        ...(driverNames ? { driverName: { in: driverNames } } : {}),
      },
      include: { slot: true },
    })

    // Group by driverName
    const byDriver = new Map<string, ShiftSlotLite[]>()
    for (const a of assignments) {
      const arr = byDriver.get(a.driverName) ?? []
      arr.push({
        date:      a.slot.date,
        startTime: a.slot.startTime,
        endTime:   a.slot.endTime,
        zone:      a.slot.zone,
      })
      byDriver.set(a.driverName, arr)
    }

    // Driver phone lookup (best effort by "firstName lastName")
    const drivers = await prisma.driver.findMany({ select: { firstName: true, lastName: true, phone: true } })
    const phoneMap = new Map<string, string>()
    for (const d of drivers) {
      phoneMap.set(`${d.firstName} ${d.lastName}`.trim(), d.phone)
    }

    let sent = 0
    let failed = 0
    const details: { driverName: string; ok: boolean; reason?: string }[] = []

    for (const [driverName, slots] of byDriver.entries()) {
      const phone = phoneMap.get(driverName)
      if (!phone) {
        failed += 1
        details.push({ driverName, ok: false, reason: 'no_phone' })
        continue
      }
      const ok = await sendWhatsApp(phone, formatShiftPlanning(driverName, slots))
      if (ok) {
        sent += 1
        details.push({ driverName, ok: true })
      } else {
        failed += 1
        details.push({ driverName, ok: false, reason: 'send_failed' })
      }
    }

    return NextResponse.json({ sent, failed, details })
  } catch (e) {
    console.error('[api/shifts/notify-whatsapp]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
