'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { authApi } from '@/lib/api'
import { GRADIENTS, TEXT } from '@/lib/theme'

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
  const dropRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = dropRef.current
    if (!el) return
    el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
  }

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
      className="login-shell animated-gradient-bg"
      style={{
        position: 'relative',
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#3a2416',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflow: 'hidden',
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Decorative color blobs + water-ripple cursor follower, same as the dashboard background */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div className="bg-blob" style={{ position: 'absolute', top: '-10%', left: '15%', width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,122,69,0.48), transparent 70%)', filter: 'blur(10px)' }} />
        <div className="bg-blob" style={{ position: 'absolute', bottom: '-15%', left: '35%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,90,31,0.34), transparent 70%)', filter: 'blur(10px)' }} />
        <div className="bg-blob" style={{ position: 'absolute', top: '20%', right: '5%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.28), transparent 70%)', filter: 'blur(10px)' }} />
        <div className="bg-blob" style={{ position: 'absolute', top: '55%', left: '5%', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,0.30), transparent 70%)', filter: 'blur(10px)' }} />
        <div className="bg-blob" style={{ position: 'absolute', top: '5%', right: '25%', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,72,153,0.26), transparent 70%)', filter: 'blur(10px)' }} />
        <div className="bg-blob" style={{ position: 'absolute', bottom: '5%', right: '30%', width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(234,179,8,0.28), transparent 70%)', filter: 'blur(10px)' }} />
        <div ref={dropRef} style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none' }}>
          <div className="water-ripple-ring" style={{ animationDelay: '0s' }} />
          <div className="water-ripple-ring" style={{ animationDelay: '0.8s' }} />
          <div className="water-ripple-ring" style={{ animationDelay: '1.6s' }} />
        </div>
      </div>

      {/* paper grain texture overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          opacity: 0.9,
          mixBlendMode: 'multiply',
          pointerEvents: 'none',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.2 0 0 0 0 0.14 0 0 0 0 0.06 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* SIGN-IN CARD */}
      <div
        className="login-card"
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          maxWidth: 480,
          padding: 48,
          borderRadius: 30,
          background: '#FCFAF7',
          boxShadow: '-1px 1px 0px rgba(40,25,10,.35), -4px 5px 3px rgba(40,25,10,.32), -25px 32px 26px -6px rgba(40,25,10,.7)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: -1,
            opacity: 0.9,
            mixBlendMode: 'multiply',
            pointerEvents: 'none',
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.2 0 0 0 0 0.14 0 0 0 0 0.06 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        <div style={{ width: 220, height: 48, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28, boxShadow: '-1px 1px 0px rgba(224,98,31,.35), -3px 4px 3px rgba(224,98,31,.3), -8px 11px 10px -3px rgba(224,98,31,.5)', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Premnathrail" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
        </div>

        <div style={{ fontSize: 13, letterSpacing: '.16em', textTransform: 'uppercase', color: TEXT.secondary, marginBottom: 13, fontWeight: 600 }}>Premnathrail Portal</div>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.01em', color: '#2e1c10', margin: '0 0 10px' }}>Welcome back</h1>
        <p style={{ fontSize: 16, color: '#7a5a42', margin: '0 0 30px', lineHeight: 1.5 }}>Sign in with your Microsoft account to continue.</p>

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
              gap: 13,
              height: 60,
              borderRadius: 17,
              border: 'none',
              cursor: busy ? 'default' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 17,
              fontWeight: 600,
              color: '#fff',
              background: GRADIENTS.primary,
              boxShadow: '-1px 1px 0px rgba(224,98,31,.4), -4px 5px 4px rgba(224,98,31,.35), -12px 16px 14px -3px rgba(224,98,31,.55)',
              opacity: busy ? 0.75 : 1,
              transition: 'transform .15s ease-out, box-shadow .2s',
            }}
          >
            {busy ? (
              <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'gl-spin .7s linear infinite' }} />
            ) : (
              <span style={{ width: 30, height: 30, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <svg width="17" height="17" viewBox="0 0 23 23">
                  <rect x="1" y="1" width="10" height="10" fill="#f25022" />
                  <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
                  <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
                  <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
                </svg>
              </span>
            )}
            {busy ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 16, padding: '15px 17px', borderRadius: 16, background: 'rgba(255,255,255,.5)', border: '1px solid rgba(255,255,255,.7)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c07038" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={{ fontSize: 14, color: '#8a6547' }}>Use your official work email address to sign in.</span>
          </div>

          <div style={{ height: 1, background: 'rgba(180,120,80,.25)', margin: '30px 0 18px' }} />
          <div style={{ textAlign: 'center', fontSize: 12.5, color: '#a8825f', lineHeight: 1.6 }}>
            By using Premnathrail Portal, you agree to the{' '}
            <Link href="/legal/privacy-policy" style={{ color: '#c07038', fontWeight: 600 }}>Privacy Policy</Link>,{' '}
            <Link href="/legal/terms-of-use" style={{ color: '#c07038', fontWeight: 600 }}>Terms of Use</Link>, and{' '}
            <Link href="/legal/permissions" style={{ color: '#c07038', fontWeight: 600 }}>Permissions</Link>.
          </div>
          <div style={{ textAlign: 'center', fontSize: 12.5, color: '#a8825f', marginTop: 9 }}>© 2026 Premnathrail. All rights reserved.</div>
      </div>

      <style jsx>{`
        @keyframes gl-spin { to { transform: rotate(360deg); } }
        @media (max-width: 480px) {
          .login-card {
            padding: 28px 24px !important;
          }
        }
      `}</style>
    </div>
  )
}
