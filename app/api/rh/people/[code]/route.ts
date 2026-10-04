import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'

const STATUSES = ['prospect', 'formation', 'quiz', 'valide', 'actif', 'inactif']

// PATCH /api/rh/people/D07 (ADMIN) — modification d'une fiche (seul l'admin peut modifier)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { code } = await ctx.params
    const b = await req.json() as Record<string, unknown>
    const cur = await prisma.opsDriver.findUnique({ where: { code } })
    if (!cur) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
    const s = (k: string) => (b[k] === undefined ? undefined : b[k] === '' || b[k] === null ? null : String(b[k]))
    const dt = (k: string) => (b[k] === undefined ? undefined : b[k] ? new Date(String(b[k])) : null)
    const num = (k: string) => (b[k] === undefined ? undefined : b[k] === '' || b[k] === null ? null : Number(b[k]))
    if (b.onboardingStatus !== undefined && !STATUSES.includes(String(b.onboardingStatus))) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    const hub = b.hubCode ? await prisma.opsHub.findUnique({ where: { code: String(b.hubCode) } }) : undefined

    const data = {
      firstName: s('firstName') ?? undefined, lastName: s('lastName') ?? undefined, phone: s('phone'), cin: s('cin'), address: s('address'), licenseNo: s('licenseNo'), notes: s('notes'),
      birthDate: dt('birthDate'), hireDate: dt('hireDate'), contractType: s('contractType') ?? undefined,
      onboardingStatus: s('onboardingStatus') ?? undefined, trainingDone: b.trainingDone === undefined ? undefined : !!b.trainingDone, quizScore: num('quizScore'),
      status: s('status') ?? undefined, dailyRate: num('dailyRate') ?? undefined, vehicleId: b.vehicleId === undefined ? undefined : b.vehicleId ? String(b.vehicleId) : null,
      ...(hub ? { hubId: hub.id } : {}),
    }
    await prisma.opsDriver.update({ where: { code }, data })
    await audit(auth.session, 'rh.person_update', 'driver', code, Object.keys(b))
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
