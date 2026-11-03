'use client'
// Carte des stops de la journée (Leaflet, import dynamique : jamais chargé côté serveur). Marqueurs numérotés reliés dans l'ordre de passage ;
// le stop sélectionné est mis en avant. Sans réseau les tuiles manquent mais les marqueurs restent affichés (fond neutre).
import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

export interface MapStop { id: string; seq: number; lat: number | null; lng: number | null; status: string }

const COLOR = (s: string) => (s === 'START_DELIVERY' ? '#d97706' : s === 'IN_TRANSPORT' ? '#0891b2' : '#2563eb')

export default function StopMap({ stops, focusId, hub, onPick }: { stops: MapStop[]; focusId: string | null; hub: { lat: number; lng: number } | null; onPick: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const fitted = useRef(false)
  const pick = useRef(onPick)
  useEffect(() => { pick.current = onPick }, [onPick])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        if (cancelled || !el.current) return
        if (!mapRef.current) {
          mapRef.current = L.map(el.current, { zoomControl: false, attributionControl: false }).setView(hub ? [hub.lat, hub.lng] : [33.57, -7.65], 12)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapRef.current)
        }
        const map = mapRef.current
        layerRef.current?.remove()
        const g = L.layerGroup().addTo(map)
        layerRef.current = g
        const pts = stops.filter(s => s.lat != null && s.lng != null) as (MapStop & { lat: number; lng: number })[]
        if (pts.length > 1) L.polyline(pts.map(p => [p.lat, p.lng] as [number, number]), { color: '#2563eb', weight: 4, opacity: 0.55, dashArray: '2 8' }).addTo(g)
        for (const p of pts) {
          const on = p.id === focusId, size = on ? 38 : 28
          const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${on ? COLOR(p.status) : '#fff'};color:${on ? '#fff' : COLOR(p.status)};border:3px solid ${COLOR(p.status)};display:flex;align-items:center;justify-content:center;font:800 ${on ? 16 : 13}px system-ui;box-shadow:0 2px 6px rgba(0,0,0,.3)">${p.seq}</div>`
          L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html }), zIndexOffset: on ? 1000 : 0 })
            .on('click', () => pick.current(p.id)).addTo(g)
        }
        if (hub) L.circleMarker([hub.lat, hub.lng], { radius: 7, color: '#111827', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(g)
        const focus = pts.find(p => p.id === focusId)
        if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 14), { duration: 0.5 })
        else if (!fitted.current && pts.length) { map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 15 }); fitted.current = true }
      } catch { /* carte indisponible : la liste et les actions restent utilisables */ }
    })()
    return () => { cancelled = true }
  }, [stops, focusId, hub])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])
  return <div ref={el} className="absolute inset-0 z-0 bg-slate-200" style={{ isolation: 'isolate' }} aria-hidden="true" />
}
