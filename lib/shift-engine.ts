import { prisma } from '@/lib/prisma'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlotWithAssignments {
  id:          string
  zone:        string
  date:        Date
  startTime:   string
  endTime:     string
  maxDrivers:  number
  minDrivers:  number
  premiumOnly: boolean
  assignments: Array<{
    id:         string
    driverName: string
    scoreIA:    number | null
    priority:   boolean
    status:     string
  }>
}

// ─── Priorisation livreurs (source Prompt Master Sprint 10) ──────────────────
// score >= 80 → accès shifts 24h avant les autres
// score < 60  → accès uniquement si slots non remplis
export function canAccessSlot(
  scoreIA:     number,
  slotDate:    Date,
  requestedAt: Date,
): boolean {
  const msUntilSlot = slotDate.getTime() - requestedAt.getTime()
  const hoursUntil  = msUntilSlot / (1000 * 60 * 60)

  // Slots déjà passés ou dans moins de 0h → toujours accessible
  if (hoursUntil <= 0) return true

  // Score >= 80 → accès 24h avant (soit jusqu'à 48h à l'avance)
  if (scoreIA >= 80) return hoursUntil <= 48
  // Score 60-79 → accès standard 24h à l'avance
  if (scoreIA >= 60) return hoursUntil <= 24
  // Score < 60 → accès 12h avant seulement
  return hoursUntil <= 12
}

// ─── Assigner un livreur à un slot ───────────────────────────────────────────
export async function assignDriver(
  slotId:     string,
  driverName: string,
  scoreIA?:   number,
): Promise<{ ok: boolean; error?: string }> {
  const slot = await prisma.shiftSlot.findUnique({
    where:   { id: slotId },
    include: { assignments: true },
  })
  if (!slot) return { ok: false, error: 'Slot introuvable' }
  if (slot.assignments.length >= slot.maxDrivers) return { ok: false, error: 'Slot complet' }

  // Vérifier si déjà assigné
  const already = slot.assignments.find(a => a.driverName === driverName)
  if (already) return { ok: false, error: 'Livreur déjà assigné à ce slot' }

  // Accès premium requis (Academy R9) — si scoreIA undefined on autorise (pas de données)
  if (slot.premiumOnly && scoreIA !== undefined && scoreIA < 60) {
    return { ok: false, error: 'Score IA insuffisant pour ce slot premium (min 60)' }
  }

  const score    = scoreIA ?? null
  const priority = score !== null && score >= 80

  await prisma.shiftAssignment.create({
    data: { slotId, driverName, scoreIA: score, priority, status: 'assigned' },
  })
  return { ok: true }
}

// ─── Rééquilibrage zone (source Prompt Master — revenu minimum garanti) ──────
// Si trop de livreurs → supprimer les scores les plus bas jusqu'à maxDrivers
export async function rebalanceZone(zone: string, date: Date): Promise<void> {
  const slots = await prisma.shiftSlot.findMany({
    where:   { zone, date },
    include: { assignments: true },
  })
  for (const slot of slots) {
    if (slot.assignments.length <= slot.maxDrivers) continue
    const sorted  = [...slot.assignments].sort((a, b) => (a.scoreIA ?? 0) - (b.scoreIA ?? 0))
    const toRemove = sorted.slice(0, slot.assignments.length - slot.maxDrivers)
    for (const a of toRemove) {
      await prisma.shiftAssignment.delete({ where: { id: a.id } })
    }
  }
}
