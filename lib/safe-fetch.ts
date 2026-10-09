/**
 * lib/safe-fetch.ts — appels sortants vers des URL saisies par un utilisateur (webhooks Slack / n8n) — Sprint 17 A6.
 * Anti-SSRF : https uniquement, hôte dans la liste autorisée, résolution DNS refusant adresses privées / loopback / link-local,
 * pas de redirection suivie, délai maximal.
 */
import { lookup } from 'dns/promises'
import net from 'net'

const baseAllowed = () => (process.env.OUTBOUND_ALLOWED_HOSTS ?? 'hooks.slack.com').split(',').map(s => s.trim()).filter(Boolean)
const n8nHost = () => { try { return process.env.N8N_HOST ? [process.env.N8N_HOST] : process.env.N8N_URL ? [new URL(process.env.N8N_URL).hostname] : ['n8n.mediflows.shop'] } catch { return ['n8n.mediflows.shop'] } }

export const isPrivateIp = (ip: string): boolean => {
  if (net.isIP(ip) === 4) return /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)
  return /^(::1$|::$|fc|fd|fe[89ab]|::ffff:(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168)\.)/i.test(ip)
}

export async function assertSafeUrl(rawUrl: string, extraHosts: string[] = []): Promise<URL> {
  let u: URL
  try { u = new URL(rawUrl) } catch { throw new Error('URL invalide') }
  if (u.protocol !== 'https:') throw new Error('URL https obligatoire')
  if (u.username || u.password) throw new Error('URL avec identifiants refusée')
  const allowed = [...baseAllowed(), ...n8nHost(), ...extraHosts]
  if (!allowed.includes(u.hostname)) throw new Error(`Hôte non autorisé : ${u.hostname}`)
  const addrs = await lookup(u.hostname, { all: true })
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Adresse interne refusée')
  return u
}

export async function safeFetch(rawUrl: string, init: RequestInit = {}, extraHosts: string[] = []): Promise<Response> {
  const u = await assertSafeUrl(rawUrl, extraHosts)
  return fetch(u, { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(8000) })
}
