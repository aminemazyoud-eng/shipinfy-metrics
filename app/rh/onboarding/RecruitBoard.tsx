'use client'
import { useMemo, useState } from 'react'
import { Phone, GraduationCap, FileText, Pencil, GripVertical, Eye, EyeOff, Lock } from 'lucide-react'

interface Person { code: string; firstName: string; lastName: string; jobType: 'chauffeur' | 'helper'; phone: string | null; contractType: string; onboardingStatus: string; trainingDone: boolean; quizScore: number | null; hubName: string | null; contractReady: boolean; driving: { ok: boolean; reasons: string[] } }

// Pipeline de recrutement (comme un ATS) : on glisse la fiche d'une colonne à l'autre.
const COLS = [
  { key: 'prospect', l: 'Candidats', c: '#64748b', bg: 'bg-slate-50', hint: 'Candidature reçue' },
  { key: 'formation', l: 'Formation', c: '#2563eb', bg: 'bg-blue-50', hint: 'Academy en cours' },
  { key: 'quiz', l: 'Quiz', c: '#d97706', bg: 'bg-amber-50', hint: 'Évaluation (≥ 70 %)' },
  { key: 'valide', l: 'Validés', c: '#0d9488', bg: 'bg-teal-50', hint: 'Prêts à signer' },
  { key: 'actif', l: 'Actifs', c: '#16a34a', bg: 'bg-green-50', hint: 'Embauchés — visibles au dispatch' },
  { key: 'inactif', l: 'Inactifs / refusés', c: '#dc2626', bg: 'bg-red-50', hint: 'Sortis du parcours' },
] as const

export default function RecruitBoard<T extends Person>({ people, canEdit, onEdit, onChanged }: { people: T[]; canEdit: boolean; onEdit: (p: T) => void; onChanged: () => void }) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; s: string } | null>(null)
  const [hideActive, setHideActive] = useState(true)
  const [role, setRole] = useState<'all' | 'chauffeur' | 'helper'>('all')

  const shown = useMemo(() => people.filter(p => role === 'all' || p.jobType === role), [people, role])
  const by = (k: string) => shown.filter(p => p.onboardingStatus === k)

  const move = async (code: string, to: string) => {
    const p = people.find(x => x.code === code); if (!p || p.onboardingStatus === to) return
    const r = await fetch(`/api/rh/people/${code}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboardingStatus: to }) })
    const j = await r.json().catch(() => ({}))
    setFlash(r.ok ? { ok: true, s: `${p.firstName} ${p.lastName} → ${COLS.find(c => c.key === to)?.l}` } : { ok: false, s: j.error || 'Déplacement impossible' })
    if (r.ok) onChanged()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white">{([['all', 'Tous'], ['chauffeur', 'Chauffeurs'], ['helper', 'Helpers']] as const).map(([v, l]) => <button key={v} onClick={() => setRole(v)} className={`px-3 py-1.5 ${role === v ? 'bg-teal-600 text-white' : 'hover:bg-gray-50'}`}>{l}</button>)}</div>
        <button onClick={() => setHideActive(!hideActive)} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg bg-white">{hideActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}{hideActive ? 'Afficher les actifs' : 'Masquer les actifs'}</button>
        <span className="text-xs text-gray-400 flex items-center gap-1">{canEdit ? 'Glissez une fiche dans une colonne pour faire avancer le candidat.' : <><Lock className="w-3.5 h-3.5" />lecture seule (admin requis pour déplacer)</>}</span>
      </div>
      {flash && <div className={`text-sm rounded-lg p-2.5 border ${flash.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{flash.s}</div>}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLS.filter(c => !(hideActive && c.key === 'actif')).map(col => {
          const list = by(col.key)
          return (
            <div key={col.key}
              onDragOver={e => { if (canEdit) { e.preventDefault(); setOver(col.key) } }} onDragLeave={() => setOver(o => (o === col.key ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); const c = drag ?? e.dataTransfer.getData('text/plain'); setDrag(null); if (canEdit && c) move(c, col.key) }}
              className={`w-72 shrink-0 rounded-xl border ${over === col.key ? 'border-teal-500 ring-2 ring-teal-200' : 'border-gray-200'} ${col.bg}`}>
              <div className="px-3 py-2.5 border-b border-gray-200/70 flex items-center justify-between">
                <div><div className="text-sm font-semibold flex items-center gap-2" style={{ color: col.c }}><span className="w-2.5 h-2.5 rounded-full" style={{ background: col.c }} />{col.l}</div><div className="text-[10px] text-gray-400">{col.hint}</div></div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">{list.length}</span>
              </div>
              <div className="p-2 space-y-2 max-h-[560px] overflow-y-auto min-h-24">
                {list.map(p => (
                  <div key={p.code} draggable={canEdit} onDragStart={e => { setDrag(p.code); e.dataTransfer.setData('text/plain', p.code); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setOver(null) }}
                    className={`bg-white rounded-lg border border-gray-200 p-2.5 shadow-sm ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${drag === p.code ? 'opacity-40' : ''}`}>
                    <div className="flex items-start gap-1.5">
                      {canEdit && <GripVertical className="w-3.5 h-3.5 text-gray-300 mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">{p.firstName} {p.lastName}</div>
                        <div className="text-[11px] text-gray-400 flex items-center gap-1.5"><span className="font-mono">{p.code}</span><span className={`px-1.5 rounded ${p.jobType === 'chauffeur' ? 'bg-indigo-50 text-indigo-700' : 'bg-orange-50 text-orange-700'}`}>{p.jobType === 'chauffeur' ? 'Chauffeur' : 'Helper'}</span><span>{p.contractType}</span></div>
                      </div>
                      {canEdit && <button onClick={() => onEdit(p)} className="p-1 rounded border border-gray-200 hover:bg-gray-50" title="Ouvrir la fiche"><Pencil className="w-3 h-3" /></button>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                      {p.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>}
                      {p.hubName && <span>{p.hubName.replace('Marjane ', '')}</span>}
                      <span className="flex items-center gap-1"><GraduationCap className="w-3 h-3" /><span className={p.trainingDone ? 'text-green-600' : ''}>{p.trainingDone ? 'formation ✓' : 'formation à faire'}</span> · {p.quizScore != null ? <b className={p.quizScore >= 70 ? 'text-green-600' : 'text-red-600'}>{p.quizScore}%</b> : 'quiz —'}</span>
                    </div>
                    {!p.driving.ok && col.key !== 'inactif' && <div className="mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 inline-block">⚠ {p.driving.reasons[0]}</div>}
                    {p.contractReady && <a href={`/api/rh/people/${p.code}/contract`} target="_blank" className="mt-1.5 flex items-center gap-1 text-[11px] text-teal-700 hover:underline"><FileText className="w-3 h-3" />Contrat PDF</a>}
                  </div>
                ))}
                {!list.length && <div className="text-xs text-gray-300 text-center py-6">Déposez une fiche ici</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
