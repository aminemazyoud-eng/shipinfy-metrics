import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { computeCosting, parseRange, aggregate, summarize, GROUP_BYS, type GroupBy } from '@/lib/ops-costing'
import { xlsxResponse } from '@/lib/xlsx-response'

const GROUP_LABEL: Record<GroupBy, string> = { day: 'Jour', vehicle: 'Véhicule', driver: 'Chauffeur', hub: 'Hub', month: 'Mois', slot: 'Créneau' }

// GET /api/ops/costing?from=&to=&groupBy=day|vehicle|driver|hub|month|slot&hub=[&format=xlsx] — coût par commande (Chiffrage). MANAGER+ (contient des coûts de paie).
// Toute valeur déduite plutôt que mesurée est signalée : `estimated: true` (résumé, lignes et journées) + `estimatedParts`.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const range = parseRange(sp)
    if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 })
    const gb = (sp.get('groupBy') ?? 'day') as GroupBy
    if (!GROUP_BYS.includes(gb)) return NextResponse.json({ error: `groupBy doit être : ${GROUP_BYS.join(', ')}` }, { status: 400 })
    const hub = sp.get('hub') || undefined
    const data = await computeCosting(range.from, range.to, { hub })
    const rows = aggregate(data.days, gb, data.params), summary = summarize(data.days, data.params)

    if (sp.get('format') === 'xlsx') {
      const n = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))
      const head = [GROUP_LABEL[gb], 'Commandes livrées', 'Journées-équipe', 'Km', 'Coût total (MAD)', 'Coût/commande (MAD)', 'Écart vs cible haute (MAD)', 'Chauffeur', 'Helper', 'Charges patronales', 'Carburant', 'Entretien', 'Véhicule', 'Équipement SI', 'Revenu (MAD)', 'Marge (MAD)', 'Part estimée (%)']
      const lines = [head, ...rows.map(r => [r.label, r.orders, r.teamDays, n(r.km), n(r.cost), n(r.costPerOrder), n(r.gapVsMax), n(r.breakdown.driver), n(r.breakdown.helper), n(r.breakdown.charges), n(r.breakdown.fuel), n(r.breakdown.maintenance), n(r.breakdown.vehicle), n(r.breakdown.equipment), n(r.revenue), n(r.margin), n(r.estimatedCostPct)]),
        ['TOTAL', summary.orders, summary.teamDays, n(summary.km), n(summary.cost), n(summary.costPerOrder), n(summary.gapVsMax), n(summary.breakdown.driver), n(summary.breakdown.helper), n(summary.breakdown.charges), n(summary.breakdown.fuel), n(summary.breakdown.maintenance), n(summary.breakdown.vehicle), n(summary.breakdown.equipment), n(summary.revenue), n(summary.margin), n(summary.estimatedCostPct)]]
      return xlsxResponse(lines.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'), `chiffrage_${gb}_${range.from}_${range.to}`, 'Chiffrage')
    }
    return NextResponse.json({
      from: range.from, to: range.to, hub: hub ?? null, groupBy: gb, estimated: summary.estimated,
      targets: { costMin: data.params['target.costMin'], costMax: data.params['target.costMax'], vehicleDayCost: data.params['target.vehicleDayCost'], rotationsPerDay: data.params['target.rotationsPerDay'], ordersPerRotationMin: data.params['target.ordersPerRotationMin'], ordersPerRotationMax: data.params['target.ordersPerRotationMax'], pricePerOrder: data.params['price.perOrder'] },
      summary, rows, meta: data.meta,
      note: 'Valeurs « estimées » : tarif du jour au lieu de la paie figée, carburant/entretien déduits des km et des provisions, km déduits du nombre de commandes, rotations déduites des créneaux. Voir `estimatedParts`.',
    })
  } catch (e) { return fail(e) }
}
