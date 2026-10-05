'use client'
import { fmtDuration, type Step, type Tone } from '@/lib/ops-steps'

export const TONE_CHIP: Record<Tone, string> = {
  green: 'bg-green-100 text-green-800 border-green-200', amber: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200', none: 'bg-gray-50 text-gray-300 border-gray-100',
}
const DOT: Record<Tone, string> = { green: '#16a34a', amber: '#f59e0b', red: '#dc2626', none: '#d1d5db' }
export const hhmm = (d: string | null) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }) : '—')

/** Heure d'une étape en pastille colorée (+ délai depuis l'étape précédente). */
export function StepChip({ s, compact }: { s: Step; compact?: boolean }) {
  if (!s.at) return <span className="text-gray-300">—</span>
  return (
    <span className={`inline-flex items-baseline gap-1 border rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap ${TONE_CHIP[s.tone]}`} title={`${s.label} · ${new Date(s.at).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })}${s.delayMin != null ? ` · +${fmtDuration(s.delayMin)} après l'étape précédente` : ''}`}>
      <b className="font-semibold">{hhmm(s.at)}</b>{!compact && s.delayMin != null && <span className="text-[10px] opacity-75">+{fmtDuration(s.delayMin)}</span>}
    </span>
  )
}

/** Parcours complet : chaque étape avec son heure et le délai écoulé, en couleur. */
export default function OrderTimeline({ steps, totalMin, slotLabel }: { steps: Step[]; totalMin: number | null; slotLabel?: string | null }) {
  const done = steps.filter(s => s.at)
  return (
    <div>
      <ol className="border-l-2 border-gray-200 ml-1.5 space-y-3">
        {steps.map(s => (
          <li key={s.key} className="pl-4 relative">
            <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ring-2 ring-white" style={{ background: DOT[s.tone] }} />
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm ${s.at ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>{s.label}</span>
              {s.at && <span className={`border rounded-md px-1.5 py-0.5 text-sm font-semibold ${TONE_CHIP[s.tone]}`}>{hhmm(s.at)}</span>}
              {s.delayMin != null && <span className={`text-xs border rounded-md px-1.5 py-0.5 ${TONE_CHIP[s.tone]}`}>+{fmtDuration(s.delayMin)}</span>}
              {s.late ? <span className="text-xs border rounded-md px-1.5 py-0.5 bg-red-100 text-red-800 border-red-200">hors créneau {slotLabel ? `${slotLabel.replace('-', 'h–')}h ` : ''}+{fmtDuration(s.late)}</span> : null}
            </div>
          </li>
        ))}
      </ol>
      {totalMin != null && done.length > 1 && <div className="mt-3 text-xs text-gray-500">Durée totale du parcours : <b className="text-gray-800">{fmtDuration(totalMin)}</b></div>}
      <div className="mt-2 flex gap-3 text-[11px] text-gray-400"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-green-600" />dans les temps</span><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-500" />lent</span><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-red-600" />trop long</span></div>
    </div>
  )
}
