// lib/qr-blacklist.ts — Sprint 16 BLOC 4 — QR Pointage single-use token blacklist
// Valide uniquement en mode Docker standalone (process persistant) — identique à lib/upload-progress.ts
//
// In-memory Map<token, usedAtMs>. A token is single-use : once markUsed() is called,
// isUsed() returns true until the entry is auto-evicted (60s after use).

const usedTokens = new Map<string, number>()

export function isUsed(token: string): boolean {
  return usedTokens.has(token)
}

export function markUsed(token: string): void {
  usedTokens.set(token, Date.now())
}

// ─── Auto-cleanup — registered once at module scope ──────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __qrBlacklistInterval: ReturnType<typeof setInterval> | undefined
}

if (!globalThis.__qrBlacklistInterval) {
  globalThis.__qrBlacklistInterval = setInterval(() => {
    const now = Date.now()
    for (const [t, ts] of usedTokens) {
      if (now - ts > 60_000) usedTokens.delete(t)
    }
  }, 30_000)
  // Do not keep the event loop alive just for this timer
  if (typeof globalThis.__qrBlacklistInterval.unref === 'function') {
    globalThis.__qrBlacklistInterval.unref()
  }
}
