// lib/timezone.ts
//
// CONVENTION (Sprint 17 B6) :
//  - `toMoroccoTime` ne sert QU'AUX IMPORTS EXCEL : le back-office exporte des dates « murales » marocaines sans fuseau, parsées
//    comme si elles étaient UTC ; on ajoute donc le décalage pour retrouver l'instant réel. Il reste un +1 h forfaitaire car le
//    fichier source n'indique pas la période (Ramadan) ; pour ce cas précis, utiliser localParts() de lib/tz.ts si la date exacte est connue.
//  - Pour TOUT le reste (jour local, bornes de journée, créneaux, pointage, paie, cron) : utiliser lib/tz.ts (Africa/Casablanca réel via Intl).
const MOROCCO_OFFSET_MS = 60 * 60 * 1000 // import Excel uniquement — voir la convention ci-dessus

export function toMoroccoTime(rawValue: unknown): Date | null {
  if (!rawValue) return null
  const utcDate = new Date(String(rawValue))
  if (isNaN(utcDate.getTime())) return null
  return new Date(utcDate.getTime() + MOROCCO_OFFSET_MS)
}

export function formatMoroccoDate(date: Date | string | null | undefined, withTime = false): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  if (withTime) {
    return d.toLocaleString('fr-MA', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }
  return d.toLocaleDateString('fr-MA', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
}
