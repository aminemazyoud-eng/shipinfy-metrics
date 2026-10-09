'use client'
import { useEffect, useState } from 'react'
import { ShieldCheck, Lock } from 'lucide-react'

interface OtpState { verifiedAt: string | null; verifiedBy?: string | null; attempts: number; locked: boolean; maxAttempts?: number }
const ELIGIBLE = ['IN_TRANSPORT', 'START_DELIVERY', 'DELIVERED']
const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Saisie du code de remise à 4 chiffres communiqué par le client au livreur. Le code lui-même n'est jamais fourni par le serveur Ops.
export default function OtpPanel({ orderId, status, verifiedAt }: { orderId: string; status: string; verifiedAt?: string | null }) {
  const [st, setSt] = useState<OtpState>({ verifiedAt: verifiedAt ?? null, attempts: 0, locked: false })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    setMsg(null); setCode('')
    fetch(`/api/ops/orders/${orderId}/otp`).then(r => r.ok ? r.json() : null).then(j => { if (alive && j) setSt(j) }).catch(() => {})
    return () => { alive = false }
  }, [orderId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4}$/.test(code) || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/ops/orders/${orderId}/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const j = await r.json().catch(() => ({}))
      if (j && typeof j.attempts === 'number') setSt(j)
      if (r.ok) setMsg({ ok: true, text: 'Code vérifié : remise confirmée.' })
      else if (r.status === 429) setMsg({ ok: false, text: 'Vérification verrouillée après trop d’essais. Contactez un responsable.' })
      else if (r.status === 422) setMsg({ ok: false, text: `Code incorrect${j.attempts != null && j.maxAttempts ? ` (${j.attempts}/${j.maxAttempts} essais)` : ''}.` })
      else setMsg({ ok: false, text: j.error || 'Erreur' })
      setCode('')
    } finally { setBusy(false) }
  }

  if (st.verifiedAt) return (
    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
      <ShieldCheck className="w-4 h-4" />Code vérifié le {fmt(st.verifiedAt)}{st.verifiedBy ? ` par ${st.verifiedBy}` : ''}
    </div>
  )
  if (!ELIGIBLE.includes(status)) return <div className="text-xs text-gray-400">Code de remise : disponible une fois la commande en transport.</div>
  if (st.locked) return (
    <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
      <Lock className="w-4 h-4" />Vérification verrouillée après {st.attempts} essais ratés.
    </div>
  )
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="text-xs text-gray-500">Code de remise (4 chiffres donnés par le client)</div>
      <div className="flex gap-2">
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" placeholder="0000" aria-label="Code de remise"
          className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm tracking-widest text-center" />
        <button type="submit" disabled={busy || code.length !== 4} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-50">Vérifier</button>
      </div>
      {st.attempts > 0 && !msg && <div className="text-xs text-amber-600">{st.attempts} essai(s) raté(s)</div>}
      {msg && <div className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</div>}
    </form>
  )
}
