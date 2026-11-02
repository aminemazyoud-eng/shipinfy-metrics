import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOfTz } from '@/lib/tz'
import { loadLeaderboard } from '@/lib/ops-pilot'
import { scorecardMessage } from '@/lib/ops-scorecard'
import { normalizePhone } from '@/lib/ops-planning'
import { sendWhatsApp, whatsappConfigured } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

// POST /api/ops/scorecards { days?: 7, send?: boolean }
// Construit la scorecard de chaque livreur classé ; send=true l'envoie par WhatsApp si un fournisseur est configuré,
// sinon (ou send=false) renvoie des liens wa.me prêts à l'emploi. Rien n'est envoyé sans send=true explicite.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json().catch(() => ({})) as { days?: number; send?: boolean }
    const days = Math.min(30, Math.max(1, Math.round(Number(body.days) || 7)))
    const lb = await loadLeaderboard(dayOfTz('today'), days)
    const ids = Object.values(lb).flat().map(s => s.driverId)
    const drivers = await prisma.opsDriver.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, phone: true } })
    const info = new Map(drivers.map(d => [d.id, d]))
    const live = !!body.send && whatsappConfigured()
    const results: { driverId: string; name: string; hub: string; rank: number; status: 'sent' | 'failed' | 'no_phone' | 'manual'; waLink?: string }[] = []
    for (const [hub, rows] of Object.entries(lb)) for (const s of rows) {
      const d = info.get(s.driverId), phone = normalizePhone(d?.phone)
      const r: (typeof results)[number] = { driverId: s.driverId, name: d?.firstName ?? s.driverId, hub, rank: s.rank, status: 'no_phone' }
      if (phone) {
        const text = scorecardMessage(r.name, s, rows.length, days)
        r.waLink = `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(text)}`
        r.status = 'manual'
        if (live) r.status = (await sendWhatsApp(phone, text)) ? 'sent' : 'failed'
      }
      results.push(r)
    }
    const count = (st: string) => results.filter(r => r.status === st).length
    await audit(auth.session, 'scorecards.send', 'driver', null, { days, send: live, sent: count('sent'), failed: count('failed'), manual: count('manual'), noPhone: count('no_phone') })
    return NextResponse.json({ ok: true, whatsapp: live, results })
  } catch (e) { return fail(e) }
}
