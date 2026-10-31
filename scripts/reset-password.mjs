/**
 * Réinitialise le mot de passe d'un utilisateur directement en base (secours quand l'email de reset ne part pas).
 * Usage : node --env-file=.env.local scripts/reset-password.mjs <email> [nouveau-mot-de-passe]
 * Sans mot de passe fourni, un mot de passe aléatoire est généré et affiché.
 * Même format que lib/auth.ts (pbkdf2$210000$sel:hash).
 */
import { randomBytes, pbkdf2Sync } from 'crypto'
import { PrismaClient } from '@prisma/client'

const [, , emailArg, pwArg] = process.argv
if (!emailArg) { console.error('Usage: node --env-file=.env.local scripts/reset-password.mjs <email> [mot-de-passe]'); process.exit(1) }

const MIN = 12
const password = pwArg ?? `Shp-${randomBytes(6).toString('hex')}-Aa9`
if (password.length < MIN) { console.error(`Mot de passe minimum ${MIN} caractères`); process.exit(1) }

const salt = randomBytes(16).toString('hex')
const hash = pbkdf2Sync(password, salt, 210_000, 64, 'sha512').toString('hex')

const prisma = new PrismaClient()
try {
  const r = await prisma.user.updateMany({
    where: { email: emailArg.toLowerCase().trim() },
    data: { password: `pbkdf2$210000$${salt}:${hash}`, active: true },
  })
  if (!r.count) { console.error('Aucun utilisateur avec cet email'); process.exit(1) }
  console.log(`OK — mot de passe de ${emailArg} réinitialisé.`)
  if (!pwArg) console.log(`Mot de passe temporaire : ${password}  (à changer dans Paramètres)`)
} catch (e) {
  console.error('Échec — vérifiez DATABASE_URL dans .env.local :', e.message?.split('\n').filter(Boolean).pop())
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
