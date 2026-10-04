// Règles RH partagées (Onboarding → contrat).
export const QUIZ_PASS = 70 // score minimum (%) au quiz de fin de formation

export const contractReady = (p: { onboardingStatus: string; trainingDone: boolean; quizScore: number | null }) =>
  p.onboardingStatus === 'actif' || p.onboardingStatus === 'valide' || (p.trainingDone && (p.quizScore ?? 0) >= QUIZ_PASS)
