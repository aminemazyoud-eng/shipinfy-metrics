/**
 * lib/ops-waves.ts — vagues de préparation (Agent C).
 * Pour un créneau (et un hub), les commandes À PRÉPARER (READY_PICKUP / ASSIGNED) sont regroupées par secteur puis découpées en LOTS de
 * 3 à 4 commandes (taille cible / max paramétrables). L'ordre de préparation suit les lots géographiques, pas l'ordre d'arrivée.
 * Fenêtre élargie (« cut-off + N min », défaut 120) : les commandes du créneau SUIVANT dont le début tombe dans cette fenêtre sont
 * ajoutées à la vague (marquées « élargie ») pour mieux remplir les lots.
 * Partie PURE : lotSizes, buildLots, waveId, parseWaveId. Partie base : buildWave / loadWave (import dynamique de prisma).
 * waveId = W<YYYYMMDD>-<créneau>-<hub|ALL>-L<nn>  (ex. W20261010-12-15-CAS-MM-L03). Écrit dans OpsOrder.waveId.
 */
import { nearestNeighbour, twoOpt, toPt, type Pt } from '@/lib/ops-route'
import { haversineM } from '@/lib/geo'

export interface WaveOrder {
  id: string; ref: string; lat: number | null; lng: number | null; sector: string | null; district: string | null; hubCode: string | null
  slot: string; slotStart: number; slotEnd: number; status: string; address?: string | null; customer?: string | null; extended?: boolean
}
export interface WaveLot { n: number; waveId: string; sector: string | null; hubCode: string | null; orders: WaveOrder[]; earliestEnd: number }

export const waveDayKey = (day: string) => day.replace(/-/g, '')
export const wavePrefix = (day: string, slot: string, hub?: string | null) => `W${waveDayKey(day)}-${slot}-${hub ? hub + '-L' : ''}`
export const waveId = (day: string, slot: string, hub: string | null | undefined, n: number) => `W${waveDayKey(day)}-${slot}-${hub || 'ALL'}-L${String(n).padStart(2, '0')}`
export function parseWaveId(id: string | null | undefined): { lot: number } | null {
  const m = /-L(\d{2,3})$/.exec(id ?? '')
  return m ? { lot: Number(m[1]) } : null
}

/** Tailles de lots : un seul lot si n ≤ max ; sinon ceil(n / cible) lots répartis à parts égales (jamais au-delà de max). */
export function lotSizes(n: number, target: number, max: number): number[] {
  if (n <= 0) return []
  const t = Math.max(1, target), m = Math.max(t, max)
  if (n <= m) return [n]
  let k = Math.ceil(n / t)
  while (Math.ceil(n / k) > m) k++
  return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0))
}

const centroid = (os: WaveOrder[]): Pt | null => {
  const ps = os.map(toPt).filter((x): x is Pt => !!x)
  return ps.length ? { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length } : null
}
const d = (a: Pt, b: Pt) => haversineM(a.lat, a.lng, b.lat, b.lng)

/**
 * Lots pour UN créneau. `hubPts` = coordonnées des hubs (départ du chemin de préparation). Les secteurs de moins de `minGroup` commandes
 * sont fusionnés avec le secteur le plus proche du même hub. Lots numérotés par urgence (fin de créneau la plus proche) puis proximité du hub.
 */
export function buildLots(orders: WaveOrder[], day: string, slot: string, hubFilter: string | null, opts: { target: number; max: number; minGroup?: number; hubPts?: Record<string, Pt | null> }): WaveLot[] {
  const minGroup = opts.minGroup ?? 2
  const byHub = new Map<string, WaveOrder[]>()
  for (const o of orders) (byHub.get(o.hubCode ?? '') ?? byHub.set(o.hubCode ?? '', []).get(o.hubCode ?? '')!).push(o)
  const raw: { sector: string | null; hubCode: string | null; orders: WaveOrder[] }[] = []
  for (const [hub, list] of byHub) {
    const groups = new Map<string, WaveOrder[]>()
    for (const o of list) (groups.get(o.sector ?? '') ?? groups.set(o.sector ?? '', []).get(o.sector ?? '')!).push(o)
    // fusion des petits secteurs avec le plus proche
    let changed = true
    while (changed && groups.size > 1) {
      changed = false
      const small = [...groups.entries()].filter(([, g]) => g.length < minGroup).sort((a, b) => a[1].length - b[1].length)[0]
      if (!small) break
      const cs = centroid(small[1])
      let best: string | null = null, bd = Infinity
      for (const [k, g] of groups) {
        if (k === small[0]) continue
        const c = centroid(g)
        const dd = cs && c ? d(cs, c) : 1e9
        if (dd < bd) { bd = dd; best = k }
      }
      if (best != null) { groups.get(best)!.push(...small[1]); groups.delete(small[0]); changed = true }
    }
    const hubPt = (hub && opts.hubPts?.[hub]) || null
    for (const [sec, g] of groups) {
      // chemin de préparation : NN + 2-opt depuis le hub → chaque lot = tronçon consécutif = voisinage géographique
      const withPt = g.filter(o => toPt(o)), noPt = g.filter(o => !toPt(o))
      const pts = withPt.map(o => toPt(o) as Pt)
      const ord = twoOpt(hubPt, pts, nearestNeighbour(hubPt, pts))
      const seq = [...ord.map(i => withPt[i]), ...noPt]
      let off = 0
      for (const sz of lotSizes(seq.length, opts.target, opts.max)) { raw.push({ sector: sec || null, hubCode: hub || null, orders: seq.slice(off, off + sz) }); off += sz }
    }
  }
  const keyed = raw.map(l => ({ ...l, earliestEnd: Math.min(...l.orders.map(o => o.slotEnd)), dh: (() => { const hp = (l.hubCode && opts.hubPts?.[l.hubCode]) || null; const c = centroid(l.orders); return hp && c ? d(hp, c) : 0 })() }))
    .sort((a, b) => a.earliestEnd - b.earliestEnd || a.dh - b.dh || (a.sector ?? '').localeCompare(b.sector ?? ''))
  return keyed.map((l, i) => ({ n: i + 1, waveId: waveId(day, slot, hubFilter, i + 1), sector: l.sector, hubCode: l.hubCode, orders: l.orders, earliestEnd: l.earliestEnd }))
}

// ── Base ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface WaveRequest { day: string; slot: string; hub?: string | null; widenMin?: number; target?: number; max?: number }
const PREP_STATUSES = ['READY_PICKUP', 'ASSIGNED']

async function candidates(req: WaveRequest, widenMin: number): Promise<WaveOrder[]> {
  const { prisma } = await import('@/lib/prisma')
  const { dayBoundsTz, dayStartUtc } = await import('@/lib/tz')
  const { CFG } = await import('@/lib/ops-config')
  const { canonicalSlot } = await import('@/lib/ops-slots')
  const { from, to } = dayBoundsTz(req.day)
  const sl = CFG.slots.find(s => s.label === req.slot)
  const rows = await prisma.opsOrder.findMany({
    where: { slotStart: { gte: from, lt: to }, status: { in: PREP_STATUSES }, ...(req.hub ? { hubCode: req.hub } : {}) },
    select: { id: true, reference: true, externalId: true, lat: true, lng: true, sectorCode: true, district: true, hubCode: true, slotStart: true, slotEnd: true, status: true, address: true, customerName: true },
    take: 5000,
  })
  const startMs = sl ? dayStartUtc(req.day) + sl.startHour * 3_600_000 : null
  const endMs = startMs != null ? startMs + 3 * 3_600_000 : null
  const out: WaveOrder[] = []
  for (const r of rows) {
    const slot = canonicalSlot(r.slotStart)
    const t = r.slotStart.getTime()
    const extended = slot !== req.slot && endMs != null && widenMin > 0 && t >= endMs && t < endMs + widenMin * 60_000
    if (slot !== req.slot && !extended) continue
    out.push({ id: r.id, ref: r.reference ?? r.externalId, lat: r.lat, lng: r.lng, sector: r.sectorCode, district: r.district, hubCode: r.hubCode, slot, slotStart: t, slotEnd: r.slotEnd.getTime(), status: r.status, address: r.address, customer: r.customerName, extended })
  }
  return out
}

async function hubPoints(): Promise<Record<string, Pt | null>> {
  const { prisma } = await import('@/lib/prisma')
  const hubs = await prisma.opsHub.findMany({ select: { code: true, lat: true, lng: true } })
  return Object.fromEntries(hubs.map(h => [h.code, toPt(h)]))
}

/** Calcule (et, sauf dryRun, écrit OpsOrder.waveId) les lots d'un créneau. Idempotent : relancer donne le même résultat. */
export async function buildWave(req: WaveRequest & { dryRun?: boolean }): Promise<{ lots: WaveLot[]; orders: number; extended: number; cleared: number; params: { target: number; max: number; widenMin: number } }> {
  const { loadRouteSettings } = await import('@/lib/ops-route')
  const s = await loadRouteSettings()
  const target = req.target ?? s.waveTarget, max = Math.max(target, req.max ?? s.waveMax), widenMin = req.widenMin ?? s.waveWidenMin
  const orders = await candidates(req, widenMin)
  const lots = buildLots(orders, req.day, req.slot, req.hub ?? null, { target, max, hubPts: await hubPoints() })
  let cleared = 0
  if (!req.dryRun) {
    const { prisma } = await import('@/lib/prisma')
    const prefix = wavePrefix(req.day, req.slot, req.hub ?? null)
    const allIds = lots.flatMap(l => l.orders.map(o => o.id))
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wave:' + prefix}))`
      // libère les commandes qui ne sont plus dans la vague (sauf si déjà chargées : statut hors préparation)
      cleared = Number(await tx.$executeRaw`UPDATE "OpsOrder" SET "waveId" = NULL WHERE starts_with("waveId", ${prefix}) AND "status" IN ('READY_PICKUP','ASSIGNED') AND NOT ("id" = ANY(${allIds}::text[]))`)
      for (const l of lots) {
        // CAS : seulement les commandes encore à préparer et libres ou déjà dans CETTE vague
        await tx.$executeRaw`UPDATE "OpsOrder" SET "waveId" = ${l.waveId} WHERE "id" = ANY(${l.orders.map(o => o.id)}::text[]) AND "status" IN ('READY_PICKUP','ASSIGNED') AND ("waveId" IS NULL OR starts_with("waveId", ${prefix}))`
      }
    }, { timeout: 30_000 })
  }
  return { lots, orders: orders.length, extended: orders.filter(o => o.extended).length, cleared, params: { target, max, widenMin } }
}

/** Relit la vague enregistrée (waveId) et rend les lots dans l'ordre de préparation. */
export async function loadWave(req: { day: string; slot: string; hub?: string | null }): Promise<WaveLot[]> {
  const { prisma } = await import('@/lib/prisma')
  const { canonicalSlot } = await import('@/lib/ops-slots')
  const prefix = wavePrefix(req.day, req.slot, req.hub ?? null)
  const rows = await prisma.opsOrder.findMany({
    where: { waveId: { startsWith: prefix } },
    select: { id: true, reference: true, externalId: true, lat: true, lng: true, sectorCode: true, district: true, hubCode: true, slotStart: true, slotEnd: true, status: true, address: true, customerName: true, waveId: true },
    take: 5000,
  })
  const hubPts = await hubPoints()
  const by = new Map<string, typeof rows>()
  for (const r of rows) (by.get(r.waveId as string) ?? by.set(r.waveId as string, []).get(r.waveId as string)!).push(r)
  const lots: WaveLot[] = []
  for (const [wid, list] of by) {
    const hub = list[0].hubCode
    const hp = (hub && hubPts[hub]) || null
    const wo: WaveOrder[] = list.map(r => ({ id: r.id, ref: r.reference ?? r.externalId, lat: r.lat, lng: r.lng, sector: r.sectorCode, district: r.district, hubCode: r.hubCode, slot: canonicalSlot(r.slotStart), slotStart: r.slotStart.getTime(), slotEnd: r.slotEnd.getTime(), status: r.status, address: r.address, customer: r.customerName, extended: canonicalSlot(r.slotStart) !== req.slot }))
    const withPt = wo.filter(o => toPt(o)), noPt = wo.filter(o => !toPt(o))
    const pts = withPt.map(o => toPt(o) as Pt)
    const seq = [...twoOpt(hp, pts, nearestNeighbour(hp, pts)).map(i => withPt[i]), ...noPt]
    lots.push({ n: parseWaveId(wid)?.lot ?? 0, waveId: wid, sector: list[0].sectorCode, hubCode: hub, orders: seq, earliestEnd: Math.min(...wo.map(o => o.slotEnd)) })
  }
  return lots.sort((a, b) => a.n - b.n || a.waveId.localeCompare(b.waveId))
}

const q = (v: unknown) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
/** CSV (séparateur « ; ») de la vague pour lib/xlsx-response.ts. */
export function waveToCsv(lots: WaveLot[]): string {
  const head = ['Lot', 'Rang', 'Référence', 'Secteur', 'Quartier', 'Hub', 'Créneau', 'Statut', 'Adresse', 'Élargie']
  const rows = lots.flatMap(l => l.orders.map((o, i) => [l.n, i + 1, o.ref, l.sector ?? '', o.district ?? '', o.hubCode ?? '', o.slot, o.status, o.address ?? '', o.extended ? 'oui' : 'non']))
  return '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\n')
}
