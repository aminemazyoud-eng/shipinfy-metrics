/**
 * lib/ops-pay.ts — calcul de la paie livreurs (fonction pure).
 * Modèle : FIXE à la journée pointée (mode Standard) + bonus de performance configurables.
 *   brut      = jours payés × tarif journalier du livreur
 *   bonus     = Σ_jours max(0, livrées du jour − seuil) × bonusPerOrder  +  livrées dans le créneau × onTimeBonus
 *   retenues  = NO_SHOW × noShowPenalty + livrées hors créneau × latePenalty
 *   net       = brut + bonus − retenues
 * Le pointage se fait à la JOURNÉE (pas à la commande) ; le nombre de commandes sert uniquement aux bonus.
 */
export interface PayConfig { dailyRate: number; helperDailyRate: number; bonusThreshold: number; bonusPerOrder: number; onTimeBonus: number; noShowPenalty: number; latePenalty: number; paidLeave: boolean }
export interface PayDriver { id: string; code: string; name: string; hubCode: string | null; dailyRate: number }
export interface PayAttendance { driverId: string; day: string; status: string }
export interface PayOrder { driverId: string; day: string; status: string; onTime: boolean }

export interface PayLine {
  code: string; name: string; hubCode: string | null; dailyRate: number
  daysPresent: number; daysLate: number; daysAbsent: number; daysLeave: number; paidDays: number
  delivered: number; onTime: number; deliveredLate: number; noShow: number; bonusOrders: number
  gross: number; bonus: number; deductions: number; net: number
}

export function computePay(cfg: PayConfig, drivers: PayDriver[], attendance: PayAttendance[], orders: PayOrder[]): PayLine[] {
  return drivers.map(d => {
    const att = attendance.filter(a => a.driverId === d.id)
    const mine = orders.filter(o => o.driverId === d.id)
    const count = (s: string) => att.filter(a => a.status === s).length
    const present = count('present'), late = count('late'), absent = count('absent'), leave = count('leave')
    const paidDays = present + late + (cfg.paidLeave ? leave : 0)

    const perDay = new Map<string, number>()
    for (const o of mine) if (o.status === 'DELIVERED') perDay.set(o.day, (perDay.get(o.day) || 0) + 1)
    const bonusOrders = [...perDay.values()].reduce((s, n) => s + Math.max(0, n - cfg.bonusThreshold), 0)
    const delivered = mine.filter(o => o.status === 'DELIVERED').length
    const onTime = mine.filter(o => o.status === 'DELIVERED' && o.onTime).length
    const noShow = mine.filter(o => o.status === 'NO_SHOW').length
    const deliveredLate = delivered - onTime

    const gross = paidDays * d.dailyRate
    const bonus = bonusOrders * cfg.bonusPerOrder + onTime * cfg.onTimeBonus
    const deductions = noShow * cfg.noShowPenalty + deliveredLate * cfg.latePenalty
    const r = (n: number) => Math.round(n * 100) / 100
    return { code: d.code, name: d.name, hubCode: d.hubCode, dailyRate: d.dailyRate, daysPresent: present, daysLate: late, daysAbsent: absent, daysLeave: leave, paidDays,
      delivered, onTime, deliveredLate, noShow, bonusOrders, gross: r(gross), bonus: r(bonus), deductions: r(deductions), net: r(gross + bonus - deductions) }
  })
}

/** CSV prêt pour Excel FR (séparateur ';', virgule décimale, BOM UTF-8) — « fichier pour faire la paie ». */
export function payCsv(lines: PayLine[], period: string): string {
  const head = ['Livreur', 'Code', 'Hub', 'Période', 'Tarif/jour', 'Jours payés', 'Retards (jours)', 'Absences', 'Congés', 'Livrées', 'Dans le créneau', 'Hors créneau', 'NO_SHOW', 'Cmd bonus', 'Brut', 'Bonus', 'Retenues', 'Net à payer']
  const n = (v: number) => String(v).replace('.', ',')
  const rows = lines.map(l => [l.name, l.code, l.hubCode ?? '', period, n(l.dailyRate), l.paidDays, l.daysLate, l.daysAbsent, l.daysLeave, l.delivered, l.onTime, l.deliveredLate, l.noShow, l.bonusOrders, n(l.gross), n(l.bonus), n(l.deductions), n(l.net)])
  const total = ['TOTAL', '', '', period, '', ...[5, 6, 7, 8, 9, 10, 11, 12, 13].map(i => rows.reduce((s, r) => s + Number(String(r[i]).replace(',', '.')), 0)), ...[14, 15, 16, 17].map(i => n(Math.round(rows.reduce((s, r) => s + Number(String(r[i]).replace(',', '.')), 0) * 100) / 100))]
  return '﻿' + [head, ...rows, total].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
}
