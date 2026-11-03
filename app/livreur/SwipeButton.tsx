'use client'
// Bouton « glisser pour confirmer » (style apps de livraison) : évite les appuis accidentels sur les actions qui changent le statut d'une commande.
// Accessibilité : le conteneur est un bouton — Entrée / Espace confirme sans glisser (clavier, lecteur d'écran, appareils sans glisser fiable).
import { useRef, useState } from 'react'
import { ChevronsRight } from 'lucide-react'

const TONES = { blue: 'bg-blue-600', green: 'bg-green-600', orange: 'bg-orange-600' } as const
const THUMB = 56 // px (cible tactile ≥ 48)
const THRESHOLD = 0.8 // part de la course à atteindre pour confirmer

export function SwipeButton({ label, onConfirm, tone = 'blue', rtl = false, disabled = false }: {
  label: string; onConfirm: () => void; tone?: keyof typeof TONES; rtl?: boolean; disabled?: boolean
}) {
  const track = useRef<HTMLDivElement>(null)
  const startX = useRef<number | null>(null)
  const [dx, setDx] = useState(0)
  const [done, setDone] = useState(false)
  const dir = rtl ? -1 : 1

  const max = () => Math.max(1, (track.current?.clientWidth ?? 280) - THUMB - 8)
  const confirm = () => {
    if (done || disabled) return
    setDone(true); setDx(max())
    try { navigator.vibrate?.(40) } catch { /* non supporté */ }
    onConfirm()
    setTimeout(() => { setDone(false); setDx(0) }, 900) // la carte change ou le panneau s'ouvre ; le bouton redevient disponible
  }
  const down = (e: React.PointerEvent) => { if (disabled || done) return; startX.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  const move = (e: React.PointerEvent) => { if (startX.current == null) return; setDx(Math.min(max(), Math.max(0, (e.clientX - startX.current) * dir))) }
  const up = () => {
    if (startX.current == null) return
    startX.current = null
    if (dx >= max() * THRESHOLD) confirm(); else setDx(0)
  }

  return (
    <div ref={track} role="button" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confirm() } }}
      className={`relative flex h-16 w-full select-none items-center overflow-hidden rounded-full ${TONES[tone]} ${disabled ? 'opacity-50' : ''}`}>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center ps-14 pe-4 text-center text-base font-bold text-white" style={{ opacity: 1 - Math.min(1, dx / (max() * 0.6)) }}>{label}</span>
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="absolute start-1 top-1 flex touch-none items-center justify-center rounded-full bg-white text-slate-900 shadow"
        style={{ width: THUMB, height: THUMB, transform: `translateX(${dx * dir}px)`, transition: startX.current == null ? 'transform 180ms ease-out' : 'none' }}>
        <ChevronsRight size={26} className={rtl ? 'rotate-180' : ''} />
      </div>
    </div>
  )
}
