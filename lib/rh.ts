// Règles RH partagées (Onboarding → contrat).
export const QUIZ_PASS = 70 // score minimum (%) au quiz de fin de formation

export const contractReady = (p: { onboardingStatus: string; trainingDone: boolean; quizScore: number | null }) =>
  p.onboardingStatus === 'actif' || p.onboardingStatus === 'valide' || (p.trainingDone && (p.quizScore ?? 0) >= QUIZ_PASS)

/** Apte à conduire un véhicule (van commercial) : permis valide + visite médicale valide. Un helper n'a pas besoin de permis. */
export function drivingStatus(p: { jobType: string; licenseNo: string | null; licenseExpiry: Date | null; medicalVisitExpiry: Date | null }, now = Date.now()): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (p.jobType === 'chauffeur') {
    if (!p.licenseNo) reasons.push('permis non renseigné')
    else if (!p.licenseExpiry) reasons.push("date d'expiration du permis manquante")
    else if (p.licenseExpiry.getTime() < now) reasons.push('permis expiré')
  }
  if (!p.medicalVisitExpiry) reasons.push('visite médicale non renseignée')
  else if (p.medicalVisitExpiry.getTime() < now) reasons.push('visite médicale expirée')
  return { ok: reasons.length === 0, reasons }
}
