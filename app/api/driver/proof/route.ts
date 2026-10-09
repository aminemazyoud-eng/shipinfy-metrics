import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { sniffImage, validLatLng } from '@/lib/geo'
import { MAX_PROOFS_PER_ORDER, PROOF_MAX_KB } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

const MIMES = ['image/jpeg', 'image/webp', 'image/png']
const KINDS = ['delivery', 'noshow', 'damage']
const MAX_B64 = Math.ceil(PROOF_MAX_KB * 1024 * 4 / 3) + 4
const DAY = 86_400_000

// POST /api/driver/proof — photo de preuve (base64). Idempotent par clientId ; signature réelle du fichier contrôlée ; 5 preuves max par commande.
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const cl = Number(req.headers.get('content-length') ?? 0)
    if (cl > MAX_B64 + 4096) return driverJson({ error: `Photo trop lourde (${PROOF_MAX_KB} Ko maximum)`, code: 'TOO_LARGE' }, 413)
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b) return driverJson({ error: 'Corps illisible' }, 400)
    const clientId = typeof b.clientId === 'string' ? b.clientId : ''
    const orderId = typeof b.orderId === 'string' ? b.orderId : ''
    const kind = typeof b.kind === 'string' ? b.kind : ''
    const mime = typeof b.mime === 'string' ? b.mime : ''
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId) || !orderId || !KINDS.includes(kind) || !MIMES.includes(mime)) return driverJson({ error: 'Paramètres invalides', code: 'BAD_REQUEST' }, 400)
    let b64 = typeof b.dataBase64 === 'string' ? b.dataBase64 : ''
    b64 = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
    if (!b64) return driverJson({ error: 'Photo manquante', code: 'BAD_REQUEST' }, 400)
    if (b64.length > MAX_B64) return driverJson({ error: `Photo trop lourde (${PROOF_MAX_KB} Ko maximum)`, code: 'TOO_LARGE' }, 413)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return driverJson({ error: 'Encodage invalide', code: 'BAD_REQUEST' }, 400)
    const buf = Buffer.from(b64, 'base64')
    if (buf.length > PROOF_MAX_KB * 1024) return driverJson({ error: `Photo trop lourde (${PROOF_MAX_KB} Ko maximum)`, code: 'TOO_LARGE' }, 413)
    // le type déclaré doit correspondre aux octets réels (un exécutable renommé en .jpg est refusé)
    if (sniffImage(buf) !== mime) return driverJson({ error: 'Le fichier n\'est pas une image valide', code: 'BAD_IMAGE' }, 415)

    // rejeu : même clientId => même preuve (jamais celle d'un autre livreur)
    const dup = await prisma.opsProof.findUnique({ where: { clientId }, select: { id: true, driverCode: true, orderId: true } })
    if (dup) return dup.driverCode === d.code && dup.orderId === orderId ? driverJson({ proofId: dup.id }) : driverJson({ error: 'Identifiant déjà utilisé', code: 'ID_CONFLICT' }, 409)

    const o = await prisma.opsOrder.findFirst({ where: { id: orderId, driverId: d.id }, select: { id: true, status: true, deliveredAt: true, noShowAt: true } })
    if (!o) return driverJson({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
    if (o.status === 'CANCELLED') return driverJson({ error: 'Commande annulée', code: 'ORDER_CLOSED' }, 409)
    const doneAt = o.status === 'DELIVERED' ? o.deliveredAt : o.status === 'NO_SHOW' ? o.noShowAt : null
    if ((o.status === 'DELIVERED' || o.status === 'NO_SHOW') && doneAt && Date.now() - doneAt.getTime() > DAY) return driverJson({ error: 'Commande terminée depuis plus de 24 h', code: 'ORDER_CLOSED' }, 409)
    if (await prisma.opsProof.count({ where: { orderId: o.id } }) >= MAX_PROOFS_PER_ORDER) return driverJson({ error: `${MAX_PROOFS_PER_ORDER} preuves maximum par commande`, code: 'PROOF_LIMIT' }, 409)

    const geo = b.geo as Record<string, unknown> | undefined
    const hasGeo = !!geo && validLatLng(geo.lat, geo.lng)
    const t = typeof b.takenAt === 'string' ? Date.parse(b.takenAt) : NaN
    const takenAt = Number.isFinite(t) && t <= Date.now() + 5 * 60_000 ? new Date(t) : null
    try {
      const p = await prisma.opsProof.create({
        data: {
          orderId: o.id, driverCode: d.code, kind, mime, bytes: buf.length, data: b64, clientId, takenAt,
          lat: hasGeo ? (geo!.lat as number) : null, lng: hasGeo ? (geo!.lng as number) : null,
          accuracy: hasGeo && typeof geo!.accuracy === 'number' && Number.isFinite(geo!.accuracy) ? (geo!.accuracy as number) : null,
        },
        select: { id: true },
      })
      return driverJson({ proofId: p.id })
    } catch (e) { // course sur le même clientId : on renvoie la preuve déjà créée
      const again = await prisma.opsProof.findUnique({ where: { clientId }, select: { id: true, driverCode: true } })
      if (again && again.driverCode === d.code) return driverJson({ proofId: again.id })
      throw e
    }
  } catch (e) { console.error('[api/driver/proof]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
