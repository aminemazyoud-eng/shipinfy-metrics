'use client'
// Application livreur (PWA) — mobile-first, hors ligne, FR/AR (RTL). Plein écran (fixed) pour recouvrir tout shell éventuel.
// Toute action passe d'abord par la file locale (lib/driver-offline.ts) ; l'interface affiche le statut optimiste.
import { useEffect, useMemo, useRef, useState } from 'react'
import { tr, type Lang } from '@/lib/driver-i18n'
import { errorKey as errKey, nextAction, orderBySequence, reasonText, RETRY_CODES, sortDone, urgency, validateAction, validateNoShow, OTP_RE, type DriverReason, type Geo, type QueueItem, type TourStop, type ViewOrder } from '@/lib/driver-offline'
import { navLinks } from '@/lib/geo'
import { compressImage } from '@/lib/image-compress'
import { getGeo, useDriver, type ScanOutcome } from './useDriver'

const TZ = 'Africa/Casablanca'
const hhmm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '')
type T = (k: string, p?: Record<string, string | number>) => string
type Photo = { dataBase64: string; mime: string; bytes: number }
type Driver = ReturnType<typeof useDriver>

const TONE: Record<string, string> = { ASSIGNED: 'bg-violet-100 text-violet-800', IN_TRANSPORT: 'bg-cyan-100 text-cyan-800', START_DELIVERY: 'bg-amber-100 text-amber-800', DELIVERED: 'bg-green-100 text-green-800', NO_SHOW: 'bg-orange-100 text-orange-800' }
const BTN = 'flex min-h-14 w-full items-center justify-center rounded-2xl px-4 text-lg font-bold active:scale-[0.98] disabled:opacity-50'

export default function DriverPage() {
  const d = useDriver()
  const lang: Lang = d.lang
  const t: T = (k, p) => tr(lang, k, p)
  const [tab, setTab] = useState<'today' | 'load' | 'done' | 'queue'>('today')
  const [sheet, setSheet] = useState<{ kind: 'deliver' | 'noshow'; order: ViewOrder } | null>(null)
  const [otpFor, setOtpFor] = useState<QueueItem | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i) }, [])
  // lang/dir également sur <html> pendant que l'app livreur est affichée (restauré à la sortie)
  useEffect(() => {
    const el = document.documentElement, pl = el.lang, pd = el.dir
    el.lang = lang; el.dir = lang === 'ar' ? 'rtl' : 'ltr'
    return () => { el.lang = pl; el.dir = pd }
  }, [lang])

  // séquence de la tournée si elle existe, sinon tri historique par fin de créneau
  const today = useMemo(() => orderBySequence(d.view, d.tour.stops), [d.view, d.tour.stops])
  const done = useMemo(() => sortDone(d.view), [d.view])
  const rtl = lang === 'ar'
  const loadWarn = d.config.loadScanRequired && d.load && d.load.remaining > 0 ? d.load.remaining : 0
  const reasonLabelOf = (code?: string | null) => { const r = d.reasons.find(x => x.code === code); return r ? reasonText(r, lang) : null }

  const accept = (o: ViewOrder, type: 'accept' | 'start') => { void getGeo(3000).then(geo => d.enqueue({ type, orderId: o.id, geo })) }
  const arrive = (o: ViewOrder) => { void getGeo(6000).then(geo => d.enqueue({ type: 'arrive', orderId: o.id, geo })) }
  const postpone = (o: ViewOrder) => { if (window.confirm(t('postpone.confirm'))) void d.enqueue({ type: 'postpone', orderId: o.id }) }
  const attend = (type: 'checkin' | 'checkout') => { void getGeo(6000).then(geo => d.enqueue({ type, geo })) }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} lang={lang} className="fixed inset-0 z-[100] overflow-y-auto bg-slate-50 text-start text-slate-900">
      <Header d={d} t={t} />
      <div className="mx-auto max-w-md px-3 pb-24 pt-3">
        {d.storeMode === 'memory' && <Banner tone="amber">{t('warn.idb')}</Banner>}
        {!d.online && <Banner tone="slate">{t('net.offlineBanner')}</Banner>}
        {d.notices.map(n => (
          <button key={n.id} onClick={() => d.dismiss(n.id)} className="mb-2 block w-full rounded-xl bg-slate-800 px-4 py-3 text-start text-sm font-medium text-white">{t(n.key, n.params)}</button>
        ))}

        {d.auth === 'loading' && <Card><div className="py-6 text-center text-slate-500">{t('app.loading')}</div></Card>}
        {d.auth === 'expired' && <Block title={t('auth.expired.title')} body={t('auth.expired.body')} />}
        {d.auth === 'notoken' && <Block title={t('auth.none.title')} body={t('auth.none.body')} />}
        {d.auth === 'config' && <Block title={t('auth.config.title')} body={t('auth.config.body')} action={<button className={`${BTN} mt-4 bg-blue-600 text-white`} onClick={() => void d.retryAuth()}>{t('auth.retry')}</button>} />}

        {d.auth === 'ok' && (
          <>
            {d.firstLoadFailed && <Banner tone="amber">{t('warn.firstLoad')}</Banner>}
            <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-200 p-1" role="tablist">
              {(['today', 'load', 'done', 'queue'] as const).map(k => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`min-h-12 rounded-xl px-0.5 text-xs font-bold ${tab === k ? 'bg-white shadow' : 'text-slate-600'}`}>
                  {t(`tab.${k}`)}
                  {k === 'today' && today.length > 0 && <span className="ms-1 text-blue-700">({today.length})</span>}
                  {k === 'load' && loadWarn > 0 && <span className="ms-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{loadWarn}</span>}
                  {k === 'queue' && d.queue.length > 0 && <span className="ms-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{d.queue.length}</span>}
                </button>
              ))}
            </div>

            {tab === 'today' && (
              <div className="space-y-3">
                <Attendance d={d} t={t} onAttend={attend} />
                {d.tour.tour && <div className="px-1 text-sm font-bold text-slate-500">{t('tour.title')} · {t('tour.rotation', { n: d.tour.tour.rotation })}</div>}
                {today.length === 0 && <Card><p className="py-4 text-center text-slate-500">{t('empty.today')}</p></Card>}
                {today.map(({ order: o, stop }) => <OrderCard key={o.id} o={o} stop={stop} t={t} now={now} otp={d.config.otpRequired || o.otpRequired}
                  geofenceMode={d.config.geofenceMode} loadWarn={loadWarn} onGoLoad={() => setTab('load')}
                  onAccept={() => accept(o, 'accept')} onStart={() => accept(o, 'start')} onArrive={() => arrive(o)} onPostpone={() => postpone(o)}
                  onDeliver={() => setSheet({ kind: 'deliver', order: o })} onNoShow={() => setSheet({ kind: 'noshow', order: o })}
                  onFixOtp={() => o.errorItem && setOtpFor(o.errorItem)} />)}
              </div>
            )}
            {tab === 'load' && <LoadView d={d} t={t} />}
            {tab === 'done' && (
              <div className="space-y-3">
                {done.length === 0 && <Card><p className="py-4 text-center text-slate-500">{t('empty.done')}</p></Card>}
                {done.map(o => <OrderCard key={o.id} o={o} stop={null} t={t} now={now} otp={false} finished reasonLabel={o.status === 'NO_SHOW' ? reasonLabelOf(o.reasonCode) : null} />)}
              </div>
            )}
            {tab === 'queue' && <QueueView d={d} t={t} onFixOtp={setOtpFor} />}
          </>
        )}
      </div>

      {sheet?.kind === 'deliver' && <DeliverSheet order={sheet.order} t={t} lang={lang} maxKB={d.config.photoMaxKB} otpRequired={d.config.otpRequired || sheet.order.otpRequired}
        onClose={() => setSheet(null)} onSubmit={async v => { await d.enqueue({ type: 'deliver', orderId: sheet.order.id, otp: v.otp, geo: v.geo, photos: v.photos, kind: 'delivery' }); setSheet(null) }} />}
      {sheet?.kind === 'noshow' && <NoShowSheet order={sheet.order} t={t} lang={lang} reasons={d.reasons} live={d.reasonsLive} maxKB={d.config.photoMaxKB}
        onClose={() => setSheet(null)} onSubmit={async v => { await d.enqueue({ type: 'noshow', orderId: sheet.order.id, reasonCode: v.reasonCode, reason: v.reason, geo: v.geo, photos: v.photos, kind: 'noshow' }); setSheet(null) }} />}
      {otpFor && <OtpSheet item={otpFor} t={t} onClose={() => setOtpFor(null)} onSubmit={async otp => { await d.reenterOtp(otpFor.id, otp); setOtpFor(null) }} />}
    </div>
  )
}

// ───────────────────────── éléments communs ─────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}>{children}</div>
}
function Banner({ tone, children }: { tone: 'amber' | 'slate'; children: React.ReactNode }) {
  return <div className={`mb-2 rounded-xl px-4 py-3 text-sm font-medium ${tone === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-slate-200 text-slate-800'}`}>{children}</div>
}
function Block({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <Card className="mt-6 text-center"><div className="text-xl font-extrabold">{title}</div><p className="mt-2 text-base text-slate-600">{body}</p>{action}</Card>
}

function Header({ d, t }: { d: Driver; t: T }) {
  return (
    <div className="sticky top-0 z-10 bg-blue-700 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow">
      <div className="mx-auto flex max-w-md items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={28} height={30} className="rounded bg-white p-0.5 object-contain" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-extrabold leading-tight">{d.me ? d.me.name : t('app.name')}</div>
          <div className="truncate text-xs text-blue-100">{d.me?.hubName ? `${t('hub.label')} ${d.me.hubName}` : t('app.name')}</div>
        </div>
        <button onClick={() => d.setLang(d.lang === 'ar' ? 'fr' : 'ar')} className="min-h-11 min-w-11 rounded-xl bg-white/15 px-3 text-sm font-bold">{t('lang.toggle')}</button>
      </div>
      <div className="mx-auto mt-2 flex max-w-md flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${d.online ? 'bg-green-500 text-white' : 'bg-red-600 text-white'}`}>
          <span className="h-2 w-2 rounded-full bg-white" />{d.online ? t('net.online') : t('net.offline')}
          {d.pending > 0 && <span className="rounded-full bg-white/25 px-2">{t('net.pending', { n: d.pending })}</span>}
        </span>
        <button onClick={() => void d.runSync(true)} disabled={d.syncing} className="ms-auto min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-blue-800 disabled:opacity-60">
          {d.syncing ? t('sync.running') : t('sync.button')}
        </button>
      </div>
      <div className="mx-auto mt-1 flex max-w-md flex-wrap items-center gap-x-3 text-xs text-blue-100">
        <span>{d.lastSync ? t('sync.last', { time: hhmm(d.lastSync) }) : t('sync.never')}</span>
        {d.gps === 'active' && <span className="font-bold text-green-200" title={t('gps.note')}>● {t('gps.active')}{d.gpsPending > 0 ? ` · ${t('gps.pending', { n: d.gpsPending })}` : ''}</span>}
        {d.gps === 'denied' && <span className="font-bold text-amber-200">{t('gps.denied')}</span>}
      </div>
      {d.gps === 'active' && <div className="mx-auto mt-0.5 max-w-md text-[11px] text-blue-200">{t('gps.note')}</div>}
    </div>
  )
}

function Attendance({ d, t, onAttend }: { d: Driver; t: T; onAttend: (k: 'checkin' | 'checkout') => void }) {
  const { att } = d
  return (
    <Card>
      <div className="mb-2 text-sm font-bold text-slate-500">{t('att.title')}</div>
      <p className="mb-3 text-sm text-slate-700">{att.outAt ? t('att.out', { time: hhmm(att.outAt) }) : att.inAt ? t('att.in', { time: hhmm(att.inAt) }) : t('att.none')}</p>
      <div className="grid grid-cols-2 gap-2">
        <button className={`${BTN} bg-slate-800 text-base text-white`} disabled={!!att.inAt} onClick={() => onAttend('checkin')}>{t('action.checkin')}</button>
        <button className={`${BTN} bg-slate-200 text-base text-slate-900`} disabled={!att.inAt || !!att.outAt} onClick={() => onAttend('checkout')}>{t('action.checkout')}</button>
      </div>
    </Card>
  )
}

function OrderCard(p: {
  o: ViewOrder; stop: TourStop | null; t: T; now: number; otp: boolean; finished?: boolean; reasonLabel?: string | null
  geofenceMode?: 'block' | 'soft'; loadWarn?: number; onGoLoad?: () => void
  onAccept?: () => void; onStart?: () => void; onArrive?: () => void; onPostpone?: () => void; onDeliver?: () => void; onNoShow?: () => void; onFixOtp?: () => void
}) {
  const { o, t, stop } = p
  const u = urgency(o, p.now)
  const act = nextAction(o.status)
  const border = p.finished ? 'border-slate-200' : u.level === 'late' ? 'border-red-500' : u.level === 'soon' ? 'border-amber-500' : 'border-transparent'
  const slot = o.slotLabel || (o.slotStart && o.slotEnd ? `${hhmm(o.slotStart)} - ${hhmm(o.slotEnd)}` : '')
  const nav = navLinks(o.lat ?? stop?.lat, o.lng ?? stop?.lng)
  const canDeliver = p.geofenceMode === 'soft' || o.arrived // en mode « block », la livraison exige l'arrivée
  return (
    <div className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {stop && !p.finished && <span className="mt-0.5 shrink-0 rounded-lg bg-blue-700 px-2 py-1 text-sm font-extrabold text-white" title={t('tour.seq', { n: stop.seq })}>{stop.seq}</span>}
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold">{o.customerName || o.ref}</div>
            <div className="text-xs text-slate-500">{o.ref}</div>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${TONE[o.status] ?? 'bg-slate-100 text-slate-700'}`}>{t(`status.${o.status}`)}</span>
      </div>

      {(o.localPending || o.errorItem || o.postponed || (stop?.postponedCount ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {o.localPending && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{t('order.pendingBadge')}</span>}
          {o.errorItem && <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">{t('order.errorBadge')} · {t(errKey(o.errorItem.errorCode))}</span>}
          {o.postponed && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-800">{t('order.postponedBadge')}</span>}
          {!o.postponed && (stop?.postponedCount ?? 0) > 0 && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-800">{t('order.postponedCount', { n: stop!.postponedCount })}</span>}
        </div>
      )}

      {!p.finished && u.level === 'late' && <div className="mt-2 text-sm font-bold text-red-600">{t('order.late', { n: u.min })}</div>}
      {!p.finished && u.level === 'soon' && <div className="mt-2 text-sm font-bold text-amber-600">{t('order.soon', { n: u.min })}</div>}

      <dl className="mt-3 space-y-1 text-base">
        {stop?.etaAt && !p.finished && <div className="font-bold text-blue-800">{t('tour.eta', { time: hhmm(stop.etaAt) })}</div>}
        {slot && <div><dt className="inline text-slate-500">{t('order.slot')} : </dt><dd className="inline font-bold">{slot}</dd></div>}
        <div><dt className="inline text-slate-500">{t('order.address')} : </dt><dd className="inline">{[o.address ?? stop?.address, o.district].filter(Boolean).join(' · ') || t('order.noAddress')}</dd></div>
        <div><dt className="inline text-slate-500">{t('order.amount')} : </dt><dd className="inline text-lg font-extrabold">{o.amount ? `${Math.round(o.amount)} ${t('order.currency')}` : t('order.noAmount')}</dd></div>
        {p.otp && !p.finished && <div className="text-sm text-slate-500">{t('order.otp')}</div>}
        {o.hasProof && <div className="text-sm text-green-700">{t('order.proof')}</div>}
        {p.finished && p.reasonLabel && <div className="text-sm font-semibold text-orange-800">{p.reasonLabel}</div>}
        {!p.finished && o.arrived && o.status === 'START_DELIVERY' && <div className="text-sm text-green-700">{t('order.arrived')}</div>}
      </dl>

      {!p.finished && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {nav && <a href={nav.waze} target="_blank" rel="noopener noreferrer" className={`${BTN} min-h-12 bg-sky-100 text-base text-sky-900`}>{t('nav.waze')}</a>}
          {nav && <a href={nav.google} target="_blank" rel="noopener noreferrer" className={`${BTN} min-h-12 bg-slate-100 text-base`}>{t('nav.google')}</a>}
          {o.customerPhone && <a href={`tel:${o.customerPhone}`} className={`${BTN} min-h-12 bg-slate-100 text-base`}>{t('order.call')}</a>}
        </div>
      )}

      {!p.finished && (
        <div className="mt-3 space-y-2">
          {o.errorItem?.errorCode === 'OTP_INVALID' && <button className={`${BTN} bg-red-600 text-white`} onClick={p.onFixOtp}>{t('queue.retryOtp')}</button>}
          {act === 'accept' && <button className={`${BTN} bg-blue-600 text-white`} onClick={p.onAccept}>{t('action.accept')}</button>}
          {act === 'start' && (
            <>
              {(p.loadWarn ?? 0) > 0 && (
                <button onClick={p.onGoLoad} className="block w-full rounded-xl bg-amber-100 px-3 py-2 text-start text-sm font-semibold text-amber-900">{t('order.loadWarn', { n: p.loadWarn ?? 0 })}</button>
              )}
              <button className={`${BTN} bg-blue-600 text-white`} onClick={p.onStart}>{t('action.start')}</button>
            </>
          )}
          {act === 'deliver' && (
            <>
              {!o.arrived && <button className={`${BTN} bg-blue-600 text-white`} onClick={p.onArrive}>{t('action.arrive')}</button>}
              {canDeliver && <button className={`${BTN} bg-green-600 text-white`} onClick={p.onDeliver}>{t('action.deliver')}</button>}
              <button className={`${BTN} bg-orange-100 text-orange-900`} onClick={p.onNoShow}>{t('action.nodeliver')}</button>
              {!o.postponed && stop?.canPostpone !== false && <button className={`${BTN} bg-slate-100 text-slate-900`} onClick={p.onPostpone}>{t('action.postpone')}</button>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function QueueView({ d, t, onFixOtp }: { d: Driver; t: T; onFixOtp: (i: QueueItem) => void }) {
  const items = [...d.queue].sort((a, b) => a.seq - b.seq)
  const refOf = (id?: string) => d.view.find(o => o.id === id)?.ref
  if (!items.length) return <Card><p className="py-4 text-center text-slate-500">{t('empty.queue')}</p></Card>
  return (
    <div className="space-y-3">
      <div className="px-1 text-sm font-bold text-slate-500">{t('queue.title')}</div>
      {items.map(i => (
        <Card key={i.id} className={i.state === 'error' ? 'border-2 border-red-400' : ''}>
          <div className="flex items-start justify-between gap-2">
            <div className="font-bold">{t(`type.${i.type}`)}</div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${i.state === 'error' ? 'bg-red-100 text-red-800' : i.state === 'sending' ? 'bg-cyan-100 text-cyan-800' : 'bg-blue-100 text-blue-800'}`}>{t(`queue.state.${i.state}`)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {i.orderId && refOf(i.orderId) ? `${t('queue.order', { ref: refOf(i.orderId) ?? '' })} · ` : ''}{hhmm(i.at)} · {t('queue.tries', { n: i.tries })}
            {i.proofClientIds?.length ? ` · ${t('queue.photos', { n: i.proofClientIds.length })}` : ''}
          </div>
          {i.state === 'error' && (
            <div className="mt-2 space-y-2">
              <div className="text-sm font-semibold text-red-700">{t(errKey(i.errorCode))}</div>
              {i.errorCode === 'OTP_INVALID' && <button className={`${BTN} min-h-12 bg-red-600 text-base text-white`} onClick={() => onFixOtp(i)}>{t('queue.retryOtp')}</button>}
              {i.errorCode && RETRY_CODES.includes(i.errorCode) && <button className={`${BTN} min-h-12 bg-blue-600 text-base text-white`} onClick={() => void d.retryItem(i.id)}>{t('queue.retryGeo')}</button>}
              <button className={`${BTN} min-h-12 bg-slate-100 text-base`} onClick={() => { if (window.confirm(t('queue.discardConfirm'))) void d.discard(i.id) }}>{t('queue.discard')}</button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

// ───────────────────────── chargement : scan des bacs + véhicule ─────────────────────────

type BarcodeDetectorLike = new (o?: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
const getDetector = (): BarcodeDetectorLike | null => (typeof window === 'undefined' ? null : ((window as unknown as { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector ?? null))

function LoadView({ d, t }: { d: Driver; t: T }) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const load = d.load
  useEffect(() => { void d.refreshLoad() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (code: string) => {
    if (busy) return
    setBusy(true)
    const r: ScanOutcome = await d.scan(code)
    setBusy(false)
    const bad = (k: string) => setMsg({ tone: 'bad', text: t(k) })
    if (r.ok) setMsg({ tone: 'ok', text: t('load.ok', { label: r.label ?? '' }) })
    else if (r.code === 'NETWORK') bad('load.needNet')
    else if (r.code === 'RATE') bad('warn.rate')
    else bad(`load.${r.code ?? 'UNKNOWN_BARCODE'}`)
    if (r.checkin && !r.checkin.code && r.checkin.done) setMsg(m => ({ tone: m?.tone ?? 'ok', text: `${m?.text ?? ''} ${t('load.checkin.ok')}`.trim() }))
    if (r.checkin && (r.checkin.code === 'OUT_OF_RANGE' || r.checkin.code === 'GEO_REQUIRED')) setMsg(m => ({ tone: 'bad', text: `${m?.text ?? ''} ${t(`load.checkin.${r.checkin!.code}`)}`.trim() }))
    try { navigator.vibrate?.(r.ok ? 60 : [80, 60, 80]) } catch { /* non supporté */ }
    setManual('')
  }

  const groups = useMemo(() => {
    const m = new Map<string, { ref: string; items: NonNullable<typeof load>['items'] }>()
    for (const i of load?.items ?? []) { const g = m.get(i.orderId) ?? { ref: i.ref, items: [] }; g.items.push(i); m.set(i.orderId, g) }
    return [...m.values()]
  }, [load])

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-1 text-sm font-bold text-slate-500">{t('load.title')}</div>
        {load && load.total > 0 ? (
          <>
            <div className="text-2xl font-extrabold">{t('load.progress', { loaded: load.loaded, total: load.total })}</div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${load.complete ? 'bg-green-600' : 'bg-blue-600'}`} style={{ width: `${Math.round((load.loaded / load.total) * 100)}%` }} /></div>
            {load.complete && <p className="mt-2 text-sm font-semibold text-green-700">{t('load.complete')}</p>}
          </>
        ) : <p className="py-2 text-slate-500">{t('load.empty')}</p>}
        <button onClick={() => void d.refreshLoad()} className={`${BTN} mt-3 min-h-12 bg-slate-100 text-base`}>{t('load.refresh')}</button>
      </Card>

      {load && load.total > 0 && !load.complete && (
        <Card>
          <Scanner t={t} onCode={c => void submit(c)} />
          <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (manual.trim()) void submit(manual) }}>
            <input value={manual} onChange={e => setManual(e.target.value)} dir="ltr" autoComplete="off" aria-label={t('load.manual.label')} placeholder={t('load.manual.label')}
              className="min-h-14 min-w-0 flex-1 rounded-2xl border-2 border-slate-300 px-3 text-lg focus:border-blue-600 focus:outline-none" />
            <button type="submit" disabled={busy || !manual.trim()} className="min-h-14 rounded-2xl bg-blue-600 px-5 text-lg font-bold text-white disabled:opacity-50">{t('load.manual.send')}</button>
          </form>
        </Card>
      )}
      {msg && <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${msg.tone === 'ok' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`} role="status">{msg.text}</div>}

      {groups.map(g => (
        <Card key={g.ref}>
          <div className="mb-1 text-sm font-bold text-slate-500">{g.ref}</div>
          <ul className="space-y-1">
            {g.items.map(i => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-base">
                <span className="min-w-0 truncate">{i.label}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${i.loadedQty >= i.qty ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{i.loadedQty}/{i.qty}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <VehicleCard d={d} t={t} />
    </div>
  )
}

/** Scan par caméra (BarcodeDetector) ; absent ou refusé => message et saisie manuelle. */
function Scanner({ t, onCode }: { t: T; onCode: (c: string) => void }) {
  const [on, setOn] = useState(false)
  const [err, setErr] = useState<'none' | 'unsupported' | 'denied'>('none')
  const video = useRef<HTMLVideoElement>(null)
  const cb = useRef(onCode)
  useEffect(() => { cb.current = onCode })

  useEffect(() => {
    if (!on) return
    const Det = getDetector()
    if (!Det || !navigator.mediaDevices?.getUserMedia) { setErr('unsupported'); setOn(false); return }
    let stop = false, stream: MediaStream | null = null, timer: ReturnType<typeof setInterval> | null = null
    let lastCode = '', lastAt = 0
    ;(async () => {
      try {
        const det = new Det({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stop) { stream.getTracks().forEach(x => x.stop()); return }
        const v = video.current
        if (!v) return
        v.srcObject = stream; await v.play().catch(() => { /* lecture auto refusée : l'image s'affichera au prochain essai */ })
        let busy = false
        timer = setInterval(async () => {
          if (busy || !v.videoWidth) return
          busy = true
          try {
            const found = await det.detect(v)
            const code = found[0]?.rawValue
            const nowMs = Date.now()
            if (code && !(code === lastCode && nowMs - lastAt < 2500)) { lastCode = code; lastAt = nowMs; cb.current(code) }
          } catch { /* image non lisible : on réessaie */ }
          busy = false
        }, 350)
      } catch { setErr('denied'); setOn(false) }
    })()
    return () => { stop = true; if (timer) clearInterval(timer); stream?.getTracks().forEach(x => x.stop()) }
  }, [on])

  const supported = getDetector() != null
  return (
    <div className="space-y-2">
      {on && (
        <div>
          <video ref={video} muted playsInline className="aspect-[4/3] w-full rounded-2xl bg-black object-cover" />
          <p className="mt-1 text-sm text-slate-500">{t('load.scan.hint')}</p>
        </div>
      )}
      {!supported && <p className="text-sm text-slate-600">{t('load.noCamera')}</p>}
      {err === 'unsupported' && <p className="text-sm font-semibold text-amber-700">{t('load.noCamera')}</p>}
      {err === 'denied' && <p className="text-sm font-semibold text-amber-700">{t('load.camera.denied')}</p>}
      {supported && <button className={`${BTN} min-h-14 ${on ? 'bg-slate-200 text-slate-900' : 'bg-blue-600 text-white'}`} onClick={() => { setErr('none'); setOn(v => !v) }}>{on ? t('load.scan.stop') : t('load.scan')}</button>}
    </div>
  )
}

function VehicleCard({ d, t }: { d: Driver; t: T }) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [liters, setLiters] = useState('')
  const [amount, setAmount] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() !== '' && Number.isFinite(n) ? n : NaN }
  const report = (r: { ok: boolean; code?: string }, okKey: string) => {
    if (r.ok) return setMsg({ tone: 'ok', text: t(okKey) })
    setMsg({ tone: 'bad', text: r.code === 'NETWORK' ? t('veh.needNet') : t(`veh.err.${r.code ?? 'UNKNOWN'}`) === `veh.err.${r.code}` ? t('veh.err.UNKNOWN') : t(`veh.err.${r.code ?? 'UNKNOWN'}`) })
  }
  const saveKm = async (kind: 'start' | 'end', raw: string) => { const v = num(raw); if (Number.isNaN(v)) return setMsg({ tone: 'bad', text: t('veh.err.BAD_KM') }); setBusy(true); report(await d.submitOdometer(kind, v), 'veh.km.saved'); setBusy(false) }
  const saveFuel = async () => {
    const l = num(liters), a = num(amount)
    if (Number.isNaN(l)) return setMsg({ tone: 'bad', text: t('veh.err.BAD_LITERS') })
    if (Number.isNaN(a)) return setMsg({ tone: 'bad', text: t('veh.err.BAD_AMOUNT') })
    setBusy(true); const r = await d.submitFuel(l, a); setBusy(false); report(r, 'veh.fuel.saved')
    if (r.ok) { setLiters(''); setAmount('') }
  }
  const field = 'min-h-14 w-full rounded-2xl border-2 border-slate-300 px-3 text-lg focus:border-blue-600 focus:outline-none'
  return (
    <Card>
      <div className="mb-2 text-sm font-bold text-slate-500">{t('veh.title')}{d.me?.plate ? ` · ${d.me.plate}` : ''}</div>
      <div className="space-y-3">
        {([['start', t('veh.kmStart'), start, setStart, d.km.start], ['end', t('veh.kmEnd'), end, setEnd, d.km.end]] as const).map(([kind, label, val, set, saved]) => (
          <div key={kind}>
            <label className="mb-1 block font-bold">{label}{saved != null ? ` (${saved})` : ''}</label>
            <div className="flex gap-2">
              <input inputMode="decimal" dir="ltr" value={val} onChange={e => set(e.target.value)} className={field} />
              <button disabled={busy || !val.trim()} onClick={() => void saveKm(kind, val)} className="min-h-14 rounded-2xl bg-slate-800 px-4 text-base font-bold text-white disabled:opacity-50">{t('veh.km.save')}</button>
            </div>
          </div>
        ))}
        <div className="border-t border-slate-200 pt-3">
          <div className="mb-2 font-bold">{t('veh.fuel.title')}</div>
          <div className="grid grid-cols-2 gap-2">
            <input inputMode="decimal" dir="ltr" placeholder={t('veh.fuel.liters')} aria-label={t('veh.fuel.liters')} value={liters} onChange={e => setLiters(e.target.value)} className={field} />
            <input inputMode="decimal" dir="ltr" placeholder={t('veh.fuel.amount')} aria-label={t('veh.fuel.amount')} value={amount} onChange={e => setAmount(e.target.value)} className={field} />
          </div>
          <button disabled={busy || !liters.trim() || !amount.trim()} onClick={() => void saveFuel()} className={`${BTN} mt-2 min-h-12 bg-slate-800 text-base text-white`}>{t('veh.fuel.send')}</button>
        </div>
        {msg && <div className={`rounded-xl px-3 py-2 text-sm font-semibold ${msg.tone === 'ok' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`} role="status">{msg.text}</div>}
      </div>
    </Card>
  )
}

// ───────────────────────── feuilles (modales plein écran) ─────────────────────────

function Sheet({ title, onClose, t, children }: { title: string; onClose: () => void; t: T; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end bg-black/50" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button onClick={onClose} className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-bold">{t('common.close')}</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Position au moment de l'ouverture : jamais bloquante. */
function useGeoOnOpen() {
  const [geo, setGeo] = useState<Geo | undefined>()
  const [state, setState] = useState<'getting' | 'ok' | 'none'>('getting')
  useEffect(() => {
    let dead = false
    void getGeo(10_000).then(g => { if (!dead) { setGeo(g); setState(g ? 'ok' : 'none') } })
    return () => { dead = true }
  }, [])
  return { geo, state }
}

function GeoLine({ g, t }: { g: { geo?: Geo; state: 'getting' | 'ok' | 'none' }; t: T }) {
  return <p className="text-sm text-slate-500">{g.state === 'getting' ? t('geo.getting') : g.state === 'ok' ? t('geo.ok', { m: g.geo?.accuracy ?? 0 }) : t('geo.none')}</p>
}

function PhotoPicker({ photos, setPhotos, maxKB, t, hint }: { photos: Photo[]; setPhotos: (p: Photo[]) => void; maxKB: number; t: T; hint: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setBusy(true); setErr(false)
    try { const c = await compressImage(f, maxKB); setPhotos([...photos, { dataBase64: c.dataBase64, mime: c.mime, bytes: c.bytes }].slice(-3)) } catch { setErr(true) }
    setBusy(false)
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:${p.mime};base64,${p.dataBase64}`} alt="" className="h-24 w-24 rounded-xl object-cover" />
            <button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -end-1 -top-1 min-h-8 rounded-full bg-red-600 px-2 text-xs font-bold text-white">{t('photo.remove')}</button>
            <div className="text-center text-xs text-slate-500">{t('photo.size', { kb: Math.round(p.bytes / 1024) })}</div>
          </div>
        ))}
      </div>
      <label className={`${BTN} cursor-pointer bg-blue-50 text-blue-800`}>
        {busy ? t('photo.processing') : photos.length ? t('photo.add') : t('photo.take')}
        <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={onFile} />
      </label>
      {err && <p className="text-sm font-semibold text-red-600">{t('photo.error')}</p>}
    </div>
  )
}

function DeliverSheet({ order, t, maxKB, otpRequired, onClose, onSubmit }: {
  order: ViewOrder; t: T; lang: Lang; maxKB: number; otpRequired: boolean; onClose: () => void
  onSubmit: (v: { otp?: string; geo?: Geo; photos: Photo[] }) => Promise<void>
}) {
  const g = useGeoOnOpen()
  const [otp, setOtp] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const bad = validateAction('deliver', { otp, proofCount: photos.length })
  return (
    <Sheet title={`${t('deliver.title')} · ${order.ref}`} onClose={onClose} t={t}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block font-bold" htmlFor="otp">{t('deliver.otp.label')}{otpRequired ? ' *' : ''}</label>
          <input id="otp" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="one-time-code" dir="ltr" value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-center text-4xl font-black tracking-[0.5em] focus:border-blue-600 focus:outline-none" />
          <p className="mt-1 text-sm text-slate-500">{t('deliver.otp.hint')}</p>
        </div>
        <PhotoPicker photos={photos} setPhotos={setPhotos} maxKB={maxKB} t={t} hint={t('deliver.photo.hint')} />
        <GeoLine g={g} t={t} />
        {bad && <p className="text-sm font-semibold text-amber-700">{t(bad)}</p>}
        <button className={`${BTN} bg-green-600 text-white`} disabled={!!bad || busy || (otp !== '' && !OTP_RE.test(otp))}
          onClick={async () => { setBusy(true); await onSubmit({ otp: OTP_RE.test(otp) ? otp : undefined, geo: g.geo, photos }) }}>{t('deliver.confirm')}</button>
      </div>
    </Sheet>
  )
}

/** Non livré : motif OBLIGATOIRE choisi dans la nomenclature (GET /api/driver/reasons, liste de secours hors ligne), photo, précision facultative. */
function NoShowSheet({ order, t, lang, reasons, live, maxKB, onClose, onSubmit }: {
  order: ViewOrder; t: T; lang: Lang; reasons: DriverReason[]; live: boolean; maxKB: number; onClose: () => void
  onSubmit: (v: { reasonCode: string; reason: string; geo?: Geo; photos: Photo[] }) => Promise<void>
}) {
  const g = useGeoOnOpen()
  const [pick, setPick] = useState<string>('')
  const [free, setFree] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const chosen = reasons.find(r => r.code === pick)
  // le libellé FR du motif (nomenclature) sert de texte ; la précision libre s'y ajoute
  const reason = chosen ? `${chosen.label}${free.trim() ? ` — ${free.trim()}` : ''}` : ''
  const bad = validateNoShow({ reasonCode: pick || undefined, proofCount: photos.length })
  return (
    <Sheet title={`${t('noshow.title')} · ${order.ref}`} onClose={onClose} t={t}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 font-bold">{t('noshow.reason.label')} *</div>
          <div className="grid gap-2">
            {reasons.map(r => (
              <button key={r.code} onClick={() => setPick(r.code)} aria-pressed={pick === r.code}
                className={`min-h-12 rounded-xl border-2 px-4 text-start text-base font-semibold ${pick === r.code ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}>{reasonText(r, lang)}</button>
            ))}
          </div>
          {!live && <p className="mt-1 text-xs text-slate-500">{t('noshow.reasons.offline')}</p>}
          <label className="mt-3 block text-sm font-semibold text-slate-600" htmlFor="free">{t('noshow.free.label')}</label>
          <textarea id="free" value={free} onChange={e => setFree(e.target.value)} placeholder={t('noshow.reason.placeholder')} rows={2} maxLength={200}
            className="mt-1 w-full rounded-xl border-2 border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-none" />
        </div>
        <PhotoPicker photos={photos} setPhotos={setPhotos} maxKB={maxKB} t={t} hint={t('noshow.photo.hint')} />
        <GeoLine g={g} t={t} />
        {bad && <p className="text-sm font-semibold text-amber-700">{t(bad)}</p>}
        <button className={`${BTN} bg-orange-600 text-white`} disabled={!!bad || busy}
          onClick={async () => { setBusy(true); await onSubmit({ reasonCode: pick, reason, geo: g.geo, photos }) }}>{t('noshow.confirm')}</button>
      </div>
    </Sheet>
  )
}

function OtpSheet({ item, t, onClose, onSubmit }: { item: QueueItem; t: T; onClose: () => void; onSubmit: (otp: string) => Promise<void> }) {
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Sheet title={t('otp.retry.title')} onClose={onClose} t={t}>
      <div className="space-y-4">
        <p className="text-sm font-semibold text-red-700">{t(errKey(item.errorCode))}</p>
        <input inputMode="numeric" pattern="[0-9]*" maxLength={4} dir="ltr" autoFocus value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-center text-4xl font-black tracking-[0.5em] focus:border-blue-600 focus:outline-none" />
        <button className={`${BTN} bg-green-600 text-white`} disabled={!OTP_RE.test(otp) || busy} onClick={async () => { setBusy(true); await onSubmit(otp) }}>{t('otp.retry.send')}</button>
      </div>
    </Sheet>
  )
}
