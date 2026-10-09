import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const ITERATIONS  = 210_000     // itérations des NOUVEAUX hash
const LEGACY_ITERATIONS = 100_000 // ancien format `salt:hash` (sans préfixe)
const KEY_LEN     = 64
const DIGEST      = 'sha512'
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
export const COOKIE_NAME      = 'shipinfy_session'
export const ROLE_COOKIE_NAME = 'shipinfy_role'

// ─── Password ─────────────────────────────────────────────────────────────────

/** Nouveau format : `pbkdf2$<itérations>$<sel>:<hash>`. Ancien format toujours lisible : `<sel>:<hash>` (100000 itérations). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(plain, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return `pbkdf2$${ITERATIONS}$${salt}:${hash}`
}

function parseStored(stored: string): { iter: number; salt: string; hash: string } | null {
  let iter = LEGACY_ITERATIONS, rest = stored
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$') // ['pbkdf2', iter, 'salt:hash']
    iter = Number(parts[1]); rest = parts.slice(2).join('$')
    if (!Number.isInteger(iter) || iter < 1000) return null
  }
  const [salt, hash] = rest.split(':')
  return salt && hash ? { iter, salt, hash } : null
}

export function verifyPassword(plain: string, stored: string): boolean {
  const p = parseStored(stored)
  if (!p) return false
  const got = pbkdf2Sync(plain, p.salt, p.iter, KEY_LEN, DIGEST)
  const exp = Buffer.from(p.hash, 'hex')
  return got.length === exp.length && timingSafeEqual(got, exp)
}

/** Vrai si le hash stocké est à l'ancien format / moins d'itérations que la cible → à re-hacher après connexion réussie. */
export function needsRehash(stored: string): boolean {
  const p = parseStored(stored)
  return !p || p.iter < ITERATIONS
}

let _dummyHash: string | null = null
/** Utilisateur inconnu : fait le même travail PBKDF2 pour égaliser le temps de réponse (anti-énumération). */
export function burnPasswordCheck(plain: string): void {
  _dummyHash ??= hashPassword('dummy-password-for-timing')
  verifyPassword(plain, _dummyHash)
}

export const MIN_PASSWORD_LENGTH = 12

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionPayload {
  userId:   string
  tenantId: string | null
  role:     string
  name:     string | null
  email:    string
}

export async function createSession(userId: string): Promise<string> {
  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL)
  await prisma.session.create({ data: { token, userId, expiresAt } })
  return token
}

export async function getSession(req: Request): Promise<SessionPayload | null> {
  // Try Authorization header first (for API clients)
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : await getSessionCookieToken()

  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  if (session.user.active === false) return null // compte désactivé : session invalide immédiatement
  return {
    userId:   session.user.id,
    tenantId: session.user.tenantId,
    role:     session.user.role,
    name:     session.user.name,
    email:    session.user.email,
  }
}

async function getSessionCookieToken(): Promise<string | null> {
  try {
    const jar = await cookies()
    return jar.get(COOKIE_NAME)?.value ?? null
  } catch {
    return null
  }
}

// Cookie Secure en production (HTTPS derrière Traefik)
const SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : ''

export function buildSessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL / 1000)
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE}`
}

export function buildRoleCookie(role: string): string {
  const maxAge = Math.floor(SESSION_TTL / 1000)
  return `${ROLE_COOKIE_NAME}=${role}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE}`
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } }).catch(() => {})
}

/** Supprime toutes les sessions d'un utilisateur (après changement / réinitialisation du mot de passe). */
export async function deleteUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } }).catch(() => {})
}

// ─── Role guards ──────────────────────────────────────────────────────────────

export const ROLES = ['VIEWER', 'SUPPORT', 'DISPATCHER', 'COORDINATOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const
export type  Role  = typeof ROLES[number]

export function roleAtLeast(userRole: string, required: Role): boolean {
  return ROLES.indexOf(userRole as Role) >= ROLES.indexOf(required)
}
