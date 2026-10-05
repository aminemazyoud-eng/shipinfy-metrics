import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { loadTeams, planDemand } from '@/lib/ops-planning-data'
import { planPdfUrl, fmtDayLong, type PlanTeam, type PlanPerson } from '@/lib/ops-planning'
import { sendWhatsAppDocument, whatsappConfigured } from '@/lib/whatsapp'

const slotText = (s: string) => `${s.slice(0, 2)}h–${s.slice(3)}h`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function message(t: PlanTeam, p: PlanPerson, url: string) {
  const mate = t.crew.filter(c => c.code !== p.code).map(c => `${c.name} (${c.role === 'chauffeur' ? 'chauffeur' : 'helper'}${c.phone ? ` ${c.phone}` : ''})`)
  return [
    `📋 *Planning ${cap(fmtDayLong(t.day))}*`, `Bonjour ${p.name.split(' ')[0]},`, '',
    `📍 Hub de départ : *${t.hubName}* (${t.hubCity.charAt(0) + t.hubCity.slice(1).toLowerCase()})`,
    `🕘 Départ : *${t.departTime.replace(':', 'h')}* (soyez présent 15 min avant)`,
    `📦 Créneaux : ${t.slots.length ? t.slots.map(slotText).join(' · ') : 'journée'}`,
    ...(t.homeHubName && t.homeHubName !== t.hubName ? [`⚠️ Affectation exceptionnelle (votre hub habituel : ${t.homeHubName})`] : []),
    ...(t.plate ? [`🚚 Véhicule : ${t.vehicle ?? ''} ${t.plate}`] : []), ...(mate.length ? [`👥 Équipe : ${mate.join(', ')}`] : []),
    ...(t.note ? [`📝 ${t.note}`] : []), '', `Planning détaillé (PDF) : ${url}`,
  ].join('\n')
}

// POST /api/ops/planning/send { day, driverCodes?: string[] } — publie le planning et l'envoie en PDF par WhatsApp au chauffeur ET au helper.
// Sans fournisseur WhatsApp configuré : renvoie des liens wa.me prêts à l'emploi (envoi manuel en un clic).
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { day, driverCodes } = await req.json() as { day: string; driverCodes?: string[] }
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) return NextResponse.json({ error: 'day requis' }, { status: 400 })

    // volumes prévus par hub / créneau : figés dans le planning au moment de l'envoi (affichés dans le PDF)
    try {
      const demand = await planDemand(day); const lines = await prisma.opsPlanLine.findMany({ where: { day }, select: { id: true, hubCode: true } })
      await prisma.$transaction(lines.map(l => prisma.opsPlanLine.update({ where: { id: l.id }, data: { demand: JSON.stringify(demand[l.hubCode] ?? {}) } })))
    } catch (e) { console.warn('[planning] prévisions indisponibles', e) }

    const teams = await loadTeams(day, driverCodes)
    if (!teams.length) return NextResponse.json({ error: 'Aucune équipe planifiée à envoyer' }, { status: 400 })
    const live = whatsappConfigured()
    type Res = { code: string; name: string; role: string; phone: string | null; hub: string; status: 'sent' | 'failed' | 'no_phone' | 'manual'; error?: string; pdf: string; waLink?: string }
    const results: Res[] = []
    const jobs: (() => Promise<void>)[] = []
    for (const t of teams) {
      const chauffeur = t.crew[0]; const url = planPdfUrl(day, chauffeur.code)
      for (const p of t.crew) {
        const r: Res = { code: p.code, name: p.name, role: p.role, phone: p.phone, hub: t.hubName, status: 'no_phone', pdf: url }; results.push(r)
        if (!p.phone) continue
        const text = message(t, p, url)
        r.waLink = `https://wa.me/${p.phone.replace('+', '')}?text=${encodeURIComponent(text)}`
        if (!live) { r.status = 'manual'; continue }
        jobs.push(async () => { const o = await sendWhatsAppDocument(p.phone!, text, url, `planning_${day}_${chauffeur.code}.pdf`); r.status = o.ok ? 'sent' : 'failed'; r.error = o.error })
      }
    }
    for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(j => j()))

    // statut par équipe (ligne du chauffeur) : sent | partial | failed | manual | no_phone
    const now = new Date()
    for (const t of teams) {
      const rs = results.filter(r => t.crew.some(c => c.code === r.code)); const st = rs.map(r => r.status)
      const sentStatus = st.every(s => s === 'sent') ? 'sent' : st.some(s => s === 'sent') ? 'partial' : st.every(s => s === 'no_phone') ? 'no_phone' : st.some(s => s === 'manual') ? 'manual' : 'failed'
      await prisma.opsPlanLine.update({ where: { day_driverCode: { day, driverCode: t.crew[0].code } }, data: { sentStatus, sentAt: sentStatus === 'sent' || sentStatus === 'partial' || sentStatus === 'manual' ? now : null } })
    }
    await prisma.opsPlanDay.upsert({ where: { day }, create: { day, status: 'published', publishedAt: now, publishedBy: auth.session.name || auth.session.email }, update: { status: 'published', publishedAt: now, publishedBy: auth.session.name || auth.session.email } })
    const count = (s: Res['status']) => results.filter(r => r.status === s).length
    await audit(auth.session, 'planning.send', 'planning', day, { teams: teams.length, sent: count('sent'), failed: count('failed'), noPhone: count('no_phone'), manual: count('manual') })
    return NextResponse.json({ ok: true, whatsapp: live, teams: teams.length, sent: count('sent'), failed: count('failed'), noPhone: count('no_phone'), manual: count('manual'), results })
  } catch (e) { return fail(e) }
}
