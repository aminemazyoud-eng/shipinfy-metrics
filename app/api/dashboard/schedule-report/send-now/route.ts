import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { audit } from '@/lib/ops-auth'

// POST /api/dashboard/schedule-report/send-now?id=… — envoie tout de suite le rapport d'une planification (mêmes destinataires, même contenu).
// Action explicite d'un MANAGER+ : le résultat est tracé dans l'historique des envois et dans le journal d'audit.
export async function POST(request: Request) {
  const _guard = await requireSession(request, 'MANAGER'); if ('error' in _guard) return _guard.error
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  try {
    const { sendScheduledReport } = await import('@/lib/cron')
    const r = await sendScheduledReport(id)
    await audit(_guard.session, 'report.send_now', 'scheduledReport', id, { success: r.success, error: r.error ?? null })
    return NextResponse.json(r, { status: r.success ? 200 : 422 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, error: 'Envoi impossible' }, { status: 500 })
  }
}
