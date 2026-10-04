'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { UserPlus, Car, Search, FileText, Pencil, Lock, GraduationCap, X, CheckCircle2 } from 'lucide-react'

interface Person { code: string; firstName: string; lastName: string; jobType: 'chauffeur' | 'helper'; phone: string | null; cin: string | null; address: string | null; birthDate: string | null; hireDate: string | null; licenseNo: string | null
  contractType: string; status: string; onboardingStatus: string; trainingDone: boolean; quizScore: number | null; dailyRate: number; hubCode: string | null; hubName: string | null; city: string | null; vehicleId: string | null; vehiclePlate: string | null
  contractGeneratedAt: string | null; contractReady: boolean; licenseExpiry: string | null; licenseCategory: string | null; medicalVisitExpiry: string | null; driving: { ok: boolean; reasons: string[] } }
interface Vehicle { id: string; plate: string; type: string; fuelType: string; brand: string | null; model: string | null; year: number | null; registrationNo: string | null; status: string; odometerKm: number; hubCode: string | null; hubName: string | null
  insuranceExpiry: string | null; technicalVisitExpiry: string | null; vignetteExpiry: string | null; insuranceDays: number | null; visitDays: number | null; vignetteDays: number | null; chauffeur: string | null; helper: string | null }
type Tab = 'chauffeur' | 'helper' | 'vehicle'
type Form = Record<string, string>

const STEPS: Record<string, { l: string; c: string }> = {
  prospect: { l: 'Candidat', c: 'bg-gray-100 text-gray-600' }, formation: { l: 'En formation', c: 'bg-blue-100 text-blue-700' }, quiz: { l: 'Quiz', c: 'bg-amber-100 text-amber-700' },
  valide: { l: 'Validé', c: 'bg-teal-100 text-teal-700' }, actif: { l: 'Actif', c: 'bg-green-100 text-green-700' }, inactif: { l: 'Inactif', c: 'bg-red-100 text-red-700' },
}
const iso = (d: string | null) => (d ? d.slice(0, 10) : '')
const expiry = (days: number | null) => (days == null ? <span className="text-gray-300">—</span> : <span className={days < 0 ? 'text-red-600 font-semibold' : days < 30 ? 'text-amber-600 font-medium' : 'text-gray-600'}>{days < 0 ? `expirée (${-days} j)` : `${days} j`}</span>)

export default function OnboardingRhPage() {
  const [tab, setTab] = useState<Tab>('chauffeur')
  const [people, setPeople] = useState<Person[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<{ kind: 'person' | 'vehicle'; code?: string; id?: string } | null>(null)
  const [f, setF] = useState<Form>({})
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [p, v] = await Promise.all([fetch('/api/rh/people'), fetch('/api/rh/vehicles')])
    if (p.ok) { const j = await p.json(); setPeople(j.people); setCanEdit(j.canEdit) }
    if (v.ok) setVehicles((await v.json()).vehicles)
  }, [])
  useEffect(() => { load(); fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [load])

  const list = useMemo(() => people.filter(p => p.jobType === tab && (!q || `${p.firstName} ${p.lastName} ${p.code} ${p.cin ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [people, tab, q])
  const vList = useMemo(() => vehicles.filter(v => !q || `${v.plate} ${v.brand ?? ''} ${v.model ?? ''}`.toLowerCase().includes(q.toLowerCase())), [vehicles, q])

  const openPerson = (p?: Person) => { setErr(''); setModal({ kind: 'person', code: p?.code }); setF(p ? { firstName: p.firstName, lastName: p.lastName, phone: p.phone ?? '', cin: p.cin ?? '', address: p.address ?? '', birthDate: iso(p.birthDate), hireDate: iso(p.hireDate), licenseNo: p.licenseNo ?? '', licenseCategory: p.licenseCategory ?? '', licenseExpiry: iso(p.licenseExpiry), medicalVisitExpiry: iso(p.medicalVisitExpiry), contractType: p.contractType, hubCode: p.hubCode ?? '', vehicleId: p.vehicleId ?? '', dailyRate: String(p.dailyRate), onboardingStatus: p.onboardingStatus, trainingDone: p.trainingDone ? '1' : '', quizScore: p.quizScore == null ? '' : String(p.quizScore) } : { contractType: 'CDD' }) }
  const openVehicle = (v?: Vehicle) => { setErr(''); setModal({ kind: 'vehicle', id: v?.id }); setF(v ? { plate: v.plate, type: v.type, fuelType: v.fuelType, brand: v.brand ?? '', model: v.model ?? '', year: v.year ? String(v.year) : '', registrationNo: v.registrationNo ?? '', hubCode: v.hubCode ?? '', status: v.status, insuranceExpiry: iso(v.insuranceExpiry), technicalVisitExpiry: iso(v.technicalVisitExpiry), vignetteExpiry: iso(v.vignetteExpiry) } : { type: 'utilitaire', fuelType: 'diesel' }) }

  const save = async () => {
    if (!modal) return
    const isPerson = modal.kind === 'person'
    const url = isPerson ? (modal.code ? `/api/rh/people/${modal.code}` : '/api/rh/people') : (modal.id ? `/api/rh/vehicles/${modal.id}` : '/api/rh/vehicles')
    const body = isPerson ? { ...f, jobType: tab, trainingDone: !!f.trainingDone } : f
    const r = await fetch(url, { method: (isPerson ? modal.code : modal.id) ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json(); if (r.ok) { setModal(null); load() } else setErr(j.error || 'Erreur')
  }
  const field = (k: string, label: string, type = 'text', opts?: { v: string; l: string }[]) => (
    <label className="text-xs text-gray-600 block">{label}
      {opts ? <select value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"><option value="">—</option>{opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
        : <input type={type} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />}
    </label>
  )
  const hubOpts = hubs.map(h => ({ v: h.code, l: h.name.replace('Marjane ', '') }))
  const label = tab === 'chauffeur' ? 'chauffeur' : tab === 'helper' ? 'livreur / helper' : 'véhicule'

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><UserPlus className="w-5 h-5 text-teal-600" />Onboarding — base du personnel & des véhicules</h1>
          <p className="text-sm text-gray-500">Équipe par véhicule : 1 chauffeur + 1 helper · seul l&apos;administrateur peut créer et modifier les fiches</p></div>
        <div className="flex gap-2 text-xs"><Link href="/onboarding" className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white">Parcours de recrutement (kanban)</Link><Link href="/academy" className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" />Academy</Link></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200">
        {([['chauffeur', 'Chauffeurs', people.filter(p => p.jobType === 'chauffeur').length], ['helper', 'Livreurs / Helpers', people.filter(p => p.jobType === 'helper').length], ['vehicle', 'Véhicules', vehicles.length]] as const).map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-gray-500'}`}>{l} <span className="text-xs text-gray-400">{n}</span></button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher…" className="border border-gray-300 rounded-lg pl-8 pr-2 py-1.5 text-sm w-48" /></div>
          {canEdit ? <button onClick={() => (tab === 'vehicle' ? openVehicle() : openPerson())} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-teal-600 text-white">{tab === 'vehicle' ? <Car className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}Nouveau {label}</button>
            : <span className="flex items-center gap-1 text-xs text-gray-400"><Lock className="w-3.5 h-3.5" />lecture seule (admin requis)</span>}
        </div>
      </div>

      {tab !== 'vehicle' ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Code', 'Nom', 'CIN', 'Hub', 'Véhicule', 'Aptitude conduite', 'Contrat', 'Fixe / jour', 'Parcours d\'intégration', ''].map(h => <th key={h} className="p-2 font-medium first:pl-3 whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {list.map(p => (
                <tr key={p.code} className="border-t border-gray-100">
                  <td className="p-2 pl-3 font-mono text-xs text-gray-500">{p.code}</td><td className="p-2 font-medium text-gray-900">{p.firstName} {p.lastName}<div className="text-xs font-normal text-gray-400">{p.phone}</div></td>
                  <td className="p-2 text-gray-600">{p.cin ?? '—'}</td><td className="p-2 text-gray-600">{p.hubName?.replace('Marjane ', '') ?? '—'}</td><td className="p-2 text-gray-600">{p.vehiclePlate ?? '—'}</td><td className="p-2">{p.driving.ok ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{p.jobType === 'chauffeur' ? 'Apte à conduire' : 'Visite OK'}</span> : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700" title={p.driving.reasons.join(', ')}>{p.driving.reasons[0]}</span>}<div className="text-[11px] text-gray-400 mt-0.5">{p.jobType === 'chauffeur' ? `permis ${p.licenseCategory ?? ''} → ${iso(p.licenseExpiry) || '—'}` : ''}{p.jobType === 'chauffeur' ? ' · ' : ''}visite méd. → {iso(p.medicalVisitExpiry) || '—'}</div></td><td className="p-2">{p.contractType}</td><td className="p-2">{p.dailyRate} MAD</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs ${STEPS[p.onboardingStatus]?.c}`}>{STEPS[p.onboardingStatus]?.l ?? p.onboardingStatus}</span>
                    <div className="text-[11px] text-gray-400 mt-0.5">{p.trainingDone ? <span className="text-green-600">formation ✓</span> : 'formation à faire'} · {p.quizScore != null ? `quiz ${p.quizScore}%` : 'quiz —'}</div></td>
                  <td className="p-2 whitespace-nowrap">
                    {p.contractReady ? <a href={`/api/rh/people/${p.code}/contract`} target="_blank" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-teal-300 text-teal-700 hover:bg-teal-50" title={p.contractGeneratedAt ? 'Déjà généré — régénérer' : 'Générer le contrat'}><FileText className="w-3.5 h-3.5" />{p.contractGeneratedAt ? <CheckCircle2 className="w-3 h-3" /> : null} Contrat</a>
                      : <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-300" title="Formation terminée et quiz ≥ 70 % requis"><FileText className="w-3.5 h-3.5" />Contrat</span>}
                    {canEdit && <button onClick={() => openPerson(p)} className="ml-1 p-1.5 rounded-md border border-gray-300" title="Modifier"><Pencil className="w-3.5 h-3.5" /></button>}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={10} className="p-8 text-center text-gray-400">Aucune fiche</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Immatriculation', 'Type', 'Marque / modèle', 'Hub', 'Équipe', 'Assurance', 'Visite technique', 'Vignette', 'Statut', ''].map(h => <th key={h} className="p-2 font-medium first:pl-3 whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {vList.map(v => (
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="p-2 pl-3 font-medium">{v.plate}</td><td className="p-2 text-gray-600">{v.type} · {v.fuelType}</td><td className="p-2 text-gray-600">{[v.brand, v.model, v.year].filter(Boolean).join(' ') || '—'}</td>
                  <td className="p-2 text-gray-600">{v.hubName?.replace('Marjane ', '') ?? '—'}</td><td className="p-2 text-gray-600">{v.chauffeur ?? '—'}{v.helper && <div className="text-xs text-gray-400">+ {v.helper}</div>}</td>
                  <td className="p-2">{expiry(v.insuranceDays)}</td><td className="p-2">{expiry(v.visitDays)}</td><td className="p-2">{expiry(v.vignetteDays)}</td><td className="p-2 text-xs">{v.status}</td>
                  <td className="p-2">{canEdit && <button onClick={() => openVehicle(v)} className="p-1.5 rounded-md border border-gray-300"><Pencil className="w-3.5 h-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><div className="font-semibold">{(modal.code || modal.id) ? 'Modifier' : 'Nouveau'} {modal.kind === 'vehicle' ? 'véhicule' : label}</div><button onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            {modal.kind === 'person' ? (
              <div className="grid grid-cols-2 gap-3">
                {field('firstName', 'Prénom')}{field('lastName', 'Nom')}{field('cin', 'CIN')}{field('phone', 'Téléphone')}{field('birthDate', 'Date de naissance', 'date')}{field('address', 'Adresse')}
                {tab === 'chauffeur' && (<>{field('licenseNo', 'N° permis de conduire')}{field('licenseCategory', 'Catégorie du permis', 'text', [{ v: 'B', l: 'B (véhicule léger)' }, { v: 'C1', l: 'C1 (utilitaire > 3,5 t)' }, { v: 'C', l: 'C (poids lourd)' }, { v: 'A', l: 'A (moto)' }])}{field('licenseExpiry', "Expiration du permis", 'date')}</>)}{field('medicalVisitExpiry', 'Expiration visite médicale', 'date')}{field('hireDate', "Date d'embauche", 'date')}
                {field('contractType', 'Type de contrat', 'text', [{ v: 'CDD', l: 'CDD' }, { v: 'CDI', l: 'CDI' }, { v: 'Prestation', l: 'Prestation de services' }])}
                {field('hubCode', 'Hub', 'text', hubOpts)}{field('vehicleId', 'Véhicule', 'text', vehicles.map(v => ({ v: v.id, l: v.plate })))}{field('dailyRate', 'Fixe / jour (MAD)', 'number')}
                {modal.code && (<div className="col-span-2 border-t border-gray-100 pt-3 grid grid-cols-3 gap-3 items-end">
                  {field('onboardingStatus', 'Étape du parcours', 'text', Object.entries(STEPS).map(([v, s]) => ({ v, l: s.l })))}
                  <label className="text-xs text-gray-600 flex items-center gap-2 pb-2"><input type="checkbox" checked={!!f.trainingDone} onChange={e => setF({ ...f, trainingDone: e.target.checked ? '1' : '' })} />Formation terminée</label>
                  {field('quizScore', 'Score au quiz (%)', 'number')}
                </div>)}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {field('plate', 'Immatriculation')}{field('type', 'Type', 'text', [{ v: 'moto', l: 'Moto' }, { v: 'utilitaire', l: 'Utilitaire' }, { v: 'van', l: 'Van' }])}{field('brand', 'Marque')}{field('model', 'Modèle')}{field('year', 'Année', 'number')}{field('registrationNo', 'N° carte grise')}
                {field('fuelType', 'Carburant', 'text', [{ v: 'diesel', l: 'Diesel' }, { v: 'essence', l: 'Essence' }])}{field('hubCode', 'Hub', 'text', hubOpts)}{field('insuranceExpiry', "Échéance d'assurance", 'date')}{field('technicalVisitExpiry', 'Échéance visite technique', 'date')}{field('vignetteExpiry', 'Échéance vignette', 'date')}
                {modal.id && field('status', 'Statut', 'text', [{ v: 'active', l: 'Actif' }, { v: 'maintenance', l: 'Entretien' }, { v: 'out_of_service', l: 'Hors service' }])}
              </div>
            )}
            {err && <div className="text-sm text-red-600 mt-3">{err}</div>}
            <div className="flex justify-end gap-2 mt-4"><button onClick={() => setModal(null)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Annuler</button><button onClick={save} className="px-4 py-1.5 text-sm bg-teal-600 text-white rounded-lg">Enregistrer</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
