'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, LogIn, Shield } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm]       = useState({ email: '', password: '' })
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: form.email, password: form.password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Identifiants invalides')
        setLoading(false)
        return
      }
      // Redirect based on role
      if (data.user?.role === 'SUPER_ADMIN') {
        router.push('/admin')
      } else {
        router.push('/')
      }
    } catch {
      setError('Erreur réseau — réessayez')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 relative mb-3">
            <Image src="/logo.png" alt="Shipinfy" width={56} height={56} className="object-contain" />
          </div>
          <h1 className="text-2xl font-black text-blue-700 tracking-tight">SHIPINFY</h1>
          <p className="text-sm text-gray-400 mt-0.5">Metrics & Analytics</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          <h2 className="text-base font-bold text-gray-800 mb-5 flex items-center gap-2">
            <LogIn size={16} className="text-blue-600" />
            Connexion
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="admin@shipinfy.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 active:scale-[0.98] transition-transform duration-100 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>

        {/* Bootstrap hint */}
        <p className="text-center text-xs text-gray-400 mt-4">
          Première connexion ? Créez le Super Admin via{' '}
          <code className="bg-gray-100 px-1 rounded">/api/auth/bootstrap</code>
        </p>

        <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-gray-300">
          <Shield size={11} />
          <span>SHIPINFY Metrics — Accès sécurisé</span>
        </div>
      </div>
    </div>
  )
}
