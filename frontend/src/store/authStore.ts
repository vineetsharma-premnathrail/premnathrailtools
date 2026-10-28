'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User } from '@/types'
import { authApi } from '@/lib/api'
import { clearAllFormDrafts } from '@/lib/formDraft'
import { clearPendingKeys } from '@/lib/idempotency'

/** localStorage key set by logout(); read and cleared by the login page. */
export const SIGNED_OUT_FLAG = 'pr-signed-out'

interface AuthStore {
  user: User | null
  /** Bearer token. Browser sessions authenticate via the httponly
   * `session_token` cookie set by /auth/callback; inside Microsoft Teams,
   * where that cookie is often dropped, the tab holds the access token here
   * (lib/teamsAuth.ts). `user` (not `token`) is the authoritative "am I
   * logged in" signal for the UI. */
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
          // A deliberate sign-out: the login page must not sign this browser
          // straight back in with Microsoft / Teams (app/login/page.tsx) —
          // in any tab, so the next person on a shared PC gets the button.
          try { localStorage.setItem(SIGNED_OUT_FLAG, '1') } catch { /* storage blocked */ }
          // Unsaved form drafts and pending save keys are this person's — not the next one's (lib/formDraft.ts).
          clearAllFormDrafts()
          clearPendingKeys()
        }
      },

      clearSession: () => {
        set({ user: null, token: null, isLoading: false, hasChecked: true })
        localStorage.removeItem('auth-storage')
        clearAllFormDrafts()
        clearPendingKeys()
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
