// Parcours d'une commande : étapes horodatées, délai entre chaque étape et couleur (vert / ambre / rouge).
// Fonctions pures (aucun import) — utilisées par les routes API ; le client reçoit les étapes déjà calculées.

export type Tone = 'green' | 'amber' | 'red' | 'none'
export interface Step { key: string; label: string; at: string | null; delayMin: number | null; tone: Tone; late?: number; inferred?: boolean }

// Délai accepté (minutes) depuis l'étape précédente : [vert jusqu'à, ambre jusqu'à] — au-delà : rouge
const LIMITS: Record<string, [number, number]> = { ASSIGNED: [15, 30], IN_TRANSPORT: [10, 20], START_DELIVERY: [30, 60], DELIVERED: [45, 90], NO_SHOW: [45, 90], COLLECTED: [120, 480] }
const LABEL: Record<string, string> = { RECEIVED: 'Reçue', ASSIGNED: 'Assignée', IN_TRANSPORT: 'Acceptée', START_DELIVERY: 'En livraison', DELIVERED: 'Livrée', NO_SHOW: 'NO_SHOW', COLLECTED: 'Encaissée' }

export const toneOf = (key: string, min: number | null): Tone => {
  if (min == null) return 'none'
  const l = LIMITS[key]; if (!l) return 'green'
  return min <= l[0] ? 'green' : min <= l[1] ? 'amber' : 'red'
}

export function buildSteps(o: {
  createdAt: Date | null; events: { to: string; at: Date; inferred?: boolean }[]; deliveredAt: Date | null; noShowAt: Date | null; collectedAt: Date | null; slotEnd: Date
}): { steps: Step[]; totalMin: number | null } {
  const first = (s: string) => o.events.filter(e => e.to === s).map(e => e.at.getTime()).sort((a, b) => a - b)[0]
  const times: [string, number | undefined][] = [
    ['RECEIVED', o.createdAt?.getTime() ?? first('READY_PICKUP')],
    ['ASSIGNED', first('ASSIGNED')], ['IN_TRANSPORT', first('IN_TRANSPORT')], ['START_DELIVERY', first('START_DELIVERY')],
    [o.noShowAt && !o.deliveredAt ? 'NO_SHOW' : 'DELIVERED', o.deliveredAt?.getTime() ?? o.noShowAt?.getTime() ?? first('DELIVERED') ?? first('NO_SHOW')],
    ['COLLECTED', o.collectedAt?.getTime() ?? first('COLLECTED')],
  ]
  const isInferred = (s: string) => { const e = o.events.filter(x => x.to === s); return e.length > 0 && e.every(x => x.inferred) }
  let prev: number | null = null, prevReal = true, start: number | null = null, end: number | null = null
  const steps: Step[] = times.map(([key, ms]) => {
    if (ms == null) return { key, label: LABEL[key], at: null, delayMin: null, tone: 'none' as Tone }
    const inferred = key !== 'RECEIVED' && key !== 'COLLECTED' && isInferred(key === 'NO_SHOW' ? 'NO_SHOW' : key) && !(key === 'DELIVERED' && o.deliveredAt)
    // un horodatage estimé n'est ni mesuré ni coloré ; un délai n'est jugé que s'il sépare deux étapes réellement mesurées
    const delay = prev == null || inferred || !prevReal ? null : Math.max(0, Math.round((ms - prev) / 60_000))
    prev = ms; prevReal = !inferred; if (start == null) start = ms; end = ms
    const step: Step = { key, label: LABEL[key], at: new Date(ms).toISOString(), delayMin: delay, tone: key === 'RECEIVED' ? 'green' : inferred ? 'none' : toneOf(key, delay), ...(inferred ? { inferred: true } : {}) }
    if (key === 'DELIVERED' && ms > o.slotEnd.getTime()) step.late = Math.round((ms - o.slotEnd.getTime()) / 60_000)
    return step
  })
  return { steps, totalMin: start != null && end != null ? Math.round((end - start) / 60_000) : null }
}

export const fmtDuration = (min: number | null) => (min == null ? '' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`)
