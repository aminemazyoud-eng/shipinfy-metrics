/**
 * lib/whatsapp.ts — Sprint 16 BLOC 5 — Notifications WhatsApp plannings shifts
 *
 * Provider configurable via WHATSAPP_PROVIDER ('twilio' | 'meta' | undefined).
 * sendWhatsApp NE THROW JAMAIS — retourne false en cas d'échec / non configuré.
 * Chaque envoi est loggé best-effort dans prisma.n8NLog.
 */

import { prisma } from '@/lib/prisma'

export type ShiftSlotLite = {
  date:      string | Date
  startTime: string
  endTime:   string
  zone:      string
}

// ─── Envoi WhatsApp ─────────────────────────────────────────────────────────
export async function sendWhatsApp(to: string, message: string): Promise<boolean> {
  const provider = process.env.WHATSAPP_PROVIDER

  if (!provider) {
    console.warn('[whatsapp] WHATSAPP_PROVIDER non configuré')
    return false
  }

  let ok = false
  let responseCode: number | null = null

  try {
    if (provider === 'twilio') {
      const sid   = process.env.TWILIO_ACCOUNT_SID ?? ''
      const token = process.env.TWILIO_AUTH_TOKEN ?? ''
      const from  = process.env.TWILIO_WHATSAPP_FROM ?? ''
      const body  = new URLSearchParams({
        From: from,
        To:   `whatsapp:${to}`,
        Body: message,
      })
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method:  'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body:   body.toString(),
        signal: AbortSignal.timeout(10000),
      })
      responseCode = res.status
      ok = res.ok
    } else if (provider === 'meta') {
      const phoneId = process.env.META_WHATSAPP_PHONE_ID ?? ''
      const metaTok = process.env.META_WHATSAPP_TOKEN ?? ''
      const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${metaTok}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
        signal: AbortSignal.timeout(10000),
      })
      responseCode = res.status
      ok = res.ok
    } else {
      console.warn('[whatsapp] provider inconnu:', provider)
      return false
    }
  } catch (e) {
    console.error('[whatsapp] envoi échoué:', e)
    ok = false
  }

  // Log best-effort
  await prisma.n8NLog.create({
    data: {
      eventType:    'whatsapp_shift',
      status:       ok ? 'success' : 'error',
      responseCode: responseCode ?? undefined,
      payload:      message.slice(0, 200),
    },
  }).catch(() => {})

  return ok
}

// ─── Formatage du message planning ──────────────────────────────────────────
const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtDayDate(d: Date): string {
  return `${DAYS_FR[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formatShiftPlanning(driverName: string, slots: ShiftSlotLite[]): string {
  const dates = slots
    .map(s => new Date(s.date))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())

  // Lundi de la semaine du 1er slot (ou aujourd'hui si vide)
  const ref = dates[0] ?? new Date()
  const monday = new Date(ref)
  const day = monday.getDay()
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1))

  const header = `📋 Planning Shipinfy — Semaine du ${pad(monday.getDate())}/${pad(monday.getMonth() + 1)}/${monday.getFullYear()}`

  const lines = slots
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(s => {
      const d = new Date(s.date)
      return `- ${fmtDayDate(d)} : ${s.startTime} - ${s.endTime} (${s.zone})`
    })

  return [
    header,
    `Bonjour ${driverName} !`,
    'Voici votre planning :',
    ...lines,
    '',
    'Bonne livraison ! 🚀',
  ].join('\n')
}
