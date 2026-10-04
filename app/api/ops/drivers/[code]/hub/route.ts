import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { localToday, attendanceKey } from '@/lib/ops-time'

// POST /api/ops/drivers/D07/hub { hubCode: "CAS-MM", permanent?: boolean }
// Switch d'un livreur (et de son véhicule) vers un autre hub. Les commandes déjà en cours restent à lui.
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { code } = await ctx.params
    const { hubCode, permanent } = await req.json() as { hubCode: string; permanent?: boolean }
    const [driver, hub] = await Promise.all([
      prisma.opsDriver.findUnique({ where: { code }, include: { hub: { select: { code: true } } } }),
      prisma.opsHub.findUnique({ where: { code: hubCode } }),
    ])
    if (!driver) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })
    if (!hub) return NextResponse.json({ error: 'Hub inconnu' }, { status: 404 })
    if (driver.hubId === hub.id) return NextResponse.json({ ok: true, unchanged: true })

    await prisma.$transaction([
      prisma.opsDriver.update({ where: { id: driver.id }, data: { hubId: hub.id, ...(permanent ? { homeHubId: hub.id } : {}) } }),
      ...(driver.vehicleId ? [prisma.opsVehicle.update({ where: { id: driver.vehicleId }, data: { hubId: hub.id } })] : []),
      prisma.opsAttendance.updateMany({ where: { driverId: driver.id, date: attendanceKey(localToday()) }, data: { hubCode: hub.code } }),
    ])
    await audit(auth.session, 'driver.hub_switch', 'driver', driver.code, { from: driver.hub?.code ?? null, to: hub.code, permanent: !!permanent }, hub.code)
    return NextResponse.json({ ok: true, from: driver.hub?.code ?? null, to: hub.code })
  } catch (e) { return fail(e) }
}
