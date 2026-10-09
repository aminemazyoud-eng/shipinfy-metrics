/**
 * lib/ops-config.ts — TOUS les paramètres de calcul du module Opérations, au même endroit (fonction pure, sans import).
 * Valeurs par défaut ci-dessous ; elles sont surchargées par Paramétrage → Calculs & équations (table OpsSetting),
 * appliquées côté serveur par lib/ops-settings.ts (applyOpsSettings) à chaque appel d'une route /api/ops/*.
 */
export interface OpsConfig {
  // Créneaux officiels (heure de début locale → libellé)
  slots: { label: string; startHour: number }[]
  // Prévisions
  perDriverPerSlot: number   // commandes qu'une équipe (chauffeur + helper) peut traiter par créneau
  tenseThreshold: number     // charge ≥ ce ratio → « tendu »
  saturatedThreshold: number // charge ≥ ce ratio → « saturé »
  historyDays: number        // profondeur d'historique utilisée (jours)
  minDayOrders: number       // un jour d'historique n'est retenu que s'il a au moins N commandes
  // Suivi / retards
  atRiskMinutes: number      // « à risque » : fin de créneau dans moins de N minutes
  // Dispatch
  autoDistWeight: number     // poids de la distance (km) dans l'auto-dispatch (charge = 1 par commande)
  // Flotte
  fuelPriceDiesel: number    // MAD / litre
  fuelPriceEssence: number
  consumptionAlertPct: number // alerte si L/100 réel > théorique + N %
  docAlertDays: number       // alerte documents (permis, visite, assurance, vignette…) sous N jours
  maintKmMargin: number      // alerte entretien à N km de l'échéance
  // Scoring
  scoreCritical: number      // score < N → critique
  scoreGood: number          // score ≥ N → excellent
  // Caisse
  cashGapAlert: number       // clôture de caisse : alerte si |écart| > N MAD
  // Preuves de livraison & géolocalisation (Sprint 20)
  geofenceMeters: number          // pointage d'arrivée « conforme » si le livreur est à ≤ N m du hub
  deliveryGeofenceMeters: number  // livraison « conforme » si la position est à ≤ N m de l'adresse
  proofRequired: ProofRequired    // preuve exigée pour livrer : code ou photo / photo / code
}

export const PROOF_REQUIRED_VALUES = ['otp_or_photo', 'photo', 'otp'] as const
export type ProofRequired = (typeof PROOF_REQUIRED_VALUES)[number]

/** Bornes des paramètres qui en ont une (le reste : nombre fini ≥ 0). */
export const CFG_BOUNDS: Partial<Record<keyof OpsConfig, [number, number]>> = { geofenceMeters: [50, 2000], deliveryGeofenceMeters: [50, 2000] }

/**
 * Valide une valeur de paramètre : nombre dans les bornes (arrondi à l'unité pour les rayons), ou valeur d'une liste fermée.
 * Renvoie undefined si la valeur est refusée. Fonction pure.
 */
export function sanitizeCfgValue(k: keyof OpsConfig, v: unknown): number | ProofRequired | undefined {
  if (k === 'proofRequired') return typeof v === 'string' && (PROOF_REQUIRED_VALUES as readonly string[]).includes(v) ? (v as ProofRequired) : undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  const b = CFG_BOUNDS[k]
  if (!b) return v
  return v >= b[0] && v <= b[1] ? Math.round(v) : undefined
}

export const DEFAULT_CFG: OpsConfig = {
  slots: [{ label: '09-12', startHour: 9 }, { label: '12-15', startHour: 12 }, { label: '15-18', startHour: 15 }, { label: '18-21', startHour: 18 }],
  perDriverPerSlot: 3, tenseThreshold: 0.7, saturatedThreshold: 1, historyDays: 42, minDayOrders: 20,
  atRiskMinutes: 45, autoDistWeight: 0.25,
  fuelPriceDiesel: 11.4, fuelPriceEssence: 13.6, consumptionAlertPct: 15, docAlertDays: 30, maintKmMargin: 500,
  scoreCritical: 60, scoreGood: 80,
  cashGapAlert: 50,
  geofenceMeters: 300, deliveryGeofenceMeters: 300, proofRequired: 'otp_or_photo',
}

/** Configuration vivante (mutable) lue par les fonctions de calcul. */
export const CFG: OpsConfig = { ...DEFAULT_CFG, slots: DEFAULT_CFG.slots.map(s => ({ ...s })) }

export function setCfg(partial: Partial<OpsConfig>) {
  for (const k of Object.keys(partial) as (keyof OpsConfig)[]) {
    const v = partial[k]
    if (v === undefined || v === null) continue
    if (k === 'slots') { if (Array.isArray(v) && v.length) CFG.slots = (v as OpsConfig['slots']).map(s => ({ label: String(s.label), startHour: Number(s.startHour) })); continue }
    const sv = sanitizeCfgValue(k, v)
    if (sv !== undefined) (CFG as unknown as Record<string, number | string>)[k] = sv
  }
}
