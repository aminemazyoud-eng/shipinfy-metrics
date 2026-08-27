import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notify, type NotifyChannel } from '@/lib/notify'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// POST /api/notifications/[id]/retry — renvoie une notification échouée.
// Note : le PDF n'est pas conservé → un rapport renvoyé part sans pièce jointe
// (résumé + lien in-app). Les alertes se renvoient à l'identique.
export async function POST(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const log = await prisma.notificationLog.findUnique({ where: { id } })
    if (!log) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const stored = safeParse<{
      channels?: NotifyChannel[]
      recipients?: string[]
      data?: Record<string, unknown>
      title?: string
      summary?: string
    }>(log.payloadJson) ?? {}

    const r = await notify({
      kind:       log.kind === 'alert' ? 'alert' : 'report',
      event:      'notification_retry',
      title:      stored.title ?? log.title,
      summary:    `↻ Renvoi — ${stored.summary ?? log.summary}`,
      channels:   stored.channels ?? (safeParse<NotifyChannel[]>(log.channels) ?? undefined),
      recipients: stored.recipients ?? (log.recipients ? log.recipients.split(',').map(s => s.trim()) : undefined),
      reportId:   log.reportId ?? undefined,
      alertLevel: log.alertLevel ?? undefined,
      data:       stored.data,
    })

    return NextResponse.json({ retried: true, notificationId: r.notificationId, status: r.status, mode: r.mode })
  } catch (e) {
    console.error('[api/notifications/retry]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
