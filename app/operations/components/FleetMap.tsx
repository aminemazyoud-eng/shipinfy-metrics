'use client'
import { useEffect, useRef } from 'react'

export interface FleetVehicle { driverCode: string; name: string; lat: number; lng: number; ageSec: number; speedKmh: number | null; tourId: string; done: number; total: number; lateStops: number; etaLateStops: number; nextStop: { ref: string; etaAt: string | null } | null }
export interface FleetStopPt { orderId: string; ref: string; seq: number; status: string; lat: number | null; lng: number | null; late: boolean; etaLateMin: number; etaAt: string | null }
export interface FleetHub { code: string; name: string; lat: number | null; lng: number | null }

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }) : '—')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/** Carte des véhicules en direct (Leaflet, comme LiveMap) + stops de la tournée sélectionnée reliés dans l'ordre de passage. */
export default function FleetMap({ vehicles, stops, hubs, selectedTourId, onSelect }: {
  vehicles: FleetVehicle[]; stops: FleetStopPt[]; hubs: FleetHub[]; selectedTourId: string | null; onSelect?: (tourId: string) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const fitted = useRef(false)
  const cb = useRef(onSelect)
  useEffect(() => { cb.current = onSelect }, [onSelect])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      if (cancelled || !el.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(el.current).setView([33.57, -7.65], 11)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(mapRef.current)
      }
      const map = mapRef.current
      layerRef.current?.remove()
      const g = L.layerGroup().addTo(map)
      layerRef.current = g

      for (const h of hubs) {
        if (h.lat == null || h.lng == null) continue
        L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', iconSize: [22, 22], html: '<div style="width:22px;height:22px;border-radius:50%;background:#7c3aed;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);color:#fff;font:700 10px sans-serif;display:flex;align-items:center;justify-content:center">H</div>' }) }).bindTooltip(esc(h.name)).addTo(g)
      }
      // stops de la tournée sélectionnée, numérotés dans l'ordre de passage
      const route: [number, number][] = []
      for (const s of stops) {
        if (s.lat == null || s.lng == null) continue
        const done = s.status === 'DELIVERED' || s.status === 'NO_SHOW'
        const color = done ? '#16a34a' : s.late ? '#dc2626' : s.etaLateMin > 0 ? '#f59e0b' : '#2563eb'
        L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: [20, 20], html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;font:700 10px sans-serif;display:flex;align-items:center;justify-content:center">${s.seq}</div>` }) })
          .bindTooltip(`${esc(s.ref)} · ETA ${hhmm(s.etaAt)}${s.late ? ' · EN RETARD' : s.etaLateMin > 0 ? ` · risque (+${s.etaLateMin} min)` : ''}`).addTo(g)
        if (!done) route.push([s.lat, s.lng])
      }
      // véhicules
      const sel = vehicles.find(v => v.tourId === selectedTourId)
      if (sel && route.length) L.polyline([[sel.lat, sel.lng], ...route], { color: '#2563eb', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(g)
      for (const v of vehicles) {
        const bad = v.lateStops > 0, risk = v.etaLateStops > 0, stale = v.ageSec > 300
        const color = stale ? '#6b7280' : bad ? '#dc2626' : risk ? '#f59e0b' : '#16a34a'
        const m = L.marker([v.lat, v.lng], { icon: L.divIcon({ className: '', iconSize: [34, 34], html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};border:3px solid ${v.tourId === selectedTourId ? '#111827' : '#fff'};box-shadow:0 2px 6px rgba(0,0,0,.45);color:#fff;font:700 11px sans-serif;display:flex;align-items:center;justify-content:center">${esc(v.driverCode)}</div>` }), zIndexOffset: 1000 })
          .bindTooltip(`${esc(v.name)} · ${v.done}/${v.total} livrées${v.nextStop ? ` · prochain ${esc(v.nextStop.ref)} ${hhmm(v.nextStop.etaAt)}` : ''}${v.speedKmh != null ? ` · ${v.speedKmh} km/h` : ''} · position il y a ${v.ageSec < 90 ? v.ageSec + ' s' : Math.round(v.ageSec / 60) + ' min'}`)
        m.on('click', () => cb.current?.(v.tourId))
        m.addTo(g)
      }
      if (!fitted.current) {
        const pts: [number, number][] = [...vehicles.map(v => [v.lat, v.lng] as [number, number]), ...hubs.filter(h => h.lat != null && h.lng != null).map(h => [h.lat as number, h.lng as number] as [number, number])]
        if (pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 13 }); fitted.current = true }
      }
    })()
    return () => { cancelled = true }
  }, [vehicles, stops, hubs, selectedTourId])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  return <div ref={el} className="w-full h-[480px] rounded-xl border border-gray-200 z-0" />
}
