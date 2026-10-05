import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayBounds, dayOf } from '@/lib/ops-time'

// GET /api/ops/audit?q=&module=&actor=&hub=&from=&to=&limit=100&offset=0&format=csv
// Journal des actions (dispatch, pointage, paie, flotte, RH, paramétrage, encaissement…) — réservé à l'administration.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const from = sp.get('from') || dayOf('-30'), to = sp.get('to') || dayOf('today')
    const q = sp.get('q')?.trim(), mod = sp.get('module'), actor = sp.get('actor')?.trim(), hub = sp.get('hub')
    const csv = sp.get('format') === 'csv'
    const limit = csv ? 20000 : Math.min(Number(sp.get('limit')) || 100, 500), offset = Number(sp.get('offset')) || 0

    const where: Prisma.OpsAuditLogWhereInput = {
      at: { gte: dayBounds(from).from, lt: dayBounds(to).to },
      ...(mod ? { action: { startsWith: mod + '.' } } : {}), ...(hub ? { hubCode: hub } : {}), ...(actor ? { actor: { contains: actor, mode: 'insensitive' } } : {}),
      ...(q ? { OR: [{ action: { contains: q, mode: 'insensitive' } }, { entityId: { contains: q, mode: 'insensitive' } }, { actor: { contains: q, mode: 'insensitive' } }, { payload: { contains: q, mode: 'insensitive' } }] } : {}),
    }
    const [rows, total, modules] = await Promise.all([
      prisma.opsAuditLog.findMany({ where, orderBy: { at: 'desc' }, take: limit, skip: csv ? 0 : offset }),
      prisma.opsAuditLog.count({ where }),
      prisma.opsAuditLog.groupBy({ by: ['action'], _count: { _all: true } }),
    ])
    if (csv) {
      const lines = [['Date', 'Acteur', 'Action', 'Objet', 'Hub', 'Détail'], ...rows.map(r => [r.at.toISOString().replace('T', ' ').slice(0, 19), r.actor ?? '', r.action, `${r.entity} ${r.entityId ?? ''}`.trim(), r.hubCode ?? '', r.payload ?? ''])]
      return new NextResponse('﻿' + lines.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="journal_actions_${from}_${to}.csv"` } })
    }
    const counts = new Map<string, number>(); for (const m of modules) { const k = m.action.split('.')[0]; counts.set(k, (counts.get(k) ?? 0) + m._count._all) }
    return NextResponse.json({
      from, to, total, offset, limit, modules: [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      rows: rows.map(r => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, entity: r.entity, entityId: r.entityId, hubCode: r.hubCode, payload: r.payload })),
    })
  } catch (e) { return fail(e) }
}
