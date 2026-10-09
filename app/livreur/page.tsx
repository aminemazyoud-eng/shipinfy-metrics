'use client'
// Application livreur (PWA) — mobile-first, hors ligne, FR/AR (RTL). Plein écran (fixed) pour recouvrir tout shell éventuel.
// Toute action passe d'abord par la file locale (lib/driver-offline.ts) ; l'interface affiche le statut optimiste.
import { useEffect, useMemo, useState } from 'react'
import { tr, type Lang } from '@/lib/driver-i18n'
import { errorKey as errKey, nextAction, sortDone, sortToday, urgency, validateAction, OTP_RE, type Geo, type QueueItem, type ViewOrder } from '@/lib/driver-offline'
import { compressImage } from '@/lib/image-compress'
import { getGeo, useDriver } from './useDriver'

const TZ = 'Africa/Casablanca'
const hhmm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '')
type T = (k: string, p?: Record<string, string | number>) => string
type Photo = { dataBase64: string; mime: string; bytes: number }

const TONE: Record<string, string> = { ASSIGNED: 'bg-violet-100 text-violet-800', IN_TRANSPORT: 'bg-cyan-100 text-cyan-800', START_DELIVERY: 'bg-amber-100 text-amber-800', DELIVERED: 'bg-green-100 text-green-800', NO_SHOW: 'bg-orange-100 text-orange-800' }
const BTN = 'flex min-h-14 w-full items-center justify-center rounded-2xl px-4 text-lg font-bold active:scale-[0.98] disabled:opacity-50'

export default function DriverPage() {
  const d = useDriver()
  const lang: Lang = d.lang
  const t: T = (k, p) => tr(lang, k, p)
  const [tab, setTab] = useState<'today' | 'done' | 'queue'>('today')
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

  const today = useMemo(() => sortToday(d.view), [d.view])
  const done = useMemo(() => sortDone(d.view), [d.view])
  const rtl = lang === 'ar'

  const accept = (o: ViewOrder, type: 'accept' | 'start') => { void getGeo(3000).then(geo => d.enqueue({ type, orderId: o.id, geo })) }
  const attend = (type: 'checkin' | 'checkout') => { void getGeo(4000).then(geo => d.enqueue({ type, geo })) }

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
            <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-200 p-1" role="tablist">
              {(['today', 'done', 'queue'] as const).map(k => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`min-h-12 rounded-xl px-1 text-sm font-bold ${tab === k ? 'bg-white shadow' : 'text-slate-600'}`}>
                  {t(`tab.${k}`)}
                  {k === 'today' && today.length > 0 && <span className="ms-1 text-blue-700">({today.length})</span>}
                  {k === 'queue' && d.queue.length > 0 && <span className="ms-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{d.queue.length}</span>}
                </button>
              ))}
            </div>

            {tab === 'today' && (
              <div className="space-y-3">
                <Attendance d={d} t={t} onAttend={attend} />
                {today.length === 0 && <Card><p className="py-4 text-center text-slate-500">{t('empty.today')}</p></Card>}
                {today.map(o => <OrderCard key={o.id} o={o} t={t} now={now} otp={d.config.otpRequired || o.otpRequired}
                  onAccept={() => accept(o, 'accept')} onStart={() => accept(o, 'start')}
                  onDeliver={() => setSheet({ kind: 'deliver', order: o })} onNoShow={() => setSheet({ kind: 'noshow', order: o })}
                  onFixOtp={() => o.errorItem && setOtpFor(o.errorItem)} />)}
              </div>
            )}
            {tab === 'done' && (
              <div className="space-y-3">
                {done.length === 0 && <Card><p className="py-4 text-center text-slate-500">{t('empty.done')}</p></Card>}
                {done.map(o => <OrderCard key={o.id} o={o} t={t} now={now} otp={false} finished />)}
              </div>
            )}
            {tab === 'queue' && <QueueView d={d} t={t} onFixOtp={setOtpFor} />}
          </>
        )}
      </div>

      {sheet?.kind === 'deliver' && <DeliverSheet order={sheet.order} t={t} lang={lang} maxKB={d.config.photoMaxKB} otpRequired={d.config.otpRequired || sheet.order.otpRequired}
        onClose={() => setSheet(null)} onSubmit={async v => { await d.enqueue({ type: 'deliver', orderId: sheet.order.id, otp: v.otp, geo: v.geo, photos: v.photos, kind: 'delivery' }); setSheet(null) }} />}
      {sheet?.kind === 'noshow' && <NoShowSheet order={sheet.order} t={t} maxKB={d.config.photoMaxKB}
        onClose={() => setSheet(null)} onSubmit={async v => { await d.enqueue({ type: 'noshow', orderId: sheet.order.id, reason: v.reason, geo: v.geo, photos: v.photos, kind: 'noshow' }); setSheet(null) }} />}
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

function Header({ d, t }: { d: ReturnType<typeof useDriver>; t: T }) {
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
      <div className="mx-auto mt-2 flex max-w-md items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${d.online ? 'bg-green-500 text-white' : 'bg-red-600 text-white'}`}>
          <span className="h-2 w-2 rounded-full bg-white" />{d.online ? t('net.online') : t('net.offline')}
          {d.pending > 0 && <span className="rounded-full bg-white/25 px-2">{t('net.pending', { n: d.pending })}</span>}
        </span>
        <button onClick={() => void d.runSync(true)} disabled={d.syncing} className="ms-auto min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-blue-800 disabled:opacity-60">
          {d.syncing ? t('sync.running') : t('sync.button')}
        </button>
      </div>
      <div className="mx-auto mt-1 max-w-md text-xs text-blue-100">{d.lastSync ? t('sync.last', { time: hhmm(d.lastSync) }) : t('sync.never')}</div>
    </div>
  )
}

function Attendance({ d, t, onAttend }: { d: ReturnType<typeof useDriver>; t: T; onAttend: (k: 'checkin' | 'checkout') => void }) {
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
  o: ViewOrder; t: T; now: number; otp: boolean; finished?: boolean
  onAccept?: () => void; onStart?: () => void; onDeliver?: () => void; onNoShow?: () => void; onFixOtp?: () => void
}) {
  const { o, t } = p
  const u = urgency(o, p.now)
  const act = nextAction(o.status)
  const border = p.finished ? 'border-slate-200' : u.level === 'late' ? 'border-red-500' : u.level === 'soon' ? 'border-amber-500' : 'border-transparent'
  const slot = o.slotLabel || (o.slotStart && o.slotEnd ? `${hhmm(o.slotStart)} - ${hhmm(o.slotEnd)}` : '')
  const maps = o.lat != null && o.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}` : null
  return (
    <div className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-lg font-extrabold">{o.customerName || o.ref}</div>
          <div className="text-xs text-slate-500">{o.ref}</div>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${TONE[o.status] ?? 'bg-slate-100 text-slate-700'}`}>{t(`status.${o.status}`)}</span>
      </div>

      {(o.localPending || o.errorItem) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {o.localPending && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{t('order.pendingBadge')}</span>}
          {o.errorItem && <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">{t('order.errorBadge')} · {t(errKey(o.errorItem.errorCode))}</span>}
        </div>
      )}

      {!p.finished && u.level === 'late' && <div className="mt-2 text-sm font-bold text-red-600">{t('order.late', { n: u.min })}</div>}
      {!p.finished && u.level === 'soon' && <div className="mt-2 text-sm font-bold text-amber-600">{t('order.soon', { n: u.min })}</div>}

      <dl className="mt-3 space-y-1 text-base">
        {slot && <div><dt className="inline text-slate-500">{t('order.slot')} : </dt><dd className="inline font-bold">{slot}</dd></div>}
        <div><dt className="inline text-slate-500">{t('order.address')} : </dt><dd className="inline">{[o.address, o.district].filter(Boolean).join(' · ') || t('order.noAddress')}</dd></div>
        <div><dt className="inline text-slate-500">{t('order.amount')} : </dt><dd className="inline text-lg font-extrabold">{o.amount ? `${Math.round(o.amount)} ${t('order.currency')}` : t('order.noAmount')}</dd></div>
        {p.otp && !p.finished && <div className="text-sm text-slate-500">{t('order.otp')}</div>}
        {o.hasProof && <div className="text-sm text-green-700">{t('order.proof')}</div>}
      </dl>

      {!p.finished && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {maps && <a href={maps} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-slate-100 text-base`}>{t('order.itinerary')}</a>}
          {o.customerPhone && <a href={`tel:${o.customerPhone}`} className={`${BTN} bg-slate-100 text-base`}>{t('order.call')}</a>}
        </div>
      )}

      {!p.finished && (
        <div className="mt-3 space-y-2">
          {o.errorItem?.errorCode === 'OTP_INVALID' && <button className={`${BTN} bg-red-600 text-white`} onClick={p.onFixOtp}>{t('queue.retryOtp')}</button>}
          {act === 'accept' && <button className={`${BTN} bg-blue-600 text-white`} onClick={p.onAccept}>{t('action.accept')}</button>}
          {act === 'start' && <button className={`${BTN} bg-blue-600 text-white`} onClick={p.onStart}>{t('action.start')}</button>}
          {act === 'deliver' && (
            <>
              <button className={`${BTN} bg-green-600 text-white`} onClick={p.onDeliver}>{t('action.deliver')}</button>
              <button className={`${BTN} bg-orange-100 text-orange-900`} onClick={p.onNoShow}>{t('action.noshow')}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function QueueView({ d, t, onFixOtp }: { d: ReturnType<typeof useDriver>; t: T; onFixOtp: (i: QueueItem) => void }) {
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
              <button className={`${BTN} min-h-12 bg-slate-100 text-base`} onClick={() => { if (window.confirm(t('queue.discardConfirm'))) void d.discard(i.id) }}>{t('queue.discard')}</button>
            </div>
          )}
        </Card>
      ))}
    </div>
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

const REASONS = ['noshow.reason.r1', 'noshow.reason.r2', 'noshow.reason.r3', 'noshow.reason.r4', 'noshow.reason.other']

function NoShowSheet({ order, t, maxKB, onClose, onSubmit }: {
  order: ViewOrder; t: T; maxKB: number; onClose: () => void; onSubmit: (v: { reason: string; geo?: Geo; photos: Photo[] }) => Promise<void>
}) {
  const g = useGeoOnOpen()
  const [pick, setPick] = useState<string>('')
  const [free, setFree] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const reason = pick && pick !== 'noshow.reason.other' ? `${t(pick)}${free.trim() ? ` — ${free.trim()}` : ''}` : free.trim()
  const bad = validateAction('noshow', { reason, proofCount: photos.length })
  return (
    <Sheet title={`${t('noshow.title')} · ${order.ref}`} onClose={onClose} t={t}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 font-bold">{t('noshow.reason.label')}</div>
          <div className="grid gap-2">
            {REASONS.map(k => (
              <button key={k} onClick={() => setPick(k)} aria-pressed={pick === k}
                className={`min-h-12 rounded-xl border-2 px-4 text-start text-base font-semibold ${pick === k ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}>{t(k)}</button>
            ))}
          </div>
          <textarea value={free} onChange={e => setFree(e.target.value)} placeholder={t('noshow.reason.placeholder')} rows={2}
            className="mt-2 w-full rounded-xl border-2 border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-none" />
        </div>
        <PhotoPicker photos={photos} setPhotos={setPhotos} maxKB={maxKB} t={t} hint={t('noshow.photo.hint')} />
        <GeoLine g={g} t={t} />
        {bad && <p className="text-sm font-semibold text-amber-700">{t(bad)}</p>}
        <button className={`${BTN} bg-orange-600 text-white`} disabled={!!bad || busy}
          onClick={async () => { setBusy(true); await onSubmit({ reason, geo: g.geo, photos }) }}>{t('noshow.confirm')}</button>
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
