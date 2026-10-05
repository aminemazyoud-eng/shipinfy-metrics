// Parcours obligatoire d'une commande : Reçue → Assignée → Acceptée → En livraison → Livrée (ou NO_SHOW) → Encaissée.
// On ne saute jamais d'étape : si le back-office ne fournit pas l'horodatage d'une étape intermédiaire, elle est reconstituée
// (horodatage ESTIMÉ, réparti entre l'étape connue précédente et la suivante) et marquée « inferred » — jamais présentée comme mesurée.
// Fonction pure (aucun import) : utilisée par la synchro et par le script de rattrapage.

const PATH = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY'] as const
export const TERMINAL = ['DELIVERED', 'NO_SHOW']

export interface ChainEvent { status: string; at: Date; inferred: boolean }

/** Étapes que la commande a nécessairement franchies pour être dans `status`. */
export function requiredPath(status: string): string[] {
  if (TERMINAL.includes(status)) return [...PATH, status]
  const i = PATH.indexOf(status as (typeof PATH)[number])
  return i < 0 ? [] : PATH.slice(0, i + 1) as unknown as string[]
}

export function fillChain(known: { status: string; at: Date }[], status: string): ChainEvent[] {
  const seq = requiredPath(status)
  const first = new Map<string, Date>()
  for (const k of [...known].sort((a, b) => a.at.getTime() - b.at.getTime())) if (!first.has(k.status)) first.set(k.status, k.at)
  const out: ChainEvent[] = []
  seq.forEach((s, i) => {
    const at = first.get(s)
    if (at) { out.push({ status: s, at, inferred: false }); return }
    // voisins connus avant / après
    let p = i - 1; while (p >= 0 && !first.has(seq[p])) p--
    let n = i + 1; while (n < seq.length && !first.has(seq[n])) n++
    const pt = p >= 0 ? first.get(seq[p])!.getTime() : null, nt = n < seq.length ? first.get(seq[n])!.getTime() : null
    let t: number
    if (pt != null && nt != null) t = pt + ((nt - pt) * (i - p)) / (n - p)
    else if (pt != null) t = pt + 60_000 * (i - p)
    else if (nt != null) t = nt - 60_000 * (n - i)
    else return // aucune étape connue : rien à reconstituer
    out.push({ status: s, at: new Date(Math.round(t)), inferred: true })
  })
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}
