import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-guard'
import { runAlertCheck } from '@/lib/alert-check'

// Checks all enabled alert rules against latest KPIs
// Called by cron (hourly) or manually from the Alertes page
export async function POST(req: Request) {
  const _guard = await requireSession(req, 'MANAGER', { allowCron: true }); if ('error' in _guard) return _guard.error
  try {
    // La logique vit dans lib/alert-check.ts (partagée avec le cron, qui l'appelle directement)
    return NextResponse.json(await runAlertCheck())
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Check failed' }, { status: 500 })
  }
}
