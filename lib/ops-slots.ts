/**
 * lib/ops-slots.ts — les créneaux de livraison officiels (fonction pure).
 * Les exports back-office contiennent des fenêtres décalées (08-11, 10-13, 11-14, 13-16, 14-17, 16-19, 17-20, 19-22, 20-23…) :
 * chaque commande est RATTACHÉE au créneau officiel le plus proche (par heure de début) pour la prévision, le dispatch et le BI.
 * L'heure PROMISE au client (slotStart / slotEnd) n'est jamais modifiée : les retards restent calculés dessus.
 * Les créneaux se règlent dans Paramétrage → Calculs & équations (lib/ops-config.ts).
 */
import { CFG } from '@/lib/ops-config'
import { localHour } from '@/lib/tz'

export const slotLabels = () => CFG.slots.map(s => s.label)

/** Créneau officiel d'une commande à partir de l'heure de début promise (ISO ou ms). Heure locale réelle (Ramadan inclus). */
export function canonicalSlot(slotStart: string | number | Date): string {
  const ms = typeof slotStart === 'number' ? slotStart : new Date(slotStart).getTime()
  const h = localHour(ms)
  let best = CFG.slots[0], bd = Infinity
  for (const s of CFG.slots) { const dist = Math.abs(h - s.startHour); if (dist < bd) { bd = dist; best = s } }
  return best.label
}
