'use client'
import dynamic from 'next/dynamic'
import { MapPin } from 'lucide-react'

export interface HeatmapData {
  heatmapPoints: [number, number, number][]
  noShowLocations: Array<{
    lat: number
    lng: number
    firstName?: string
    lastName?: string
    ref?: string
  }>
  hubLocations: Array<{ name: string; lat: number; lng: number }>
}

const HeatmapInner = dynamic(() => import('./DeliveryHeatmapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-gray-100 rounded-lg">
      <div className="text-center text-gray-500">
        <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="text-sm">Chargement de la carte...</p>
      </div>
    </div>
  ),
})

interface Props {
  data: HeatmapData
  totalOrders: number
}

export function DeliveryHeatmap({ data, totalOrders }: Props) {
  const hasData = data.heatmapPoints.length > 0 || data.noShowLocations.length > 0

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm col-span-1 lg:col-span-2">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
            <MapPin className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Carte des livraisons — Marrakech</h3>
            <p className="text-xs text-gray-500">
              Heatmap des {totalOrders} commandes · OpenStreetMap
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow" />
            Livraisons
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow" />
            NO_SHOW ({data.noShowLocations.length})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-600 shadow" />
            Hubs ({data.hubLocations.length})
          </span>
        </div>
      </div>

      <div className="h-[460px] rounded-lg overflow-hidden border border-gray-200">
        {hasData ? (
          <HeatmapInner data={data} />
        ) : (
          <div className="flex h-full items-center justify-center bg-gray-50">
            <div className="text-center text-gray-400">
              <MapPin className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p className="text-sm">Aucune coordonnée disponible</p>
              <p className="text-xs mt-1">Vérifiez que le fichier Excel contient des coordonnées GPS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
