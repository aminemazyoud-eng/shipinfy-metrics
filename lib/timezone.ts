// lib/timezone.ts
const MOROCCO_OFFSET_MS = 60 * 60 * 1000 // UTC+1 fixe

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
