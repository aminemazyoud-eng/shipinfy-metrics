'use client'
// Carte des livraisons (Leaflet). Par défaut AUCUN fond externe (comme le HTML : « fond cartographique externe uniquement sur demande »).
import { useEffect, useRef } from 'react'
import { mapCells, type GeoPoint } from '@/lib/ops-bi'

type Mode = 'dots' | 'density' | 'late'
interface Store { name: string; lat: number; lon: number }

export default function GeoMap({ points, stores, mode, tiles }: { points: GeoPoint[]; stores: Store[]; mode: Mode; tiles: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const tileRef = useRef<import('leaflet').TileLayer | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      if (cancelled || !el.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([32.5, -8.1], 6)
        el.current.style.background = '#f7f9fd'
      }
      const map = mapRef.current
      if (tiles && !tileRef.current) tileRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
      if (!tiles && tileRef.current) { tileRef.current.remove(); tileRef.current = null }
      layerRef.current?.remove()
      const g = L.layerGroup().addTo(map)
      layerRef.current = g
      const bounds: [number, number][] = []
      for (const c of mapCells(points, mode)) {
        L.circleMarker([c.lat, c.lon], { radius: c.radius, color: c.color, fillColor: c.color, fillOpacity: 0.7, weight: 0.4 })
          .bindTooltip(`${c.count} commande(s), ${c.late} en retard`).addTo(g)
        bounds.push([c.lat, c.lon])
      }
      for (const s of stores) {
        L.circleMarker([s.lat, s.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#165eb7', fillOpacity: 1 }).bindTooltip(s.name, { permanent: false }).addTo(g)
        bounds.push([s.lat, s.lon])
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 })
      setTimeout(() => map.invalidateSize(), 60)
    })()
    return () => { cancelled = true }
  }, [points, stores, mode, tiles])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  return <div ref={el} className="h-[460px] w-full rounded-lg border border-slate-200" />
}
