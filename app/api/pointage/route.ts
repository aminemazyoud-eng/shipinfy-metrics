import { requireSession } from '@/lib/api-guard'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'
import { guardCorrection, isCorrection, snapshot, deriveFields } from '@/lib/ops-attendance'

// GET /api/pointage?date=2026-04-12  (date = YYYY-MM-DD, defaults to today)
export async function GET(req: NextRequest) {
  const _guard = await requireSession(req, 'VIEWER'); if ('error' in _guard) return _guard.error
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


// POST /api/pointage — créer ou mettre à jour un pointage (corrections tracées, verrou de période)
// Body: { driverName, date, hub?, checkIn?, checkOut?, status?, notes?, role?, reason?, override? }
//   reason (>= 3 car.) obligatoire si le pointage existe déjà et qu'une valeur saisie est corrigée ;
//   période de paie validée -> 423, sauf ADMIN+ avec override:true + reason.
const STATUSES = ['present', 'late', 'absent', 'leave']
export async function POST(req: NextRequest) {
  const _guard = await requireSession(req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const body = await req.json() as {
      driverName: string; date: string
      hub?: string; checkIn?: string; checkOut?: string
      status?: string; notes?: string; role?: string
      reason?: string; override?: boolean
    }

    if (!body.driverName || !body.date || !/^\d{4}-\d\d-\d\d$/.test(body.date)) {
      return NextResponse.json({ error: 'driverName et date (YYYY-MM-DD) requis' }, { status: 400 })
    }
    if (body.status && !STATUSES.includes(body.status)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    const ci = body.checkIn ? new Date(body.checkIn) : undefined
    const co = body.checkOut ? new Date(body.checkOut) : undefined
    if ((ci && isNaN(ci.getTime())) || (co && isNaN(co.getTime()))) return NextResponse.json({ error: 'Heure invalide' }, { status: 400 })

    const dateKey = new Date(body.date + 'T00:00:00.000Z')
    const existing = await prisma.driverAttendance.findUnique({ where: { driverName_date: { driverName: body.driverName, date: dateKey } } })

    const g = await guardCorrection(_guard.session, body.date, {
      needsReason: isCorrection(existing, { status: body.status, checkIn: ci, checkOut: co, notes: body.notes, hub: body.hub }),
      reason: body.reason, override: body.override,
    })
    if (g.error) return g.error

    // Heures travaillées, retard et départ prévu (planning du jour) calculés côté serveur ; statut saisi respecté
    const d = await deriveFields(body.driverName, body.date, {
      checkIn: ci ?? existing?.checkIn ?? null, checkOut: co ?? existing?.checkOut ?? null, status: body.status ?? existing?.status ?? 'present',
    }, !!body.status)
    const calc = { workedMinutes: d.workedMinutes, lateMinutes: d.lateMinutes, plannedDepart: d.plannedDepart }

    const record = await prisma.driverAttendance.upsert({
      where:  { driverName_date: { driverName: body.driverName, date: dateKey } },
      create: {
        driverName: body.driverName,
        date:       dateKey,
        hub:        body.hub     ?? null,
        checkIn:    ci ?? null,
        checkOut:   co ?? null,
        status:     d.status,
        role:       body.role === 'PICKER' ? 'PICKER' : 'LIVREUR',
        notes:      body.notes   ?? null,
        ...calc,
      },
      update: {
        hub:      body.hub     ?? undefined,
        checkIn:  ci,
        checkOut: co,
        status:   d.status,
        role:     body.role === 'PICKER' ? 'PICKER' : body.role === 'LIVREUR' ? 'LIVREUR' : undefined,
        notes:    body.notes   ?? undefined,
        ...calc,
      },
    })

    await audit(_guard.session, existing ? 'pointage.update' : 'pointage.create', 'attendance', record.id,
      { driverName: record.driverName, day: body.date, before: snapshot(existing), after: snapshot(record), reason: g.reason, override: g.overridden })
    return NextResponse.json(record)
  } catch (e) {
    console.error('[api/pointage POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
