/**
 * lib/ops-costing-core.ts — « Chiffrage » : coût par commande (logique PURE, aucun accès base, testable sous Node).
 *
 * Unité de calcul = la JOURNÉE-ÉQUIPE (jour × chauffeur) : chauffeur + helper (option) + charges patronales + carburant
 * + entretien + véhicule (amortissement / location / assurance par jour) + équipement SI.
 *   coût par commande = coût de la journée-équipe ÷ commandes livrées ce jour-là par l'équipe
 * Chaque valeur déduite (et non mesurée) est marquée `estimated` : l'écran et l'API disent toujours ce qui est réel ou estimé.
 *
 * Clés OpsCostParam (toutes en Float ; défauts dans COST_PARAM_DEFS — modifiables via PUT /api/ops/costing/params) :
 *   price.perOrder (0 = non renseigné → pas de marge) · target.costMin/costMax (cible coût/commande 20,31–27,08) · target.vehicleDayCost (650)
 *   target.rotationsPerDay (8) · target.ordersPerRotationMin/Max (3–4) · helper.enabled (1/0) · helper.dailyRateFallback · payroll.employerRatePct
 *   fuel.priceMad (0 = prix gasoil de Paramètres généraux) · fuel.defaultL100 · km.perOrderFallback · maint.provisionPerKm/provisionPerDay
 *   vehicle.depreciationPerDay/insurancePerDay/rentalPerDay · equipment.siPerDay · alert.* (seuils d'anomalies)
 */
export interface CostParamDef { key: string; label: string; unit: string; def: number; min: number; max: number; group: string; note: string }

export const COST_PARAM_DEFS: CostParamDef[] = [
  { key: 'price.perOrder', label: 'Prix facturé par commande', unit: 'MAD', def: 0, min: 0, max: 1000, group: 'Revenu', note: '0 = non renseigné : la marge n’est alors pas calculée.' },
  { key: 'target.costMin', label: 'Cible coût/commande (bas)', unit: 'MAD', def: 20.31, min: 0, max: 500, group: 'Objectifs', note: 'Borne basse de la cible du modèle.' },
  { key: 'target.costMax', label: 'Cible coût/commande (haut)', unit: 'MAD', def: 27.08, min: 0, max: 500, group: 'Objectifs', note: 'Au-delà : écart rouge/ambre.' },
  { key: 'target.vehicleDayCost', label: 'Coût véhicule-jour cible', unit: 'MAD', def: 650, min: 0, max: 5000, group: 'Objectifs', note: 'Modèle « chauffeur seul » : coût d’une équipe sur une journée.' },
  { key: 'target.rotationsPerDay', label: 'Rotations par jour (cible)', unit: 'rot.', def: 8, min: 1, max: 20, group: 'Objectifs', note: 'Modèle : 8 rotations/jour.' },
  { key: 'target.ordersPerRotationMin', label: 'Commandes/rotation (min cible)', unit: 'cmd', def: 3, min: 1, max: 20, group: 'Objectifs', note: '' },
  { key: 'target.ordersPerRotationMax', label: 'Commandes/rotation (max cible)', unit: 'cmd', def: 4, min: 1, max: 20, group: 'Objectifs', note: '' },
  { key: 'helper.enabled', label: 'Helper dans l’équipe (1 = oui, 0 = non)', unit: '0/1', def: 1, min: 0, max: 1, group: 'Équipe', note: '0 = le coût du helper est ignoré (scénario « chauffeur seul »).' },
  { key: 'helper.dailyRateFallback', label: 'Tarif helper par défaut', unit: 'MAD/j', def: 100, min: 0, max: 2000, group: 'Équipe', note: 'Utilisé si le helper n’a pas de tarif propre (barème de paie).' },
  { key: 'payroll.employerRatePct', label: 'CNSS / charges patronales', unit: '%', def: 21.09, min: 0, max: 60, group: 'Équipe', note: 'Estimation courante (≈ 21,09 % : AF 6,4 + PS 8,98 + AMO 4,11 + TFP 1,6) à valider avec votre comptable.' },
  { key: 'fuel.priceMad', label: 'Prix du gasoil', unit: 'MAD/L', def: 0, min: 0, max: 50, group: 'Carburant', note: '0 = reprend le prix de Paramétrage › Calculs & équations.' },
  { key: 'fuel.defaultL100', label: 'Consommation par défaut', unit: 'L/100 km', def: 12, min: 1, max: 60, group: 'Carburant', note: 'Si le véhicule n’a pas de consommation renseignée.' },
  { key: 'km.perOrderFallback', label: 'Km par commande (repli)', unit: 'km', def: 6, min: 0, max: 100, group: 'Carburant', note: 'Utilisé quand ni tournée ni mission n’ont de kilométrage : km marqués « estimés ».' },
  { key: 'maint.provisionPerKm', label: 'Provision entretien', unit: 'MAD/km', def: 0.45, min: 0, max: 20, group: 'Véhicule', note: 'Utilisée si aucun entretien réel n’est saisi sur la période.' },
  { key: 'maint.provisionPerDay', label: 'Provision entretien fixe', unit: 'MAD/j', def: 0, min: 0, max: 1000, group: 'Véhicule', note: '' },
  { key: 'vehicle.depreciationPerDay', label: 'Amortissement véhicule', unit: 'MAD/j', def: 120, min: 0, max: 5000, group: 'Véhicule', note: 'Valeur d’achat ÷ durée ÷ jours roulés.' },
  { key: 'vehicle.insurancePerDay', label: 'Assurance + vignette', unit: 'MAD/j', def: 25, min: 0, max: 1000, group: 'Véhicule', note: 'Les entretiens de type « assurance » ne sont pas recomptés.' },
  { key: 'vehicle.rentalPerDay', label: 'Location véhicule', unit: 'MAD/j', def: 0, min: 0, max: 5000, group: 'Véhicule', note: 'Si véhicule loué (remplace l’amortissement : mettre ce dernier à 0).' },
  { key: 'equipment.siPerDay', label: 'Équipement SI (téléphone, forfait, PDA)', unit: 'MAD/j', def: 15, min: 0, max: 500, group: 'Véhicule', note: '' },
  { key: 'alert.kmPerOrder', label: 'Alerte km/commande au-dessus de', unit: 'km', def: 12, min: 1, max: 200, group: 'Anomalies', note: '' },
  { key: 'alert.consumptionPct', label: 'Alerte consommation anormale', unit: '%', def: 15, min: 1, max: 200, group: 'Anomalies', note: 'Écart entre la consommation réelle (pleins ÷ km) et celle du véhicule.' },
  { key: 'alert.vehicleUtilPct', label: 'Véhicule sous-utilisé sous', unit: '%', def: 40, min: 1, max: 100, group: 'Anomalies', note: 'Part des jours d’activité de la flotte où le véhicule a roulé.' },
  { key: 'alert.lowRotationOrders', label: 'Rotation « vide » : au plus', unit: 'cmd', def: 2, min: 1, max: 10, group: 'Anomalies', note: '' },
  { key: 'alert.dayCostOverPct', label: 'Journée trop chère : cible haute +', unit: '%', def: 25, min: 1, max: 500, group: 'Anomalies', note: '' },
]

export type CostParams = Record<string, number>
export const DEFAULT_COST_PARAMS: CostParams = Object.fromEntries(COST_PARAM_DEFS.map(d => [d.key, d.def]))

/** Fusionne des surcharges (clé → valeur) sur les défauts ; ignore les clés inconnues et les valeurs non finies. */
export function resolveParams(overrides: Record<string, number | null | undefined>): CostParams {
  const out: CostParams = { ...DEFAULT_COST_PARAMS }
  for (const d of COST_PARAM_DEFS) { const v = overrides[d.key]; if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = v }
  return out
}

/** Valide une mise à jour de paramètres : { ok, clean } ou { ok:false, error }. */
export function validateParamUpdate(input: unknown): { ok: true; clean: Record<string, number> } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Corps invalide.' }
  const clean: Record<string, number> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const d = COST_PARAM_DEFS.find(x => x.key === k)
    if (!d) return { ok: false, error: `Paramètre inconnu : ${k}` }
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `Valeur invalide pour « ${d.label} ».` }
    if (v < d.min || v > d.max) return { ok: false, error: `« ${d.label} » doit être entre ${d.min} et ${d.max}.` }
    clean[k] = Math.round(v * 10000) / 10000
  }
  if (!Object.keys(clean).length) return { ok: false, error: 'Aucun paramètre à enregistrer.' }
  return { ok: true, clean }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10

// ── Entrées assemblées par lib/ops-costing.ts ───────────────────────────────────────────────────────
export interface TeamDayInput {
  day: string; driverCode: string; driverName: string; helperCode: string | null; vehicleId: string | null; plate: string | null; hubCode: string | null
  delivered: number
  byHub: Record<string, number>; bySlot: Record<string, number>
  rotationOrders: number[]            // commandes livrées par rotation (créneau ou tournée)
  rotationsFromTours: boolean         // true si le nombre de rotations vient d'OpsTour
  rotations: number                   // nombre de rotations (tournées si présentes, sinon créneaux distincts)
  kmTour: number | null; kmMission: number | null
  driverDaily: { amount: number; frozen: boolean }          // coût chauffeur de la journée (hors charges)
  helperDaily: { amount: number; frozen: boolean } | null   // null = pas de helper
  consumptionL100: number | null
}
export interface VehicleRange { fuelAmount: number | null; fuelLiters: number | null; maintAmount: number | null }

export interface CostBreakdown { driver: number; helper: number; charges: number; fuel: number; maintenance: number; vehicle: number; equipment: number; total: number }
export interface TeamDay {
  day: string; driverCode: string; driverName: string; helperCode: string | null; vehicleId: string | null; plate: string | null; hubCode: string | null
  delivered: number; rotations: number; rotationOrders: number[]; km: number; kmSource: 'tour' | 'mission' | 'estimated'
  liters: number | null; cost: CostBreakdown; costPerOrder: number | null; revenue: number; margin: number | null
  estimated: boolean; estimatedParts: string[]
  byHub: Record<string, number>; bySlot: Record<string, number>
}

/** Calcule les journées-équipes (carburant et entretien réels répartis par véhicule sur ses jours actifs, sinon estimés). */
export function computeTeamDays(inputs: TeamDayInput[], vehicles: Map<string, VehicleRange>, p: CostParams): TeamDay[] {
  const price = p['price.perOrder']
  const fuelPrice = p['fuel.priceMad'] > 0 ? p['fuel.priceMad'] : 11.4
  const kmOf = (t: TeamDayInput): { km: number; src: TeamDay['kmSource'] } => {
    if (t.kmTour != null && t.kmTour > 0) return { km: t.kmTour, src: 'tour' }
    if (t.kmMission != null && t.kmMission > 0) return { km: t.kmMission, src: 'mission' }
    return { km: t.delivered * p['km.perOrderFallback'], src: 'estimated' }
  }
  const kms = inputs.map(kmOf)
  // Parts par véhicule (clé = vehicleId) pour répartir les coûts réels : carburant au prorata des km, entretien à parts égales.
  const kmSumByVeh = new Map<string, number>(), daysByVeh = new Map<string, number>()
  inputs.forEach((t, i) => { if (!t.vehicleId) return; kmSumByVeh.set(t.vehicleId, (kmSumByVeh.get(t.vehicleId) ?? 0) + kms[i].km); daysByVeh.set(t.vehicleId, (daysByVeh.get(t.vehicleId) ?? 0) + 1) })

  return inputs.map((t, i) => {
    const { km, src } = kms[i]
    const est: string[] = []
    if (!t.driverDaily.frozen || (t.helperDaily && !t.helperDaily.frozen)) est.push('paie')
    if (src === 'estimated') est.push('km')
    if (!t.rotationsFromTours) est.push('rotations')

    const v = t.vehicleId ? vehicles.get(t.vehicleId) : undefined
    const days = t.vehicleId ? daysByVeh.get(t.vehicleId) ?? 1 : 1
    // carburant
    let fuel: number, liters: number | null
    if (v && v.fuelAmount != null && t.vehicleId) {
      const tot = kmSumByVeh.get(t.vehicleId) ?? 0
      const share = tot > 0 ? km / tot : 1 / days
      fuel = v.fuelAmount * share; liters = v.fuelLiters != null ? v.fuelLiters * share : null
    } else {
      const l100 = t.consumptionL100 && t.consumptionL100 > 0 ? t.consumptionL100 : p['fuel.defaultL100']
      liters = (km * l100) / 100; fuel = liters * fuelPrice; est.push('carburant')
    }
    // entretien
    let maint: number
    if (v && v.maintAmount != null && v.maintAmount > 0) maint = v.maintAmount / days
    else { maint = km * p['maint.provisionPerKm'] + p['maint.provisionPerDay']; est.push('entretien') }

    const driver = t.driverDaily.amount, helper = t.helperDaily ? t.helperDaily.amount : 0
    const charges = (driver + helper) * (p['payroll.employerRatePct'] / 100)
    const vehicle = p['vehicle.depreciationPerDay'] + p['vehicle.insurancePerDay'] + p['vehicle.rentalPerDay']
    const equipment = p['equipment.siPerDay']
    const total = driver + helper + charges + fuel + maint + vehicle + equipment
    const revenue = price > 0 ? t.delivered * price : 0
    return {
      day: t.day, driverCode: t.driverCode, driverName: t.driverName, helperCode: t.helperCode, vehicleId: t.vehicleId, plate: t.plate, hubCode: t.hubCode,
      delivered: t.delivered, rotations: t.rotations, rotationOrders: t.rotationOrders, km: r1(km), kmSource: src, liters: liters != null ? r1(liters) : null,
      cost: { driver: r2(driver), helper: r2(helper), charges: r2(charges), fuel: r2(fuel), maintenance: r2(maint), vehicle: r2(vehicle), equipment: r2(equipment), total: r2(total) },
      costPerOrder: t.delivered > 0 ? r2(total / t.delivered) : null, revenue: r2(revenue), margin: price > 0 ? r2(revenue - total) : null,
      estimated: est.some(x => x !== 'rotations') , estimatedParts: [...new Set(est)], byHub: t.byHub, bySlot: t.bySlot,
    }
  })
}

// ── Agrégations ─────────────────────────────────────────────────────────────────────────────────────
export type GroupBy = 'day' | 'vehicle' | 'driver' | 'hub' | 'month' | 'slot'
export const GROUP_BYS: GroupBy[] = ['day', 'vehicle', 'driver', 'hub', 'month', 'slot']
export type GapStatus = 'ok' | 'warn' | 'bad' | 'nd'
export interface GroupRow {
  key: string; label: string; orders: number; teamDays: number; km: number
  cost: number; costPerOrder: number | null; revenue: number; margin: number | null; marginPerOrder: number | null
  breakdown: CostBreakdown
  gapVsMax: number | null; gapPct: number | null; status: GapStatus
  estimated: boolean; estimatedCostPct: number
}
const zero = (): CostBreakdown => ({ driver: 0, helper: 0, charges: 0, fuel: 0, maintenance: 0, vehicle: 0, equipment: 0, total: 0 })

/** Statut d'un coût/commande vs la cible : ≤ max → ok ; ≤ max+10 % → warn ; au-delà → bad ; pas de commande → nd. */
export function gapOf(cpo: number | null, p: CostParams): { gapVsMax: number | null; gapPct: number | null; status: GapStatus } {
  if (cpo == null) return { gapVsMax: null, gapPct: null, status: 'nd' }
  const max = p['target.costMax']
  return { gapVsMax: r2(cpo - max), gapPct: max > 0 ? r1(((cpo - max) / max) * 100) : null, status: cpo <= max ? 'ok' : cpo <= max * 1.1 ? 'warn' : 'bad' }
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`

export function aggregate(days: TeamDay[], groupBy: GroupBy, p: CostParams): GroupRow[] {
  const acc = new Map<string, { label: string; orders: number; tds: Set<string>; km: number; bd: CostBreakdown; revenue: number; estCost: number }>()
  const price = p['price.perOrder']
  const add = (key: string, label: string, td: TeamDay, share: number, orders: number) => {
    const g = acc.get(key) ?? { label, orders: 0, tds: new Set<string>(), km: 0, bd: zero(), revenue: 0, estCost: 0 }
    g.orders += orders; g.tds.add(`${td.day}|${td.driverCode}`); g.km += td.km * share; g.revenue += price > 0 ? orders * price : 0
    for (const k of Object.keys(g.bd) as (keyof CostBreakdown)[]) g.bd[k] += td.cost[k] * share
    if (td.estimated) g.estCost += td.cost.total * share
    acc.set(key, g)
  }
  for (const td of days) {
    if (groupBy === 'hub' || groupBy === 'slot') {
      const dist = groupBy === 'hub' ? td.byHub : td.bySlot
      const entries = Object.entries(dist)
      if (!entries.length || td.delivered === 0) { add('—', 'Sans livraison', td, 1, 0); continue }
      for (const [k, n] of entries) add(k, k, td, n / td.delivered, n)
      continue
    }
    const [key, label] = groupBy === 'day' ? [td.day, td.day] : groupBy === 'month' ? [td.day.slice(0, 7), monthLabel(td.day.slice(0, 7))]
      : groupBy === 'vehicle' ? [td.plate ?? '—', td.plate ?? 'Sans véhicule'] : [td.driverCode, `${td.driverName} (${td.driverCode})`]
    add(key, label, td, 1, td.delivered)
  }
  const rows: GroupRow[] = [...acc.entries()].map(([key, g]) => {
    const cpo = g.orders > 0 ? r2(g.bd.total / g.orders) : null
    const bd = Object.fromEntries(Object.entries(g.bd).map(([k, v]) => [k, r2(v)])) as unknown as CostBreakdown
    return {
      key, label: g.label, orders: g.orders, teamDays: g.tds.size, km: r1(g.km), cost: r2(g.bd.total), costPerOrder: cpo,
      revenue: r2(g.revenue), margin: price > 0 ? r2(g.revenue - g.bd.total) : null, marginPerOrder: price > 0 && g.orders > 0 ? r2((g.revenue - g.bd.total) / g.orders) : null,
      breakdown: bd, ...gapOf(cpo, p), estimated: g.estCost > 0, estimatedCostPct: g.bd.total > 0 ? r1((g.estCost / g.bd.total) * 100) : 0,
    }
  })
  const num = (a: GroupRow, b: GroupRow) => (b.costPerOrder ?? -1) - (a.costPerOrder ?? -1)
  return groupBy === 'day' || groupBy === 'month' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort(num)
}

export interface CostSummary {
  orders: number; teamDays: number; km: number; cost: number; costPerOrder: number | null; revenue: number; margin: number | null; marginPerOrder: number | null
  avgDayCost: number | null; avgRotations: number | null; avgOrdersPerRotation: number | null; avgKmPerOrder: number | null
  breakdown: CostBreakdown; gapVsMax: number | null; gapPct: number | null; status: GapStatus; dayCostGap: number | null
  estimated: boolean; estimatedCostPct: number; estimatedParts: string[]
}
export function summarize(days: TeamDay[], p: CostParams): CostSummary {
  const bd = zero(); let orders = 0, km = 0, rot = 0, est = 0
  const parts = new Set<string>()
  for (const t of days) { orders += t.delivered; km += t.km; rot += t.rotations; for (const k of Object.keys(bd) as (keyof CostBreakdown)[]) bd[k] += t.cost[k]; if (t.estimated) est += t.cost.total; t.estimatedParts.forEach(x => parts.add(x)) }
  const price = p['price.perOrder'], revenue = price > 0 ? orders * price : 0
  const cpo = orders > 0 ? r2(bd.total / orders) : null
  const avgDay = days.length ? r2(bd.total / days.length) : null
  return {
    orders, teamDays: days.length, km: r1(km), cost: r2(bd.total), costPerOrder: cpo, revenue: r2(revenue),
    margin: price > 0 ? r2(revenue - bd.total) : null, marginPerOrder: price > 0 && orders > 0 ? r2((revenue - bd.total) / orders) : null,
    avgDayCost: avgDay, avgRotations: days.length ? r1(rot / days.length) : null, avgOrdersPerRotation: rot > 0 ? r1(orders / rot) : null, avgKmPerOrder: orders > 0 ? r1(km / orders) : null,
    breakdown: Object.fromEntries(Object.entries(bd).map(([k, v]) => [k, r2(v)])) as unknown as CostBreakdown,
    ...gapOf(cpo, p), dayCostGap: avgDay != null ? r2(avgDay - p['target.vehicleDayCost']) : null,
    estimated: est > 0, estimatedCostPct: bd.total > 0 ? r1((est / bd.total) * 100) : 0, estimatedParts: [...parts],
  }
}

// ── Simulateur d'optimisation ───────────────────────────────────────────────────────────────────────
export interface SimBase { driverDailyRate: number; helperDailyRate: number; bonusThreshold: number; bonusPerOrder: number; consumptionL100: number }
export interface SimInput {
  ordersPerRotation: number; rotationsPerDay: number; helper: boolean; fuelPrice: number; kmPerOrder: number
  base?: Partial<SimBase>; priceOverride?: number
}
export interface SimResult {
  input: { ordersPerRotation: number; rotationsPerDay: number; helper: boolean; fuelPrice: number; kmPerOrder: number }
  ordersPerDay: number; kmPerDay: number; cost: CostBreakdown; fixedCost: number; variablePerOrder: number
  costPerOrder: number | null; price: number; revenue: number; margin: number | null; marginPerOrder: number | null
  breakEvenOrdersPerDay: number | null; breakEvenOrdersPerRotation: number | null; breakEvenPrice: number | null
  gapVsMax: number | null; status: GapStatus; dayCostGap: number; inTarget: boolean
  estimated: true
}
export const DEFAULT_SIM_BASE: SimBase = { driverDailyRate: 150, helperDailyRate: 100, bonusThreshold: 10, bonusPerOrder: 5, consumptionL100: 12 }

export function simulate(inp: SimInput, p: CostParams): SimResult {
  const b = { ...DEFAULT_SIM_BASE, ...(inp.base ?? {}) }
  const opr = Math.max(0, inp.ordersPerRotation), rot = Math.max(0, inp.rotationsPerDay)
  const orders = opr * rot, km = orders * Math.max(0, inp.kmPerOrder)
  const helperOn = inp.helper
  const bonus = Math.max(0, orders - b.bonusThreshold) * b.bonusPerOrder
  const driver = b.driverDailyRate + bonus, helper = helperOn ? b.helperDailyRate : 0
  const charges = (driver + helper) * (p['payroll.employerRatePct'] / 100)
  const fuel = ((km * b.consumptionL100) / 100) * inp.fuelPrice
  const maint = km * p['maint.provisionPerKm'] + p['maint.provisionPerDay']
  const vehicle = p['vehicle.depreciationPerDay'] + p['vehicle.insurancePerDay'] + p['vehicle.rentalPerDay']
  const equipment = p['equipment.siPerDay']
  const total = driver + helper + charges + fuel + maint + vehicle + equipment
  const price = inp.priceOverride != null ? inp.priceOverride : p['price.perOrder']
  const cpo = orders > 0 ? total / orders : null
  // variable par commande = carburant + entretien au km + bonus marginal + charges sur ce bonus ; fixe = le reste
  const varPerOrder = Math.max(0, inp.kmPerOrder) * ((b.consumptionL100 / 100) * inp.fuelPrice + p['maint.provisionPerKm']) + (orders > b.bonusThreshold ? b.bonusPerOrder * (1 + p['payroll.employerRatePct'] / 100) : 0)
  const fixed = total - varPerOrder * orders
  const be = price > varPerOrder ? fixed / (price - varPerOrder) : null
  const g = gapOf(cpo != null ? r2(cpo) : null, p)
  return {
    input: { ordersPerRotation: opr, rotationsPerDay: rot, helper: helperOn, fuelPrice: inp.fuelPrice, kmPerOrder: inp.kmPerOrder },
    ordersPerDay: r1(orders), kmPerDay: r1(km),
    cost: { driver: r2(driver), helper: r2(helper), charges: r2(charges), fuel: r2(fuel), maintenance: r2(maint), vehicle: r2(vehicle), equipment: r2(equipment), total: r2(total) },
    fixedCost: r2(fixed), variablePerOrder: r2(varPerOrder), costPerOrder: cpo != null ? r2(cpo) : null, price,
    revenue: r2(orders * price), margin: price > 0 ? r2(orders * price - total) : null, marginPerOrder: price > 0 && orders > 0 ? r2(price - total / orders) : null,
    breakEvenOrdersPerDay: price > 0 && be != null ? r1(be) : null, breakEvenOrdersPerRotation: price > 0 && be != null && rot > 0 ? r1(be / rot) : null, breakEvenPrice: cpo != null ? r2(cpo) : null,
    gapVsMax: g.gapVsMax, status: g.status, dayCostGap: r2(total - p['target.vehicleDayCost']), inTarget: cpo != null && cpo >= 0 && cpo <= p['target.costMax'], estimated: true,
  }
}

export interface SimOutput { scenario: SimResult; withHelper: SimResult; withoutHelper: SimResult; sweep: { ordersPerRotation: number; costPerOrder: number | null; margin: number | null }[]; recommendations: string[]; estimated: true }

export function runSimulation(inp: SimInput, p: CostParams): SimOutput {
  const scenario = simulate(inp, p)
  const withHelper = simulate({ ...inp, helper: true }, p), withoutHelper = simulate({ ...inp, helper: false }, p)
  const sweep = [1, 2, 3, 4, 5, 6, 8].map(o => { const s = simulate({ ...inp, ordersPerRotation: o }, p); return { ordersPerRotation: o, costPerOrder: s.costPerOrder, margin: s.margin } })
  const rec: string[] = []
  const max = p['target.costMax']
  if (scenario.costPerOrder == null) rec.push('Aucune commande dans ce scénario : renseignez des commandes par rotation et des rotations.')
  else if (scenario.costPerOrder > max) {
    rec.push(`Coût/commande ${scenario.costPerOrder.toFixed(2)} MAD : ${(scenario.costPerOrder - max).toFixed(2)} MAD au-dessus de la cible haute (${max.toFixed(2)} MAD).`)
    let need: number | null = null
    for (let o = Math.ceil(inp.ordersPerRotation * 4) / 4; o <= 15; o += 0.25) { const s = simulate({ ...inp, ordersPerRotation: o }, p); if (s.costPerOrder != null && s.costPerOrder <= max) { need = o; break } }
    if (need != null) rec.push(`Atteindre la cible exige environ ${need.toFixed(2).replace(/\.?0+$/, '')} commandes par rotation (à ${inp.rotationsPerDay} rotations/jour).`)
    else rec.push('La cible n’est pas atteignable en jouant seulement sur les commandes par rotation : revoyez les coûts fixes (véhicule, équipe).')
    if (inp.helper && withoutHelper.costPerOrder != null) rec.push(`Sans helper : ${withoutHelper.costPerOrder.toFixed(2)} MAD/commande (${(scenario.costPerOrder - withoutHelper.costPerOrder).toFixed(2)} MAD de moins) — à arbitrer avec la capacité de chargement et la sécurité.`)
    if (inp.kmPerOrder > p['alert.kmPerOrder'] * 0.7) rec.push(`Km par commande élevé (${inp.kmPerOrder}) : regrouper les tournées par zone réduit carburant et entretien.`)
  } else rec.push(`Coût/commande dans la cible (${p['target.costMin'].toFixed(2)}–${max.toFixed(2)} MAD).`)
  if (scenario.margin != null && scenario.margin < 0) rec.push(`Marge négative (${scenario.margin.toFixed(2)} MAD/jour) : le prix facturé (${scenario.price} MAD) est inférieur au coût de revient ${scenario.costPerOrder?.toFixed(2)} MAD.`)
  if (scenario.breakEvenOrdersPerDay != null) rec.push(`Seuil de rentabilité : ${scenario.breakEvenOrdersPerDay} commandes/jour (≈ ${scenario.breakEvenOrdersPerRotation} par rotation).`)
  else if (scenario.price > 0) rec.push('Le prix facturé ne couvre pas le coût variable par commande : aucun volume ne rend le scénario rentable.')
  else rec.push('Prix facturé non renseigné (paramètre « price.perOrder ») : marge et seuil de rentabilité non calculés.')
  const lowT = p['target.ordersPerRotationMin']
  if (inp.ordersPerRotation < lowT) rec.push(`Moins de ${lowT} commandes par rotation : sous la cible du modèle (${lowT}–${p['target.ordersPerRotationMax']}).`)
  return { scenario, withHelper, withoutHelper, sweep, recommendations: rec, estimated: true }
}

// ── Détection d'anomalies ───────────────────────────────────────────────────────────────────────────
export interface Anomaly {
  kind: 'km_per_order' | 'consumption' | 'underused_vehicle' | 'low_rotation' | 'day_cost'
  severity: 'info' | 'warn' | 'critical'
  title: string; detail: string; recommendation: string
  driverCode?: string; plate?: string; day?: string; value: number | null; threshold: number | null; estimated: boolean
}
export interface FleetStat { vehicleId: string; plate: string; status: string; declaredL100: number | null; fuelLiters: number | null; fuelAmount: number | null }

export function detectAnomalies(days: TeamDay[], fleet: FleetStat[], p: CostParams): Anomaly[] {
  const out: Anomaly[] = []
  const worst = (v: number, thr: number): Anomaly['severity'] => (v >= thr * 1.5 ? 'critical' : 'warn')

  // 1. km/commande élevé, par chauffeur (sur km réels uniquement)
  const byDrv = new Map<string, { name: string; km: number; orders: number }>()
  for (const t of days) if (t.kmSource !== 'estimated' && t.delivered > 0) { const g = byDrv.get(t.driverCode) ?? { name: t.driverName, km: 0, orders: 0 }; g.km += t.km; g.orders += t.delivered; byDrv.set(t.driverCode, g) }
  for (const [code, g] of byDrv) {
    const kpo = g.km / g.orders, thr = p['alert.kmPerOrder']
    if (kpo > thr) out.push({ kind: 'km_per_order', severity: worst(kpo, thr), title: `Km/commande élevé — ${g.name}`, detail: `${r1(kpo)} km par commande sur ${g.orders} livraisons (seuil ${thr}).`, recommendation: 'Revoir le séquencement des arrêts et le regroupement par secteur ; vérifier que le kilométrage saisi (départ/arrivée) est correct.', driverCode: code, value: r1(kpo), threshold: thr, estimated: false })
  }

  // 2. consommation anormale vs OpsVehicle.consumptionL100 (pleins réels ÷ km réels)
  const kmByVeh = new Map<string, number>()
  for (const t of days) if (t.vehicleId && t.kmSource !== 'estimated') kmByVeh.set(t.vehicleId, (kmByVeh.get(t.vehicleId) ?? 0) + t.km)
  for (const f of fleet) {
    const km = kmByVeh.get(f.vehicleId) ?? 0
    if (!f.declaredL100 || f.fuelLiters == null || f.fuelLiters <= 0 || km < 100) continue
    const real = (f.fuelLiters / km) * 100, over = ((real - f.declaredL100) / f.declaredL100) * 100, thr = p['alert.consumptionPct']
    if (over > thr) out.push({ kind: 'consumption', severity: worst(over, thr), title: `Consommation anormale — ${f.plate}`, detail: `${r1(real)} L/100 km mesurés contre ${f.declaredL100} déclarés (+${r1(over)} %) sur ${Math.round(km)} km.`, recommendation: 'Contrôler les pleins (doublons, bidons), la pression des pneus, la conduite, et recouper avec le kilométrage saisi.', plate: f.plate, value: r1(over), threshold: thr, estimated: false })
  }

  // 3. véhicule sous-utilisé : jours d'activité du véhicule ÷ jours d'activité de la flotte
  const fleetDays = new Set(days.filter(t => t.delivered > 0).map(t => t.day)).size
  const actByVeh = new Map<string, Set<string>>()
  for (const t of days) if (t.vehicleId && t.delivered > 0) { const s = actByVeh.get(t.vehicleId) ?? new Set<string>(); s.add(t.day); actByVeh.set(t.vehicleId, s) }
  if (fleetDays >= 3) for (const f of fleet) {
    if (f.status !== 'active') continue
    const pct = ((actByVeh.get(f.vehicleId)?.size ?? 0) / fleetDays) * 100, thr = p['alert.vehicleUtilPct']
    if (pct < thr) out.push({ kind: 'underused_vehicle', severity: pct === 0 ? 'critical' : 'warn', title: `Véhicule sous-utilisé — ${f.plate}`, detail: `A roulé ${actByVeh.get(f.vehicleId)?.size ?? 0} jour(s) sur ${fleetDays} jours d’activité (${r1(pct)} %, seuil ${thr} %). Son amortissement et son assurance courent quand même.`, recommendation: 'Affecter le véhicule à une équipe, le mutualiser entre hubs, ou le sortir de la flotte active.', plate: f.plate, value: r1(pct), threshold: thr, estimated: false })
  }
  // rotations par jour très en dessous de la cible (tournées saisies uniquement : sinon les rotations sont déduites des créneaux)
  const tourDays = days.filter(t => t.delivered > 0 && t.rotations > 0)
  const rotTarget = p['target.rotationsPerDay']
  const rotByDrv = new Map<string, { name: string; rot: number; n: number; est: boolean }>()
  for (const t of tourDays) { const g = rotByDrv.get(t.driverCode) ?? { name: t.driverName, rot: 0, n: 0, est: true }; g.rot += t.rotations; g.n++; if (t.rotationOrders.length && !t.estimatedParts.includes('rotations')) g.est = false; rotByDrv.set(t.driverCode, g) }
  for (const [code, g] of rotByDrv) if (g.n >= 3 && g.rot / g.n < rotTarget * 0.5 && !g.est) out.push({ kind: 'underused_vehicle', severity: 'warn', title: `Rotations insuffisantes — ${g.name}`, detail: `${r1(g.rot / g.n)} rotations par jour en moyenne pour une cible de ${rotTarget}.`, recommendation: 'Augmenter le nombre de tournées (créneaux plus rapprochés, rechargement plus court) ou réduire le temps entre deux rotations.', driverCode: code, value: r1(g.rot / g.n), threshold: rotTarget * 0.5, estimated: false })

  // 4. rotations à 1-2 commandes (par chauffeur)
  const lowMax = p['alert.lowRotationOrders']
  const lowByDrv = new Map<string, { name: string; low: number; total: number; sample: string[]; est: boolean }>()
  for (const t of days) for (const n of t.rotationOrders) {
    const g = lowByDrv.get(t.driverCode) ?? { name: t.driverName, low: 0, total: 0, sample: [], est: false }
    g.total++; if (t.estimatedParts.includes('rotations')) g.est = true
    if (n >= 1 && n <= lowMax) { g.low++; if (g.sample.length < 3 && !g.sample.includes(t.day)) g.sample.push(t.day) }
    lowByDrv.set(t.driverCode, g)
  }
  for (const [code, g] of lowByDrv) if (g.low >= 2 && g.low / g.total >= 0.25) out.push({ kind: 'low_rotation', severity: g.low / g.total >= 0.5 ? 'critical' : 'warn', title: `Rotations à ${lowMax} commandes ou moins — ${g.name}`, detail: `${g.low} rotation(s) sur ${g.total} avec ${lowMax} commande(s) ou moins (ex. ${g.sample.join(', ')}).${g.est ? ' Rotations déduites des créneaux (tournées non saisies).' : ''}`, recommendation: 'Fusionner les créneaux creux, retarder le départ jusqu’à avoir 3–4 commandes, ou rediriger ces commandes vers une autre équipe du hub.', driverCode: code, value: g.low, threshold: lowMax, estimated: g.est })

  // 5. journées trop chères (les 10 pires)
  const capDay = p['target.costMax'] * (1 + p['alert.dayCostOverPct'] / 100)
  days.filter(t => t.costPerOrder != null && t.costPerOrder > capDay).sort((a, b) => (b.costPerOrder ?? 0) - (a.costPerOrder ?? 0)).slice(0, 10)
    .forEach(t => out.push({ kind: 'day_cost', severity: (t.costPerOrder ?? 0) > capDay * 1.5 ? 'critical' : 'warn', title: `Journée coûteuse — ${t.driverName} le ${t.day}`, detail: `${t.costPerOrder} MAD/commande (${t.delivered} commande(s), coût total ${t.cost.total} MAD) contre une cible haute de ${p['target.costMax']} MAD.`, recommendation: t.delivered <= 4 ? 'Très peu de commandes pour une journée complète : vérifier le planning (équipe surdimensionnée ?) avant de payer un véhicule et un helper.' : 'Vérifier le kilométrage et le carburant de la journée.', driverCode: t.driverCode, plate: t.plate ?? undefined, day: t.day, value: t.costPerOrder, threshold: r2(capDay), estimated: t.estimated }))

  const rank = { critical: 0, warn: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
