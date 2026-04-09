import { NextResponse } from 'next/server'

/**
 * Real-time dashboard API
 *
 * Retourne les données en temps réel du back-office Shipinfy.
 * Pour l'instant, utilise des données mock au même format que l'API réelle.
 *
 * Quand l'API back-office sera disponible, remplacer le bloc MOCK DATA
 * par un fetch vers BACKOFFICE_API_URL avec la clé BACKOFFICE_API_KEY.
 *
 * Format attendu de l'API réelle :
 * GET ${BACKOFFICE_API_URL}/live-stats
 * Headers: Authorization: Bearer ${BACKOFFICE_API_KEY}
 *
 * Response: { orders, drivers, deliveryRate, cod, hubs, updatedAt }
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LiveDriver {
  id: string
  name: string
  status: 'active' | 'delivering' | 'returning' | 'idle'
  hub: string
  ordersToday: number
  ordersDelivered: number
  lat?: number
  lng?: number
}

interface LiveOrder {
  id: string
  ref: string
  status: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'NO_SHOW' | 'PENDING'
  hub: string
  driver?: string
  creneau: string
  cod: number
}

interface LiveStats {
  totalOrdersToday: number
  ordersInTransit: number
  ordersDelivered: number
  ordersNoShow: number
  deliveryRateLive: number
  codCollectedToday: number
  activeDrivers: number
  drivers: LiveDriver[]
  recentOrders: LiveOrder[]
  hubStats: Array<{
    name: string
    total: number
    delivered: number
    inTransit: number
    rate: number
  }>
  updatedAt: string
}

// ─── MOCK DATA ─────────────────────────────────────────────────────────────────
// Remplacer ce bloc par un vrai fetch quand l'API back-office sera disponible.
// Le format de retour doit rester identique pour ne pas modifier le frontend.
function generateMockData(): LiveStats {
  const now = new Date()
  const hourOfDay = now.getHours()

  // Simulate realistic order counts based on time of day
  const baseOrders = Math.floor(80 + hourOfDay * 8 + Math.random() * 20)
  const delivered  = Math.floor(baseOrders * (0.72 + Math.random() * 0.18))
  const noShow     = Math.floor(baseOrders * (0.05 + Math.random() * 0.06))
  const inTransit  = baseOrders - delivered - noShow

  const drivers: LiveDriver[] = [
    { id: 'd1', name: 'Karim Benali',    status: 'delivering', hub: 'Hub Guéliz',     ordersToday: 18, ordersDelivered: 14, lat: 31.631, lng: -8.008 },
    { id: 'd2', name: 'Youssef Alami',   status: 'active',     hub: 'Hub Médina',     ordersToday: 22, ordersDelivered: 19, lat: 31.629, lng: -7.990 },
    { id: 'd3', name: 'Omar Tazi',       status: 'delivering', hub: 'Hub Hivernage',  ordersToday: 15, ordersDelivered: 11, lat: 31.622, lng: -8.014 },
    { id: 'd4', name: 'Hassan Rachidi',  status: 'returning',  hub: 'Hub Guéliz',     ordersToday: 20, ordersDelivered: 18, lat: 31.635, lng: -8.001 },
    { id: 'd5', name: 'Mehdi Ouali',     status: 'active',     hub: 'Hub Majorelle',  ordersToday: 12, ordersDelivered: 9,  lat: 31.634, lng: -7.993 },
    { id: 'd6', name: 'Amine Boukhari',  status: 'idle',       hub: 'Hub Médina',     ordersToday: 25, ordersDelivered: 24, lat: 31.627, lng: -7.987 },
    { id: 'd7', name: 'Rachid Hamdouch', status: 'delivering', hub: 'Hub Palmeraie',  ordersToday: 17, ordersDelivered: 13, lat: 31.659, lng: -7.975 },
    { id: 'd8', name: 'Samir El Fassi',  status: 'active',     hub: 'Hub Targa',      ordersToday: 19, ordersDelivered: 16, lat: 31.645, lng: -8.028 },
  ]

  const recentOrders: LiveOrder[] = [
    { id: 'o1', ref: 'MRK-2024-001',  status: 'OUT_FOR_DELIVERY', hub: 'Hub Guéliz',    driver: 'Karim Benali',    creneau: '12:00-15:00', cod: 250 },
    { id: 'o2', ref: 'MRK-2024-002',  status: 'DELIVERED',        hub: 'Hub Médina',    driver: 'Youssef Alami',   creneau: '09:00-12:00', cod: 180 },
    { id: 'o3', ref: 'MRK-2024-003',  status: 'IN_TRANSIT',       hub: 'Hub Hivernage', driver: 'Omar Tazi',       creneau: '15:00-18:00', cod: 320 },
    { id: 'o4', ref: 'MRK-2024-004',  status: 'NO_SHOW',          hub: 'Hub Guéliz',    driver: 'Hassan Rachidi',  creneau: '12:00-15:00', cod: 150 },
    { id: 'o5', ref: 'MRK-2024-005',  status: 'DELIVERED',        hub: 'Hub Majorelle', driver: 'Mehdi Ouali',     creneau: '09:00-12:00', cod: 450 },
    { id: 'o6', ref: 'MRK-2024-006',  status: 'OUT_FOR_DELIVERY', hub: 'Hub Médina',    driver: 'Amine Boukhari',  creneau: '15:00-18:00', cod: 280 },
    { id: 'o7', ref: 'MRK-2024-007',  status: 'IN_TRANSIT',       hub: 'Hub Palmeraie', driver: 'Rachid Hamdouch', creneau: '18:00-21:00', cod: 190 },
    { id: 'o8', ref: 'MRK-2024-008',  status: 'PENDING',          hub: 'Hub Targa',     driver: undefined,          creneau: '18:00-21:00', cod: 370 },
  ]

  const hubs = [
    { name: 'Hub Guéliz',    total: 145, delivered: 119, inTransit: 18, rate: 82.1 },
    { name: 'Hub Médina',    total: 128, delivered: 108, inTransit: 12, rate: 84.4 },
    { name: 'Hub Hivernage', total: 97,  delivered: 78,  inTransit: 11, rate: 80.4 },
    { name: 'Hub Majorelle', total: 74,  delivered: 63,  inTransit: 8,  rate: 85.1 },
    { name: 'Hub Palmeraie', total: 62,  delivered: 50,  inTransit: 9,  rate: 80.6 },
    { name: 'Hub Targa',     total: 58,  delivered: 46,  inTransit: 7,  rate: 79.3 },
  ]

  return {
    totalOrdersToday: baseOrders,
    ordersInTransit:  Math.max(0, inTransit),
    ordersDelivered:  delivered,
    ordersNoShow:     noShow,
    deliveryRateLive: Math.round((delivered / baseOrders) * 1000) / 10,
    codCollectedToday: Math.round(delivered * 287.5),
    activeDrivers: drivers.filter(d => d.status !== 'idle').length,
    drivers,
    recentOrders,
    hubStats: hubs,
    updatedAt: now.toISOString(),
  }
}
// ─── END MOCK DATA ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // TODO: When back-office API is available, replace with:
    // const BACKOFFICE_API_URL = process.env.BACKOFFICE_API_URL
    // const BACKOFFICE_API_KEY = process.env.BACKOFFICE_API_KEY
    // if (BACKOFFICE_API_URL) {
    //   const res = await fetch(`${BACKOFFICE_API_URL}/live-stats`, {
    //     headers: { Authorization: `Bearer ${BACKOFFICE_API_KEY}` },
    //     next: { revalidate: 0 },
    //   })
    //   if (res.ok) return NextResponse.json(await res.json())
    // }

    const data = generateMockData()
    return NextResponse.json(data)
  } catch (e) {
    console.error('[realtime]', e)
    return NextResponse.json({ error: 'Failed to fetch live data' }, { status: 500 })
  }
}
