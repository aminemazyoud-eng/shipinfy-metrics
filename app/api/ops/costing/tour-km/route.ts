import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'

const DAY_RE = /^\d{4}-\d\d-\d\d$/
const km = (v: unknown): number | null | undefined => (v === undefined ? undefined : v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2_000_000 ? v : undefined)

// PATCH /api/ops/costing/tour-km { tourId | (day + driverCode [+ rotation]), kmStart?, kmEnd? } — saisie rapide du kilométrage d'une tournée.
// Crée l'OpsTour (rotation 1 par défaut) si elle n'existe pas. DISPATCHER+. Les km alimentent le carburant/entretien du Chiffrage (sinon estimés).
export async function PATCH(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
    const kmStart = km(b.kmStart), kmEnd = km(b.kmEnd)
    if (kmStart === undefined && kmEnd === undefined) return NextResponse.json({ error: 'kmStart ou kmEnd requis (nombre ≥ 0)' }, { status: 400 })
    const data = { ...(kmStart !== undefined ? { kmStart } : {}), ...(kmEnd !== undefined ? { kmEnd } : {}) }

    let tour
    if (typeof b.tourId === 'string' && b.tourId) {
      const cur = await prisma.opsTour.findUnique({ where: { id: b.tourId } })
      if (!cur) return NextResponse.json({ error: 'Tournée introuvable' }, { status: 404 })
      const s = kmStart !== undefined ? kmStart : cur.kmStart, e = kmEnd !== undefined ? kmEnd : cur.kmEnd
      if (s != null && e != null && e < s) return NextResponse.json({ error: 'Le km d’arrivée doit être supérieur au km de départ' }, { status: 400 })
      tour = await prisma.opsTour.update({ where: { id: cur.id }, data })
    } else {
      const day = String(b.day ?? ''), driverCode = String(b.driverCode ?? '').trim()
      const rotation = Number.isInteger(b.rotation) && (b.rotation as number) >= 1 && (b.rotation as number) <= 30 ? (b.rotation as number) : 1
      if (!DAY_RE.test(day) || !driverCode) return NextResponse.json({ error: 'tourId, ou day (YYYY-MM-DD) + driverCode, requis' }, { status: 400 })
      const drv = await prisma.opsDriver.findUnique({ where: { code: driverCode }, include: { vehicle: { select: { plate: true } }, hub: { select: { code: true } } } })
      if (!drv) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })
      const cur = await prisma.opsTour.findUnique({ where: { day_driverCode_rotation: { day, driverCode, rotation } } })
      const s = kmStart !== undefined ? kmStart : cur?.kmStart ?? null, e = kmEnd !== undefined ? kmEnd : cur?.kmEnd ?? null
      if (s != null && e != null && e < s) return NextResponse.json({ error: 'Le km d’arrivée doit être supérieur au km de départ' }, { status: 400 })
      tour = await prisma.opsTour.upsert({
        where: { day_driverCode_rotation: { day, driverCode, rotation } }, update: data,
        create: { day, driverCode, rotation, hubCode: drv.hub?.code ?? null, vehicleRef: drv.vehicle?.plate ?? null, ...data },
      })
    }
    await audit(auth.session, 'costing.tour-km', 'tour', tour.id, { day: tour.day, driverCode: tour.driverCode, rotation: tour.rotation, kmStart: tour.kmStart, kmEnd: tour.kmEnd }, tour.hubCode)
    return NextResponse.json({ ok: true, tour: { id: tour.id, day: tour.day, driverCode: tour.driverCode, rotation: tour.rotation, vehicleRef: tour.vehicleRef, kmStart: tour.kmStart, kmEnd: tour.kmEnd, km: tour.kmStart != null && tour.kmEnd != null ? tour.kmEnd - tour.kmStart : null } })
  } catch (e) { return fail(e) }
}
