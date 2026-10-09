import { NextResponse } from 'next/server'
import { calculateScores } from '@/lib/score-ia-engine'
import { getSession } from '@/lib/auth'
import { requireSession } from '@/lib/api-guard'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const _guard = await requireSession(req, 'MANAGER', { allowCron: true }); if ('error' in _guard) return _guard.error
  try {
    // La logique vit dans lib/score-ia-engine.ts (partagée avec le cron de 02:00, qui l'appelle directement)
    const session = _guard.session.userId === 'cron' ? null : await getSession(req)

    // Corps optionnel { reportId } → ce rapport au lieu du rapport actif
    let bodyReportId: string | undefined
    try {
      const body = await req.json() as { reportId?: string } | null
      bodyReportId = body?.reportId || undefined
    } catch {
      bodyReportId = undefined
    }

    const r = await calculateScores({ reportId: bodyReportId, tenantId: session?.tenantId })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ calculated: r.calculated, drivers: r.drivers, purged: r.purged, reportId: r.reportId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
