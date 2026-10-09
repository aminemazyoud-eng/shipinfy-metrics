import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'

export async function POST(request: Request) {
  const _guard = await requireSession(request, 'MANAGER'); if ('error' in _guard) return _guard.error
  try {
    const body = await request.json() as {
      reportId: string
      emails: string[]
      frequency: string
      time: string
      dayOfWeek?: number | null
      dayOfMonth?: number | null
    }

    const schedule = await prisma.scheduledReport.create({
      data: {
        reportId:   body.reportId,
        emails:     JSON.stringify(body.emails),
        frequency:  body.frequency,
        time:       body.time,
        dayOfWeek:  body.dayOfWeek  ?? null,
        dayOfMonth: body.dayOfMonth ?? null,
        isActive:   true,
      },
    })

    // Register immediately in the running cron scheduler (no restart needed)
    try {
      const { registerSchedule } = await import('@/lib/cron')
      registerSchedule(schedule.id, body.frequency, body.time, body.dayOfWeek, body.dayOfMonth)
    } catch {
      // Cron not available in Edge — will be picked up on next minute tick
    }

    await audit(_guard.session, 'report.schedule_create', 'scheduledReport', schedule.id, { reportId: body.reportId, frequency: body.frequency, time: body.time, recipients: body.emails?.length ?? 0 })
    return NextResponse.json({ success: true, scheduleId: schedule.id })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const _guard = await requireSession(req, 'MANAGER'); if ('error' in _guard) return _guard.error
  try {
    const schedules = await prisma.scheduledReport.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { sendLogs: { orderBy: { sentAt: 'desc' }, take: 5 } },
    })
    return NextResponse.json(schedules.map(s => ({
      ...s,
      emails: JSON.parse(s.emails) as string[],
    })))
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const _guard = await requireSession(request, 'MANAGER'); if ('error' in _guard) return _guard.error
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    await prisma.scheduledReport.update({
      where: { id },
      data:  { isActive: false },
    })

    try {
      const { unregisterSchedule } = await import('@/lib/cron')
      unregisterSchedule(id)
    } catch { /* noop */ }

    await audit(_guard.session, 'report.schedule_delete', 'scheduledReport', id)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
