'use client'
import { useEffect, useRef } from 'react'
import type { HeatmapData } from './DeliveryHeatmap'

export default function DeliveryHeatmapInner({ data }: { data: HeatmapData }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<unknown>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    async function initMap() {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      // @ts-expect-error leaflet.heat has no types
      await import('leaflet.heat')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      })

      if (!mapRef.current) return

      let centerLat = 31.6074
      let centerLng = -8.0435
      if (data.heatmapPoints.length > 0) {
        const lats = data.heatmapPoints.map(p => p[0]).filter(v => v !== 0)
        const lngs = data.heatmapPoints.map(p => p[1]).filter(v => v !== 0)
        if (lats.length > 0) {
          centerLat = lats.reduce((s, v) => s + v, 0) / lats.length
          centerLng = lngs.reduce((s, v) => s + v, 0) / lngs.length
        }
      }

      const map = L.map(mapRef.current, { zoomControl: true }).setView([centerLat, centerLng], 12)
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      if (data.heatmapPoints.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(L as any).heatLayer(data.heatmapPoints, {
          radius: 20,
          blur: 18,
          maxZoom: 17,
          gradient: { 0.2: '#3b82f6', 0.5: '#8b5cf6', 0.8: '#ef4444', 1.0: '#ff0000' },
        }).addTo(map)
      }

      const hubIcon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50%;background:#7c3aed;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:12px;color:white;font-weight:bold;">H</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      for (const hub of data.hubLocations) {
        L.marker([hub.lat, hub.lng], { icon: hubIcon })
          .addTo(map)
          .bindPopup(`<b>🏭 Hub</b><br/>${hub.name}`)
      }

      const noShowIcon = L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:#ef4444;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:10px;color:white;font-weight:bold;">✕</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      for (const ns of data.noShowLocations) {
        const name = [ns.firstName, ns.lastName].filter(Boolean).join(' ') || 'Inconnu'
        L.marker([ns.lat, ns.lng], { icon: noShowIcon })
          .addTo(map)
          .bindPopup(`<b>🚫 NO_SHOW</b><br/>Client: ${name}<br/>Réf: ${ns.ref ?? '—'}`)
      }
    }

    initMap().catch(console.error)

    return () => {
      if (mapInstanceRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mapInstanceRef.current as any).remove()
        mapInstanceRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}
