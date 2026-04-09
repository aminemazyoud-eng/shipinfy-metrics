'use client'

interface Timing {
  orderToAssign: number
  assignToTransport: number
  transportToStart: number
  startToDelivered: number
  totalDuration: number
}

function fmtMin(min: number): string {
  if (min >= 60) return `${Math.round(min / 60 * 10) / 10}h`
  return `${min}min`
}

export function DeliveryPipeline({ timing }: { timing: Timing }) {
  const steps = [
    { label: 'Commande créée → Assignée', value: timing.orderToAssign, emoji: '📋' },
    { label: 'Assignée → En transit', value: timing.assignToTransport, emoji: '🔄' },
    { label: 'En transit → Départ livraison', value: timing.transportToStart, emoji: '🚚' },
    { label: 'Départ → Livrée', value: timing.startToDelivered, emoji: '📦' },
  ]
  const total = timing.totalDuration || 1

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-gray-900">Pipeline de livraison</h3>
      <div className="space-y-4">
        {steps.map(s => (
          <div key={s.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-gray-700">{s.emoji} {s.label}</span>
              <span className="font-semibold text-gray-900">{fmtMin(s.value)}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-blue-500"
                style={{ width: `${Math.min(100, Math.round((s.value / total) * 100))}%` }}
              />
            </div>
          </div>
        ))}
        <div className="mt-4 flex justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm font-semibold">
          <span>⏱ Durée totale moyenne</span>
          <span className="text-blue-700">{fmtMin(timing.totalDuration)}</span>
        </div>
      </div>
    </div>
  )
}
