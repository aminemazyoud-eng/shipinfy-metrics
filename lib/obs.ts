/**
 * lib/obs.ts — observabilité des routes API (Sprint 17 C4) : durée, statut, x-request-id, Server-Timing et UNE ligne JSON par appel.
 *   export const GET = withMetrics('ops.forecast', async (req) => NextResponse.json(...))
 * Compatible avec les routes à contexte (params) : le 2e argument est transmis tel quel.
 * N'enregistre jamais le corps ni les en-têtes (pas de donnée sensible) ; le chemin est journalisé SANS query string.
 */
import { randomUUID } from 'crypto'

type Handler<A extends unknown[]> = (req: Request, ...rest: A) => Promise<Response> | Response

export function withMetrics<A extends unknown[]>(name: string, handler: Handler<A>): (req: Request, ...rest: A) => Promise<Response> {
  return async (req: Request, ...rest: A) => {
    const t0 = performance.now()
    const id = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID()
    let res: Response
    try {
      res = await handler(req, ...rest)
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      console.error(JSON.stringify({ t: new Date().toISOString(), lvl: 'error', route: name, id, status: 500, ms, err: e instanceof Error ? e.message.slice(0, 300) : 'erreur' }))
      throw e
    }
    const status = res.status
    const ms = Math.round((performance.now() - t0) * 10) / 10
    try {
      res.headers.set('x-request-id', id); res.headers.append('Server-Timing', `app;dur=${ms}`)
    } catch { // en-têtes immuables (Response.redirect, fetch proxifié) : on recopie la réponse
      const h = new Headers(res.headers); h.set('x-request-id', id); h.append('Server-Timing', `app;dur=${ms}`)
      res = new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
    }
    let path = ''; try { path = new URL(req.url).pathname } catch { /* ignore */ }
    console.log(JSON.stringify({ t: new Date().toISOString(), lvl: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', route: name, method: req.method, path, id, status, ms }))
    return res
  }
}
