'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plug, Webhook, RefreshCw, Copy, Trash2, Send, RotateCcw, KeyRound, Thermometer } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface Stats { PENDING: number; OK: number; FAILED: number }
interface Endpoint { id: string; name: string; url: string; events: string; active: boolean; createdAt: string; stats: Stats }
interface Delivery { id: string; endpointId: string; event: string; status: 'PENDING' | 'OK' | 'FAILED'; attempts: number; nextAt: string; lastError: string | null; createdAt: string; deliveredAt: string | null }
interface Data { endpoints: Endpoint[]; deliveries: Delivery[]; events: string[]; cursorAt: string | null; keyConfigured: boolean }

const dt = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
const ST: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-700', OK: 'bg-green-100 text-green-700', FAILED: 'bg-red-100 text-red-700' }

const CURL_POST = `curl -X POST https://metrics.mediflows.shop/api/v1/orders \\
  -H "x-api-key: $SHIPINFY_API_KEY" -H "Content-Type: application/json" \\
  -d '{
    "externalId": "CMD-10042",
    "reference": "WEB-10042",
    "slot": { "label": "09-12", "date": "2026-10-11" },
    "address": "12 rue des Orangers, Maarif",
    "district": "Maarif", "city": "CASABLANCA",
    "lat": 33.5731, "lng": -7.6298,
    "customerName": "Sara B.", "customerPhone": "+212600000000",
    "amount": 349.5,
    "hubCode": "CAS-MM",
    "items": [
      { "sku": "YAO-1L", "label": "Yaourt nature 1 L", "qty": 4, "barcode": "6111000000017", "coldChain": true },
      { "sku": "RIZ-5", "label": "Riz 5 kg", "qty": 1, "coldChain": false }
    ]
  }'`

const RESP_POST = `201 Created   (200 si externalId déjà connu : aucun effet, même corps renvoyé)
{
  "created": true,
  "order": {
    "externalId": "CMD-10042", "reference": "WEB-10042", "status": "READY_PICKUP",
    "slot": { "start": "2026-10-11T07:00:00.000Z", "end": "2026-10-11T10:00:00.000Z", "label": "09-12" },
    "hubCode": "CAS-MM", "driver": null, "events": [ { "status": "READY_PICKUP", "at": "..." } ],
    "items": [ ... ]
  }
}`

const CURL_PUT = `# modifier (champs présents uniquement) — refusé (409) si la commande est livrée / NO_SHOW / annulée
curl -X PUT https://metrics.mediflows.shop/api/v1/orders/CMD-10042 \\
  -H "x-api-key: $SHIPINFY_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "address": "14 rue des Orangers", "slot": { "start": "2026-10-11T10:00:00Z", "end": "2026-10-11T13:00:00Z" } }'

# annuler
curl -X PUT .../api/v1/orders/CMD-10042 -H "x-api-key: $SHIPINFY_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "cancel": true, "cancelReason": "Client injoignable" }'

# relire le statut
curl https://metrics.mediflows.shop/api/v1/orders/CMD-10042 -H "x-api-key: $SHIPINFY_API_KEY"`

const WH_PAYLOAD = `POST <votre URL>
Content-Type: application/json
x-shipinfy-event: order.delivered
x-shipinfy-delivery: <id de livraison — à utiliser pour dédoublonner>
x-shipinfy-timestamp: 1760090000            (secondes)
x-shipinfy-signature: sha256=<hex>           HMAC-SHA256( secret, timestamp + "." + corps brut )

{
  "event": "order.delivered", "orderId": "cl...", "reference": "WEB-10042", "externalId": "CMD-10042",
  "status": "DELIVERED", "at": "2026-10-11T08:41:00.000Z",
  "geo": { "lat": 33.573, "lng": -7.629, "distanceM": 38, "ok": true },
  "reasonCode": null, "reasonLabel": null,
  "cod": { "amount": 349.5, "method": "cash", "collectedAt": "..." },
  "proofUrl": "https://.../api/ops/proofs/<id>",
  "tour": { "id": "cl...", "day": "2026-10-11", "rotation": 1 },
  "driver": { "code": "D07" }
}`

const WH_VERIFY = `// Node.js — vérification côté récepteur
const crypto = require('crypto')
function verify(secret, headers, rawBody) {
  const ts = headers['x-shipinfy-timestamp']
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false          // anti-rejeu : ±5 min
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(headers['x-shipinfy-signature'] || '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
// Répondez 2xx rapidement. Sinon : relances à 1 min, 5 min, 15 min, 1 h, 3 h, 12 h, 24 h (8 tentatives au total) puis statut FAILED.`

const IOT = `curl -X POST https://metrics.mediflows.shop/api/iot/temperature \\
  -H "x-api-key: $SHIPINFY_IOT_KEY" -H "Content-Type: application/json" \\
  -d '{ "readings": [ { "vehicleRef": "12345-A-6", "sensor": "frigo", "celsius": 4.2, "at": "2026-10-11T08:30:00Z", "lat": 33.57, "lng": -7.58 } ] }'
# 202 { "accepted": 1, "duplicates": 0, "rejected": 0 }  — idempotent par (vehicleRef, sensor, at), 500 lectures max
# Variante HMAC par capteur : en-têtes x-sensor-id, x-timestamp, x-signature = HMAC-SHA256(secret du capteur, timestamp + "." + corps)`

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre">{children}</pre>
      <button onClick={() => navigator.clipboard?.writeText(children)} title="Copier" className="absolute top-2 right-2 text-gray-400 hover:text-white"><Copy className="w-3.5 h-3.5" /></button>
    </div>
  )
}

export default function IntegrationsPage() {
  const [tab, setTab] = useState<'api' | 'webhooks' | 'iot'>('api')
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2"><Plug className="w-5 h-5 text-purple-600" /><h1 className="text-xl font-bold text-gray-900">Intégrations</h1></div>
      <OpsNav />
      <div className="flex gap-1 border-b border-gray-200">
        {([['api', 'API entrante'], ['webhooks', 'Webhooks sortants'], ['iot', 'Capteurs de température']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{l}</button>
        ))}
      </div>
      {tab === 'api' && <ApiDocs />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'iot' && <IotDocs />}
    </div>
  )
}

function ApiDocs() {
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-600">Votre système (e-commerce, WMS, back-office) <b>pousse</b> ses commandes dans Shipinfy. Authentification par clé API dans l&apos;en-tête <code className="bg-gray-100 px-1 rounded">x-api-key</code> ; les clés sont configurées côté serveur (variable <code className="bg-gray-100 px-1 rounded">INGEST_API_KEYS</code>, liste « nom:clé » séparée par des virgules, clés de 16 caractères minimum) et comparées par empreinte SHA-256. Limite : 300 requêtes / minute / clé, corps ≤ 256 Ko, 200 lignes d&apos;articles maximum.</p>
      <h2 className="font-semibold text-gray-900">Créer une commande — POST /api/v1/orders</h2>
      <Code>{CURL_POST}</Code>
      <Code>{RESP_POST}</Code>
      <div className="text-sm text-gray-600 space-y-1">
        <p><b>Champs</b> : <code>externalId</code> (obligatoire, unique par source : lettres, chiffres, . _ : -), <code>slot</code> (obligatoire : <code>{'{start,end}'}</code> ISO 8601, ou <code>{'{label:"09-12", date:"AAAA-MM-JJ"}'}</code> en heure du Maroc), <code>amount</code> (montant à encaisser, 0 si prépayé), <code>hubCode</code> (doit exister, sinon 422), <code>items[]</code> : <code>sku</code>, <code>label</code>, <code>qty</code> (entier ≥ 1), <code>barcode</code>, <code>coldChain</code> (true = produit à température dirigée).</p>
        <p><b>Idempotence</b> : rejouer le même <code>externalId</code> ne crée rien et renvoie la commande existante (200). <b>Statut initial</b> : READY_PICKUP ; l&apos;événement est horodaté et alimente le cockpit comme une commande synchronisée.</p>
        <p><b>Codes</b> : 201 créée · 200 déjà connue · 400/413 JSON invalide ou trop gros · 401 clé absente/invalide · 409 commande terminée · 422 validation (liste « details ») · 429 limite · 503 clés non configurées.</p>
      </div>
      <h2 className="font-semibold text-gray-900">Modifier, annuler, relire</h2>
      <Code>{CURL_PUT}</Code>
      <p className="text-sm text-gray-500">Les statuts d&apos;avancement (assignée, en livraison, livrée…) sont pilotés par le dispatch et l&apos;application livreur : l&apos;API entrante ne peut pas les rétrograder. Pour être notifié des changements, utilisez l&apos;onglet « Webhooks sortants ».</p>
    </div>
  )
}

function IotDocs() {
  return (
    <div className="space-y-3 max-w-4xl">
      <p className="text-sm text-gray-600">Récepteur de lectures de température des véhicules (chaîne du froid). Clés : <code className="bg-gray-100 px-1 rounded">IOT_API_KEYS</code> ; ou signature HMAC par capteur dérivée de <code className="bg-gray-100 px-1 rounded">IOT_HMAC_SECRET</code>. Seuils, courbe, ruptures et mode test : page <a href="/operations/froid" className="text-purple-700 underline inline-flex items-center gap-1"><Thermometer className="w-3.5 h-3.5" />Chaîne du froid</a>.</p>
      <Code>{IOT}</Code>
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Aucun capteur réel n&apos;est branché à ce jour : seul le récepteur existe. Pour valider la chaîne complète, injectez des lectures de test depuis la page Chaîne du froid (administrateur).</p>
    </div>
  )
}

function Webhooks() {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null)
  const [form, setForm] = useState({ name: '', url: '', events: '*' })
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/ops/webhooks${filter ? `?status=${filter}` : ''}`)
    if (r.status === 403) { setErr('Réservé aux administrateurs.'); return }
    if (r.ok) setD(await r.json()); else setErr('Chargement impossible')
  }, [filter])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const call = async (key: string, url: string, method: string, body?: unknown) => {
    setBusy(key); setErr(''); setMsg('')
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j.error || 'Erreur'); else await load()
      return r.ok ? j : null
    } finally { setBusy('') }
  }
  const create = async () => {
    const j = await call('create', '/api/ops/webhooks', 'POST', { name: form.name, url: form.url, events: form.events.split(',').map(s => s.trim()).filter(Boolean) })
    if (j?.secret) { setSecret({ name: form.name, value: j.secret }); setForm({ name: '', url: '', events: '*' }) }
  }
  const nameOf = (id: string) => d?.endpoints.find(e => e.id === id)?.name ?? id.slice(0, 6)

  if (err === 'Réservé aux administrateurs.') return <p className="text-sm text-gray-500">{err}</p>
  return (
    <div className="space-y-4">
      {!d?.keyConfigured && d && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">La variable <code>WEBHOOK_SECRET_KEY</code> (≥ 16 caractères) n&apos;est pas définie : impossible de créer un endpoint ni d&apos;envoyer des webhooks. L&apos;hôte de destination doit aussi figurer dans <code>OUTBOUND_ALLOWED_HOSTS</code>.</div>}
      {err && err !== 'Réservé aux administrateurs.' && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{err}</div>}
      {msg && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">{msg}</div>}
      {secret && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4 space-y-2">
          <div className="text-sm font-medium text-green-900 flex items-center gap-2"><KeyRound className="w-4 h-4" />Secret de « {secret.name} » — affiché UNE seule fois</div>
          <div className="flex items-center gap-2"><code className="flex-1 bg-white border border-green-200 rounded px-2 py-1.5 text-xs break-all">{secret.value}</code><button onClick={() => navigator.clipboard?.writeText(secret.value)} className="px-2 py-1.5 text-xs border border-green-300 rounded-lg bg-white">Copier</button></div>
          <button onClick={() => setSecret(null)} className="text-xs text-green-800 underline">J&apos;ai copié le secret</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="font-medium text-gray-900 flex items-center gap-2"><Webhook className="w-4 h-4 text-purple-600" />Nouvel endpoint</div>
        <div className="grid md:grid-cols-4 gap-2">
          <input placeholder="Nom (ex. ERP client)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <input placeholder="https://exemple.com/hooks/shipinfy" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="md:col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <input placeholder="Événements (* ou liste)" value={form.events} onChange={e => setForm({ ...form, events: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div className="text-xs text-gray-500">Événements : {d?.events.join(', ')}. « order.* » = toutes les commandes. Seules les évolutions postérieures à la création sont envoyées.</div>
        <button onClick={create} disabled={busy === 'create' || !form.name || !form.url} className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg disabled:opacity-50">Créer et générer le secret</button>
      </div>

      <div className="space-y-2">
        {d?.endpoints.length === 0 && <div className="text-sm text-gray-500">Aucun endpoint.</div>}
        {d?.endpoints.map(e => (
          <div key={e.id} className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="font-medium text-gray-900">{e.name} {!e.active && <span className="text-xs bg-gray-100 text-gray-500 rounded px-1.5">désactivé</span>}</div>
              <div className="text-xs text-gray-500 break-all">{e.url}</div>
              <div className="text-xs text-gray-400">{e.events}</div>
            </div>
            <div className="flex gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full ${ST.OK}`}>{e.stats.OK} OK</span>
              <span className={`px-2 py-0.5 rounded-full ${ST.PENDING}`}>{e.stats.PENDING} en attente</span>
              <span className={`px-2 py-0.5 rounded-full ${ST.FAILED}`}>{e.stats.FAILED} échec</span>
            </div>
            <div className="flex gap-1">
              <button disabled={busy === 'test' + e.id} onClick={async () => { const j = await call('test' + e.id, `/api/ops/webhooks/${e.id}/test`, 'POST'); if (j) setMsg(j.ok ? 'Ping reçu (HTTP 2xx).' : `Ping non reçu : ${j.delivery?.lastError ?? 'échec'}`) }} className="px-2 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-1"><Send className="w-3 h-3" />Test</button>
              <button onClick={() => call('act', `/api/ops/webhooks/${e.id}`, 'PATCH', { active: !e.active })} className="px-2 py-1 text-xs border border-gray-300 rounded-lg">{e.active ? 'Désactiver' : 'Activer'}</button>
              <button onClick={async () => { if (!confirm('Générer un nouveau secret ? L\'ancien cessera de fonctionner.')) return; const j = await call('rot', `/api/ops/webhooks/${e.id}`, 'PATCH', { rotateSecret: true }); if (j?.secret) setSecret({ name: e.name, value: j.secret }) }} className="px-2 py-1 text-xs border border-gray-300 rounded-lg flex items-center gap-1"><KeyRound className="w-3 h-3" />Secret</button>
              <button onClick={() => { if (confirm(`Supprimer « ${e.name} » et son historique ?`)) call('del', `/api/ops/webhooks/${e.id}`, 'DELETE') }} className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded-lg"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-3 flex items-center gap-3 border-b border-gray-100">
          <div className="font-medium text-gray-900">Livraisons récentes</div>
          <select value={filter} onChange={e => setFilter(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1">
            <option value="">Toutes</option><option value="PENDING">En attente</option><option value="OK">Réussies</option><option value="FAILED">En échec</option>
          </select>
          <button onClick={load} className="ml-auto text-gray-500 hover:text-gray-800"><RefreshCw className="w-4 h-4" /></button>
          {d?.cursorAt && <span className="text-xs text-gray-400">curseur : {dt(d.cursorAt)}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100"><th className="p-2">Créée</th><th className="p-2">Endpoint</th><th className="p-2">Événement</th><th className="p-2">Statut</th><th className="p-2">Essais</th><th className="p-2">Prochain essai</th><th className="p-2">Dernière erreur</th><th className="p-2" /></tr></thead>
            <tbody>
              {d?.deliveries.map(x => (
                <tr key={x.id} className="border-b border-gray-50">
                  <td className="p-2 whitespace-nowrap text-gray-600">{dt(x.createdAt)}</td><td className="p-2">{nameOf(x.endpointId)}</td><td className="p-2 font-mono text-xs">{x.event}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${ST[x.status]}`}>{x.status}</span></td>
                  <td className="p-2">{x.attempts}/8</td><td className="p-2 whitespace-nowrap text-gray-500">{x.status === 'PENDING' ? dt(x.nextAt) : x.deliveredAt ? dt(x.deliveredAt) : '—'}</td>
                  <td className="p-2 text-xs text-red-600 max-w-[240px] truncate" title={x.lastError ?? ''}>{x.lastError ?? ''}</td>
                  <td className="p-2"><button title="Rejouer" disabled={busy === x.id} onClick={() => call(x.id, `/api/ops/webhooks/deliveries/${x.id}`, 'POST')} className="text-gray-500 hover:text-purple-700"><RotateCcw className="w-4 h-4" /></button></td>
                </tr>
              ))}
              {d && d.deliveries.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-400">Aucune livraison.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold text-gray-900">Format et vérification de la signature</h2>
        <Code>{WH_PAYLOAD}</Code>
        <Code>{WH_VERIFY}</Code>
        <p className="text-xs text-gray-500">Le secret est conservé chiffré (AES-256-GCM) car la signature HMAC exige le secret en clair à l&apos;envoi ; il n&apos;est jamais ré-affiché. L&apos;URL de preuve (<code>proofUrl</code>) est protégée par la session Shipinfy : elle sert aux comptes bureau, pas à un téléchargement automatique.</p>
      </div>
    </div>
  )
}
