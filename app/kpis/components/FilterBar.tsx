'use client'
import { useState, useRef, useEffect } from 'react'
import { RotateCcw, ChevronDown, Check } from 'lucide-react'

export interface FilterState {
  preset: 'yesterday' | 'today' | 'week' | 'month' | 'all'
  dateFrom: string
  dateTo: string
  selectedCreneaux: string[]
  selectedHubs: string[]
  selectedLivreurs: string[]
}

export const DEFAULT_FILTERS: FilterState = {
  preset: 'all', dateFrom: '', dateTo: '',
  selectedCreneaux: [], selectedHubs: [], selectedLivreurs: [],
}

const PRESETS = [
  { value: 'yesterday', label: 'Hier' },
  { value: 'today',     label: "Aujourd'hui" },
  { value: 'week',      label: 'Cette semaine' },
  { value: 'month',     label: 'Ce mois' },
  { value: 'all',       label: 'Tout' },
] as const

const CRENEAUX_OPTIONS = [
  '09:00-12:00',
  '12:00-15:00',
  '15:00-18:00',
  '18:00-21:00',
  '20:00-23:00',
]

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const toggle = (opt: string) => {
    if (selected.includes(opt)) onChange(selected.filter(s => s !== opt))
    else onChange([...selected, opt])
  }

  const displayText =
    selected.length === 0
      ? `${placeholder}`
      : selected.length === 1
        ? selected[0].length > 18 ? selected[0].slice(0, 16) + '…' : selected[0]
        : `${selected.length} sélectionné(s)`

  return (
    <div className="relative flex flex-col gap-1" ref={ref}>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex min-w-[160px] items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm text-left transition-colors ${
          selected.length > 0
            ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl min-w-[190px]">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full px-3 py-2 text-xs text-left text-blue-600 hover:bg-blue-50 border-b border-gray-100 font-medium"
            >
              Tout désélectionner
            </button>
          )}
          {options.map(opt => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-sm"
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                selected.includes(opt) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
              }`}>
                {selected.includes(opt) && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </span>
              <input type="checkbox" className="sr-only" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  hubs: string[]
  sprints: string[]
}

export function FilterBar({ filters, onChange, hubs, sprints }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })

  const activeFiltersCount =
    filters.selectedHubs.length + filters.selectedLivreurs.length + filters.selectedCreneaux.length

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => set({ preset: p.value, dateFrom: '', dateTo: '' })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filters.preset === p.value && !filters.dateFrom
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        {activeFiltersCount > 0 && (
          <span className="ml-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
            {activeFiltersCount} filtre{activeFiltersCount > 1 ? 's' : ''} actif{activeFiltersCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Date début</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => set({ dateFrom: e.target.value, preset: 'all' })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Date fin</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => set({ dateTo: e.target.value, preset: 'all' })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <MultiSelect
          label="Créneaux"
          options={CRENEAUX_OPTIONS}
          selected={filters.selectedCreneaux}
          onChange={v => set({ selectedCreneaux: v })}
          placeholder="Tous les créneaux"
        />

        {hubs.length > 0 && (
          <MultiSelect
            label="Hubs"
            options={hubs}
            selected={filters.selectedHubs}
            onChange={v => set({ selectedHubs: v })}
            placeholder="Tous les hubs"
          />
        )}

        {sprints.length > 0 && (
          <MultiSelect
            label="Livreurs"
            options={sprints}
            selected={filters.selectedLivreurs}
            onChange={v => set({ selectedLivreurs: v })}
            placeholder="Tous les livreurs"
          />
        )}

        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Réinitialiser
        </button>
      </div>
    </div>
  )
}
