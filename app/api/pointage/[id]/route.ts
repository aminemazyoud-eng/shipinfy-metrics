import { requireSession } from '@/lib/api-guard'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'
import { guardCorrection, isCorrection, snapshot, deriveFields } from '@/lib/ops-attendance'

type RouteCtx = { params: Promise<{ id: string }> }
const STATUSES = ['present', 'late', 'absent', 'leave']

// PATCH /api/pointage/[id] — mettre à jour checkOut, statut, notes, hub (corrections tracées + verrou de période)
// Body: { checkOut?, status?, notes?, hub?, reason?, override? } — reason (≥ 3 car.) requis si une valeur déjà saisie est corrigée.
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const _guard = await requireSession(req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await ctx.params
    const body = await req.json() as { checkOut?: string; status?: string; notes?: string; hub?: string; reason?: string; override?: boolean }
    if (body.status && !STATUSES.includes(body.status)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    const co = body.checkOut ? new Date(body.checkOut) : undefined
    if (co && isNaN(co.getTime())) return NextResponse.json({ error: 'Heure invalide' }, { status: 400 })

    const before = await prisma.driverAttendance.findUnique({ where: { id } })
    if (!before) return NextResponse.json({ error: 'Pointage introuvable' }, { status: 404 })
    const day = before.date.toISOString().slice(0, 10)

    const g = await guardCorrection(_guard.session, day, {
      needsReason: isCorrection(before, { status: body.status, checkOut: co, notes: body.notes, hub: body.hub }),
      reason: body.reason, override: body.override,
    })
    if (g.error) return g.error

    const d = await deriveFields(before.driverName, day, { checkIn: before.checkIn, checkOut: co ?? before.checkOut, status: body.status ?? before.status }, !!body.status)
    const record = await prisma.driverAttendance.update({
      where: { id },
      data: {
        checkOut: co,
        status:   d.status,
        notes:    body.notes ?? undefined,
        hub:      body.hub   ?? undefined,
        workedMinutes: d.workedMinutes, lateMinutes: d.lateMinutes, plannedDepart: d.plannedDepart,
      },
    })

    await audit(_guard.session, 'pointage.update', 'attendance', id,
      { driverName: record.driverName, day, before: snapshot(before), after: snapshot(record), reason: g.reason, override: g.overridden })
    return NextResponse.json(record)
  } catch (e) {
    console.error('[api/pointage/[id] PATCH]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// DELETE /api/pointage/[id]?reason=...  (ou corps { reason, override }) — motif obligatoire, journalisé
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const _guard = await requireSession(req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await ctx.params
    const url = new URL(req.url)
    let reason: unknown = url.searchParams.get('reason') ?? undefined
    let override: unknown = url.searchParams.get('override') === 'true' ? true : undefined
    try { const b = await req.json() as { reason?: string; override?: boolean }; reason = b.reason ?? reason; override = b.override ?? override } catch { /* pas de corps */ }

    const before = await prisma.driverAttendance.findUnique({ where: { id } })
    if (!before) return NextResponse.json({ error: 'Pointage introuvable' }, { status: 404 })
    const day = before.date.toISOString().slice(0, 10)

    const g = await guardCorrection(_guard.session, day, { needsReason: true, reason, override })
    if (g.error) return g.error

    await prisma.driverAttendance.delete({ where: { id } })
    await audit(_guard.session, 'pointage.delete', 'attendance', id,
      { driverName: before.driverName, day, before: snapshot(before), after: null, reason: g.reason, override: g.overridden })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/pointage/[id] DELETE]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
