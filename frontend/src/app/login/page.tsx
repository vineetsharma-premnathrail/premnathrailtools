'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { authApi } from '@/lib/api'
import { BRAND, GRADIENTS } from '@/lib/theme'

const modules = [
  { label: 'Service Module', desc: 'Vehicle & Service Management' },
  { label: 'R&D Tools', desc: 'Engineering Calculation Suite' },
  { label: 'CRM', desc: 'Customer Relationship Management' },
]

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your Microsoft account\'s email domain is not authorized for this portal.',
  inactive: 'Your account has been deactivated. Contact an administrator.',
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, hasChecked, isLoading, fetchUser, setToken } = useAuthStore()
  const [busy, setBusy] = useState(false)
  const [inTeams, setInTeams] = useState(false)
  const [teamsMessage, setTeamsMessage] = useState('')

  const errorParam = searchParams.get('error')
  const errorMessage = errorParam ? ERROR_MESSAGES[errorParam] || 'Sign-in failed. Please try again.' : null

  // Backward-compat: an old-style ?token= link (e.g. a bookmarked URL) still works.
  useEffect(() => {
    const token = searchParams.get('token')
    if (token) setToken(token)
  }, [searchParams, setToken])

  // The session lives in an httponly cookie set by /auth/callback — if we
  // land here already logged in (e.g. back button, or a stale bookmark),
  // just continue to the dashboard instead of showing the login screen.
  useEffect(() => {
    if (!hasChecked && !isLoading) fetchUser()
  }, [hasChecked, isLoading, fetchUser])

  useEffect(() => {
    if (hasChecked && user) router.push('/dashboard')
  }, [hasChecked, user, router])

  // Detect whether we're running inside a Microsoft Teams tab (app.initialize()
  // only resolves inside a Teams/Office host — outside Teams it just hangs, so
  // race it against a short timeout). If we are, try silent SSO immediately.
  useEffect(() => {
    if (hasChecked && user) return
    let cancelled = false

    const tryTeams = async () => {
      try {
        const teams = await import('@microsoft/teams-js')
        await Promise.race([
          teams.app.initialize(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('not in Teams')), 1500)),
        ])
        if (cancelled) return
        setInTeams(true)
        await silentTeamsLogin(teams)
      } catch {
        // Not running inside Teams — the normal button flow below handles it.
      }
    }

    const silentTeamsLogin = async (teams: typeof import('@microsoft/teams-js')) => {
      try {
        const token = await teams.authentication.getAuthToken()
        await authApi.teamsTokenLogin(token)
        if (cancelled) return
        await fetchUser()
        router.push('/dashboard')
      } catch {
        if (!cancelled) setTeamsMessage('Sign-in required — tap below to continue.')
      }
    }

    tryTeams()
    return () => { cancelled = true }
  }, [hasChecked, user, fetchUser, router])

  const popupTeamsLogin = async () => {
    setBusy(true)
    setTeamsMessage('')
    try {
      const teams = await import('@microsoft/teams-js')
      const code = await teams.authentication.authenticate({
        url: `${process.env.NEXT_PUBLIC_API_URL}/auth/microsoft-login?next=/auth/teams-success`,
        width: 600,
        height: 640,
      })
      await authApi.teamsExchange(code)
      await fetchUser()
      router.push('/dashboard')
    } catch {
      setTeamsMessage('Sign-in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleLogin = () => {
    if (inTeams) {
      popupTeamsLogin()
      return
    }
    setBusy(true)
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/microsoft-login`
  }

  return (
    <div
      className="login-shell"
      style={{
        position: 'relative',
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#3a2416',
        overflow: 'hidden',
        background: GRADIENTS.page,
      }}
    >
      {/* floating warm orbs */}
      <div style={{ position: 'absolute', top: -140, left: '8%', width: 440, height: 440, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,.9), transparent 68%)', filter: 'blur(30px)', animation: 'gl-orb1 16s ease-in-out infinite', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -160, left: '34%', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,157,92,.85), transparent 66%)', filter: 'blur(34px)', animation: 'gl-orb2 19s ease-in-out infinite', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: '20%', right: '6%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,196,140,.9), transparent 66%)', filter: 'blur(30px)', animation: 'gl-orb3 21s ease-in-out infinite', pointerEvents: 'none' }} />

      {/* LEFT / BRAND */}
      <div className="login-left" style={{ position: 'relative', flex: '1.1', minWidth: 0, padding: '64px 72px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ position: 'relative', maxWidth: 520 }}>
          <p style={{ maxWidth: 420, fontSize: 17, lineHeight: 1.6, color: '#6e4a2e', margin: '0 0 44px' }}>
            One workspace for Engineering, Service Management, and Business Operations — everything your team runs, in a single place.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 460 }}>
            {modules.map((m) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,.5)', border: '1px solid rgba(255,255,255,.7)', backdropFilter: 'blur(18px)', boxShadow: '0 8px 24px rgba(180,90,40,.1)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#2e1c10' }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: '#8a6547', marginTop: 1 }}>{m.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT / SIGN-IN */}
      <div className="login-right" style={{ position: 'relative', flex: 1, minWidth: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 400, padding: 40, borderRadius: 26, background: 'rgba(255,255,255,.6)', backdropFilter: 'blur(26px) saturate(1.4)', border: '1px solid rgba(255,255,255,.85)', boxShadow: '0 24px 60px rgba(160,80,30,.25), inset 0 1px 0 rgba(255,255,255,.7)' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.9),transparent)' }} />

          <div style={{ width: 184, height: 40, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, boxShadow: '0 6px 18px rgba(224,98,31,.3)', overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Premnathrail" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
          </div>

          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: BRAND.primaryActive, marginBottom: 11, fontWeight: 600 }}>Premnathrail Portal</div>
          <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.01em', color: '#2e1c10', margin: '0 0 8px' }}>Welcome back</h1>
          <p style={{ fontSize: 14, color: '#7a5a42', margin: '0 0 26px', lineHeight: 1.5 }}>Sign in with your Microsoft account to continue.</p>

          {errorMessage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18, padding: '13px 15px', borderRadius: 14, background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.25)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ fontSize: 12.5, color: '#991b1b' }}>{errorMessage}</span>
            </div>
          )}

          {!errorMessage && teamsMessage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18, padding: '13px 15px', borderRadius: 14, background: 'rgba(224,98,31,.08)', border: '1px solid rgba(224,98,31,.25)' }}>
              <span style={{ fontSize: 12.5, color: '#8a4a20' }}>{teamsMessage}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={busy}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 11,
              height: 52,
              borderRadius: 15,
              border: 'none',
              cursor: busy ? 'default' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 15,
              fontWeight: 600,
              color: '#fff',
              background: GRADIENTS.primary,
              boxShadow: '0 10px 24px rgba(224,98,31,.4)',
              opacity: busy ? 0.75 : 1,
              transition: 'transform .15s ease-out, box-shadow .2s',
            }}
          >
            {busy ? (
              <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'gl-spin .7s linear infinite' }} />
            ) : (
              <span style={{ width: 26, height: 26, borderRadius: 7, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <svg width="15" height="15" viewBox="0 0 23 23">
                  <rect x="1" y="1" width="10" height="10" fill="#f25022" />
                  <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
                  <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
                  <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
                </svg>
              </span>
            )}
            {busy ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, padding: '13px 15px', borderRadius: 14, background: 'rgba(255,255,255,.5)', border: '1px solid rgba(255,255,255,.7)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c07038" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={{ fontSize: 12.5, color: '#8a6547' }}>Use your official work email address to sign in.</span>
          </div>

          <div style={{ height: 1, background: 'rgba(180,120,80,.25)', margin: '26px 0 16px' }} />
          <div style={{ textAlign: 'center', fontSize: 11, color: '#a8825f' }}>© 2026 Premnathrail. All rights reserved.</div>
        </div>
      </div>

      <style jsx>{`
        @keyframes gl-orb1 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(60px, -40px) scale(1.12); } }
        @keyframes gl-orb2 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-50px, 50px) scale(1.15); } }
        @keyframes gl-orb3 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(40px, 60px) scale(0.9); } }
        @keyframes gl-spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .login-shell {
            flex-direction: column;
            overflow-y: auto;
            height: auto;
          }
          .login-left {
            padding: 40px 24px 24px !important;
          }
          .login-right {
            min-width: 0 !important;
            padding: 24px !important;
          }
        }
        @media (max-width: 480px) {
          .login-left {
            padding: 32px 18px 16px !important;
          }
          .login-right {
            padding: 16px !important;
          }
        }
      `}</style>
    </div>
  )
}
