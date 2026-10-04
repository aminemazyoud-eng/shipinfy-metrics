'use client'
import { useEffect, useRef } from 'react'
import type { LivePoint } from '@/lib/ops-analytics'

interface HubPt { code: string; name: string; lat: number | null; lng: number | null }

// Carte live : points colorés (rouge = en retard, orange = en cours, bleu = à dispatcher) + heatmap optionnelle
export default function LiveMap({ points, hubs, heat }: { points: LivePoint[]; hubs: HubPt[]; heat: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      // @ts-expect-error leaflet.heat sans types
      await import('leaflet.heat')
      if (cancelled || !el.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(el.current).setView([33.57, -7.65], 11)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(mapRef.current)
      }
      const map = mapRef.current
      layerRef.current?.remove()
      const g = L.layerGroup().addTo(map)
      layerRef.current = g

      if (heat) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(L as any).heatLayer(points.map(p => [p.lat, p.lng, p.late ? 1 : 0.5]), { radius: 22, blur: 18, maxZoom: 15,
          gradient: { 0.3: '#3b82f6', 0.6: '#f59e0b', 1.0: '#dc2626' } }).addTo(g)
      } else {
        for (const p of points) {
          const color = p.late ? '#dc2626' : p.status === 'READY_PICKUP' ? '#2563eb' : '#f59e0b'
          L.circleMarker([p.lat, p.lng], { radius: p.late ? 6 : 4, color, fillColor: color, fillOpacity: 0.8, weight: 1 })
            .bindTooltip(`${p.hubCode} · ${p.slot} · ${p.status}${p.late ? ' · EN RETARD' : ''}`).addTo(g)
        }
      }
      for (const h of hubs) {
        if (h.lat == null || h.lng == null) continue
        L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26],
          html: '<div style="width:26px;height:26px;border-radius:50%;background:#7c3aed;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);color:#fff;font:700 11px sans-serif;display:flex;align-items:center;justify-content:center">H</div>' }) })
          .bindTooltip(h.name).addTo(g)
      }
      if (!fitted.current && (points.length || hubs.length)) {
        const pts = [...points.map(p => [p.lat, p.lng] as [number, number]), ...hubs.filter(h => h.lat != null).map(h => [h.lat as number, h.lng as number] as [number, number])]
        if (pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 13 }); fitted.current = true }
      }
    })()
    return () => { cancelled = true }
  }, [points, hubs, heat])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  return <div ref={el} className="w-full h-[520px] rounded-xl border border-gray-200 z-0" />
}
