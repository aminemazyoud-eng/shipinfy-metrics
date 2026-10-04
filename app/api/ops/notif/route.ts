import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { EVENTS, AUDIENCES, ensureDefaults, connectionsStatus, runIncidentChecks, sendSample } from '@/lib/ops-notify'

const mask = (u: string | null) => (u ? `••••${u.slice(-6)}` : null)

// GET /api/ops/notif — catalogue (événements, audiences), règles, canaux (webhooks masqués), état des connexions, journal récent
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    await ensureDefaults()
    const [rules, channels, logs, slack, n8n] = await Promise.all([
      prisma.opsNotifRule.findMany({ orderBy: [{ event: 'asc' }, { audience: 'asc' }] }),
      prisma.opsNotifChannel.findMany(),
      prisma.opsNotifLog.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.slackConfig.findFirst({ where: { active: true } }),
      prisma.n8NConfig.count({ where: { active: true } }),
    ])
    return NextResponse.json({
      canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role),
      events: EVENTS, audiences: AUDIENCES, rules,
      channels: channels.map(c => ({ key: c.key, kind: c.kind, label: c.label, active: c.active, webhook: mask(c.webhookUrl), configured: Boolean(c.webhookUrl) })),
      connections: { ...connectionsStatus(), slackGlobal: Boolean(slack), n8nActive: n8n },
      logs,
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/notif  (ADMIN)
//   { action:'channel', key, webhookUrl?, active? }   enregistre le webhook Slack d'une équipe
//   { action:'rule', id, enabled?, template? }        active / désactive / modifie le message d'une règle
//   { action:'test', id, to? }                        message d'essai
//   { action:'run', dryRun? }                         exécute les contrôles maintenant
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { action: string; key?: string; webhookUrl?: string; active?: boolean; id?: string; enabled?: boolean; template?: string; to?: string; dryRun?: boolean }
    if (b.action === 'channel' && b.key) {
      if (b.webhookUrl && !/^https:\/\/hooks\.slack\.com\//.test(b.webhookUrl)) return NextResponse.json({ error: 'URL invalide : un webhook Slack commence par https://hooks.slack.com/…' }, { status: 400 })
      await prisma.opsNotifChannel.update({ where: { key: b.key }, data: { ...(b.webhookUrl !== undefined ? { webhookUrl: b.webhookUrl || null } : {}), ...(b.active !== undefined ? { active: b.active } : {}) } })
      await audit(auth.session, 'notif.channel', 'config', b.key, { webhook: b.webhookUrl !== undefined ? 'modifié' : undefined, active: b.active })
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'rule' && b.id) {
      await prisma.opsNotifRule.update({ where: { id: b.id }, data: { ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.template ? { template: b.template } : {}) } })
      await audit(auth.session, 'notif.rule', 'config', b.id, { enabled: b.enabled, template: b.template ? 'modifié' : undefined })
      return NextResponse.json({ ok: true })
    }
    if (b.action === 'test' && b.id) return NextResponse.json(await sendSample(b.id, b.to))
    if (b.action === 'run') { const r = await runIncidentChecks({ dryRun: b.dryRun }); await audit(auth.session, 'notif.run', 'config', null, { dryRun: !!b.dryRun, sent: r.sent, failed: r.failed }); return NextResponse.json(r) }
    return NextResponse.json({ error: 'action invalide' }, { status: 400 })
  } catch (e) { return fail(e) }
}
