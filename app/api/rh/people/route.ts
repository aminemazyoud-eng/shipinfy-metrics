import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'

import { contractReady, drivingStatus } from '@/lib/rh'

// GET /api/rh/people?type=chauffeur|helper|all&q=  — base du personnel (fiche, hub, véhicule, parcours d'intégration)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const type = sp.get('type'), q = sp.get('q')?.trim()
    const rows = await prisma.opsDriver.findMany({
      where: { ...(type && type !== 'all' ? { jobType: type } : {}), ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { cin: { contains: q, mode: 'insensitive' } }] } : {}) },
      include: { hub: { select: { code: true, name: true, city: true } }, vehicle: { select: { id: true, plate: true } } }, orderBy: [{ jobType: 'asc' }, { code: 'asc' }],
    })
    return NextResponse.json({
      canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role),
      people: rows.map(p => ({
        code: p.code, firstName: p.firstName, lastName: p.lastName, jobType: p.jobType, phone: p.phone, cin: p.cin, address: p.address, birthDate: p.birthDate, hireDate: p.hireDate, licenseNo: p.licenseNo,
        contractType: p.contractType, licenseExpiry: p.licenseExpiry, licenseCategory: p.licenseCategory, medicalVisitExpiry: p.medicalVisitExpiry, driving: drivingStatus(p), status: p.status, onboardingStatus: p.onboardingStatus, trainingDone: p.trainingDone, quizScore: p.quizScore, dailyRate: p.dailyRate, notes: p.notes,
        hubCode: p.hub?.code ?? null, hubName: p.hub?.name ?? null, city: p.hub?.city ?? null, vehicleId: p.vehicle?.id ?? null, vehiclePlate: p.vehicle?.plate ?? null,
        contractGeneratedAt: p.contractGeneratedAt, contractReady: contractReady(p),
      })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/rh/people (ADMIN) — nouveau chauffeur / helper ; démarre le parcours (prospect → formation → quiz → validé → actif)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Record<string, string | number | undefined>
    if (!b.firstName || !b.lastName) return NextResponse.json({ error: 'Nom et prénom requis' }, { status: 400 })
    const jobType = b.jobType === 'helper' ? 'helper' : 'chauffeur'
    const prefix = jobType === 'helper' ? 'H' : 'D'
    const last = await prisma.opsDriver.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
    const next = Math.max(0, ...last.map(l => Number(l.code.slice(1)) || 0)) + 1
    const hub = b.hubCode ? await prisma.opsHub.findUnique({ where: { code: String(b.hubCode) } }) : null
    const cfg = await prisma.opsPayConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
    const p = await prisma.opsDriver.create({
      data: {
        code: `${prefix}${String(next).padStart(2, '0')}`, firstName: String(b.firstName), lastName: String(b.lastName), phone: b.phone ? String(b.phone) : null, jobType,
        cin: b.cin ? String(b.cin) : null, address: b.address ? String(b.address) : null, birthDate: b.birthDate ? new Date(String(b.birthDate)) : null, licenseNo: b.licenseNo ? String(b.licenseNo) : null, licenseCategory: b.licenseCategory ? String(b.licenseCategory) : null, licenseExpiry: b.licenseExpiry ? new Date(String(b.licenseExpiry)) : null, medicalVisitExpiry: b.medicalVisitExpiry ? new Date(String(b.medicalVisitExpiry)) : null,
        contractType: ['CDI', 'CDD', 'Prestation'].includes(String(b.contractType)) ? String(b.contractType) : 'CDD', hireDate: b.hireDate ? new Date(String(b.hireDate)) : null,
        hubId: hub?.id ?? null, homeHubId: hub?.id ?? null, vehicleId: b.vehicleId ? String(b.vehicleId) : null,
        dailyRate: b.dailyRate !== undefined && b.dailyRate !== '' ? Number(b.dailyRate) : jobType === 'helper' ? cfg.helperDailyRate : cfg.dailyRate,
        onboardingStatus: 'prospect', trainingDone: false, status: 'active',
      },
    })
    await audit(auth.session, 'rh.person_create', 'driver', p.code, { name: `${p.firstName} ${p.lastName}`, jobType })
    return NextResponse.json({ ok: true, code: p.code })
  } catch (e) { return fail(e) }
}
