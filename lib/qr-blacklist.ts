// lib/qr-blacklist.ts — cache de PREMIÈRE LIGNE des nonces QR déjà vus (mémoire du processus).
// La source de vérité anti-rejeu est la table QrScanNonce (clé primaire = nonce) : ce cache évite seulement
// un aller-retour base pour un rejeu immédiat. Il se vide seul après 60 s (le jeton expire en 10 s).

const usedNonces = new Map<string, number>()

export function isUsed(nonce: string): boolean {
  return usedNonces.has(nonce)
}

export function markUsed(nonce: string): void {
  usedNonces.set(nonce, Date.now())
}

// ─── Auto-cleanup — enregistré une seule fois au niveau du module ────────────
declare global {
  // eslint-disable-next-line no-var
  var __qrBlacklistInterval: ReturnType<typeof setInterval> | undefined
}

if (!globalThis.__qrBlacklistInterval) {
  globalThis.__qrBlacklistInterval = setInterval(() => {
    const now = Date.now()
    for (const [t, ts] of usedNonces) {
      if (now - ts > 60_000) usedNonces.delete(t)
    }
  }, 30_000)
  if (typeof globalThis.__qrBlacklistInterval.unref === 'function') {
    globalThis.__qrBlacklistInterval.unref()
  }
}
