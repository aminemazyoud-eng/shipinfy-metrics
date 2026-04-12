'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  Building2, Users, Plus, Check, X, ChevronDown, ChevronUp,
  Shield, Crown, Eye, UserCog, ToggleLeft, ToggleRight,
  Trash2, BarChart3, Globe, LogOut,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id:           string
  name:         string
  slug:         string
  logoUrl:      string | null
  primaryColor: string
  plan:         string
  active:       boolean
  createdAt:    string
  _count:       { users: number }
}

interface User {
  id:        string
  email:     string
  name:      string | null
  role:      string
  tenantId:  string | null
  active:    boolean
  createdAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  basic:      'bg-gray-100 text-gray-600',
  pro:        'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
}
const PLAN_LABELS: Record<string, string> = {
  basic: 'Basic', pro: 'Pro', enterprise: 'Enterprise',
}
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  ADMIN:       'bg-orange-100 text-orange-700',
  MANAGER:     'bg-blue-100 text-blue-700',
  VIEWER:      'bg-gray-100 text-gray-600',
}
const ROLE_ICONS: Record<string, React.ReactNode> = {
  SUPER_ADMIN: <Crown size={10} />,
  ADMIN:       <Shield size={10} />,
  MANAGER:     <UserCog size={10} />,
  VIEWER:      <Eye size={10} />,
}

// ─── Shared components ────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {ROLE_ICONS[role]}
      {role}
    </span>
  )
}

// ─── Tab: Tenants ─────────────────────────────────────────────────────────────

function TenantRow({ tenant, onToggle, onDelete, tenantMap }: {
  tenant:    Tenant
  onToggle:  (id: string, active: boolean) => void
  onDelete:  (id: string) => void
  tenantMap: Map<string, string>
}) {
  const [expanded, setExpanded]     = useState(false)
  const [users, setUsers]           = useState<User[]>([])
  const [loadingUsers, setLoading]  = useState(false)
  const [showAddUser, setShowAdd]   = useState(false)
  const [addForm, setAddForm]       = useState({ email: '', name: '', role: 'VIEWER', password: '' })
  const [addErr, setAddErr]         = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const loadUsers = useCallback(async () => {
    if (users.length > 0) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}/users`)
      const data = await res.json()
      if (Array.isArray(data)) setUsers(data)
    } finally { setLoading(false) }
  }, [tenant.id, users.length])

  const handleExpand = () => { if (!expanded) loadUsers(); setExpanded(e => !e) }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddLoading(true)
    setAddErr('')
    const res  = await fetch(`/api/admin/tenants/${tenant.id}/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    const data = await res.json()
    if (!res.ok) { setAddErr(data.error ?? 'Erreur'); setAddLoading(false); return }
    setUsers(prev => [...prev, data])
    setShowAdd(false)
    setAddForm({ email: '', name: '', role: 'VIEWER', password: '' })
    setAddLoading(false)
  }

  return (
    <div className={`border-b border-gray-100 last:border-b-0 ${!tenant.active ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: tenant.primaryColor + '22' }}>
          <Building2 size={15} style={{ color: tenant.primaryColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{tenant.name}</p>
          <p className="text-xs text-gray-400 font-mono truncate">{tenant.slug}</p>
        </div>
        <span className={`hidden sm:inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${PLAN_COLORS[tenant.plan] ?? 'bg-gray-100 text-gray-600'}`}>
          {PLAN_LABELS[tenant.plan] ?? tenant.plan}
        </span>
        <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400">
          <Users size={11} />
          <span>{tenant._count.users}</span>
        </div>
        <button onClick={() => onToggle(tenant.id, !tenant.active)} className="text-gray-300 hover:text-blue-600 transition-colors">
          {tenant.active ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} />}
        </button>
        <button onClick={() => onDelete(tenant.id)} className="text-gray-200 hover:text-red-500 transition-colors">
          <Trash2 size={14} />
        </button>
        <button onClick={handleExpand} className="text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Utilisateurs</span>
            <button onClick={() => setShowAdd(v => !v)} className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-700">
              <Plus size={11} /> Ajouter
            </button>
          </div>

          {showAdd && (
            <form onSubmit={handleAddUser} className="bg-white rounded-xl p-3 mb-3 border border-gray-100 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Nom" />
                <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Email *" required />
                <input type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Mot de passe *" required />
                <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <option value="VIEWER">VIEWER</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              {addErr && <p className="text-[10px] text-red-600">{addErr}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500">Annuler</button>
                <button type="submit" disabled={addLoading} className="flex-1 py-1.5 text-xs bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-60">
                  {addLoading ? '…' : 'Créer'}
                </button>
              </div>
            </form>
          )}

          {loadingUsers ? (
            <p className="text-xs text-gray-400 py-2">Chargement…</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 italic">Aucun utilisateur.</p>
          ) : (
            <div className="space-y-1.5">
              {users.map(u => (
                <div key={u.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-blue-700">{(u.name ?? u.email).charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">{u.name ?? '—'}</p>
                    <p className="text-[10px] text-gray-400 truncate">{u.email}</p>
                  </div>
                  <RoleBadge role={u.role} />
                  {u.active ? <Check size={11} className="text-green-500" /> : <X size={11} className="text-red-400" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TenantsTab() {
  const [tenants, setTenants]   = useState<Tenant[]>([])
  const [loading, setLoading]   = useState(true)
  const [showCreate, setCreate] = useState(false)
  const [form, setForm]         = useState({ name: '', slug: '', plan: 'basic', primaryColor: '#2563eb' })
  const [createErr, setCreateErr] = useState('')
  const [creating, setCreating]   = useState(false)
  const tenantMap = new Map(tenants.map(t => [t.id, t.name]))

  useEffect(() => {
    fetch('/api/admin/tenants').then(r => r.json()).then((d: unknown) => {
      if (Array.isArray(d)) setTenants(d)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const autoSlug = (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateErr('')
    const res  = await fetch('/api/admin/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setCreateErr(data.error ?? 'Erreur'); setCreating(false); return }
    setTenants(prev => [{ ...data, _count: { users: 0 } }, ...prev])
    setCreate(false)
    setForm({ name: '', slug: '', plan: 'basic', primaryColor: '#2563eb' })
    setCreating(false)
  }

  const handleToggle = async (id: string, active: boolean) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, active } : t))
    await fetch(`/api/admin/tenants/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce tenant ? Irréversible.')) return
    setTenants(prev => prev.filter(t => t.id !== id))
    await fetch(`/api/admin/tenants/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{tenants.length} client{tenants.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setCreate(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700">
          <Plus size={12} /> Nouveau client
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Nouveau tenant</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Nom *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Ma Société" required />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Slug *</label>
              <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" placeholder="ma-societe" required />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Plan</label>
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                <option value="basic">Basic</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Couleur</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColor} onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                  className="w-8 h-8 rounded border border-gray-200 cursor-pointer" />
                <span className="text-[10px] font-mono text-gray-400">{form.primaryColor}</span>
              </div>
            </div>
          </div>
          {createErr && <p className="text-xs text-red-600">{createErr}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setCreate(false)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500">Annuler</button>
            <button type="submit" disabled={creating} className="flex-1 py-1.5 text-xs bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-60">
              {creating ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Chargement…</div>
        ) : tenants.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 size={32} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Aucun tenant. Créez votre premier client.</p>
          </div>
        ) : tenants.map(t => (
          <TenantRow key={t.id} tenant={t} onToggle={handleToggle} onDelete={handleDelete} tenantMap={tenantMap} />
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Users ───────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]       = useState<User[]>([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [form, setForm]         = useState({ email: '', name: '', role: 'VIEWER', password: '', tenantId: '' })
  const [tenants, setTenants]   = useState<Tenant[]>([])
  const [err, setErr]           = useState('')
  const [adding, setAdding]     = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/users').then(r => r.json()),
      fetch('/api/admin/tenants').then(r => r.json()),
    ]).then(([u, t]) => {
      if (Array.isArray(u)) setUsers(u)
      if (Array.isArray(t)) setTenants(t)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const tenantName = (id: string | null) => tenants.find(t => t.id === id)?.name ?? '—'

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true); setErr('')
    const res  = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setErr(data.error ?? 'Erreur'); setAdding(false); return }
    setUsers(prev => [data, ...prev])
    setShowAdd(false)
    setForm({ email: '', name: '', role: 'VIEWER', password: '', tenantId: '' })
    setAdding(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{users.length} utilisateur{users.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700">
          <Plus size={12} /> Nouvel utilisateur
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Nouvel utilisateur</p>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Nom" />
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Email *" required />
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="Mot de passe *" required />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
              <option value="VIEWER">VIEWER</option><option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option><option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
            <select value={form.tenantId} onChange={e => setForm(f => ({ ...f, tenantId: e.target.value }))}
              className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
              <option value="">Aucun tenant (SUPER_ADMIN global)</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500">Annuler</button>
            <button type="submit" disabled={adding} className="flex-1 py-1.5 text-xs bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-60">
              {adding ? '…' : 'Créer'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Chargement…</div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">Aucun utilisateur.</div>
        ) : users.map(u => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-blue-700">{(u.name ?? u.email).charAt(0).toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{u.name ?? '—'}</p>
              <p className="text-xs text-gray-400 truncate">{u.email}</p>
            </div>
            <div className="hidden sm:block text-xs text-gray-400 truncate max-w-[120px]">{tenantName(u.tenantId)}</div>
            <RoleBadge role={u.role} />
            {u.active ? <Check size={12} className="text-green-500" /> : <X size={12} className="text-red-400" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Stats ───────────────────────────────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState<{
    tenants: number; activeTenants: number; users: number;
    reports: number; planBreakdown: Record<string, number>
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/tenants').then(r => r.json()),
      fetch('/api/admin/users').then(r => r.json()),
      fetch('/api/dashboard/reports').then(r => r.json()),
    ]).then(([tenants, users, reports]) => {
      if (!Array.isArray(tenants)) return
      const planBreakdown: Record<string, number> = {}
      ;(tenants as Tenant[]).forEach(t => { planBreakdown[t.plan] = (planBreakdown[t.plan] ?? 0) + 1 })
      setStats({
        tenants:       tenants.length,
        activeTenants: (tenants as Tenant[]).filter(t => t.active).length,
        users:         Array.isArray(users) ? users.length : 0,
        reports:       Array.isArray(reports) ? reports.length : 0,
        planBreakdown,
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Chargement…</div>
  if (!stats)  return <div className="py-12 text-center text-sm text-gray-400">Erreur de chargement.</div>

  const cards = [
    { label: 'Tenants total',    value: stats.tenants,       color: 'text-gray-800',   bg: 'bg-gray-50',   icon: <Globe size={16} className="text-gray-400" /> },
    { label: 'Tenants actifs',   value: stats.activeTenants, color: 'text-green-700',  bg: 'bg-green-50',  icon: <Check size={16} className="text-green-500" /> },
    { label: 'Utilisateurs',     value: stats.users,         color: 'text-blue-700',   bg: 'bg-blue-50',   icon: <Users size={16} className="text-blue-500" /> },
    { label: 'Rapports importés',value: stats.reports,       color: 'text-purple-700', bg: 'bg-purple-50', icon: <BarChart3 size={16} className="text-purple-500" /> },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl p-4 flex flex-col gap-2`}>
            {c.icon}
            <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Répartition par plan</p>
        <div className="flex gap-3 flex-wrap">
          {Object.entries(stats.planBreakdown).map(([plan, count]) => (
            <div key={plan} className={`px-3 py-2 rounded-xl ${PLAN_COLORS[plan] ?? 'bg-gray-100 text-gray-600'}`}>
              <p className="text-lg font-black">{count}</p>
              <p className="text-[11px] font-medium capitalize">{plan}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Légende des rôles</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { role: 'SUPER_ADMIN', desc: 'Accès total — tous les tenants' },
            { role: 'ADMIN',       desc: 'Tout sauf gestion des tenants' },
            { role: 'MANAGER',     desc: 'Opérations, dispatch, support' },
            { role: 'VIEWER',      desc: 'Lecture seule' },
          ].map(r => (
            <div key={r.role} className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
              <RoleBadge role={r.role} />
              <p className="text-[10px] text-gray-500 mt-1.5">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'tenants' | 'users' | 'stats'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('tenants')

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'tenants', label: 'Tenants',       icon: <Building2 size={14} /> },
    { key: 'users',   label: 'Utilisateurs',  icon: <Users size={14} /> },
    { key: 'stats',   label: 'Stats globales', icon: <BarChart3 size={14} /> },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <Shield size={20} className="text-blue-600" />
            Administration SUPER_ADMIN
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Gestion multi-tenant — clients, utilisateurs, statistiques</p>
        </div>
        <button
          onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/login' })}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-50"
        >
          <LogOut size={13} /> Déconnexion
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'tenants' && <TenantsTab />}
      {tab === 'users'   && <UsersTab />}
      {tab === 'stats'   && <StatsTab />}
    </div>
  )
}
