'use client'
import { useEffect, useState } from 'react'
import { UserCheck, Plus, X } from 'lucide-react'

type StepStatus = 'pending' | 'submitted' | 'validated' | 'rejected'
type DriverStatus = 'prospect' | 'en_cours' | 'formation' | 'valide' | 'actif' | 'inactif' | 'rejete'

interface OnboardingStep {
  id: string
  step: string
  status: StepStatus
  notes?: string
  completedAt?: string
}

interface Driver {
  id: string
  firstName: string
  lastName:  string
  phone:     string
  email?:    string
  city?:     string
  status:    DriverStatus
  reliabilityScore?: number
  notes?:    string
  onboardingSteps: OnboardingStep[]
  courseProgress?: { score?: number; certified?: boolean }[]
  createdAt: string
}

const COLUMNS: { key: DriverStatus; label: string; color: string; bg: string }[] = [
  { key: 'prospect',  label: 'Prospects',  color: '#64748b', bg: '#f8fafc' },
  { key: 'en_cours',  label: 'En cours',   color: '#2563eb', bg: '#eff6ff' },
  { key: 'formation', label: 'Formation',  color: '#ca8a04', bg: '#fefce8' },
  { key: 'valide',    label: 'Validés',    color: '#16a34a', bg: '#f0fdf4' },
  { key: 'actif',     label: 'Actifs',     color: '#059669', bg: '#ecfdf5' },
]

const STEP_LABELS: Record<string, string> = {
  kyc_identity: 'KYC Identité',
  kyc_vehicle:  'KYC Véhicule',
  contract:     'Contrat',
  training:     'Formation',
  equipment:    'Équipement',
}

function scoreColor(s?: number) {
  if (!s) return '#94a3b8'
  if (s >= 80) return '#16a34a'
  if (s >= 60) return '#ca8a04'
  return '#dc2626'
}
function scoreBg(s?: number) {
  if (!s) return '#f1f5f9'
  if (s >= 80) return '#dcfce7'
  if (s >= 60) return '#fef9c3'
  return '#fee2e2'
}

export default function OnboardingPage() {
  const [drivers, setDrivers]     = useState<Driver[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Driver | null>(null)
  const [showAdd, setShowAdd]     = useState(false)
  const [form, setForm]           = useState({ firstName:'', lastName:'', phone:'', email:'', city:'' })
  const [saving, setSaving]       = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/drivers').then(r => r.json()).then(d => { setDrivers(d); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const addDriver = async () => {
    if (!form.firstName || !form.lastName || !form.phone) return
    setSaving(true)
    await fetch('/api/drivers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form) })
    setSaving(false)
    setShowAdd(false)
    setForm({ firstName:'', lastName:'', phone:'', email:'', city:'' })
    load()
  }

  const updateStep = async (driverId: string, stepId: string, status: StepStatus) => {
    await fetch(`/api/drivers/${driverId}`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ stepId, status }),
    })
    load()
    if (selected?.id === driverId) {
      const updated = await fetch(`/api/drivers/${driverId}`).then(r => r.json())
      setSelected(updated)
    }
  }

  const colDrivers = (col: DriverStatus) => drivers.filter(d => d.status === col)

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <UserCheck size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-base lg:text-lg font-bold text-gray-900">Onboarding Livreurs</h1>
            <p className="text-xs text-gray-500 hidden md:block">{drivers.length} livreurs · Pipeline de recrutement digital</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-blue-600 text-white px-3 lg:px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors min-h-[44px] flex-shrink-0">
          <Plus size={15} /> <span className="hidden sm:inline">Nouveau livreur</span>
        </button>
      </div>

      {/* Stats bar — scrollable on mobile */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-2 flex gap-4 md:gap-6 overflow-x-auto no-scrollbar">
        {COLUMNS.map(col => (
          <div key={col.key} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{background: col.color}} />
            <span className="text-xs text-gray-500">{col.label}</span>
            <span className="text-xs font-bold text-gray-900">{colDrivers(col.key).length}</span>
          </div>
        ))}
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto p-4">
        {loading ? (
          <div className="flex gap-4">
            {COLUMNS.map(col => (
              <div key={col.key} className="w-60 flex-shrink-0">
                <div className="h-8 bg-gray-200 animate-pulse rounded mb-3" />
                {[1,2].map(i => <div key={i} className="h-28 bg-gray-100 animate-pulse rounded-lg mb-2" />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 h-full">
            {COLUMNS.map(col => (
              <div key={col.key} className="w-64 flex-shrink-0 flex flex-col" style={{maxHeight: 'calc(100vh - 220px)'}}>
                {/* Column header */}
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-xs font-bold uppercase tracking-wide" style={{color: col.color}}>{col.label}</span>
                  <span className="text-xs text-gray-400 ml-auto bg-gray-100 px-2 py-0.5 rounded-full">{colDrivers(col.key).length}</span>
                </div>
                {/* Cards */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {colDrivers(col.key).map(driver => {
                    const validated = driver.onboardingSteps.filter(s => s.status === 'validated').length
                    const total     = driver.onboardingSteps.length || 5
                    const pct       = Math.round((validated / total) * 100)
                    return (
                      <div
                        key={driver.id}
                        onClick={() => setSelected(driver)}
                        className="bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 leading-tight">{driver.firstName} {driver.lastName}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{driver.phone}</p>
                          </div>
                          {driver.reliabilityScore != null && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                              style={{ color: scoreColor(driver.reliabilityScore), background: scoreBg(driver.reliabilityScore) }}>
                              {driver.reliabilityScore.toFixed(0)}
                            </span>
                          )}
                        </div>
                        {/* Progress */}
                        <div className="mt-2">
                          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                            <span>Étapes {validated}/{total}</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: col.color }} />
                          </div>
                        </div>
                        {/* Steps dots */}
                        <div className="flex gap-1 mt-2">
                          {driver.onboardingSteps.map(s => (
                            <span key={s.id} className="w-4 h-4 rounded-full flex items-center justify-center"
                              style={{ background: s.status === 'validated' ? '#dcfce7' : s.status === 'rejected' ? '#fee2e2' : s.status === 'submitted' ? '#dbeafe' : '#f1f5f9' }}>
                              <span className="w-1.5 h-1.5 rounded-full"
                                style={{ background: s.status === 'validated' ? '#16a34a' : s.status === 'rejected' ? '#dc2626' : s.status === 'submitted' ? '#2563eb' : '#cbd5e1' }} />
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {colDrivers(col.key).length === 0 && (
                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center">
                      <p className="text-xs text-gray-400">Aucun livreur</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end p-4">
          <div className="bg-white w-full max-w-md h-full max-h-[calc(100vh-32px)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
            {/* Panel header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">{selected.firstName} {selected.lastName}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{selected.phone} {selected.city ? `· ${selected.city}` : ''}</p>
              </div>
              <button onClick={() => setSelected(null)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Score IA */}
              {selected.reliabilityScore != null && (
                <div className="rounded-xl p-3 text-center" style={{ background: scoreBg(selected.reliabilityScore) }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: scoreColor(selected.reliabilityScore) }}>Score de Fiabilité IA</p>
                  <p className="text-3xl font-black mt-1" style={{ color: scoreColor(selected.reliabilityScore) }}>{selected.reliabilityScore.toFixed(1)}<span className="text-sm font-normal">/100</span></p>
                </div>
              )}

              {/* Onboarding Steps */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Étapes Onboarding</h3>
                <div className="space-y-2">
                  {selected.onboardingSteps.map(step => (
                    <div key={step.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">{STEP_LABELS[step.step] ?? step.step}</span>
                        <div className="flex gap-1">
                          {(['pending','submitted','validated','rejected'] as StepStatus[]).map(s => (
                            <button key={s}
                              onClick={() => updateStep(selected.id, step.id, s)}
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${step.status === s ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
                              style={{
                                background: s === 'validated' ? '#dcfce7' : s === 'rejected' ? '#fee2e2' : s === 'submitted' ? '#dbeafe' : '#f1f5f9',
                                color: s === 'validated' ? '#16a34a' : s === 'rejected' ? '#dc2626' : s === 'submitted' ? '#2563eb' : '#64748b',
                              }}>
                              {s === 'pending' ? '⏳' : s === 'submitted' ? '📤' : s === 'validated' ? '✓' : '✗'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {step.completedAt && (
                        <p className="text-[10px] text-gray-400 mt-1">Validé le {new Date(step.completedAt).toLocaleDateString('fr-FR')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Driver Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white w-full sm:max-w-sm rounded-t-xl sm:rounded-xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Nouveau Livreur</h2>
              <button onClick={() => setShowAdd(false)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"><X size={14} /></button>
            </div>
            <div className="p-4 space-y-3">
              {[
                { key:'firstName', label:'Prénom *',      placeholder:'Mohamed' },
                { key:'lastName',  label:'Nom *',         placeholder:'El Amrani' },
                { key:'phone',     label:'Téléphone *',   placeholder:'06 12 34 56 78' },
                { key:'email',     label:'Email',         placeholder:'email@example.com' },
                { key:'city',      label:'Ville',         placeholder:'Casablanca' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{f.label}</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={f.placeholder}
                    value={(form as Record<string, string>)[f.key]}
                    onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))}
                  />
                </div>
              ))}
              <button
                onClick={addDriver}
                disabled={saving || !form.firstName || !form.lastName || !form.phone}
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Création...' : 'Créer le livreur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
