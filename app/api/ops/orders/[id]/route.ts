import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'

// GET /api/ops/orders/:id — fiche commande : chronologie des statuts (OpsOrderEvent) + livreur + réclamations liées
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const o = await prisma.opsOrder.findUnique({
      where: { id },
      include: { events: { orderBy: { at: 'asc' } }, driver: { select: { code: true, firstName: true, lastName: true, phone: true, hub: { select: { name: true } } } } },
    })
    if (!o) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    const tickets = await prisma.supportTicket.findMany({ where: { orderRef: { in: [o.externalId, o.reference ?? '__'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, reference: true, subject: true, status: true, priority: true, createdAt: true } })
    return NextResponse.json({
      id: o.id, ref: o.reference || o.externalId, externalId: o.externalId, hubCode: o.hubCode, status: o.status, slotStart: o.slotStart, slotEnd: o.slotEnd, slotLabel: o.slotLabel,
      customer: o.customerName, address: o.address, district: o.district, amount: o.amount, attempts: o.attemptCount,
      driver: o.driver ? { code: o.driver.code, name: `${o.driver.firstName} ${o.driver.lastName}`, phone: o.driver.phone, hub: o.driver.hub?.name ?? null } : null,
      events: o.events.map(e => ({ from: e.fromStatus, to: e.toStatus, at: e.at, source: e.source })), tickets,
    })
  } catch (e) { return fail(e) }
}
