import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, hashPassword } from '@/lib/auth'
import { limited } from '@/lib/rate-limit'
import { makeDriverToken, driverJson } from '@/lib/ops-driver-token'
import { envUnavailable } from '@/lib/env'
import { normalizeLogin } from '@/lib/ops-driver-account'
import { normalizePhone } from '@/lib/ops-planning'

export const dynamic = 'force-dynamic'

let dummy: string | null = null // hash factice : même durée de calcul que le compte soit inconnu ou non (pas d'indice sur son existence)

// POST /api/driver/login { login, password } → { token, driver:{ code, name } }
// login = code livreur (ex. D01) ou numéro de téléphone. 5 essais / 15 min par IP + identifiant. Route publique (voir proxy.ts).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { login?: unknown; password?: unknown }
    const login = normalizeLogin(body.login), password = typeof body.password === 'string' ? body.password : ''
    if (!login || !password || password.length > 200) return driverJson({ error: 'Identifiant et mot de passe requis', code: 'BAD_REQUEST' }, 400)

    const tooMany = limited(req, 'driver-login', 5, 15 * 60_000, login.toLowerCase())
    if (tooMany) return tooMany

    const phone = normalizePhone(login)
    const driver = await prisma.opsDriver.findFirst({
      where: { OR: [{ code: { equals: login, mode: 'insensitive' } }, ...(phone ? [{ phone }] : [])] },
      select: { code: true, firstName: true, lastName: true, status: true, tokenVersion: true, appPasswordHash: true },
    })
    dummy ??= hashPassword('dummy-driver-password')
    const ok = verifyPassword(password, driver?.appPasswordHash ?? dummy) && !!driver?.appPasswordHash
    if (!driver || !ok) return driverJson({ error: 'Identifiant ou mot de passe incorrect', code: 'BAD_CREDENTIALS' }, 401)
    if (driver.status === 'off') return driverJson({ error: 'Compte livreur désactivé', code: 'DRIVER_OFF' }, 403)

    await prisma.opsDriver.update({ where: { code: driver.code }, data: { appLoginAt: new Date() } }).catch(() => {})
    return driverJson({ token: makeDriverToken(driver.code, driver.tokenVersion), driver: { code: driver.code, name: `${driver.firstName} ${driver.lastName}`.trim() } })
  } catch (e) {
    const env = envUnavailable(e)
    if (env) { env.headers.set('Cache-Control', 'no-store'); return env }
    console.error('[api/driver/login]', e)
    return driverJson({ error: 'Erreur serveur' }, 500)
  }
}
