import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { buildWave, loadWave, waveToCsv, type WaveLot } from '@/lib/ops-waves'
import { loadRouteSettings } from '@/lib/ops-route'
import { dayOfTz } from '@/lib/tz'
import { CFG } from '@/lib/ops-config'
import { xlsxResponse } from '@/lib/xlsx-response'
import { bumpOpsEpoch } from '@/lib/ops-cache'

export const dynamic = 'force-dynamic'

const slotOk = (s: unknown): s is string => typeof s === 'string' && CFG.slots.some(x => x.label === s)
const view = (lots: WaveLot[]) => lots.map(l => ({
  n: l.n, waveId: l.waveId, sector: l.sector, hubCode: l.hubCode, earliestEnd: new Date(l.earliestEnd).toISOString(),
  orders: l.orders.map((o, i) => ({ rank: i + 1, id: o.id, ref: o.ref, district: o.district, sector: o.sector, slot: o.slot, slotEnd: new Date(o.slotEnd).toISOString(), status: o.status, address: o.address ?? null, customer: o.customer ?? null, lat: o.lat, lng: o.lng, extended: !!o.extended })),
}))

// GET /api/ops/waves?day=today&slot=12-15&hub=CAS-MM[&format=xlsx] — lots enregistrés, dans l'ordre de préparation
// → { day, slot, hub, params:{target,max,widenMin}, slots:[labels], lots:[{ n, waveId, sector, hubCode, orders:[{ rank, ref, … }] }], orders }
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = dayOfTz(sp.get('day')), slot = sp.get('slot') ?? '', hub = sp.get('hub') || null
    const s = await loadRouteSettings()
    const params = { target: s.waveTarget, max: s.waveMax, widenMin: s.waveWidenMin }
    if (!slotOk(slot)) return NextResponse.json({ day, slot: null, hub, params, slots: CFG.slots.map(x => x.label), lots: [], orders: 0 })
    const lots = await loadWave({ day, slot, hub })
    if (sp.get('format') === 'xlsx') return xlsxResponse(waveToCsv(lots), `vague-${day}-${slot}${hub ? '-' + hub : ''}`, 'Vague')
    return NextResponse.json({ day, slot, hub, params, slots: CFG.slots.map(x => x.label), lots: view(lots), orders: lots.reduce((n, l) => n + l.orders.length, 0) })
  } catch (e) { return fail(e) }
}

// POST /api/ops/waves { day?, slot, hub?, widenMin?, target?, max?, dryRun? } — calcule les lots (dryRun) ou les enregistre (OpsOrder.waveId)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json().catch(() => null) as { day?: string; slot?: string; hub?: string; widenMin?: number; target?: number; max?: number; dryRun?: boolean } | null
    if (!b || !slotOk(b.slot)) return NextResponse.json({ error: 'Créneau invalide' }, { status: 400 })
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined)
    const day = dayOfTz(b.day), hub = typeof b.hub === 'string' && b.hub ? b.hub : null
    const r = await buildWave({ day, slot: b.slot, hub, widenMin: num(b.widenMin, 0, 360), target: num(b.target, 1, 20), max: num(b.max, 1, 30), dryRun: !!b.dryRun })
    if (!b.dryRun) { bumpOpsEpoch(); await audit(auth.session, 'wave.build', 'wave', null, { day, slot: b.slot, hub, lots: r.lots.length, orders: r.orders, extended: r.extended, cleared: r.cleared }, hub) }
    return NextResponse.json({ ok: true, dryRun: !!b.dryRun, day, slot: b.slot, hub, params: r.params, orders: r.orders, extended: r.extended, cleared: r.cleared, lots: view(r.lots) })
  } catch (e) { return fail(e) }
}
