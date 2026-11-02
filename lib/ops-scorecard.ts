/**
 * lib/ops-scorecard.ts — scorecard hebdomadaire livreur (Sprint 21). Message pur, envoyé par WhatsApp (ou lien wa.me en manuel).
 */
import type { Standing } from '@/lib/ops-gamification'

const BADGE: Record<string, string> = { centurion: '💯 Centurion (100+ livraisons)', 'sans-faute': '✅ Sans faute', 'série-3': '🔥 Série de 3 jours', 'série-7': '🏆 Série de 7 jours' }

export function scorecardMessage(name: string, s: Standing, hubSize: number, days: number): string {
  const lines = [
    `Bonjour ${name} 👋`,
    `Votre bilan des ${days} derniers jours :`,
    `📦 ${s.delivered} livraisons · ⏱️ ${s.onTime} à l'heure (${s.rate} %)`,
    `🏅 Classement ${s.hub} : ${s.rank}/${hubSize}`,
    ...(s.streak > 0 ? [`🔥 Série en cours : ${s.streak} jour${s.streak > 1 ? 's' : ''} sans retard`] : []),
    ...s.badges.map(b => BADGE[b] ?? b),
    '', s.rate >= 95 ? 'Excellent travail, continuez ainsi !' : 'Chaque livraison à l\'heure compte : visez 95 % cette semaine.',
  ]
  return lines.join('\n')
}
