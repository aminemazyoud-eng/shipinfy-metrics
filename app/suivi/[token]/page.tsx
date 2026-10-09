'use client'
// Page PUBLIC de suivi client (/suivi/[token]) — mobile-first. Le contenu est posé en plein écran (fixed) pour recouvrir le shell
// de l'application (menu, barre basse) tant que AppLayoutShell n'exclut pas /suivi ; aucune session n'est requise.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

interface View {
  ref: string; status: string; statusLabel: string; slot: string | null; slotDay: string; slotEnd: string
  steps: { key: string; label: string; at: string }[]
  hub: string | null; driverFirstName: string | null; etaAt: string | null; deliveryCode: string | null
  delivered: boolean; closed: boolean; rating: number | null
}
const TZ = 'Africa/Casablanca'
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const dayLong = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
const FLOW = [['RECEIVED', 'Reçue'], ['ASSIGNED', 'Assignée'], ['IN_TRANSPORT', 'En route'], ['START_DELIVERY', 'En livraison'], ['DELIVERED', 'Livrée']] as const
const TONE: Record<string, string> = { DELIVERED: '#15803d', NO_SHOW: '#b45309', CANCELLED: '#6b7280', START_DELIVERY: '#d97706', IN_TRANSPORT: '#0891b2', ASSIGNED: '#7c3aed', READY_PICKUP: '#2563eb' }

export default function TrackPage() {
  const { token } = useParams<{ token: string }>()
  const [v, setV] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [thanks, setThanks] = useState(false)
  const [rateErr, setRateErr] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/track/${encodeURIComponent(token)}`, { cache: 'no-store' })
      if (r.status === 403) { setErr('Ce lien de suivi est invalide ou a expiré.'); return }
      if (!r.ok) { setErr(r.status === 503 ? 'Le suivi est momentanément indisponible.' : 'Impossible de charger le suivi. Réessayez dans un instant.'); return }
      setV(await r.json()); setErr(null)
    } catch { setErr('Connexion impossible. Réessayez dans un instant.') }
  }, [token])

  // rafraîchissement toutes les 30 s, en pause quand l'onglet est masqué
  useEffect(() => {
    load()
    const start = () => { if (!timer.current) timer.current = setInterval(load, 30_000) }
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
    const onVis = () => { if (document.hidden) stop(); else { load(); start() } }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const submit = async () => {
    if (!score || sending) return
    setSending(true); setRateErr('')
    try {
      const r = await fetch(`/api/track/${encodeURIComponent(token)}/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score, comment: comment.trim() || undefined }) })
      if (r.ok || r.status === 409) { setThanks(true); load() } else setRateErr('Envoi impossible, réessayez.')
    } catch { setRateErr('Envoi impossible, réessayez.') }
    setSending(false)
  }

  const reached = new Set(v?.steps.map(s => s.key))
  const tone = v ? TONE[v.status] ?? '#2563eb' : '#2563eb'
  const lastIdx = v ? FLOW.reduce((m, [k], i) => (reached.has(k) ? i : m), 0) : 0
  const atOf = (k: string) => v?.steps.find(s => s.key === k)?.at

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-md px-4 pb-10 pt-5">
        <div className="flex items-center gap-2 pb-4 opacity-80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={24} height={24} className="object-contain" />
          <span className="text-xs font-bold tracking-wide text-slate-500">SHIPINFY · Suivi de livraison</span>
        </div>

        {err && !v && <div className="rounded-2xl bg-white p-6 text-center shadow-sm"><div className="text-lg font-semibold">Suivi indisponible</div><p className="mt-2 text-sm text-slate-500">{err}</p></div>}
        {!err && !v && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm">Chargement…</div>}

        {v && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="text-xs text-slate-400">Commande {v.ref}</div>
              <div className="mt-1 text-3xl font-extrabold" style={{ color: tone }}>{v.statusLabel}</div>
              {v.slot && <div className="mt-2 text-sm text-slate-600">Créneau de livraison : <b>{v.slot}</b> <span className="text-slate-400">· {dayLong(v.slotDay)}</span></div>}
              {v.etaAt && !v.closed && <div className="mt-1 text-sm text-slate-600">Arrivée estimée vers <b>{hhmm(v.etaAt)}</b></div>}
              {v.driverFirstName && !v.closed && <div className="mt-1 text-sm text-slate-600">Votre livreur : <b>{v.driverFirstName}</b>{v.hub ? <span className="text-slate-400"> · {v.hub}</span> : null}</div>}
              {v.status === 'NO_SHOW' && <p className="mt-2 text-sm text-amber-700">La livraison n’a pas pu aboutir. Contactez votre vendeur pour reprogrammer.</p>}
              {v.status === 'CANCELLED' && <p className="mt-2 text-sm text-slate-500">Cette commande a été annulée.</p>}
            </div>

            {v.deliveryCode && (
              <div className="rounded-2xl border-2 border-dashed p-5 text-center" style={{ borderColor: tone, background: '#fffbeb' }}>
                <div className="text-sm font-medium text-slate-700">Donnez ce code au livreur</div>
                <div className="mt-1 text-5xl font-black tracking-[0.3em]" style={{ color: tone }} aria-label="Code de remise">{v.deliveryCode}</div>
                <div className="mt-1 text-xs text-slate-500">Uniquement à la remise de votre colis.</div>
              </div>
            )}

            {v.status !== 'CANCELLED' && (
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <ol className="space-y-0">
                  {FLOW.map(([k, label], i) => {
                    const done = reached.has(k) || i < lastIdx, current = i === lastIdx && !v.closed
                    const lbl = k === 'DELIVERED' && v.status === 'NO_SHOW' ? 'Non livrée' : label
                    const at = atOf(k) ?? (k === 'DELIVERED' ? atOf('NO_SHOW') : undefined)
                    return (
                      <li key={k} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className="mt-0.5 h-4 w-4 rounded-full border-2" style={{ borderColor: done || current ? tone : '#cbd5e1', background: done ? tone : '#fff' }} />
                          {i < FLOW.length - 1 && <span className="w-0.5 flex-1" style={{ minHeight: 22, background: i < lastIdx ? tone : '#e2e8f0' }} />}
                        </div>
                        <div className="pb-3">
                          <div className={`text-sm ${done || current ? 'font-semibold' : 'text-slate-400'}`}>{lbl}</div>
                          {at && done && <div className="text-xs text-slate-400">{hhmm(at)}</div>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}

            {v.delivered && (
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                {v.rating != null || thanks ? (
                  <div className="text-center"><div className="text-lg font-semibold">Merci pour votre avis !</div>{v.rating != null && <div className="mt-1 text-2xl" style={{ color: '#f59e0b' }}>{'★'.repeat(v.rating)}<span className="text-slate-300">{'★'.repeat(5 - v.rating)}</span></div>}</div>
                ) : (
                  <>
                    <div className="text-sm font-semibold">Comment s’est passée votre livraison ?</div>
                    <div className="mt-2 flex justify-center gap-1" role="radiogroup" aria-label="Note de 1 à 5">
                      {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={score === n} aria-label={`${n} sur 5`} onClick={() => setScore(n)} className="h-12 w-12 text-4xl leading-none" style={{ color: n <= score ? '#f59e0b' : '#cbd5e1' }}>★</button>)}
                    </div>
                    <textarea value={comment} onChange={e => setComment(e.target.value.slice(0, 300))} rows={3} maxLength={300} placeholder="Un commentaire ? (facultatif)" className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" />
                    {rateErr && <div className="mt-1 text-xs text-red-600">{rateErr}</div>}
                    <button type="button" disabled={!score || sending} onClick={submit} className="mt-2 w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: '#15803d' }}>{sending ? 'Envoi…' : 'Envoyer mon avis'}</button>
                  </>
                )}
              </div>
            )}
            {err && <div className="text-center text-xs text-amber-600">{err}</div>}
            <div className="pt-1 text-center text-[11px] text-slate-400">Mise à jour automatique toutes les 30 secondes</div>
          </div>
        )}
      </div>
    </div>
  )
}
