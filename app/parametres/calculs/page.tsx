'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SlidersHorizontal, Save, RotateCcw, Lock, Plus, Trash2 } from 'lucide-react'

interface Cfg {
  slots: { label: string; startHour: number }[]
  perDriverPerSlot: number; tenseThreshold: number; saturatedThreshold: number; historyDays: number; minDayOrders: number
  atRiskMinutes: number; autoDistWeight: number
  fuelPriceDiesel: number; fuelPriceEssence: number; consumptionAlertPct: number; docAlertDays: number; maintKmMargin: number
  scoreCritical: number; scoreGood: number
  cashGapAlert: number
}
interface SpecialDay { day: string; label: string; kind: string; factor: number }
const KINDS: Record<string, string> = { ramadan: 'Ramadan', aid: 'Aïd', payday: 'Fin de mois', promo: 'Promo', event: 'Événement' }
const iso = (d: Date) => d.toISOString().slice(0, 10)
type NumKey = Exclude<keyof Cfg, 'slots'>

// Paramétrage → Calculs & équations : tout ce qui pilote les calculs des modules (créneaux, prévisions, retards, dispatch, flotte, scoring).
export default function CalculsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [defaults, setDefaults] = useState<Cfg | null>(null)
  const [overridden, setOverridden] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [msg, setMsg] = useState('')
  const [specials, setSpecials] = useState<SpecialDay[]>([])
  const [sp, setSp] = useState<SpecialDay>({ day: '', label: '', kind: 'event', factor: 1.3 })

  const load = async () => {
    const r = await fetch('/api/ops/settings'); const j = await r.json()
    if (r.ok) { setCfg(j.config); setDefaults(j.defaults); setOverridden(j.overridden); setCanEdit(j.canEdit) } else setMsg(j.error || 'Accès réservé aux managers')
  }
  const loadSpecials = async () => { const r = await fetch('/api/ops/special-days'); if (r.ok) setSpecials((await r.json()).days) }
  useEffect(() => { load(); loadSpecials() }, [])
  const addSpecial = async (items: SpecialDay[]) => {
    const r = await fetch('/api/ops/special-days', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); const j = await r.json()
    setMsg(r.ok ? `${j.saved} jour(s) spécial(aux) enregistré(s).` : j.error || 'Échec (administrateur requis)'); if (r.ok) { setSp({ ...sp, day: '', label: '' }); loadSpecials() }
  }
  const delSpecial = async (day: string) => { const r = await fetch(`/api/ops/special-days?day=${day}`, { method: 'DELETE' }); setMsg(r.ok ? 'Jour spécial supprimé.' : 'Échec (administrateur requis)'); if (r.ok) loadSpecials() }
  // Fins de mois des 3 prochains mois : dernier jour du mois + dernier vendredi (jour de paie → pic de commandes), facteur 1,3
  const prefillMonthEnds = () => {
    const out = new Map<string, SpecialDay>(), now = new Date()
    for (let m = 0; m < 3; m++) {
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m + 1, 0, 12))
      const fri = new Date(last); while (fri.getUTCDay() !== 5) fri.setUTCDate(fri.getUTCDate() - 1)
      for (const d of [last, fri]) if (iso(d) >= iso(now)) out.set(iso(d), { day: iso(d), label: 'Fin de mois', kind: 'payday', factor: 1.3 })
    }
    if (out.size) addSpecial([...out.values()])
  }

  const save = async () => { const r = await fetch('/api/ops/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); setMsg(r.ok ? 'Paramètres enregistrés — appliqués immédiatement aux calculs.' : 'Échec (administrateur requis)'); if (r.ok) load() }
  const reset = async () => { if (!confirm('Remettre TOUS les paramètres de calcul aux valeurs par défaut ?')) return; const r = await fetch('/api/ops/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) }); setMsg(r.ok ? 'Valeurs par défaut rétablies.' : 'Échec'); if (r.ok) load() }

  const num = (k: NumKey, label: string, hint: string, step = 1) => cfg && defaults && (
    <label className="block text-sm">
      <span className="flex items-center justify-between text-gray-700 font-medium">{label}{overridden.includes(k) && <span className="text-[10px] text-purple-600 font-normal">modifié (défaut {defaults[k]})</span>}</span>
      <input type="number" step={step} min={0} disabled={!canEdit} value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-gray-50" />
      <span className="text-xs text-gray-400">{hint}</span>
    </label>
  )
  const Card = ({ title, formula, children }: { title: string; formula?: string; children: React.ReactNode }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="font-semibold text-gray-900">{title}</div>
      {formula && <div className="mt-1.5 mb-3 text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-gray-600 whitespace-pre-wrap">{formula}</div>}
      <div className="grid sm:grid-cols-2 gap-4 mt-2">{children}</div>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><SlidersHorizontal className="w-5 h-5 text-purple-600" />Calculs & équations</h1>
          <p className="text-sm text-gray-500">Tous les paramètres qui pilotent les calculs des modules. Une modification s&apos;applique immédiatement aux prévisions, au suivi, au dispatch et à la flotte.</p></div>
        <div className="flex gap-2">{canEdit ? (<><button onClick={reset} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"><RotateCcw className="w-4 h-4" />Valeurs par défaut</button>
          <button onClick={save} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-600 text-white"><Save className="w-4 h-4" />Enregistrer</button></>) : <span className="flex items-center gap-1 text-xs text-gray-400"><Lock className="w-3.5 h-3.5" />lecture seule — administrateur requis</span>}</div>
      </div>
      {msg && <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">{msg}</div>}

      {cfg && defaults && (
        <>
          <Card title="Créneaux de livraison" formula={'Chaque commande est rattachée au créneau dont l’heure de début est la plus proche de l’heure promise.\nL’heure promise au client n’est jamais modifiée : les retards restent calculés dessus.'}>
            <div className="sm:col-span-2 space-y-2">
              {cfg.slots.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 w-20">Créneau {i + 1}</span>
                  <input type="number" min={0} max={23} disabled={!canEdit} value={s.startHour} onChange={e => { const slots = cfg.slots.slice(); const h = Number(e.target.value); slots[i] = { startHour: h, label: `${String(h).padStart(2, '0')}-${String((h + 3) % 24).padStart(2, '0')}` }; setCfg({ ...cfg, slots }) }} className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 disabled:bg-gray-50" />
                  <span className="text-gray-600">h → {String((s.startHour + 3) % 24).padStart(2, '0')}h <span className="text-gray-400">(fenêtre de 3 h)</span></span>
                  {canEdit && cfg.slots.length > 1 && <button onClick={() => setCfg({ ...cfg, slots: cfg.slots.filter((_, j) => j !== i) })} className="text-red-500"><Trash2 className="w-4 h-4" /></button>}
                </div>
              ))}
              {canEdit && cfg.slots.length < 8 && <button onClick={() => setCfg({ ...cfg, slots: [...cfg.slots, { startHour: 9, label: '09-12' }] })} className="flex items-center gap-1 text-xs text-purple-700"><Plus className="w-3.5 h-3.5" />Ajouter un créneau</button>}
            </div>
          </Card>

          <Card title="Prévisions de volume (Cockpit)" formula={'prévu = max( reçu , w × reçu/p + (1 − w) × historique )\n  p = part du volume final habituellement connue à cet instant   w = min(0,8 ; p)\ncharge = prévu ÷ (équipes du hub × capacité par équipe et par créneau)\ncharge ≥ seuil tendu → orange · charge ≥ seuil saturé → rouge'}>
            {num('perDriverPerSlot', 'Capacité par équipe et par créneau', 'Commandes qu’un chauffeur + helper traitent en 3 h')}
            {num('tenseThreshold', 'Seuil « tendu »', 'Ratio de charge (0,7 = 70 %)', 0.05)}
            {num('saturatedThreshold', 'Seuil « saturé »', 'Ratio de charge (1 = 100 %)', 0.05)}
            {num('historyDays', 'Profondeur d’historique (jours)', 'Jours passés utilisés pour la moyenne et la courbe d’arrivée')}
            {num('minDayOrders', 'Volume minimum d’un jour d’historique', 'Les jours incomplets (bords d’export) sont ignorés')}
          </Card>

          <Card title="Suivi des commandes & retards" formula={'en retard  = non livrée ET heure actuelle > fin du créneau promis\nà risque   = non en livraison ET fin du créneau dans moins de N minutes'}>
            {num('atRiskMinutes', 'Seuil « à risque » (minutes)', 'Avant la fin du créneau')}
          </Card>

          <Card title="Dispatch automatique" formula={'score(livreur) = nombre de commandes déjà prises + poids × distance (km) au barycentre de ses commandes\nLa commande va au livreur au score le plus bas → charge équilibrée et adresses proches regroupées.'}>
            {num('autoDistWeight', 'Poids de la distance', '0 = équilibrage pur · plus élevé = regroupement géographique', 0.05)}
          </Card>

          <Card title="Flotte & gasoil" formula={'L/100 réel = litres (hors 1er plein) ÷ km parcourus × 100\nalerte consommation = L/100 réel > théorique × (1 + seuil %)\nalerte document = échéance dans moins de N jours (assurance, visite technique, vignette, permis, visite médicale)'}>
            {num('fuelPriceDiesel', 'Prix du diesel (MAD/L)', 'Valeur indicative pour les estimations', 0.1)}
            {num('fuelPriceEssence', 'Prix de l’essence (MAD/L)', '', 0.1)}
            {num('consumptionAlertPct', 'Seuil alerte surconsommation (%)', 'Au-dessus de la consommation théorique')}
            {num('docAlertDays', 'Alerte documents (jours avant échéance)', 'Permis, visite médicale, assurance, visite technique, vignette')}
            {num('maintKmMargin', 'Alerte entretien (km avant l’échéance)', '')}
          </Card>

          <Card title="Scoring livreur" formula={'score = livraison × c1 + Academy × c2 + (100 − NO_SHOW) × c3\nsous le seuil critique → alerte automatique · au-dessus du seuil excellent → prioritaire dans les shifts'}>
            {num('scoreCritical', 'Seuil critique (<)', 'Score en dessous duquel une alerte est créée')}
            {num('scoreGood', 'Seuil excellent (≥)', '')}
            <div className="sm:col-span-2 text-xs"><Link href="/parametres/scoring" className="text-purple-700 underline">Régler les coefficients c1, c2, c3 et simuler →</Link></div>
          </Card>

          <Card title="Caisse (clôture du jour)" formula={'écart = montant remis − montant attendu (commandes livrées du jour)\nalerte si |écart| > seuil'}>
            {num('cashGapAlert', 'Seuil d’alerte d’écart de caisse (MAD)', 'Au-delà, l’écart est signalé dans le journal d’audit')}
          </Card>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-gray-900">Jours spéciaux</div>
              {canEdit && <button onClick={prefillMonthEnds} className="text-xs px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg bg-white hover:bg-purple-50">Pré-remplir les fins de mois (facteur 1,3) pour les 3 prochains mois</button>}
            </div>
            <div className="mt-1.5 mb-3 text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-gray-600 whitespace-pre-wrap">{'prévu du jour = prévu × facteur (ex. 1,4 = +40 %) · capacité inchangée → charge, niveau et manque de livreurs recalculés\nS’applique aux Prévisions du Cockpit et au Planning. Facteur entre 0,3 et 5.'}</div>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2 mb-3 text-sm">
                <label className="text-xs text-gray-500">Date<input type="date" value={sp.day} onChange={e => setSp({ ...sp, day: e.target.value })} className="block border border-gray-300 rounded-lg px-2 py-1.5" /></label>
                <label className="text-xs text-gray-500">Libellé<input value={sp.label} maxLength={80} onChange={e => setSp({ ...sp, label: e.target.value })} placeholder="ex. Aïd Al-Adha" className="block border border-gray-300 rounded-lg px-2 py-1.5 w-44" /></label>
                <label className="text-xs text-gray-500">Type<select value={sp.kind} onChange={e => setSp({ ...sp, kind: e.target.value })} className="block border border-gray-300 rounded-lg px-2 py-1.5 bg-white">{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="text-xs text-gray-500">Facteur<input type="number" step={0.05} min={0.3} max={5} value={sp.factor} onChange={e => setSp({ ...sp, factor: Number(e.target.value) })} className="block border border-gray-300 rounded-lg px-2 py-1.5 w-20" /></label>
                <button onClick={() => addSpecial([sp])} disabled={!sp.day || !sp.label.trim()} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40"><Plus className="w-4 h-4" />Ajouter</button>
              </div>
            )}
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-72 overflow-y-auto">
              {specials.map(d => (
                <div key={d.day} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-500 w-24">{d.day}</span><span className="flex-1 truncate">{d.label}</span>
                  <span className="text-xs text-gray-400">{KINDS[d.kind] ?? d.kind}</span><span className="font-semibold text-purple-700 w-14 text-right">×{String(d.factor).replace('.', ',')}</span>
                  {canEdit && <button onClick={() => delSpecial(d.day)} className="text-red-500" title="Supprimer"><Trash2 className="w-4 h-4" /></button>}
                </div>
              ))}
              {!specials.length && <div className="p-3 text-xs text-gray-400">Aucun jour spécial à venir. Ajoutez le Ramadan, les Aïd, les fins de mois ou une promo.</div>}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-600">
            <div className="font-semibold text-gray-900 mb-1">Paie & bonus</div>
            fixe chauffeur / helper, bonus, retenues → <Link href="/parametres/paie" className="text-purple-700 underline">Paramétrage → Paie & bonus</Link> · résultat mensuel dans RH & Formation → Paie & Bonus.
          </div>
        </>
      )}
    </div>
  )
}
