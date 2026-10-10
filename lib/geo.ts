/**
 * lib/geo.ts — fonctions pures de géolocalisation et de contrôle de fichier image (Sprint 20, application livreur).
 * Aucune dépendance : testable sans base ni serveur.
 */

const R_EARTH_M = 6_371_008.8 // rayon moyen de la Terre (m)
const rad = (d: number) => (d * Math.PI) / 180

/** Distance orthodromique (haversine) en mètres entre deux points GPS. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Coordonnées GPS plausibles (finies, dans les bornes terrestres, hors point nul 0/0 généré par un GPS défaillant). */
export function validLatLng(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

export interface GeoCheck { lat: number; lng: number; distanceM: number; ok: boolean }

/**
 * Contrôle « souple » : distance entre la position déclarée et la cible, ok = distance <= rayon.
 * Renvoie null si l'une des deux positions manque ou est invalide (le champ ok reste alors null en base).
 */
export function geoCheck(geo: { lat?: unknown; lng?: unknown } | null | undefined, target: { lat?: number | null; lng?: number | null }, radiusM: number): GeoCheck | null {
  if (!geo || !validLatLng(geo.lat, geo.lng)) return null
  if (!validLatLng(target.lat, target.lng)) return null
  const distanceM = Math.round(haversineM(geo.lat as number, geo.lng as number, target.lat as number, target.lng as number))
  return { lat: geo.lat as number, lng: geo.lng as number, distanceM, ok: distanceM <= radiusM }
}

/** Détecte le vrai format d'un fichier image par ses octets magiques (le type MIME déclaré par le client n'est pas fiable). */
export function sniffImage(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  // WEBP : « RIFF » + taille sur 4 octets + « WEBP »
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
  return null
}

export type GeoGate = { pass: true; check: GeoCheck | null } | { pass: false; code: 'OUT_OF_RANGE' | 'GEO_REQUIRED'; check: GeoCheck | null }

/**
 * Décision de géofence pour une action « à un endroit précis » (check-in au hub, arrivée chez le client).
 * - cible sans coordonnées valides : on ne peut rien prouver, l'action passe (check = null) ;
 * - mode 'soft' : l'action passe toujours, le contrôle sert de simple signalement (check.ok) ;
 * - mode 'block' : position absente => GEO_REQUIRED, distance > rayon => OUT_OF_RANGE.
 */
export function geoGate(geo: { lat?: unknown; lng?: unknown } | null | undefined, target: { lat?: number | null; lng?: number | null }, radiusM: number, mode: string): GeoGate {
  if (!validLatLng(target.lat, target.lng)) return { pass: true, check: null }
  const check = geoCheck(geo, target, radiusM)
  if (mode !== 'block') return { pass: true, check }
  if (!check) return { pass: false, code: 'GEO_REQUIRED', check: null }
  return check.ok ? { pass: true, check } : { pass: false, code: 'OUT_OF_RANGE', check }
}

export interface TrackPoint { lat: number; lng: number; at: number }

/** Échantillonnage du suivi GPS : on garde un point s'il est le premier, à >= minMs du dernier gardé, ou à >= minM mètres de lui. */
export function shouldKeepPoint(last: TrackPoint | null | undefined, p: TrackPoint, minMs = 30_000, minM = 50): boolean {
  if (!validLatLng(p.lat, p.lng)) return false
  if (!last) return true
  if (p.at - last.at >= minMs) return true
  return haversineM(last.lat, last.lng, p.lat, p.lng) >= minM
}

/** Liens de navigation 1 clic (Waze / Google Maps) vers une destination. Null si coordonnées invalides. */
export function navLinks(lat: number | null | undefined, lng: number | null | undefined): { waze: string; google: string } | null {
  if (!validLatLng(lat, lng)) return null
  return {
    waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  }
}
