import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'

// GET /api/ops/orders/:id/proofs — liste des preuves d'une commande (métadonnées SEULEMENT, jamais le champ data). DISPATCHER+.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const proofs = await prisma.opsProof.findMany({
      where: { orderId: id }, orderBy: { createdAt: 'asc' }, take: 50,
      select: { id: true, kind: true, takenAt: true, createdAt: true, bytes: true, driverCode: true, lat: true, lng: true, accuracy: true },
    })
    return NextResponse.json({ proofs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}
