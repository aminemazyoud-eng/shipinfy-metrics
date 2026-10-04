'use client'
import { useEffect, useState, useCallback } from 'react'
import { Send, Hash as SlackIcon, MessageCircle, Mail, Webhook, CheckCircle2, XCircle, Play, Eye, ArrowRight, Lock } from 'lucide-react'

interface Rule { id: string; event: string; audience: string; channel: string; enabled: boolean; template: string }
interface Channel { key: string; kind: string; label: string; active: boolean; webhook: string | null; configured: boolean }
interface Conn { autoEnabled: boolean; smtp: { provider: string; host: boolean; port: boolean; user: boolean; pass: boolean; from: boolean; resend: boolean }; whatsapp: { provider: string | null; twilio: boolean; meta: boolean }; slackGlobal: boolean; n8nActive: number }
interface State { canEdit: boolean; events: Record<string, { label: string; description: string; vars: string[] }>; audiences: Record<string, { label: string; channel: string; help: string }>; rules: Rule[]; channels: Channel[]; connections: Conn; logs: { id: string; event: string; audience: string; channel: string; recipient: string | null; message: string; ok: boolean; error: string | null; createdAt: string }[] }

const Dot = ({ ok }: { ok: boolean }) => (ok ? <CheckCircle2 className="w-4 h-4 text-green-600 inline" /> : <XCircle className="w-4 h-4 text-red-500 inline" />)

// Paramétrage → Notifications & incidents : événement → audience → canal, avec l'état de chaque connexion et son mode d'emploi.
export default function NotificationsSettingsPage() {
  const [s, setS] = useState<State | null>(null)
  const [hooks, setHooks] = useState<Record<string, string>>({})
  const [tpl, setTpl] = useState<Record<string, string>>({})
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState<{ audience: string; to: string; message: string }[] | null>(null)

  const load = useCallback(async () => { const r = await fetch('/api/ops/notif'); const j = await r.json(); if (r.ok) setS(j); else setMsg(j.error || 'Accès réservé aux managers') }, [])
  useEffect(() => { load() }, [load])
  const post = async (body: Record<string, unknown>) => { const r = await fetch('/api/ops/notif', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); return { ok: r.ok, j } }

  const saveHook = async (key: string) => { const { ok, j } = await post({ action: 'channel', key, webhookUrl: hooks[key] ?? '' }); setMsg(ok ? 'Webhook enregistré.' : j.error); if (ok) { setHooks({ ...hooks, [key]: '' }); load() } }
  const toggleRule = async (r: Rule) => { await post({ action: 'rule', id: r.id, enabled: !r.enabled }); load() }
  const saveTpl = async (r: Rule) => { const { ok } = await post({ action: 'rule', id: r.id, template: tpl[r.id] }); setMsg(ok ? 'Message enregistré.' : 'Échec'); if (ok) { setTpl(t => { const n = { ...t }; delete n[r.id]; return n }); load() } }
  const test = async (r: Rule) => { const { j } = await post({ action: 'test', id: r.id, to: phone }); setMsg(j.ok ? `Essai envoyé : « ${j.message} »` : `Essai non envoyé : ${j.error}`) }
  const run = async (dryRun: boolean) => { setMsg('Exécution…'); const { j } = await post({ action: 'run', dryRun }); if (dryRun) { setPreview(j.preview ?? []); setMsg(`Aperçu : ${j.preview?.length ?? 0} message(s) seraient envoyés maintenant.`) } else { setPreview(null); setMsg(`${j.sent} envoyé(s), ${j.failed} échec(s), ${j.skipped} ignoré(s) (déjà envoyés ou sans destinataire).`); load() } }

  if (!s) return <div className="p-6 text-sm text-gray-500">{msg || 'Chargement…'}</div>
  const c = s.connections
  const slackChannels = s.channels.filter(x => x.kind === 'slack')
  const smtpOk = c.smtp.resend || (c.smtp.host && c.smtp.user && c.smtp.pass)
  const waOk = (c.whatsapp.provider === 'twilio' && c.whatsapp.twilio) || (c.whatsapp.provider === 'meta' && c.whatsapp.meta)
  const byEvent = Object.keys(s.events).map(e => ({ e, rules: s.rules.filter(r => r.event === e) }))

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Send className="w-5 h-5 text-purple-600" />Notifications & incidents</h1>
        <p className="text-sm text-gray-500">Qui est prévenu, de quoi, et comment — pour gérer les incidents terrain.</p>
      </div>
      {msg && <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">{msg}</div>}

      {/* Schéma */}
      <div className="grid md:grid-cols-3 gap-3 items-stretch">
        {[['1. Événement', 'Que s’est-il passé ?', 'Créneau à risque, retard, NO_SHOW, commandes non assignées, saturation prévue, document à renouveler'],
          ['2. Audience', 'Qui prévenir ?', 'Équipes (Dispatch, Managers, RH) · terrain : chauffeur et helper concernés'],
          ['3. Canal', 'Comment ?', 'Slack pour les équipes (un webhook par équipe) · WhatsApp pour le terrain (numéro de la fiche)']].map(([t, q, d], i) => (
          <div key={t} className="relative bg-white border border-gray-200 rounded-xl p-4"><div className="font-semibold text-gray-900">{t}</div><div className="text-sm text-purple-700">{q}</div><div className="text-xs text-gray-500 mt-1">{d}</div>
            {i < 2 && <ArrowRight className="hidden md:block absolute -right-3.5 top-1/2 w-5 h-5 text-gray-300" />}</div>
        ))}
      </div>

      {/* Connexions */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between"><div className="font-semibold text-gray-900">Connexions</div>{!s.canEdit && <span className="text-xs text-gray-400 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />lecture seule — administrateur requis</span>}</div>

        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><SlackIcon className="w-4 h-4" />Slack — équipes <Dot ok={slackChannels.some(x => x.configured) || c.slackGlobal} /></div>
          <ol className="text-xs text-gray-500 list-decimal ml-5 mt-1 space-y-0.5"><li>Dans Slack : api.slack.com/apps → créer une app → <b>Incoming Webhooks</b> → activer.</li><li>« Add New Webhook to Workspace », choisir le canal de l&apos;équipe (ex. #dispatch), copier l&apos;URL <code>https://hooks.slack.com/services/…</code></li><li>La coller ci-dessous pour l&apos;équipe concernée (un webhook = un canal). Sans webhook d&apos;équipe, le webhook global historique est utilisé{c.slackGlobal ? ' (actif)' : ' (aucun)'}.</li></ol>
          <div className="mt-2 space-y-2">
            {slackChannels.map(ch => (
              <div key={ch.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-44 text-gray-700">{ch.label.replace('Slack — ', '')}</span><Dot ok={ch.configured} /><span className="text-xs text-gray-400 w-24">{ch.webhook ?? 'non configuré'}</span>
                {s.canEdit && <><input value={hooks[ch.key] ?? ''} onChange={e => setHooks({ ...hooks, [ch.key]: e.target.value })} placeholder="https://hooks.slack.com/services/…" className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" /><button onClick={() => saveHook(ch.key)} disabled={!hooks[ch.key]} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40">Enregistrer</button></>}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><MessageCircle className="w-4 h-4" />WhatsApp — chauffeurs, helpers, livreurs <Dot ok={!!waOk} /></div>
          <p className="text-xs text-gray-500 mt-1">Fournisseur : <b>{c.whatsapp.provider ?? 'non configuré'}</b>. Les messages partent au numéro saisi sur la fiche (RH → Onboarding), au format international (+2126…). À définir dans les <b>variables d&apos;environnement</b> du serveur (Dokploy → Environment) :</p>
          <div className="text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg p-2.5 mt-1.5 text-gray-600">WHATSAPP_PROVIDER=twilio <span className="text-gray-400">(ou meta)</span><br />Twilio : TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_WHATSAPP_FROM <Dot ok={c.whatsapp.twilio} /><br />Meta : META_WHATSAPP_PHONE_ID · META_WHATSAPP_TOKEN <Dot ok={c.whatsapp.meta} /></div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><Mail className="w-4 h-4" />Email (rapports planifiés) <Dot ok={!!smtpOk} /></div>
          <p className="text-xs text-gray-500 mt-1">Erreur « Missing credentials for PLAIN » = identifiants SMTP absents. Variables à définir dans Dokploy → Environment :</p>
          <div className="text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg p-2.5 mt-1.5 text-gray-600">SMTP_HOST <Dot ok={c.smtp.host} /> · SMTP_PORT <Dot ok={c.smtp.port} /> · SMTP_USER <Dot ok={c.smtp.user} /> · SMTP_PASS <Dot ok={c.smtp.pass} /> · SMTP_FROM <Dot ok={c.smtp.from} /><br />ou, plus simple : RESEND_API_KEY <Dot ok={c.smtp.resend} /></div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><Webhook className="w-4 h-4" />Automatisations N8N <Dot ok={c.n8nActive > 0} /></div>
          <p className="text-xs text-gray-500 mt-1">{c.n8nActive} webhook(s) actif(s). Le champ « Webhook URL » doit contenir l&apos;adresse du nœud Webhook de votre workflow n8n (ex. <code>https://votre-n8n/webhook/xxxx</code>) — pas une adresse e-mail. Optionnel : les notifications ci-dessous fonctionnent sans n8n. Gestion : Paramètres généraux.</p>
        </div>
      </div>

      {/* Règles */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="font-semibold text-gray-900">Règles : événement → audience → canal</div>
          <label className="text-xs text-gray-500 flex items-center gap-2">Numéro WhatsApp pour les essais<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+2126…" className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-36" /></label>
        </div>
        <div className="space-y-4">
          {byEvent.map(({ e, rules }) => (
            <div key={e} className="border border-gray-100 rounded-lg">
              <div className="px-3 py-2 bg-gray-50 rounded-t-lg"><div className="text-sm font-medium text-gray-900">{s.events[e].label}</div><div className="text-xs text-gray-500">{s.events[e].description}</div></div>
              {rules.map(r => {
                const a = s.audiences[r.audience]
                return (
                  <div key={r.id} className="px-3 py-2.5 border-t border-gray-100 flex flex-wrap items-start gap-3">
                    <label className="flex items-center gap-2 w-56 text-sm"><input type="checkbox" checked={r.enabled} disabled={!s.canEdit} onChange={() => toggleRule(r)} /><span className={r.enabled ? 'text-gray-900' : 'text-gray-400'}>{a?.label ?? r.audience}</span><span className="text-[10px] px-1.5 rounded bg-gray-100 text-gray-500">{r.channel}</span></label>
                    <div className="flex-1 min-w-[260px]">
                      <textarea rows={2} disabled={!s.canEdit} value={tpl[r.id] ?? r.template} onChange={ev => setTpl({ ...tpl, [r.id]: ev.target.value })} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs disabled:bg-gray-50" />
                      <div className="text-[10px] text-gray-400">Variables : {s.events[e].vars.map(v => `{${v}}`).join(' ')}</div>
                    </div>
                    {s.canEdit && <div className="flex flex-col gap-1">{tpl[r.id] !== undefined && tpl[r.id] !== r.template && <button onClick={() => saveTpl(r)} className="text-xs px-2.5 py-1 rounded-lg bg-purple-600 text-white">Enregistrer</button>}<button onClick={() => test(r)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300">Envoyer un essai</button></div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Exécution */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="font-semibold text-gray-900">Exécution</div>
        <p className="text-xs text-gray-500 mt-1">Contrôle automatique toutes les 5 minutes : <b>{c.autoEnabled ? 'ACTIVÉ' : 'désactivé'}</b> {c.autoEnabled ? '' : '(variable serveur OPS_ALERTS_ENABLED=true à définir dans Dokploy pour l’activer)'}. Chaque alerte n’est envoyée qu’une fois par période (anti-doublon).</p>
        {s.canEdit && <div className="flex gap-2 mt-3"><button onClick={() => run(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300"><Eye className="w-4 h-4" />Aperçu (sans envoyer)</button><button onClick={() => run(false)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white"><Play className="w-4 h-4" />Exécuter maintenant</button></div>}
        {preview && <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">{preview.map((p, i) => <div key={i} className="text-xs border border-gray-100 rounded-lg px-2.5 py-1.5"><span className="text-purple-700 font-medium">{p.audience}</span> → {p.to}<div className="text-gray-600">{p.message}</div></div>)}{!preview.length && <div className="text-xs text-gray-400">Rien à envoyer pour l’instant.</div>}</div>}
      </div>

      {/* Journal */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-3 text-sm font-medium text-gray-800 border-b border-gray-100">Derniers envois</div>
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
          {s.logs.map(l => <div key={l.id} className="px-3 py-2 text-xs flex gap-3"><Dot ok={l.ok} /><span className="text-gray-400 w-28 shrink-0">{new Date(l.createdAt).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="font-mono text-purple-700 w-28 shrink-0">{l.event}</span><span className="text-gray-600 truncate">{l.audience} → {l.recipient} · {l.message}{l.error ? ` — ${l.error}` : ''}</span></div>)}
          {!s.logs.length && <div className="p-4 text-sm text-gray-400">Aucun envoi pour l’instant</div>}
        </div>
      </div>
    </div>
  )
}
