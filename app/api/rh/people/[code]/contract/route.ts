import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { buildContractPdf } from '@/lib/contract-pdf'
import { QUIZ_PASS, contractReady } from '@/lib/rh'

// GET /api/rh/people/D07/contract — PDF du contrat. Réservé aux profils ayant terminé la formation et réussi le quiz (ou déjà actifs).
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const { code } = await ctx.params
    const p = await prisma.opsDriver.findUnique({ where: { code }, include: { hub: true, vehicle: true } })
    if (!p) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
    if (!contractReady(p)) return NextResponse.json({ error: `Contrat impossible : formation terminée et quiz ≥ ${QUIZ_PASS} % requis (formation ${p.trainingDone ? 'OK' : 'non terminée'}, quiz ${p.quizScore ?? 'non passé'}).` }, { status: 409 })
    const cfg = await prisma.opsPayConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
    const pdf = await buildContractPdf({
      code: p.code, firstName: p.firstName, lastName: p.lastName, jobType: p.jobType === 'helper' ? 'helper' : 'chauffeur', cin: p.cin, address: p.address, birthDate: p.birthDate, licenseNo: p.licenseNo,
      contractType: p.contractType, hireDate: p.hireDate, hubName: p.hub?.name ?? null, city: p.hub?.city ?? null, vehiclePlate: p.vehicle?.plate ?? null, dailyRate: p.dailyRate,
    }, cfg)
    await prisma.opsDriver.update({ where: { code }, data: { contractGeneratedAt: new Date() } })
    await audit(auth.session, 'rh.contract', 'driver', code, { type: p.contractType })
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="contrat_${p.code}_${p.lastName}.pdf"` } })
  } catch (e) { return fail(e) }
}
