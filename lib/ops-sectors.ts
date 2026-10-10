/**
 * lib/ops-sectors.ts — secteurs de livraison (polygones) et étiquetage des commandes (Agent C).
 * Partie PURE (testable sans base) : parsePolygon, pointInPolygon, sectorFor. Partie base : import dynamique de prisma.
 * Étiquetage : (1) point GPS dans un polygone (le plus petit si plusieurs) ; (2) repli par quartier (`district`) si pas de GPS
 * ou hors de tous les polygones : le NOM du secteur peut lister des quartiers séparés par « / » (ex. « Maarif / Gauthier »).
 * Un secteur lié à un hub (hubCode) ne s'applique qu'aux commandes de ce hub. Jamais bloquant : toute erreur → pas d'étiquette.
 */
import { validLatLng } from '@/lib/geo'

export type LatLng = [number, number]
export const MAX_POLYGON_POINTS = 500

/** Accepte un tableau [[lat,lng],…], une chaîne JSON, ou un texte « lat,lng » une ligne par point. Renvoie null si invalide (< 3 points…). */
export function parsePolygon(raw: unknown): LatLng[] | null {
  let v: unknown = raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    if (t.startsWith('[')) { try { v = JSON.parse(t) } catch { return null } }
    else v = t.split(/\r?\n|;/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\s]+/).map(Number))
  }
  if (!Array.isArray(v) || v.length < 3 || v.length > MAX_POLYGON_POINTS) return null
  const out: LatLng[] = []
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2 || !validLatLng(Number(p[0]), Number(p[1]))) return null
    out.push([Number(p[0]), Number(p[1])])
  }
  return out
}

/** Point dans un polygone (lancer de rayon ; x = lng, y = lat). */
export function pointInPolygon(lat: number, lng: number, poly: LatLng[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const bboxArea = (poly: LatLng[]) => {
  const la = poly.map(p => p[0]), ln = poly.map(p => p[1])
  return (Math.max(...la) - Math.min(...la)) * (Math.max(...ln) - Math.min(...ln))
}

export const normText = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim()

/** Noms de quartiers portés par le nom d'un secteur : « Maarif / Gauthier » → ['maarif', 'gauthier'] (le nom entier compte aussi). */
export function districtNames(name: string): string[] {
  const all = [name, ...name.split(/[\/,;|]/)].map(normText).filter(Boolean)
  return [...new Set(all)]
}

export interface SectorLite { id?: string; code: string; name: string; hubCode: string | null; polygon: LatLng[]; active: boolean }
export interface SectorTarget { lat?: number | null; lng?: number | null; district?: string | null; hubCode?: string | null }

export function sectorFor(o: SectorTarget, sectors: SectorLite[]): { code: string; via: 'polygon' | 'district' } | null {
  const ok = sectors.filter(s => s.active && (!s.hubCode || !o.hubCode || s.hubCode === o.hubCode))
  if (validLatLng(o.lat, o.lng)) {
    const hits = ok.filter(s => s.polygon.length >= 3 && pointInPolygon(o.lat as number, o.lng as number, s.polygon))
    if (hits.length) return { code: hits.sort((a, b) => bboxArea(a.polygon) - bboxArea(b.polygon))[0].code, via: 'polygon' }
  }
  const d = normText(o.district)
  if (d) {
    const s = ok.find(x => districtNames(x.name).includes(d) || normText(x.code) === d)
    if (s) return { code: s.code, via: 'district' }
  }
  return null
}

// ── Base ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let cache: { at: number; v: SectorLite[] } | null = null
export const invalidateSectors = () => { cache = null }

export async function loadSectors(force = false): Promise<SectorLite[]> {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.v
  const { prisma } = await import('@/lib/prisma')
  const rows = await prisma.opsSector.findMany({ orderBy: { code: 'asc' } })
  const v = rows.map(r => ({ id: r.id, code: r.code, name: r.name, hubCode: r.hubCode, active: r.active, polygon: parsePolygon(r.polygon) ?? [] }))
  cache = { at: Date.now(), v }
  return v
}

/** Code de secteur d'une commande (null si aucun). Ne lève jamais d'exception. */
export async function tagOrderSector(o: SectorTarget): Promise<string | null> {
  try { return sectorFor(o, await loadSectors())?.code ?? null } catch { return null }
}

/**
 * Étiquette en lot les commandes (par id externe de la source) : à appeler à la synchro. Par défaut seules les commandes SANS secteur
 * sont traitées ; `force` recalcule tout (après modification d'un polygone). Renvoie le nombre de commandes modifiées. Jamais bloquant.
 */
export async function tagSectorsForExternal(source: string, externalIds: string[], opts: { force?: boolean } = {}): Promise<number> {
  try {
    if (!externalIds.length) return 0
    const sectors = await loadSectors()
    if (!sectors.some(s => s.active)) return 0
    const { prisma } = await import('@/lib/prisma')
    let n = 0
    for (let i = 0; i < externalIds.length; i += 500) {
      const rows = await prisma.opsOrder.findMany({
        where: { source, externalId: { in: externalIds.slice(i, i + 500) }, ...(opts.force ? {} : { sectorCode: null }) },
        select: { id: true, lat: true, lng: true, district: true, hubCode: true, sectorCode: true },
      })
      n += await applyTags(rows)
    }
    return n
  } catch (e) { console.warn('[ops-sectors] étiquetage ignoré:', e instanceof Error ? e.message : e); return 0 }
}

async function applyTags(rows: { id: string; lat: number | null; lng: number | null; district: string | null; hubCode: string | null; sectorCode: string | null }[]): Promise<number> {
  const sectors = await loadSectors()
  const { prisma } = await import('@/lib/prisma')
  const by = new Map<string | null, string[]>()
  for (const r of rows) {
    const code = sectorFor(r, sectors)?.code ?? null
    if (code === r.sectorCode) continue
    ;(by.get(code) ?? by.set(code, []).get(code)!).push(r.id)
  }
  let n = 0
  for (const [code, ids] of by) {
    for (let i = 0; i < ids.length; i += 1000) n += (await prisma.opsOrder.updateMany({ where: { id: { in: ids.slice(i, i + 1000) } }, data: { sectorCode: code } })).count
  }
  return n
}

/** Recalcule le secteur de toutes les commandes d'un jour local (après modification des polygones). */
export async function retagDay(day: string): Promise<{ scanned: number; changed: number }> {
  const { prisma } = await import('@/lib/prisma')
  const { dayBoundsTz } = await import('@/lib/tz')
  const { from, to } = dayBoundsTz(day)
  const rows = await prisma.opsOrder.findMany({ where: { slotStart: { gte: from, lt: to } }, select: { id: true, lat: true, lng: true, district: true, hubCode: true, sectorCode: true }, take: 20000 })
  return { scanned: rows.length, changed: await applyTags(rows) }
}

export interface SectorInput { id?: string; code: string; name: string; hubCode?: string | null; polygon: unknown; active?: boolean }

export function validateSectorInput(b: Partial<SectorInput> | null): { ok: true; value: { id?: string; code: string; name: string; hubCode: string | null; polygon: LatLng[]; active: boolean } } | { ok: false; error: string } {
  if (!b || typeof b !== 'object') return { ok: false, error: 'Corps invalide' }
  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : ''
  if (!/^[A-Z0-9_-]{1,24}$/.test(code)) return { ok: false, error: 'Code invalide (1 à 24 caractères : lettres, chiffres, - _)' }
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  if (!name) return { ok: false, error: 'Nom requis' }
  const empty = b.polygon == null || b.polygon === '' || (Array.isArray(b.polygon) && b.polygon.length === 0)
  const polygon = empty ? [] : parsePolygon(b.polygon)
  if (!polygon) return { ok: false, error: 'Polygone invalide : 3 points minimum, coordonnées [lat, lng] valides' }
  const hubCode = typeof b.hubCode === 'string' && b.hubCode.trim() ? b.hubCode.trim().slice(0, 40) : null
  return { ok: true, value: { id: typeof b.id === 'string' ? b.id : undefined, code, name, hubCode, polygon, active: b.active !== false } }
}
