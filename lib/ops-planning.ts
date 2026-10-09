/**
 * lib/ops-planning.ts — planning journalier : liens PDF signés, numéros WhatsApp, PDF détaillés (équipe + récapitulatif du jour).
 * Un planning = une ligne par CHAUFFEUR (hub du jour, heure de départ, créneaux) ; son helper (même véhicule) suit la même ligne.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { requireEnv } from '@/lib/env'
import { dayStartUtc, addDays } from '@/lib/tz'

export interface PlanPerson { code: string; name: string; phone: string | null; role: 'chauffeur' | 'helper'; homeHub: string | null }
export interface PlanTeam {
  day: string; hubCode: string; hubName: string; hubCity: string; hubLat: number | null; hubLng: number | null; homeHubName: string | null
  departTime: string; slots: string[]; note: string | null; vehicle: string | null; plate: string | null
  crew: PlanPerson[]; demand: Record<string, number> | null
}

// ─── Liens signés (le chauffeur ouvre le PDF depuis WhatsApp sans compte) ──────────────────────────
// Secret obligatoire (PLANNING_LINK_SECRET) : plus de repli sur DATABASE_URL ni sur une constante.
// Le HMAC couvre jour|code|exp ; exp (ms epoch) = fin du jour planifié + 24 h → le lien expire seul.
const secret = () => requireEnv('PLANNING_LINK_SECRET')
export const planExpiry = (day: string): number => dayStartUtc(addDays(day, 1)) + 86_400_000
export const signPlan = (day: string, code: string, exp: number) => createHmac('sha256', secret()).update(`${day}|${code}|${exp}`).digest('hex').slice(0, 24)
export function verifyPlan(day: string, code: string, exp: number, token: string): boolean {
  if (!Number.isFinite(exp) || Date.now() > exp) return false // lien expiré
  const a = Buffer.from(signPlan(day, code, exp)), b = Buffer.from(token || '')
  return a.length === b.length && timingSafeEqual(a, b)
}
export const appUrl = () => (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://metrics.mediflows.shop').replace(/\/$/, '')
export const planPdfUrl = (day: string, code: string) => { const e = planExpiry(day); return `${appUrl()}/api/planning/pdf?d=${day}&c=${encodeURIComponent(code)}&e=${e}&t=${signPlan(day, code, e)}` }

/** 06 12 34 56 78 / 0612345678 / +212612345678 → +212612345678 (null si inexploitable). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let p = raw.replace(/[^\d+]/g, '')
  if (p.startsWith('00')) p = '+' + p.slice(2)
  if (p.startsWith('0') && p.length === 10) p = '+212' + p.slice(1)
  else if (p.startsWith('212') && p.length === 12) p = '+' + p
  return /^\+\d{9,15}$/.test(p) ? p : null
}

export const fmtDayLong = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const slotText = (s: string) => `${s.slice(0, 2)}h – ${s.slice(3)}h`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ─── PDF d'une équipe (envoyé au chauffeur ET au helper) ────────────────────────────────────────
export async function buildTeamPdf(t: PlanTeam, company = process.env.COMPANY_NAME || 'Shipinfy'): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: `Planning ${t.day} — ${t.crew[0]?.name ?? ''}`, Author: company } })
    const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject)
    const W = doc.page.width, L = 44, R = W - 44
    const label = (txt: string, x: number, y: number) => doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280').text(txt.toUpperCase(), x, y, { characterSpacing: 0.6 })

    doc.rect(0, 0, W, 78).fill('#0f172a')
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(company.toUpperCase(), L, 22).font('Helvetica').fontSize(10).text('Planning de livraison', L, 50)
    doc.font('Helvetica-Bold').fontSize(12).text(cap(fmtDayLong(t.day)), L, 32, { width: R - L, align: 'right' })

    // Bloc départ
    let y = 98
    doc.roundedRect(L, y, R - L, 112, 8).fill('#f5f3ff')
    label('Hub de départ', L + 18, y + 14); doc.fillColor('#4c1d95').font('Helvetica-Bold').fontSize(22).text(t.hubName.replace('Marjane ', 'Marjane '), L + 18, y + 28, { width: 300 })
    doc.font('Helvetica').fontSize(11).fillColor('#5b21b6').text(t.hubCity.charAt(0) + t.hubCity.slice(1).toLowerCase(), L + 18, y + 58)
    if (t.hubLat && t.hubLng) doc.fontSize(8.5).fillColor('#6d28d9').text(`maps.google.com/?q=${t.hubLat},${t.hubLng}`, L + 18, y + 80, { link: `https://maps.google.com/?q=${t.hubLat},${t.hubLng}`, underline: true })
    label('Heure de départ', 360, y + 14); doc.fillColor('#4c1d95').font('Helvetica-Bold').fontSize(34).text(t.departTime.replace(':', 'h'), 360, y + 30)
    doc.font('Helvetica').fontSize(9).fillColor('#5b21b6').text('Soyez au hub 15 minutes avant', 360, y + 78)
    y += 128

    if (t.homeHubName && t.homeHubName !== t.hubName) {
      doc.roundedRect(L, y, R - L, 30, 6).fill('#fef3c7')
      doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(10).text(`Affectation exceptionnelle : aujourd'hui vous travaillez à ${t.hubName}, et non à ${t.homeHubName}.`, L + 12, y + 10, { width: R - L - 24 })
      y += 42
    }

    // Équipe
    label('Votre équipe', L, y); y += 16
    for (const p of t.crew) {
      doc.roundedRect(L, y, R - L, 40, 6).lineWidth(0.8).strokeColor('#e5e7eb').stroke()
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text(p.name, L + 14, y + 8)
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`${p.role === 'chauffeur' ? 'Chauffeur' : 'Helper (aide-livreur)'}  ·  ${p.code}`, L + 14, y + 24)
      doc.fillColor('#111827').font('Helvetica').fontSize(11).text(p.phone ?? 'téléphone non renseigné', 330, y + 14, { width: R - 344, align: 'right' })
      y += 48
    }
    if (t.vehicle || t.plate) { label('Véhicule', L, y + 4); doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text(`${t.vehicle ?? ''}  ${t.plate ?? ''}`.trim(), L, y + 18); y += 44 }

    // Créneaux + volumes prévus
    label('Créneaux de livraison à couvrir', L, y); y += 16
    const slots = t.slots.length ? t.slots : []
    const cw = (R - L - 8 * (Math.max(slots.length, 1) - 1)) / Math.max(slots.length, 1)
    slots.forEach((s, i) => {
      const x = L + i * (cw + 8), n = t.demand?.[s]
      doc.roundedRect(x, y, cw, 62, 6).fill('#ecfdf5')
      doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(13).text(slotText(s), x, y + 10, { width: cw, align: 'center' })
      doc.font('Helvetica').fontSize(9).fillColor('#047857').text(n != null ? `≈ ${n} commandes prévues au hub` : 'volume non estimé', x + 4, y + 36, { width: cw - 8, align: 'center' })
    })
    if (!slots.length) doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('Journée complète', L, y + 4)
    y += 82

    if (t.note) { label('Consigne du dispatch', L, y); doc.fillColor('#111827').font('Helvetica').fontSize(11).text(t.note, L, y + 14, { width: R - L }); y = doc.y + 14 }

    label('Rappels', L, y); y += 14
    doc.font('Helvetica').fontSize(10).fillColor('#374151')
    for (const r of ['Pointer votre arrivée au hub dès votre présentation.', 'Vérifier le véhicule (carburant, documents, propreté) avant le départ.', 'Respecter les créneaux promis aux clients ; prévenir le dispatch en cas de retard.', "Encaisser et remettre les fonds à l'issue de la tournée."]) { doc.text('•  ' + r, L, y, { width: R - L }); y = doc.y + 3 }

    doc.fontSize(8).fillColor('#9ca3af').text(`Document généré le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })} — ${company}`, L, doc.page.height - 44, { width: R - L, align: 'center' })
    doc.end()
  })
}

// ─── PDF récapitulatif du jour (dispatch / managers) : tous les hubs, toutes les équipes ────────────
export async function buildDayPdf(day: string, teams: PlanTeam[], company = process.env.COMPANY_NAME || 'Shipinfy'): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: `Planning du ${day}`, Author: company } })
    const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject)
    const W = doc.page.width, L = 36, R = W - 36
    const head = () => { doc.rect(0, 0, W, 52).fill('#0f172a'); doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(`${company.toUpperCase()} — Planning du jour`, L, 16).font('Helvetica').fontSize(11).text(cap(fmtDayLong(day)), L, 18, { width: R - L, align: 'right' }) }
    head()
    let y = 66
    const byHub = new Map<string, PlanTeam[]>(); for (const t of teams) (byHub.get(t.hubCode) ?? byHub.set(t.hubCode, []).get(t.hubCode)!).push(t)
    const cols = [{ w: 150, h: 'Chauffeur' }, { w: 150, h: 'Helper' }, { w: 120, h: 'Véhicule' }, { w: 60, h: 'Départ' }, { w: 150, h: 'Créneaux' }, { w: 130, h: "Hub d'origine" }]
    for (const [, list] of [...byHub.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (y > doc.page.height - 120) { doc.addPage(); head(); y = 66 }
      doc.roundedRect(L, y, R - L, 22, 4).fill('#ede9fe'); doc.fillColor('#4c1d95').font('Helvetica-Bold').fontSize(11).text(`${list[0].hubName} — ${list[0].hubCity.charAt(0) + list[0].hubCity.slice(1).toLowerCase()}  ·  ${list.length} équipe(s)`, L + 8, y + 6); y += 26
      let x = L; doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280'); for (const c of cols) { doc.text(c.h.toUpperCase(), x, y); x += c.w } y += 13
      for (const t of list.sort((a, b) => a.departTime.localeCompare(b.departTime))) {
        if (y > doc.page.height - 50) { doc.addPage(); head(); y = 66 }
        const ch = t.crew.find(p => p.role === 'chauffeur'), he = t.crew.filter(p => p.role === 'helper')
        const vals = [ch ? `${ch.name}${ch.phone ? `\n${ch.phone}` : ''}` : '—', he.length ? he.map(h => `${h.name}${h.phone ? `\n${h.phone}` : ''}`).join('\n') : '—', `${t.vehicle ?? ''} ${t.plate ?? ''}`.trim() || '—', t.departTime.replace(':', 'h'), t.slots.length ? t.slots.map(slotText).join(', ') : 'Journée', t.homeHubName && t.homeHubName !== t.hubName ? `⇄ ${t.homeHubName}` : t.homeHubName ?? '—']
        x = L; doc.font('Helvetica').fontSize(9).fillColor('#111827'); const top = y; let h = 0
        vals.forEach((v, i) => { doc.text(v, x, top, { width: cols[i].w - 6 }); h = Math.max(h, doc.y - top); x += cols[i].w })
        y = top + Math.max(h, 14) + 5; doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.4).strokeColor('#e5e7eb').stroke()
      }
      y += 8
    }
    if (!teams.length) doc.fillColor('#6b7280').font('Helvetica').fontSize(12).text('Aucune équipe planifiée pour ce jour.', L, y)
    doc.end()
  })
}
