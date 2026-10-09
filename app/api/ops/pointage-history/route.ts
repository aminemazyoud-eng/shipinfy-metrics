import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOf, attendanceKey } from '@/lib/ops-time'
import { addDays, localToday, dayBoundsTz } from '@/lib/tz'
import { periodStatus } from '@/lib/ops-lock'
import { workedMinutes } from '@/lib/ops-attendance-calc'
import { xlsxResponse } from '@/lib/xlsx-response'

// GET /api/ops/pointage-history — consultation du pointage (rôle minimum DISPATCHER), toutes dates en JOUR LOCAL
//   ?view=day&day=YYYY-MM-DD                    → liste du jour (livreur, hub, statut, arrivée, départ, heures, retard, départ prévu, note)
//   ?view=month&month=YYYY-MM                   → matrice livreur × jours + totaux + verrou de paie
//   ?view=history&driver=&from=&to=             → journal des corrections (OpsAuditLog 'pointage.*') + créations par QR
//   &format=xlsx                                → même contenu en fichier Excel

const DAY_RE = /^\d{4}-\d\d-\d\d$/
const MONTH_RE = /^\d{4}-\d\d$/

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const toCsv = (rows: unknown[][]) => rows.map(r => r.map(cell).join(';')).join('\n')
const hm = (min: number | null | undefined) => (min ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : '')
const mins = (r: { workedMinutes: number | null; checkIn: Date | null; checkOut: Date | null }) => r.workedMinutes ?? workedMinutes(r.checkIn, r.checkOut)
const STATUS_FR: Record<string, string> = { present: 'Présent', late: 'Retard', absent: 'Absent', leave: 'Congé', none: 'Non pointé' }

export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const view = sp.get('view') || 'day'
    const xlsx = sp.get('format') === 'xlsx'

    // ─── Jour ───────────────────────────────────────────────────────────────
    if (view === 'day') {
      const day = dayOf(sp.get('day'))
      const [rows, plan, drivers] = await Promise.all([
        prisma.driverAttendance.findMany({ where: { date: attendanceKey(day) }, orderBy: { driverName: 'asc' } }),
        prisma.opsPlanLine.findMany({ where: { day }, select: { driverCode: true, hubCode: true, departTime: true } }),
        prisma.opsDriver.findMany({ select: { code: true, firstName: true, lastName: true } }),
      ])
      const nameByCode = new Map(drivers.map(d => [d.code, `${d.firstName} ${d.lastName}`]))
      const seen = new Set(rows.map(r => r.driverName))
      const planByName = new Map(plan.map(p => [nameByCode.get(p.driverCode) ?? p.driverCode, p]))
      const items = rows.map(r => ({
        id: r.id, driverName: r.driverName, role: r.role, hub: r.hub ?? planByName.get(r.driverName)?.hubCode ?? null, status: r.status,
        checkIn: r.checkIn, checkOut: r.checkOut, workedMinutes: mins(r), lateMinutes: r.lateMinutes ?? 0,
        plannedDepart: r.plannedDepart ?? planByName.get(r.driverName)?.departTime ?? null, notes: r.notes,
      }))
      // Livreurs planifiés mais non pointés ce jour-là
      for (const p of plan) {
        const name = nameByCode.get(p.driverCode) ?? p.driverCode
        if (!seen.has(name)) items.push({ id: `plan-${p.driverCode}`, driverName: name, role: 'LIVREUR', hub: p.hubCode, status: 'none', checkIn: null, checkOut: null, workedMinutes: 0, lateMinutes: 0, plannedDepart: p.departTime, notes: null })
      }
      items.sort((a, b) => a.driverName.localeCompare(b.driverName, 'fr'))
      const count = (s: string[]) => items.filter(i => s.includes(i.status)).length
      const summary = { present: count(['present']), late: count(['late']), absent: count(['absent']), leave: count(['leave']), none: count(['none']), totalMinutes: items.reduce((s, i) => s + i.workedMinutes, 0) }
      if (xlsx) {
        const t = (d: Date | null) => (d ? d.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit' }) : '')
        return xlsxResponse(toCsv([
          ['Livreur', 'Hub', 'Statut', 'Arrivée', 'Départ', 'Heures', 'Retard (min)', 'Départ prévu', 'Note'],
          ...items.map(i => [i.driverName, i.hub, STATUS_FR[i.status] ?? i.status, t(i.checkIn), t(i.checkOut), hm(i.workedMinutes), i.lateMinutes, i.plannedDepart, i.notes]),
        ]), `pointage_jour_${day}`, 'Jour')
      }
      return NextResponse.json({ view, day, locked: await isLocked(day), summary, items })
    }

    // ─── Mois ───────────────────────────────────────────────────────────────
    if (view === 'month') {
      const m = sp.get('month')
      const month = m && MONTH_RE.test(m) ? m : localToday().slice(0, 7)
      const first = `${month}-01`
      const next = addDays(`${month}-28`, 4).slice(0, 7) + '-01' // 1er du mois suivant
      const nbDays = Math.round((Date.parse(next + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z')) / 86_400_000)
      const rows = await prisma.driverAttendance.findMany({ where: { date: { gte: attendanceKey(first), lt: attendanceKey(next) } }, orderBy: [{ driverName: 'asc' }, { date: 'asc' }] })
      const byDriver = new Map<string, typeof rows>()
      for (const r of rows) { if (!byDriver.has(r.driverName)) byDriver.set(r.driverName, []); byDriver.get(r.driverName)!.push(r) }
      const matrix = [...byDriver.entries()].map(([driverName, recs]) => {
        const days: Record<number, { s: string; w: number; l: number }> = {}
        for (const r of recs) days[Number(r.date.toISOString().slice(8, 10))] = { s: r.status, w: mins(r), l: r.lateMinutes ?? 0 }
        const n = (s: string) => recs.filter(r => r.status === s).length
        const present = n('present'), late = n('late'), absent = n('absent'), leave = n('leave')
        const totalMin = recs.reduce((s, r) => s + mins(r), 0)
        const denom = present + late + absent
        return { driverName, hub: recs[recs.length - 1]?.hub ?? null, days, totals: { present: present + late, late, absent, leave, minutes: totalMin, lateMinutes: recs.reduce((s, r) => s + (r.lateMinutes ?? 0), 0), rate: denom ? Math.round(((present + late) / denom) * 100) : null } }
      })
      const ps = await periodStatus(first)
      const locked = ps === 'validated' || ps === 'paid'
      if (xlsx) {
        const head = ['Livreur', ...Array.from({ length: nbDays }, (_, i) => String(i + 1)), 'Jours présents', 'Retards', 'Absences', 'Congés', 'Heures', 'Taux présence']
        const L: Record<string, string> = { present: 'P', late: 'R', absent: 'A', leave: 'C' }
        return xlsxResponse(toCsv([head, ...matrix.map(r => [r.driverName, ...Array.from({ length: nbDays }, (_, i) => L[r.days[i + 1]?.s] ?? ''), r.totals.present, r.totals.late, r.totals.absent, r.totals.leave, hm(r.totals.minutes), r.totals.rate === null ? '' : `${r.totals.rate}%`])]), `pointage_mois_${month}`, 'Mois')
      }
      return NextResponse.json({ view, month, nbDays, locked, payStatus: ps, matrix })
    }

    // ─── Historique des corrections ──────────────────────────────────────────
    if (view === 'history') {
      const driver = (sp.get('driver') || '').trim()
      const today = localToday()
      const f = sp.get('from'), t = sp.get('to')
      const from = f && DAY_RE.test(f) ? f : addDays(today, -30)
      const to = t && DAY_RE.test(t) ? t : today
      const fromTs = dayBoundsTz(from).from, toTs = dayBoundsTz(to).to
      const [logs, qrs] = await Promise.all([
        prisma.opsAuditLog.findMany({
          where: { OR: [{ action: { startsWith: 'pointage.' } }, { action: { startsWith: 'attendance.' } }], at: { gte: fromTs, lt: toTs }, ...(driver ? { payload: { contains: driver, mode: 'insensitive' } } : {}) },
          orderBy: { at: 'desc' }, take: 500,
        }),
        prisma.driverAttendance.findMany({
          where: { qrScanId: { not: null }, date: { gte: attendanceKey(from), lte: attendanceKey(to) }, ...(driver ? { driverName: { contains: driver, mode: 'insensitive' } } : {}) },
          orderBy: { date: 'desc' }, take: 500,
        }),
      ])
      const entries = [
        ...logs.map(l => {
          let p: Record<string, unknown> = {}
          try { p = l.payload ? JSON.parse(l.payload) : {} } catch { /* payload illisible */ }
          return { id: l.id, at: l.at, actor: l.actor, action: l.action, driverName: (p.driverName as string) ?? (p.bulk ? 'Saisie en bloc' : null), day: (p.day as string) ?? null, reason: (p.reason as string) ?? null, override: p.override === true, before: p.before ?? null, after: p.after ?? null }
        }),
        ...qrs.map(r => ({ id: `qr-${r.id}`, at: r.checkIn ?? r.createdAt, actor: r.scannedBy, action: 'pointage.qr', driverName: r.driverName, day: r.date.toISOString().slice(0, 10), reason: null as string | null, override: false, before: null as unknown, after: { status: r.status, checkIn: r.checkIn, checkOut: r.checkOut } as unknown })),
      ].filter(e => !driver || (e.driverName ?? '').toLowerCase().includes(driver.toLowerCase()) || e.driverName === 'Saisie en bloc')
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 500)
      if (xlsx) {
        const brief = (v: unknown) => { const o = v as { status?: string; checkIn?: string; checkOut?: string; notes?: string } | null; return o ? `${STATUS_FR[o.status ?? ''] ?? o.status ?? ''} ${o.checkIn ? 'in ' + o.checkIn : ''} ${o.checkOut ? 'out ' + o.checkOut : ''} ${o.notes ? '(' + o.notes + ')' : ''}`.trim() : '' }
        return xlsxResponse(toCsv([
          ['Date/heure', 'Par', 'Action', 'Livreur', 'Jour pointage', 'Motif', 'Avant', 'Après', 'Dérogation'],
          ...entries.map(e => [new Date(e.at).toISOString(), e.actor, e.action, e.driverName, e.day, e.reason, brief(e.before), brief(e.after), e.override ? 'oui' : '']),
        ]), `pointage_corrections_${from}_${to}`, 'Corrections')
      }
      return NextResponse.json({ view, from, to, driver, entries })
    }

    return NextResponse.json({ error: 'view invalide (day | month | history)' }, { status: 400 })
  } catch (e) { return fail(e) }
}

async function isLocked(day: string) {
  const s = await periodStatus(day)
  return s === 'validated' || s === 'paid'
}
