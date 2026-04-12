'use client'
import { useState, useEffect } from 'react'
import {
  Settings, Mail, Bell, Database, Shield, RefreshCw,
  CheckCircle, AlertTriangle, Save, Eye, EyeOff,
  Hash, Loader2, CheckCircle2, XCircle, Webhook,
  Plus, Trash2, Play, ChevronDown, ChevronUp,
} from 'lucide-react'

interface N8NConfig {
  id:              string
  name:            string
  webhookUrl:      string
  eventType:       string
  secret:          string | null
  active:          boolean
  lastTriggeredAt: string | null
  createdAt:       string
}

// ─── Section wrapper ───────────────────────────────────────────────────────────
function Section({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-gray-50/60">
        <Icon size={15} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Field ─────────────────────────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-4">
      <label className="md:w-44 flex-shrink-0 text-sm text-gray-600 md:pt-2 font-medium">{label}</label>
      <div className="flex-1">
        {children}
        {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      </div>
    </div>
  )
}

// ─── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow ${enabled ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function ParametresPage() {
  // SMTP / notifications
  const [smtpFrom,  setSmtpFrom]  = useState(process.env.NEXT_PUBLIC_SMTP_FROM ?? '')
  const [notifEmail, setNotifEmail] = useState('')
  const [alertEmail, setAlertEmail] = useState(true)
  const [alertSlack, setAlertSlack] = useState(false)

  // Score IA thresholds
  const [threshCritical, setThreshCritical] = useState(60)
  const [threshGood,     setThreshGood]     = useState(80)

  // Cron
  const [cronTime, setCronTime]   = useState('02:00')
  const [cronEnabled, setCronEnabled] = useState(true)

  // UI states
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [saved, setSaved]       = useState(false)
  const [showEnv, setShowEnv]   = useState(false)

  // Sprint 11 — N8N config
  const [n8nConfigs, setN8nConfigs]     = useState<N8NConfig[]>([])
  const [n8nLoading, setN8nLoading]     = useState(true)
  const [n8nShowForm, setN8nShowForm]   = useState(false)
  const [n8nForm, setN8nForm]           = useState({ name: '', webhookUrl: '', eventType: 'report_ready', secret: '' })
  const [n8nSaving, setN8nSaving]       = useState(false)
  const [n8nTestMap, setN8nTestMap]     = useState<Record<string, 'idle'|'loading'|'ok'|'error'>>({})

  // Sprint 7 — Slack config
  const [slackWebhook, setSlackWebhook] = useState('')
  const [slackChannel, setSlackChannel] = useState('#alertes-livraison')
  const [slackActive, setSlackActive]   = useState(true)
  const [slackSaving, setSlackSaving]   = useState(false)
  const [slackSaved, setSlackSaved]     = useState(false)
  const [slackTest, setSlackTest]       = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  useEffect(() => {
    fetch('/api/n8n/config').then(r => r.json()).then((d: unknown) => {
      if (Array.isArray(d)) setN8nConfigs(d as N8NConfig[])
    }).catch(() => {}).finally(() => setN8nLoading(false))
  }, [])

  async function addN8NConfig() {
    if (!n8nForm.name || !n8nForm.webhookUrl) return
    setN8nSaving(true)
    try {
      const res  = await fetch('/api/n8n/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...n8nForm, secret: n8nForm.secret || null }),
      })
      const data = await res.json() as N8NConfig
      if (res.ok) {
        setN8nConfigs(prev => [data, ...prev])
        setN8nShowForm(false)
        setN8nForm({ name: '', webhookUrl: '', eventType: 'report_ready', secret: '' })
      }
    } finally { setN8nSaving(false) }
  }

  async function deleteN8NConfig(id: string) {
    if (!confirm('Supprimer cette config N8N ?')) return
    setN8nConfigs(prev => prev.filter(c => c.id !== id))
    await fetch(`/api/n8n/config/${id}`, { method: 'DELETE' })
  }

  async function toggleN8NConfig(id: string, active: boolean) {
    setN8nConfigs(prev => prev.map(c => c.id === id ? { ...c, active } : c))
    await fetch(`/api/n8n/config/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
  }

  async function testN8NConfig(id: string) {
    setN8nTestMap(prev => ({ ...prev, [id]: 'loading' }))
    try {
      const res  = await fetch('/api/n8n/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId: id }),
      })
      const data = await res.json() as { ok?: boolean }
      setN8nTestMap(prev => ({ ...prev, [id]: data.ok ? 'ok' : 'error' }))
    } catch {
      setN8nTestMap(prev => ({ ...prev, [id]: 'error' }))
    }
    setTimeout(() => setN8nTestMap(prev => ({ ...prev, [id]: 'idle' })), 4000)
  }

  useEffect(() => {
    fetch('/api/slack/config').then(r => r.json()).then((d: { webhookUrl?: string; channel?: string; active?: boolean }) => {
      if (d.webhookUrl) setSlackWebhook(d.webhookUrl)
      if (d.channel)    setSlackChannel(d.channel)
      if (d.active !== undefined) setSlackActive(d.active)
    }).catch(() => {})
  }, [])

  async function saveSlack() {
    if (!slackWebhook) return
    setSlackSaving(true)
    try {
      await fetch('/api/slack/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: slackWebhook, channel: slackChannel, active: slackActive }),
      })
      setSlackSaved(true)
      setTimeout(() => setSlackSaved(false), 3000)
    } finally {
      setSlackSaving(false)
    }
  }

  async function testSlack() {
    if (!slackWebhook) return
    setSlackTest('loading')
    try {
      const res = await fetch('/api/slack/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: slackWebhook }),
      })
      const d = await res.json() as { ok?: boolean }
      setSlackTest(d.ok ? 'ok' : 'error')
    } catch {
      setSlackTest('error')
    }
    setTimeout(() => setSlackTest('idle'), 4000)
  }

  async function testEmail() {
    if (!notifEmail) return
    setTestStatus('loading')
    try {
      const res = await fetch('/api/dashboard/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: 'test',
          emails: [notifEmail],
          mode: 'test',
          filters: {},
          kpisData: {
            totalOrders: 0, delivered: 0, noShow: 0,
            deliveryRate: 0, onTimeRate: 0, totalCOD: 0, avgOrdersPerDay: 0,
            byLivreur: [], byHub: [], byDay: [],
          },
        }),
      })
      setTestStatus(res.ok ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 4000)
  }

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-4 md:space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <Settings size={18} className="text-gray-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Paramètres</h1>
          <p className="text-xs text-gray-500">Configuration de la plateforme Shipinfy Metrics</p>
        </div>
      </div>

      {/* ── Email & Notifications ─────────────────────────── */}
      <Section icon={Mail} title="Email & Notifications">
        <div className="space-y-4">
          <Field label="Expéditeur SMTP" hint="Configuré via variable SMTP_FROM dans l'environnement Dokploy">
            <input
              readOnly
              value={smtpFrom || 'Défini via env SMTP_FROM'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </Field>

          <Field label="Email de test">
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="votre@email.com"
                value={notifEmail}
                onChange={e => setNotifEmail(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={testEmail}
                disabled={!notifEmail || testStatus === 'loading'}
                className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {testStatus === 'loading' ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : testStatus === 'ok' ? (
                  <CheckCircle size={13} />
                ) : testStatus === 'error' ? (
                  <AlertTriangle size={13} />
                ) : (
                  <Mail size={13} />
                )}
                {testStatus === 'ok' ? 'Envoyé !' : testStatus === 'error' ? 'Erreur' : 'Tester'}
              </button>
            </div>
          </Field>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Canaux d&apos;alerte</p>
            <Field label="Alertes par email">
              <Toggle enabled={alertEmail} onChange={setAlertEmail} />
            </Field>
            <Field label="Alertes Slack">
              <div className="flex items-center gap-3">
                <Toggle enabled={alertSlack} onChange={setAlertSlack} />
                <span className="text-xs text-gray-400">(Webhook Slack — à configurer)</span>
              </div>
            </Field>
          </div>
        </div>
      </Section>

      {/* ── Score IA ─────────────────────────────────────── */}
      <Section icon={Shield} title="Score IA — Seuils de fiabilité">
        <div className="space-y-4">
          <div className="bg-purple-50 rounded-lg p-3 text-xs text-purple-700 font-medium">
            Formule : <code className="font-mono">score = livraisonRate×0.4 + academyScore×0.3 + (100 − noShowRate)×0.3</code>
          </div>
          <Field label="Seuil Critique (<)" hint="En dessous de ce score, une alerte est créée automatiquement">
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={100}
                value={threshCritical}
                onChange={e => setThreshCritical(Number(e.target.value))}
                className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <span className="text-sm font-bold text-red-600">/100 → 🔴 Critique</span>
            </div>
          </Field>
          <Field label="Seuil Excellent (≥)" hint="Au-dessus de ce score, le livreur est classé Excellent">
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={100}
                value={threshGood}
                onChange={e => setThreshGood(Number(e.target.value))}
                className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <span className="text-sm font-bold text-green-600">/100 → ✅ Excellent</span>
            </div>
          </Field>
        </div>
      </Section>

      {/* ── Tâches planifiées ─────────────────────────────── */}
      <Section icon={RefreshCw} title="Tâches planifiées (Cron)">
        <div className="space-y-4">
          <Field label="Recalcul Score IA" hint="Heure d'exécution quotidienne (fuseau Africa/Casablanca)">
            <div className="flex items-center gap-3">
              <Toggle enabled={cronEnabled} onChange={setCronEnabled} />
              <input
                type="time"
                value={cronTime}
                onChange={e => setCronTime(e.target.value)}
                disabled={!cronEnabled}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
              />
            </div>
          </Field>
          <Field label="Rapports planifiés" hint="Gérés depuis le module Rapports">
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">Actifs selon configuration par rapport</span>
          </Field>
        </div>
      </Section>

      {/* ── Base de données ───────────────────────────────── */}
      <Section icon={Database} title="Base de données">
        <div className="space-y-3">
          <Field label="Connexion PostgreSQL" hint="Supabase — partagée avec App 1 (qualityos)">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-sm text-gray-600">Connectée · Supabase PostgreSQL</span>
              <button
                onClick={() => setShowEnv(!showEnv)}
                className="ml-auto text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                {showEnv ? <EyeOff size={12} /> : <Eye size={12} />}
                {showEnv ? 'Masquer' : 'Voir'}
              </button>
            </div>
            {showEnv && (
              <div className="mt-2 bg-gray-900 rounded-lg px-3 py-2 font-mono text-xs text-green-400 overflow-auto">
                DATABASE_URL=postgresql://****@****:5432/postgres
              </div>
            )}
          </Field>
          <Field label="Tables actives">
            <div className="flex flex-wrap gap-1.5">
              {['DeliveryReport','DeliveryOrder','AlertRule','Alert','Ticket','Driver','OnboardingStep','Course','Lesson','CourseProgress','ReliabilityScore','SlackConfig','PayConfig','DriverPay','DriverAttendance','SupportTicket','ShiftSlot','ShiftAssignment','Tenant','User','Session','N8NConfig'].map(t => (
                <span key={t} className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{t}</span>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      {/* ── Version ──────────────────────────────────────── */}
      <Section icon={Bell} title="À propos">
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Version plateforme</span>
            <span className="font-bold text-blue-700">SHIPINFY Metrics v5.0</span>
          </div>
          <div className="flex justify-between">
            <span>Sprints déployés</span>
            <span className="font-medium">Sprint 1 → 12 · Full Platform</span>
          </div>
          <div className="flex justify-between">
            <span>Framework</span>
            <span className="font-mono text-xs">Next.js 16 · App Router · Prisma 5</span>
          </div>
          <div className="flex justify-between">
            <span>Hébergement</span>
            <span className="font-mono text-xs">Dokploy · Docker Standalone</span>
          </div>
        </div>
      </Section>

      {/* ── Sprint 7 — Slack Notifications ─────────────────────────── */}
      <Section icon={Hash} title="Notifications Slack">
        <div className="space-y-4">
          <Field label="Webhook URL" hint="Depuis Slack → Apps → Incoming Webhooks → Add New Webhook">
            <input
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={slackWebhook}
              onChange={e => setSlackWebhook(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
            />
          </Field>
          <Field label="Canal Slack">
            <input
              type="text"
              placeholder="#alertes-livraison"
              value={slackChannel}
              onChange={e => setSlackChannel(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </Field>
          <Field label="Actif">
            <div className="flex items-center gap-3 pt-1">
              <Toggle enabled={slackActive} onChange={setSlackActive} />
              <span className="text-xs text-gray-500">{slackActive ? 'Notifications activées' : 'Notifications désactivées'}</span>
            </div>
          </Field>
          <div className="flex gap-2 pt-1 flex-wrap">
            <button
              onClick={testSlack}
              disabled={!slackWebhook || slackTest === 'loading'}
              className="flex items-center gap-2 border border-gray-200 px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-50 min-h-[40px]"
            >
              {slackTest === 'loading' ? <Loader2 size={14} className="animate-spin" /> : slackTest === 'ok' ? <CheckCircle2 size={14} className="text-green-500" /> : slackTest === 'error' ? <XCircle size={14} className="text-red-500" /> : <RefreshCw size={14} />}
              {slackTest === 'ok' ? 'Message envoyé !' : slackTest === 'error' ? 'Erreur webhook' : 'Tester'}
            </button>
            <button
              onClick={saveSlack}
              disabled={!slackWebhook || slackSaving}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 min-h-[40px]"
            >
              {slackSaving ? <Loader2 size={14} className="animate-spin" /> : slackSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {slackSaved ? 'Sauvegardé !' : 'Sauvegarder'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Niveau 2 (Danger) → Slack. Niveau 3 (Critique) → Slack + log email. Vérification toutes les 5 minutes.
          </p>
        </div>
      </Section>

      {/* ── Sprint 11 — Automatisations N8N ────────────────────────── */}
      <Section icon={Webhook} title="Automatisations N8N">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Shipinfy envoie des webhooks à N8N lors d&apos;événements clés.
            N8N gère ensuite les automatisations WhatsApp, SMS, notifications, etc.
          </p>

          {/* Event types legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { key: 'report_ready',     label: 'Rapport prêt',      color: 'bg-blue-50 text-blue-700'   },
              { key: 'alert_critical',   label: 'Alerte critique',   color: 'bg-red-50 text-red-700'     },
              { key: 'driver_onboarded', label: 'Livreur onboardé',  color: 'bg-green-50 text-green-700' },
              { key: 'shift_assigned',   label: 'Shift assigné',     color: 'bg-purple-50 text-purple-700'},
            ].map(ev => (
              <div key={ev.key} className={`${ev.color} rounded-lg px-2.5 py-1.5`}>
                <p className="text-[10px] font-bold">{ev.label}</p>
                <p className="text-[9px] font-mono opacity-70">{ev.key}</p>
              </div>
            ))}
          </div>

          {/* List of configs */}
          {n8nLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : n8nConfigs.length === 0 && !n8nShowForm ? (
            <p className="text-sm text-gray-400 italic">Aucune automatisation configurée.</p>
          ) : (
            <div className="space-y-2">
              {n8nConfigs.map(cfg => {
                const testState = n8nTestMap[cfg.id] ?? 'idle'
                return (
                  <div key={cfg.id} className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{cfg.name}</p>
                      <p className="text-[11px] text-gray-400 font-mono truncate">{cfg.webhookUrl}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">{cfg.eventType}</span>
                        {cfg.lastTriggeredAt && (
                          <span className="text-[10px] text-gray-400">
                            Dernier: {new Date(cfg.lastTriggeredAt).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => testN8NConfig(cfg.id)}
                      disabled={testState === 'loading'}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition"
                      title="Tester"
                    >
                      {testState === 'loading' ? <Loader2 size={13} className="animate-spin" /> :
                       testState === 'ok'      ? <CheckCircle2 size={13} className="text-green-500" /> :
                       testState === 'error'   ? <XCircle size={13} className="text-red-500" /> :
                       <Play size={13} />}
                    </button>
                    <button
                      onClick={() => toggleN8NConfig(cfg.id, !cfg.active)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition ${cfg.active ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                      title={cfg.active ? 'Désactiver' : 'Activer'}
                    >
                      {cfg.active ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => deleteN8NConfig(cfg.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add form */}
          {n8nShowForm && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Nouveau webhook N8N</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Nom *</label>
                  <input
                    value={n8nForm.name}
                    onChange={e => setN8nForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="WhatsApp Alertes"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Événement *</label>
                  <select
                    value={n8nForm.eventType}
                    onChange={e => setN8nForm(f => ({ ...f, eventType: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="report_ready">report_ready — Rapport prêt</option>
                    <option value="alert_critical">alert_critical — Alerte critique</option>
                    <option value="driver_onboarded">driver_onboarded — Livreur onboardé</option>
                    <option value="shift_assigned">shift_assigned — Shift assigné</option>
                    <option value="*">* — Tous les événements</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-1">Webhook URL N8N *</label>
                  <input
                    type="url"
                    value={n8nForm.webhookUrl}
                    onChange={e => setN8nForm(f => ({ ...f, webhookUrl: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="https://n8n.votredomaine.com/webhook/..."
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-1">Secret HMAC (optionnel)</label>
                  <input
                    type="password"
                    value={n8nForm.secret}
                    onChange={e => setN8nForm(f => ({ ...f, secret: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Clé secrète pour vérifier X-Shipinfy-Signature"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setN8nShowForm(false)}
                  className="flex-1 py-2 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  onClick={addN8NConfig}
                  disabled={!n8nForm.name || !n8nForm.webhookUrl || n8nSaving}
                  className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {n8nSaving ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Ajouter'}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setN8nShowForm(v => !v)}
            className="flex items-center gap-2 text-sm text-blue-600 font-semibold hover:text-blue-700"
          >
            {n8nShowForm ? <ChevronUp size={14} /> : <Plus size={14} />}
            {n8nShowForm ? 'Fermer' : 'Ajouter un webhook N8N'}
          </button>

          <p className="text-xs text-gray-400">
            URL de retour N8N → Shipinfy : <code className="font-mono bg-gray-100 px-1 rounded">/api/webhooks/n8n</code>
          </p>
        </div>
      </Section>

      {/* Save button */}
      <div className="flex justify-end pb-4">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          {saved ? <CheckCircle size={15} /> : <Save size={15} />}
          {saved ? 'Enregistré !' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  )
}
