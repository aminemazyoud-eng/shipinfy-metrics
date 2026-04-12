import { randomBytes, pbkdf2Sync } from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const ITERATIONS  = 100_000
const KEY_LEN     = 64
const DIGEST      = 'sha512'
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
export const COOKIE_NAME      = 'shipinfy_session'
export const ROLE_COOKIE_NAME = 'shipinfy_role'

// ─── Password ─────────────────────────────────────────────────────────────────

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(plain, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(':')
  if (!salt || !storedHash) return false
  const hash = pbkdf2Sync(plain, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return hash === storedHash
}

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

export function buildSessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL / 1000)
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export function buildRoleCookie(role: string): string {
  const maxAge = Math.floor(SESSION_TTL / 1000)
  return `${ROLE_COOKIE_NAME}=${role}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } }).catch(() => {})
}

// ─── Role guards ──────────────────────────────────────────────────────────────

export const ROLES = ['VIEWER', 'SUPPORT', 'DISPATCHER', 'COORDINATOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const
export type  Role  = typeof ROLES[number]

export function roleAtLeast(userRole: string, required: Role): boolean {
  return ROLES.indexOf(userRole as Role) >= ROLES.indexOf(required)
}
