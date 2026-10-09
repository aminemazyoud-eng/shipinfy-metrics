/**
 * lib/ops-customer-notif.ts — messages PROACTIFS au client final (Sprint 19). DÉSACTIVÉ PAR DÉFAUT (CUSTOMER_NOTIFY_ENABLED=true).
 * Anti-doublon : ligne OpsCustomerNotif (unique orderId+kind+channel) insérée AVANT l'envoi ; plafond de sécurité 200 messages / jour.
 */
import { prisma } from '@/lib/prisma'
import { sendWhatsApp } from '@/lib/whatsapp'
import { normalizePhone } from '@/lib/ops-planning'
import { trackUrl } from '@/lib/ops-tracking'
import { isLate, isAtRisk } from '@/lib/ops-defs'
import { localDay, dayStartUtc, addDays } from '@/lib/tz'

export const DAILY_CUSTOMER_CAP = 200
export const customerNotifEnabled = () => process.env.CUSTOMER_NOTIFY_ENABLED === 'true'

/** Texte sobre : pas de montant, juste le lien de suivi. */
export const lateMessage = (ref: string, url: string) =>
  `Bonjour, votre livraison Shipinfy (commande ${ref}) a un léger retard. Nous faisons le nécessaire. Suivez-la en direct : ${url}`

export type NotifResult = 'sent' | 'disabled' | 'no-phone' | 'duplicate' | 'cap' | 'not-late' | 'failed' | 'not-found'

/** Prévient le client d'une commande en retard (ou à risque). Ne lève jamais d'exception. */
export async function notifyCustomerLate(orderId: string): Promise<NotifResult> {
  try {
    if (!customerNotifEnabled()) return 'disabled'
    const o = await prisma.opsOrder.findUnique({ where: { id: orderId }, select: { id: true, reference: true, externalId: true, status: true, slotEnd: true, driverId: true, customerPhone: true } })
    if (!o) return 'not-found'
    const now = Date.now()
    if (!isLate(o, now) && !isAtRisk(o, now)) return 'not-late'
    const phone = normalizePhone(o.customerPhone)
    if (!phone) return 'no-phone'
    const dayStart = new Date(dayStartUtc(localDay(now)))
    if ((await prisma.opsCustomerNotif.count({ where: { createdAt: { gte: dayStart, lt: new Date(dayStartUtc(addDays(localDay(now), 1))) } } })) >= DAILY_CUSTOMER_CAP) return 'cap'
    // réservation anti-doublon AVANT l'envoi (contrainte unique orderId+kind+channel)
    try { await prisma.opsCustomerNotif.create({ data: { orderId, kind: 'late', channel: 'whatsapp', status: 'pending' } }) } catch { return 'duplicate' }
    const ok = await sendWhatsApp(phone, lateMessage(o.reference || o.externalId, trackUrl(o.id, o.slotEnd)))
    await prisma.opsCustomerNotif.update({ where: { orderId_kind_channel: { orderId, kind: 'late', channel: 'whatsapp' } }, data: { status: ok ? 'sent' : 'failed', error: ok ? null : 'Envoi WhatsApp refusé ou non configuré' } })
    return ok ? 'sent' : 'failed'
  } catch (e) {
    console.error('[customer-notif]', e instanceof Error ? e.message : 'erreur') // jamais de numéro ni de lien dans les logs
    return 'failed'
  }
}

/** Parcourt les commandes en retard / à risque du jour et prévient les clients dont le numéro est connu. */
export async function runCustomerLateNotifs(): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 }
  if (!customerNotifEnabled()) return out
  const now = Date.now(), today = localDay(now)
  const cands = await prisma.opsOrder.findMany({
    where: { customerPhone: { not: null }, status: { notIn: ['DELIVERED', 'NO_SHOW', 'CANCELLED'] }, slotStart: { gte: new Date(dayStartUtc(today)), lt: new Date(dayStartUtc(addDays(today, 1))) } },
    select: { id: true }, take: 300,
  })
  for (const c of cands) { const r = await notifyCustomerLate(c.id); if (r === 'sent') out.sent++; else out.skipped++; if (r === 'cap') break }
  return out
}
