import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { allowedProofMime } from '@/lib/ops-proof-view'

// GET /api/ops/proofs/:id — renvoie l'IMAGE d'une preuve (donnée sensible : session obligatoire, DISPATCHER+, jamais public).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const p = await prisma.opsProof.findUnique({ where: { id }, select: { id: true, orderId: true, mime: true, data: true } })
    const mime = p ? allowedProofMime(p.mime) : null
    if (!p || !mime) return NextResponse.json({ error: 'Preuve introuvable' }, { status: 404 })
    const buf = Buffer.from(p.data, 'base64')
    if (!buf.length) return NextResponse.json({ error: 'Preuve introuvable' }, { status: 404 })
    await audit(auth.session, 'proof.view', 'proof', p.id, { orderId: p.orderId }) // aucune donnée personnelle
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime, 'Content-Length': String(buf.length), 'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) { return fail(e) }
}
