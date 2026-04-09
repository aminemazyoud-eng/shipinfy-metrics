'use client'

interface DayInfo {
  date: string
  volume: number
  avgDuration: number
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function fmtMin(min: number): string {
  if (min >= 60) return `${Math.round(min / 60 * 10) / 10}h`
  return `${min}min`
}

export function BestWorstDay({ best, worst }: { best: DayInfo | null; worst: DayInfo | null }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xl">🌟</span>
          <h3 className="font-semibold text-green-900">Meilleure journée</h3>
        </div>
        {best ? (
          <>
            <p className="text-3xl font-bold text-green-800">{fmtDate(best.date)}</p>
            <p className="mt-1 text-sm text-green-700">{best.volume} commandes · Durée moy. {fmtMin(best.avgDuration)}</p>
          </>
        ) : <p className="text-sm text-green-700">Données insuffisantes</p>}
      </div>
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          <h3 className="font-semibold text-red-900">Journée la plus lente</h3>
        </div>
        {worst ? (
          <>
            <p className="text-3xl font-bold text-red-800">{fmtDate(worst.date)}</p>
            <p className="mt-1 text-sm text-red-700">{worst.volume} commandes · Durée moy. {fmtMin(worst.avgDuration)}</p>
          </>
        ) : <p className="text-sm text-red-700">Données insuffisantes</p>}
      </div>
    </div>
  )
}
