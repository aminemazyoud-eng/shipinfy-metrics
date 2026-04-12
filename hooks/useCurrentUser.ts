'use client'
import { useState, useEffect } from 'react'

export interface CurrentUser {
  id:       string
  email:    string
  name:     string | null
  role:     string
  tenantId: string | null
}

interface UseCurrentUserResult {
  user:    CurrentUser | null
  loading: boolean
}

// Module-level cache — avoids multiple simultaneous fetches (Sidebar + AppShell + BottomNav)
let cache: CurrentUser | null | undefined = undefined

export function useCurrentUser(): UseCurrentUserResult {
  const [user,    setUser]    = useState<CurrentUser | null>(cache ?? null)
  const [loading, setLoading] = useState(cache === undefined)

  useEffect(() => {
    if (cache !== undefined) {
      setUser(cache)
      setLoading(false)
      return
    }
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((data: { user: CurrentUser | null }) => {
        cache = data.user ?? null
        setUser(cache)
      })
      .catch(() => { cache = null; setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  return { user, loading }
}

// Call this after logout to invalidate the cache
export function clearUserCache() {
  cache = undefined
}
