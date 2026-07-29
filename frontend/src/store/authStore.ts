'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User } from '@/types'
import { authApi } from '@/lib/api'

interface AuthStore {
  user: User | null
  /** Bearer token for API clients/tooling only. Browser sessions authenticate
   * via the httponly `session_token` cookie set by /auth/callback — that
   * cookie is invisible to JS by design, so `user` (not `token`) is the
   * authoritative "am I logged in" signal for the UI. */
  token: string | null
  isLoading: boolean
  error: string | null
  /** True once the initial fetchUser() attempt (cookie-session check) has
   * settled, so callers can tell "still checking" apart from "checked, no session". */
  hasChecked: boolean

  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  fetchUser: () => Promise<void>
  logout: () => void
  /** Clears the session locally only — no API call. Used by the response
   * interceptor on 401 so an already-expired token can't trigger a repeat
   * 401 (and therefore a repeat call to this same clearing logic) via the
   * `/auth/logout` request that a full `logout()` would make. */
  clearSession: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,
      hasChecked: false,

      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),

      fetchUser: async () => {
        set({ isLoading: true, error: null })
        try {
          const user = await authApi.getMe()
          set({ user, isLoading: false, hasChecked: true })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch user',
            isLoading: false,
            hasChecked: true,
            user: null,
            token: null,
          })
        }
      },

      logout: async () => {
        set({ isLoading: true })
        try {
          await authApi.logout()
        } catch (error) {
          console.error('Logout failed:', error)
        } finally {
          set({ user: null, token: null, isLoading: false, hasChecked: true })
          localStorage.removeItem('auth-storage')
        }
      },

      clearSession: () => {
        set({ user: null, token: null, isLoading: false, hasChecked: true })
        localStorage.removeItem('auth-storage')
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    }
  )
)
