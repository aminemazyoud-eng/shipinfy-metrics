import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'

const TYPES = ['moto', 'utilitaire', 'van']
const DAY = 86_400_000

// GET /api/rh/vehicles — base des véhicules : fiche, équipe (chauffeur + helper), échéances assurance / visite technique
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const now = Date.now()
    const rows = await prisma.opsVehicle.findMany({ include: { hub: { select: { code: true, name: true } }, crew: { select: { code: true, firstName: true, lastName: true, jobType: true } } }, orderBy: [{ hubId: 'asc' }, { plate: 'asc' }] })
    const left = (d: Date | null) => (d ? Math.round((d.getTime() - now) / DAY) : null)
    return NextResponse.json({
      canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role),
      vehicles: rows.map(v => ({
        id: v.id, plate: v.plate, type: v.type, fuelType: v.fuelType, brand: v.brand, model: v.model, year: v.year, registrationNo: v.registrationNo, status: v.status, odometerKm: v.odometerKm, capacityKg: v.capacityKg,
        hubCode: v.hub?.code ?? null, hubName: v.hub?.name ?? null, insuranceExpiry: v.insuranceExpiry, technicalVisitExpiry: v.technicalVisitExpiry, insuranceDays: left(v.insuranceExpiry), visitDays: left(v.technicalVisitExpiry),
        chauffeur: v.crew.find(c => c.jobType === 'chauffeur') ? `${v.crew.find(c => c.jobType === 'chauffeur')!.firstName} ${v.crew.find(c => c.jobType === 'chauffeur')!.lastName}` : null,
        helper: v.crew.find(c => c.jobType === 'helper') ? `${v.crew.find(c => c.jobType === 'helper')!.firstName} ${v.crew.find(c => c.jobType === 'helper')!.lastName}` : null,
      })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/rh/vehicles (ADMIN) — nouveau véhicule
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Record<string, string | number | undefined>
    if (!b.plate) return NextResponse.json({ error: 'Immatriculation requise' }, { status: 400 })
    if (await prisma.opsVehicle.findUnique({ where: { plate: String(b.plate) } })) return NextResponse.json({ error: 'Immatriculation déjà enregistrée' }, { status: 409 })
    const hub = b.hubCode ? await prisma.opsHub.findUnique({ where: { code: String(b.hubCode) } }) : null
    const type = TYPES.includes(String(b.type)) ? String(b.type) : 'utilitaire'
    const v = await prisma.opsVehicle.create({
      data: {
        plate: String(b.plate), type, fuelType: b.fuelType === 'essence' ? 'essence' : 'diesel', brand: b.brand ? String(b.brand) : null, model: b.model ? String(b.model) : null, year: b.year ? Number(b.year) : null,
        registrationNo: b.registrationNo ? String(b.registrationNo) : null, capacityKg: b.capacityKg ? Number(b.capacityKg) : type === 'moto' ? 25 : type === 'van' ? 1200 : 600,
        consumptionL100: b.consumptionL100 ? Number(b.consumptionL100) : type === 'moto' ? 3.2 : type === 'van' ? 11 : 8.5, hubId: hub?.id ?? null,
        insuranceExpiry: b.insuranceExpiry ? new Date(String(b.insuranceExpiry)) : null, technicalVisitExpiry: b.technicalVisitExpiry ? new Date(String(b.technicalVisitExpiry)) : null,
      },
    })
    await audit(auth.session, 'rh.vehicle_create', 'vehicle', v.plate, { type })
    return NextResponse.json({ ok: true, id: v.id })
  } catch (e) { return fail(e) }
}
