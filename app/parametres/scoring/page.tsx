'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Brain, Save, RefreshCw, CheckCircle2 } from 'lucide-react'

interface Coeffs { scoreCoeffDelivery: number; scoreCoeffAcademy: number; scoreCoeffNoShow: number }

// Paramétrage → Scoring livreur : comment le score de fiabilité est calculé et comment l'ajuster.
export default function ScoringSettingsPage() {
  const [c, setC] = useState<Coeffs>({ scoreCoeffDelivery: 0.4, scoreCoeffAcademy: 0.3, scoreCoeffNoShow: 0.3 })
  const [msg, setMsg] = useState('')
  const [sim, setSim] = useState({ delivery: 92, academy: 80, noShow: 4 })

  useEffect(() => { fetch('/api/settings/score-config').then(r => r.ok ? r.json() : null).then(j => j && setC(j)).catch(() => {}) }, [])
  const total = Math.round((c.scoreCoeffDelivery + c.scoreCoeffAcademy + c.scoreCoeffNoShow) * 100) / 100
  const valid = Math.abs(total - 1) < 0.01
  const score = Math.round(sim.delivery * c.scoreCoeffDelivery + sim.academy * c.scoreCoeffAcademy + (100 - sim.noShow) * c.scoreCoeffNoShow)
  const level = score >= 80 ? { l: 'Excellent', c: 'text-green-600' } : score >= 60 ? { l: 'Moyen', c: 'text-amber-600' } : { l: 'Critique', c: 'text-red-600' }

  const save = async () => {
    const r = await fetch('/api/settings/score-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
    setMsg(r.ok ? 'Coefficients enregistrés. Appliqués au prochain recalcul.' : 'Échec (rôle Manager requis)')
  }
  const recalc = async () => {
    setMsg('Recalcul en cours…'); const r = await fetch('/api/score-ia/calculate', { method: 'POST' }); const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? `Scores recalculés (${j.calculated ?? 0} livreurs).` : 'Recalcul impossible (aucun rapport actif ?)')
  }
  const slider = (k: keyof Coeffs, label: string, hint: string, color: string) => (
    <div>
      <div className="flex justify-between text-sm"><span className="font-medium text-gray-800">{label}</span><span className="font-mono font-bold" style={{ color }}>{c[k].toFixed(2)}</span></div>
      <input type="range" min={0} max={1} step={0.05} value={c[k]} onChange={e => setC({ ...c, [k]: Number(e.target.value) })} className="w-full" style={{ accentColor: color }} />
      <div className="text-xs text-gray-400">{hint}</div>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Brain className="w-5 h-5 text-purple-600" />Scoring livreur</h1>
        <p className="text-sm text-gray-500">Le score de fiabilité (0–100) combine trois critères. Il est visible dans <Link href="/livreurs?tab=scoring" className="underline">Performance → Livreurs & Scoring</Link> et sert à prioriser les livreurs dans les shifts.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-800">1. Poids de chaque critère</div>
        {slider('scoreCoeffDelivery', 'Taux de livraison', 'Part des commandes livrées sur celles assignées', '#2563eb')}
        {slider('scoreCoeffAcademy', 'Score Academy', 'Moyenne des quiz de formation (Academy) du livreur', '#7c3aed')}
        {slider('scoreCoeffNoShow', 'Taux de NO_SHOW (inversé)', 'Plus il y a de NO_SHOW, plus le score baisse', '#ea580c')}
        <div className={`text-xs rounded-lg p-2.5 ${valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Somme des poids : <b>{total.toFixed(2)}</b> {valid ? '✓' : '— doit être égale à 1,00'}</div>
        <div className="flex gap-2">
          <button onClick={save} disabled={!valid} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40"><Save className="w-4 h-4" />Enregistrer</button>
          <button onClick={recalc} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-300"><RefreshCw className="w-4 h-4" />Recalculer maintenant</button>
        </div>
        {msg && <div className="text-sm text-gray-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-600" />{msg}</div>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-semibold text-gray-800 mb-3">2. Simulateur</div>
        <div className="grid grid-cols-3 gap-3">
          {([['delivery', 'Livraison %'], ['academy', 'Academy %'], ['noShow', 'NO_SHOW %']] as const).map(([k, l]) => (
            <label key={k} className="text-xs text-gray-600">{l}<input type="number" min={0} max={100} value={sim[k]} onChange={e => setSim({ ...sim, [k]: Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
          ))}
        </div>
        <div className="mt-3 text-sm font-mono text-gray-500">score = {sim.delivery}×{c.scoreCoeffDelivery.toFixed(2)} + {sim.academy}×{c.scoreCoeffAcademy.toFixed(2)} + {100 - sim.noShow}×{c.scoreCoeffNoShow.toFixed(2)}</div>
        <div className={`mt-1 text-3xl font-bold ${level.c}`}>{score}/100 <span className="text-base font-medium">{level.l}</span></div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-600 space-y-1.5">
        <div className="font-semibold text-gray-800">3. Seuils et effets</div>
        <div>🔴 <b>Critique</b> : score &lt; 60 → une alerte est créée automatiquement (Incidents & Support) et notifiée selon vos règles.</div>
        <div>⚠️ <b>Moyen</b> : entre 60 et 80. ✅ <b>Excellent</b> : à partir de 80 → livreur prioritaire dans les shifts.</div>
        <div>🕑 Recalcul automatique chaque nuit à 02h00 (heure du Maroc).</div>
        <div className="text-xs text-gray-400">Les seuils 60 / 80 sont fixes pour l&apos;instant ; seuls les poids sont paramétrables.</div>
      </div>
    </div>
  )
}
