/**
 * lib/ops-slots.ts — les créneaux de livraison officiels (fonction pure, sans import).
 *
 * L'activité n'a que 4 créneaux de 3 h. Les exports back-office contiennent des fenêtres décalées
 * (08-11, 10-13, 11-14, 13-16, 14-17, 16-19, 17-20, 19-22, 20-23…) : chaque commande est RATTACHÉE
 * au créneau officiel le plus proche (par heure de début) pour la prévision, le dispatch et le BI.
 * L'heure PROMISE au client (slotStart / slotEnd) n'est jamais modifiée : les retards restent calculés dessus.
 *
 * Pour changer les créneaux : modifier SLOTS (heure de début locale → libellé).
 */
export const SLOTS: { label: string; startHour: number }[] = [
  { label: '09-12', startHour: 9 },
  { label: '12-15', startHour: 12 },
  { label: '15-18', startHour: 15 },
  { label: '18-21', startHour: 18 },
]
export const SLOT_LABELS = SLOTS.map(s => s.label)

const TZ_MS = 3_600_000 // Africa/Casablanca UTC+1

/** Créneau officiel d'une commande à partir de l'heure de début promise (ISO ou ms). */
export function canonicalSlot(slotStart: string | number | Date): string {
  const ms = typeof slotStart === 'number' ? slotStart : new Date(slotStart).getTime()
  const d = new Date(ms + TZ_MS)
  const h = d.getUTCHours() + d.getUTCMinutes() / 60
  let best = SLOTS[0], bd = Infinity
  for (const s of SLOTS) { const dist = Math.abs(h - s.startHour); if (dist < bd) { bd = dist; best = s } }
  return best.label
}
