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
}

export const DEFAULT_CFG: OpsConfig = {
  slots: [{ label: '09-12', startHour: 9 }, { label: '12-15', startHour: 12 }, { label: '15-18', startHour: 15 }, { label: '18-21', startHour: 18 }],
  perDriverPerSlot: 3, tenseThreshold: 0.7, saturatedThreshold: 1, historyDays: 42, minDayOrders: 20,
  atRiskMinutes: 45, autoDistWeight: 0.25,
  fuelPriceDiesel: 11.4, fuelPriceEssence: 13.6, consumptionAlertPct: 15, docAlertDays: 30, maintKmMargin: 500,
  scoreCritical: 60, scoreGood: 80,
  cashGapAlert: 50,
}

/** Configuration vivante (mutable) lue par les fonctions de calcul. */
export const CFG: OpsConfig = { ...DEFAULT_CFG, slots: DEFAULT_CFG.slots.map(s => ({ ...s })) }

export function setCfg(partial: Partial<OpsConfig>) {
  for (const k of Object.keys(partial) as (keyof OpsConfig)[]) {
    const v = partial[k]
    if (v === undefined || v === null) continue
    if (k === 'slots') { if (Array.isArray(v) && v.length) CFG.slots = (v as OpsConfig['slots']).map(s => ({ label: String(s.label), startHour: Number(s.startHour) })); continue }
    if (typeof v === 'number' && Number.isFinite(v)) (CFG as unknown as Record<string, number>)[k] = v
  }
}
