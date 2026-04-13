'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, LogIn, Shield, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resetToken = searchParams.get('reset')

  const [form, setForm]       = useState({ email: '', password: '' })
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Forgot password state
  const [showForgot, setShowForgot]   = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent]   = useState(false)

  // Reset password state
  const [newPassword, setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPw, setShowNewPw]         = useState(false)
  const [resetLoading, setResetLoading]   = useState(false)
  const [resetDone, setResetDone]         = useState(false)
  const [resetError, setResetError]       = useState('')

  // If reset token in URL, show reset form
  const isResetMode = !!resetToken && !resetDone

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

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotEmail) return
    setForgotLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })
      setForgotSent(true)
    } finally { setForgotLoading(false) }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError('')
    if (newPassword.length < 6) { setResetError('Le mot de passe doit contenir au moins 6 caractères'); return }
    if (newPassword !== confirmPassword) { setResetError('Les mots de passe ne correspondent pas'); return }
    setResetLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setResetError(data.error ?? 'Erreur lors de la réinitialisation'); return }
      setResetDone(true)
    } finally { setResetLoading(false) }
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

        {/* ─── Reset password done ─── */}
        {resetDone && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 text-center">
            <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />
            <h2 className="text-base font-bold text-gray-800 mb-2">Mot de passe modifié !</h2>
            <p className="text-sm text-gray-500 mb-4">Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</p>
            <button
              onClick={() => router.push('/login')}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition"
            >
              Se connecter
            </button>
          </div>
        )}

        {/* ─── Reset password form ─── */}
        {isResetMode && !resetDone && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <h2 className="text-base font-bold text-gray-800 mb-5 flex items-center gap-2">
              <KeyRound size={16} className="text-blue-600" />
              Nouveau mot de passe
            </h2>
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nouveau mot de passe</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Minimum 6 caractères"
                    required
                    minLength={6}
                  />
                  <button type="button" onClick={() => setShowNewPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Répéter le mot de passe"
                  required
                />
              </div>
              {resetError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">{resetError}</div>
              )}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition"
              >
                {resetLoading ? 'Réinitialisation…' : 'Réinitialiser le mot de passe'}
              </button>
            </form>
          </div>
        )}

        {/* ─── Forgot password form ─── */}
        {!isResetMode && !resetDone && showForgot && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <button onClick={() => { setShowForgot(false); setForgotSent(false) }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-4">
              <ArrowLeft size={12} /> Retour
            </button>
            <h2 className="text-base font-bold text-gray-800 mb-5 flex items-center gap-2">
              <KeyRound size={16} className="text-blue-600" />
              Mot de passe oublié
            </h2>
            {forgotSent ? (
              <div className="text-center py-4">
                <CheckCircle2 size={36} className="text-green-500 mx-auto mb-3" />
                <p className="text-sm text-gray-600">
                  Si cet email existe, vous recevrez un lien de réinitialisation dans quelques minutes.
                </p>
                <button
                  onClick={() => { setShowForgot(false); setForgotSent(false) }}
                  className="mt-4 text-xs text-blue-600 hover:underline"
                >
                  Retour à la connexion
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Adresse email</label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="votre@email.com"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition"
                >
                  {forgotLoading ? 'Envoi…' : 'Envoyer le lien de réinitialisation'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ─── Login form ─── */}
        {!isResetMode && !resetDone && !showForgot && (
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

            {/* Forgot password link */}
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
              >
                Mot de passe oublié ?
              </button>
            </div>
          </div>
        )}

        {/* Bootstrap hint */}
        {!isResetMode && !resetDone && !showForgot && (
          <p className="text-center text-xs text-gray-400 mt-4">
            Première connexion ? Créez le Super Admin via{' '}
            <code className="bg-gray-100 px-1 rounded">/api/auth/bootstrap</code>
          </p>
        )}

        <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-gray-300">
          <Shield size={11} />
          <span>SHIPINFY Metrics — Accès sécurisé</span>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
