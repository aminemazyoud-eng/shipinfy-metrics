/**
 * lib/ops-notify.ts — notifications d'incidents : STRUCTURE COHÉRENTE  événement × audience × canal
 *
 *   ÉVÉNEMENT (que s'est-il passé ?)   →   AUDIENCE (qui prévenir ?)   →   CANAL (comment ?)
 *   créneau à risque, retard, NO_SHOW,      équipe Dispatch / Managers / RH        Slack (1 webhook par équipe)
 *   non assigné, saturation, document       chauffeur, helper                       WhatsApp (numéro de la fiche)
 *
 * Règles stockées en base (OpsNotifRule), activables une à une, modèles de message modifiables.
 * Anti-doublon : chaque envoi est tracé dans OpsNotifLog avec une clé unique (même alerte = un seul message par période).
 * Déclenchement : cron toutes les 5 min (OPS_ALERTS_ENABLED=true) ou bouton « Exécuter maintenant ».
 *
 * Sprint 17 B5 : envois REJOUABLES — la ligne OpsNotifLog est créée AVANT la tentative avec ok=false / attempts=1 / nextRetryAt=+1 min,
 * puis mise à jour selon le résultat. `retryFailedNotifs()` relance les échecs (3 tentatives, délais 1 / 5 / 15 min) puis marque dead=true.
 * B6/B7 : jours et heures via lib/tz.ts (Africa/Casablanca réel), « retard / à risque / non assigné » via lib/ops-defs.ts.
 */
import { prisma } from '@/lib/prisma'
import { sendWhatsApp } from '@/lib/whatsapp'
import { safeFetch } from '@/lib/safe-fetch'
import { normalizePhone } from '@/lib/ops-planning'
import { localDay, localParts, dayStartUtc, addDays } from '@/lib/tz'
import { isLate, isAtRisk, isUnassigned, isOpen, OPEN_WHERE } from '@/lib/ops-defs'
import { CFG } from '@/lib/ops-config'
import { canonicalSlot } from '@/lib/ops-slots'
import { forecastDay } from '@/lib/ops-analytics'
import { loadOrders, loadHubs, loadDrivers } from '@/lib/ops-data'
import { applyOpsSettings } from '@/lib/ops-settings'

export const EVENTS: Record<string, { label: string; description: string; vars: string[] }> = {
  slot_at_risk:    { label: 'Créneau à risque', description: 'Des commandes ne sont pas encore en livraison alors que la fin du créneau approche.', vars: ['hub', 'slot', 'count', 'minutes', 'name'] },
  order_late:      { label: 'Commande en retard', description: 'Créneau promis dépassé, commande non livrée.', vars: ['hub', 'slot', 'count', 'name'] },
  no_show:         { label: 'NO_SHOW', description: 'Un client était absent ou a refusé la livraison.', vars: ['hub', 'slot', 'ref', 'name'] },
  unassigned_soon: { label: 'Commandes non assignées', description: 'Le créneau commence bientôt et des commandes n’ont pas de livreur.', vars: ['hub', 'slot', 'count'] },
  hub_saturation:  { label: 'Saturation prévue demain', description: 'La prévision de demain dépasse la capacité d’un hub (envoyé en fin d’après-midi).', vars: ['hub', 'slots', 'drivers'] },
  doc_expiring:    { label: 'Document à renouveler', description: 'Permis, visite médicale, assurance, visite technique ou vignette bientôt expirés.', vars: ['entity', 'doc', 'days', 'date', 'name'] },
}
export const AUDIENCES: Record<string, { label: string; channel: 'slack' | 'whatsapp'; help: string }> = {
  'team:dispatch': { label: 'Équipe Dispatch', channel: 'slack', help: 'Canal Slack du dispatch / superviseurs' },
  'team:managers': { label: 'Managers', channel: 'slack', help: 'Canal Slack des managers (ville / opérations)' },
  'team:rh':       { label: 'RH', channel: 'slack', help: 'Canal Slack RH & flotte (documents, onboarding)' },
  chauffeur:       { label: 'Chauffeur', channel: 'whatsapp', help: 'WhatsApp au numéro de la fiche du chauffeur concerné' },
  helper:          { label: 'Helper / livreur', channel: 'whatsapp', help: 'WhatsApp au numéro de la fiche du helper de l’équipe concernée' },
}
export const SLACK_TEAMS = ['dispatch', 'managers', 'rh'] as const

const TPL = {
  slot_at_risk_team: '⚠️ *{hub}* — créneau {slot} : {count} commande(s) risquent d’être en retard (fin dans {minutes} min).',
  slot_at_risk_person: 'Bonjour {name}, {count} commande(s) du créneau {slot} sont à livrer dans les {minutes} prochaines minutes. Merci de prioriser.',
  order_late_team: '🔴 *{hub}* — créneau {slot} : {count} commande(s) EN RETARD.',
  order_late_person: 'Bonjour {name}, {count} commande(s) du créneau {slot} sont en retard. Contactez le dispatch si besoin.',
  no_show: '🚫 NO_SHOW — {hub} · créneau {slot} · commande {ref} (livreur {name}).',
  unassigned: '📦 *{hub}* — créneau {slot} : {count} commande(s) sans livreur. À dispatcher.',
  saturation: '📈 Demain, *{hub}* sera saturé sur : {slots}. Équipes disponibles : {drivers}. Prévoir un renfort.',
  doc_team: '📄 {entity} — {doc} : {days}. ({date})',
  doc_person: 'Bonjour {name}, votre {doc} {days} ({date}). Merci de le renouveler et de prévenir les RH.',
}
export const DEFAULT_RULES: { event: string; audience: string; channel: string; enabled: boolean; template: string }[] = [
  { event: 'slot_at_risk', audience: 'team:dispatch', channel: 'slack', enabled: true, template: TPL.slot_at_risk_team },
  { event: 'slot_at_risk', audience: 'chauffeur', channel: 'whatsapp', enabled: true, template: TPL.slot_at_risk_person },
  { event: 'order_late', audience: 'team:dispatch', channel: 'slack', enabled: true, template: TPL.order_late_team },
  { event: 'order_late', audience: 'team:managers', channel: 'slack', enabled: false, template: TPL.order_late_team },
  { event: 'order_late', audience: 'chauffeur', channel: 'whatsapp', enabled: true, template: TPL.order_late_person },
  { event: 'order_late', audience: 'helper', channel: 'whatsapp', enabled: false, template: TPL.order_late_person },
  { event: 'no_show', audience: 'team:dispatch', channel: 'slack', enabled: true, template: TPL.no_show },
  { event: 'unassigned_soon', audience: 'team:dispatch', channel: 'slack', enabled: true, template: TPL.unassigned },
  { event: 'hub_saturation', audience: 'team:managers', channel: 'slack', enabled: true, template: TPL.saturation },
  { event: 'doc_expiring', audience: 'team:rh', channel: 'slack', enabled: true, template: TPL.doc_team },
  { event: 'doc_expiring', audience: 'chauffeur', channel: 'whatsapp', enabled: true, template: TPL.doc_person },
]

const render = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''))
const DAY = 86_400_000
const MIN = 60_000
export const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MIN = [1, 5, 15] // délai avant la tentative suivante, selon le nombre de tentatives déjà faites

export async function ensureDefaults() {
  await prisma.opsNotifRule.createMany({ data: DEFAULT_RULES, skipDuplicates: true })
  await prisma.opsNotifChannel.createMany({
    data: [...SLACK_TEAMS.map(t => ({ key: `slack:${t}`, kind: 'slack', label: `Slack — ${AUDIENCES[`team:${t}`].label}` })), { key: 'whatsapp', kind: 'whatsapp', label: 'WhatsApp (chauffeurs & helpers)' }],
    skipDuplicates: true,
  })
}

export function connectionsStatus() {
  const e = (k: string) => Boolean(process.env[k])
  return {
    autoEnabled: process.env.OPS_ALERTS_ENABLED === 'true',
    smtp: { provider: process.env.SMTP_PROVIDER || (e('RESEND_API_KEY') ? 'resend' : 'smtp'), host: e('SMTP_HOST'), port: e('SMTP_PORT'), user: e('SMTP_USER'), pass: e('SMTP_PASS'), from: e('SMTP_FROM'), resend: e('RESEND_API_KEY') },
    whatsapp: { provider: process.env.WHATSAPP_PROVIDER || null, twilio: e('TWILIO_ACCOUNT_SID') && e('TWILIO_AUTH_TOKEN') && e('TWILIO_WHATSAPP_FROM'), meta: e('META_WHATSAPP_PHONE_ID') && e('META_WHATSAPP_TOKEN') },
  }
}

async function slackWebhook(team: string): Promise<string | null> {
  const ch = await prisma.opsNotifChannel.findUnique({ where: { key: `slack:${team}` } })
  if (ch?.active && ch.webhookUrl) return ch.webhookUrl
  const global = await prisma.slackConfig.findFirst({ where: { active: true } }) // repli : webhook global historique
  return global?.webhookUrl ?? null
}

interface Delivery { ok: boolean; error?: string; permanent?: boolean }

async function deliver(channel: string, recipient: string, message: string): Promise<Delivery> {
  try {
    if (channel === 'slack') {
      const url = await slackWebhook(recipient.replace('team:', ''))
      if (!url) return { ok: false, error: 'Aucun webhook Slack configuré pour cette équipe' }
      // le webhook est saisi par un utilisateur : appel via safeFetch (https, hôte autorisé, IP privées refusées)
      const r = await safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) })
      return r.ok ? { ok: true } : { ok: false, error: `Slack HTTP ${r.status}` }
    }
    const phone = normalizePhone(recipient) // E.164 (+212…)
    if (!phone) return { ok: false, error: `Numéro WhatsApp invalide : ${recipient}`, permanent: true }
    const ok = await sendWhatsApp(phone, message)
    return ok ? { ok: true } : { ok: false, error: 'WhatsApp non configuré ou envoi refusé' }
  } catch (e) { return { ok: false, error: String(e).slice(0, 200) } }
}

type Rule = { id: string; event: string; audience: string; channel: string; template: string }
interface Stats { sent: number; failed: number; skipped: number; preview: { event: string; audience: string; to: string; message: string }[] }

async function emit(rule: Rule, dedupeKey: string, recipient: string | null, vars: Record<string, string | number>, st: Stats, dryRun: boolean) {
  if (!recipient) { st.skipped++; return }
  const message = render(rule.template, vars)
  if (dryRun) { st.preview.push({ event: rule.event, audience: rule.audience, to: recipient, message }); return }
  const key = `${rule.id}|${dedupeKey}`
  // 1. on « réserve » la ligne AVANT l'envoi (ok=false, 1re tentative, rejeu dans 1 min) : anti-doublon + reprise si le process meurt en route
  try {
    await prisma.opsNotifLog.create({ data: { ruleId: rule.id, event: rule.event, audience: rule.audience, channel: rule.channel, dedupeKey: key, recipient, message, ok: false, attempts: 1, nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MIN[0] * MIN) } })
  } catch { st.skipped++; return } // déjà envoyé (ou en cours de rejeu) pour cette période
  // 2. tentative d'envoi puis mise à jour du résultat
  const res = await deliver(rule.channel, recipient, message)
  if (res.ok) await prisma.opsNotifLog.update({ where: { dedupeKey: key }, data: { ok: true, error: null, nextRetryAt: null } })
  else await prisma.opsNotifLog.update({ where: { dedupeKey: key }, data: res.permanent ? { ok: false, error: res.error ?? null, dead: true, nextRetryAt: null } : { ok: false, error: res.error ?? null, nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MIN[0] * MIN) } })
  if (res.ok) st.sent++; else st.failed++
}

/**
 * Comme emit, mais « aggravation » : une même alerte (clé de base + jour) n'est renotifiée que si le nombre d'éléments
 * a AU MOINS DOUBLÉ depuis la dernière notification de la journée (2 → 4 → 8 retards…). La clé porte le compteur (`|c<n>`).
 */
async function emitCounted(rule: Rule, base: string, count: number, recipient: string | null, vars: Record<string, string | number>, st: Stats, dryRun: boolean) {
  const prefix = `${rule.id}|${base}|c`
  const last = await prisma.opsNotifLog.findMany({ where: { dedupeKey: { startsWith: prefix } }, select: { dedupeKey: true } })
  const lastCount = last.reduce((m, r) => Math.max(m, Number(r.dedupeKey.slice(prefix.length)) || 0), 0)
  if (lastCount > 0 && count < lastCount * 2 && count !== lastCount) { st.skipped++; return }
  await emit(rule, `${base}|c${count}`, recipient, vars, st, dryRun)
}

/** Relance les notifications en échec (appelée à la fin du cron « incidents », toutes les 5 min). */
export async function retryFailedNotifs(): Promise<{ retried: number; recovered: number; dead: number }> {
  const out = { retried: 0, recovered: 0, dead: 0 }
  const due = await prisma.opsNotifLog.findMany({ where: { ok: false, dead: false, attempts: { lt: MAX_ATTEMPTS }, nextRetryAt: { lte: new Date() } }, orderBy: { nextRetryAt: 'asc' }, take: 50 })
  for (const r of due) {
    if (!r.recipient) { await prisma.opsNotifLog.update({ where: { id: r.id }, data: { dead: true, nextRetryAt: null, error: 'Destinataire manquant' } }); out.dead++; continue }
    // verrou optimiste : un seul conteneur rejoue une ligne donnée
    const claim = await prisma.opsNotifLog.updateMany({ where: { id: r.id, attempts: r.attempts, ok: false, dead: false }, data: { attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + 2 * MIN) } })
    if (claim.count === 0) continue
    out.retried++
    const attempts = r.attempts + 1
    const res = await deliver(r.channel, r.recipient, r.message)
    if (res.ok) { await prisma.opsNotifLog.update({ where: { id: r.id }, data: { ok: true, error: null, nextRetryAt: null } }); out.recovered++ }
    else if (res.permanent || attempts >= MAX_ATTEMPTS) { await prisma.opsNotifLog.update({ where: { id: r.id }, data: { ok: false, dead: true, error: res.error ?? null, nextRetryAt: null } }); out.dead++ }
    else await prisma.opsNotifLog.update({ where: { id: r.id }, data: { ok: false, error: res.error ?? null, nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MIN[Math.min(attempts, RETRY_DELAYS_MIN.length) - 1] * MIN) } })
  }
  return out
}

/** Évalue tous les événements et envoie les messages des règles activées. */
export async function runIncidentChecks(opts: { dryRun?: boolean } = {}): Promise<Stats> {
  await applyOpsSettings(); await ensureDefaults()
  const dryRun = !!opts.dryRun
  const st: Stats = { sent: 0, failed: 0, skipped: 0, preview: [] }
  const rules = (await prisma.opsNotifRule.findMany({ where: { enabled: true } })) as Rule[]
  if (!rules.length) return st
  const now = Date.now(), today = localDay(now), hour = localParts(now).hour
  const forEvent = (e: string) => rules.filter(r => r.event === e)
  const dayStart = dayStartUtc(today), dayEnd = dayStartUtc(addDays(today, 1))

  const open = await prisma.opsOrder.findMany({
    where: { OR: [{ slotStart: { gte: new Date(dayStart), lt: new Date(dayEnd) } }, { slotStart: { lt: new Date(dayStart) }, ...OPEN_WHERE }] },
    select: { id: true, reference: true, externalId: true, hubCode: true, status: true, slotStart: true, slotEnd: true, driverId: true, noShowAt: true, driver: { select: { id: true, firstName: true, lastName: true, phone: true, vehicleId: true } } },
  })
  const helpers = await prisma.opsDriver.findMany({ where: { jobType: 'helper', status: 'active' }, select: { firstName: true, lastName: true, phone: true, vehicleId: true } })
  const helperOf = new Map(helpers.filter(h => h.vehicleId).map(h => [h.vehicleId as string, h]))
  const slotOf = (o: (typeof open)[number]) => canonicalSlot(o.slotStart)

  // 1 & 2 — créneau à risque / commande en retard : un message par (hub, créneau) pour les équipes, par chauffeur pour le terrain
  for (const [event, pick] of [['slot_at_risk', (o: (typeof open)[number]) => isAtRisk(o, now)],
    ['order_late', (o: (typeof open)[number]) => isLate(o, now)]] as const) {
    const hit = open.filter(pick)
    if (!hit.length) continue
    for (const rule of forEvent(event)) {
      if (rule.audience.startsWith('team:')) {
        const g = new Map<string, number>(); for (const o of hit) g.set(`${o.hubCode}|${slotOf(o)}`, (g.get(`${o.hubCode}|${slotOf(o)}`) ?? 0) + 1)
        for (const [k, count] of g) { const [hub, slot] = k.split('|'); await emitCounted(rule, `${event}|${k}|${today}`, count, rule.audience, { hub, slot, count, minutes: CFG.atRiskMinutes, name: '' }, st, dryRun) }
      } else {
        const g = new Map<string, { n: number; o: (typeof open)[number] }>()
        for (const o of hit) { if (!o.driver) continue; const k = `${o.driver.id}|${slotOf(o)}`; const cur = g.get(k); g.set(k, { n: (cur?.n ?? 0) + 1, o }) }
        for (const [k, { n, o }] of g) {
          const person = rule.audience === 'helper' ? (o.driver?.vehicleId ? helperOf.get(o.driver.vehicleId) : undefined) : o.driver
          await emitCounted(rule, `${event}|${rule.audience}|${k}|${today}`, n, person?.phone ?? null, { name: person ? person.firstName : '', slot: k.split('|')[1], count: n, minutes: CFG.atRiskMinutes, hub: o.hubCode ?? '' }, st, dryRun)
        }
      }
    }
  }

  // 3 — NO_SHOW (dernières 15 minutes)
  const ns = open.filter(o => o.status === 'NO_SHOW' && o.noShowAt && now - o.noShowAt.getTime() < 15 * 60_000)
  for (const rule of forEvent('no_show')) for (const o of ns) await emit(rule, `no_show|${o.id}`, rule.audience.startsWith('team:') ? rule.audience : o.driver?.phone ?? null, { hub: o.hubCode ?? '', slot: slotOf(o), ref: o.reference || o.externalId, name: o.driver ? `${o.driver.firstName}` : 'non affecté' }, st, dryRun)

  // 4 — commandes non assignées dont le créneau commence dans moins d'une heure (ou a commencé)
  const un = open.filter(o => isUnassigned(o) && o.slotStart.getTime() - now < 60 * 60_000)
  if (un.length) for (const rule of forEvent('unassigned_soon')) {
    const g = new Map<string, number>(); for (const o of un) g.set(`${o.hubCode}|${slotOf(o)}`, (g.get(`${o.hubCode}|${slotOf(o)}`) ?? 0) + 1)
    for (const [k, count] of g) { const [hub, slot] = k.split('|'); await emit(rule, `unassigned|${k}|${today}`, rule.audience, { hub, slot, count }, st, dryRun) }
  }

  // 5 — saturation prévue demain (à partir de 17 h)
  if (hour >= 17 && forEvent('hub_saturation').length) {
    const tomorrow = addDays(today, 1), tms = dayStartUtc(tomorrow)
    const [orders, hubs, drivers] = await Promise.all([loadOrders(new Date(tms - (CFG.historyDays + 1) * DAY), new Date(tms + DAY)), loadHubs(), loadDrivers()])
    const f = forecastDay(orders, hubs, drivers, tomorrow, now)
    for (const rule of forEvent('hub_saturation')) for (const h of f.hubs) {
      const bad = Object.entries(h.cells).filter(([, c]) => c.level === 'sature').map(([s, c]) => `${s.replace('-', 'h–')}h (${c.expected} cmd)`)
      if (bad.length) await emit(rule, `saturation|${h.code}|${tomorrow}`, rule.audience, { hub: h.name, slots: bad.join(', '), drivers: h.drivers }, st, dryRun)
    }
  }

  // 6 — documents à renouveler (à partir de 8 h, rappel hebdomadaire)
  if (hour >= 8 && forEvent('doc_expiring').length) {
    const limit = new Date(now + CFG.docAlertDays * DAY), week = Math.floor(now / (7 * DAY))
    const left = (d: Date) => { const n = Math.round((d.getTime() - now) / DAY); return n < 0 ? `expiré depuis ${-n} j` : `expire dans ${n} j` }
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const people = await prisma.opsDriver.findMany({ where: { status: 'active', OR: [{ licenseExpiry: { lte: limit } }, { medicalVisitExpiry: { lte: limit } }] }, select: { code: true, firstName: true, lastName: true, phone: true, licenseExpiry: true, medicalVisitExpiry: true, jobType: true } })
    const vehicles = await prisma.opsVehicle.findMany({ where: { OR: [{ insuranceExpiry: { lte: limit } }, { technicalVisitExpiry: { lte: limit } }, { vignetteExpiry: { lte: limit } }] }, select: { plate: true, insuranceExpiry: true, technicalVisitExpiry: true, vignetteExpiry: true } })
    for (const rule of forEvent('doc_expiring')) {
      for (const p of people) for (const [doc, d] of [['permis de conduire', p.licenseExpiry], ['visite médicale', p.medicalVisitExpiry]] as const) {
        if (!d || d > limit) continue
        const target = rule.audience.startsWith('team:') ? rule.audience : (rule.audience === p.jobType ? p.phone : null)
        await emit(rule, `doc|${p.code}|${doc}|${week}`, target, { entity: `${p.firstName} ${p.lastName} (${p.code})`, doc, days: left(d), date: fmt(d), name: p.firstName }, st, dryRun)
      }
      if (rule.audience.startsWith('team:')) for (const v of vehicles) for (const [doc, d] of [['assurance', v.insuranceExpiry], ['visite technique', v.technicalVisitExpiry], ['vignette', v.vignetteExpiry]] as const) {
        if (!d || d > limit) continue
        await emit(rule, `doc|${v.plate}|${doc}|${week}`, rule.audience, { entity: `Véhicule ${v.plate}`, doc, days: left(d), date: fmt(d), name: '' }, st, dryRun)
      }
    }
  }
  return st
}

/** Envoie un message d'essai pour une règle (variables d'exemple). `to` : numéro WhatsApp de test (obligatoire pour les audiences terrain). */
export async function sendSample(ruleId: string, to?: string): Promise<{ ok: boolean; error?: string; message: string }> {
  const rule = await prisma.opsNotifRule.findUnique({ where: { id: ruleId } })
  if (!rule) return { ok: false, error: 'Règle introuvable', message: '' }
  const message = '[TEST] ' + render(rule.template, { hub: 'Marjane Morocco Mall', slot: '12-15', count: 3, minutes: CFG.atRiskMinutes, name: 'Youssef', ref: '381-000120130', slots: '12h–15h (14 cmd)', drivers: 5, entity: 'Véhicule 10000-A-6', doc: 'assurance', days: 'expire dans 12 j', date: '2026-10-20' })
  const recipient = rule.audience.startsWith('team:') ? rule.audience : to ?? ''
  if (!recipient) return { ok: false, error: 'Indiquez un numéro WhatsApp de test (format international, ex. +2126…)', message }
  return { ...(await deliver(rule.channel, recipient, message)), message }
}
