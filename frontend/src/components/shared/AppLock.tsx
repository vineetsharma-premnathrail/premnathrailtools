'use client'

// App password lock screen (backend services/app_lock.py). Shown over the
// whole portal — opaque, so nothing behind it can be read — when:
//   * a new sign-in hasn't entered the app password yet (or never set one),
//   * the person was idle for the configured minutes,
//   * they pressed "Lock now",
//   * any API call came back 423.
// The server enforces the same lock, so hiding this overlay unlocks nothing.
// "Forgot app password" emails a one-time temporary password; entering it
// lets the user set a new one. Opened in "change" mode from the user menu.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { AppLockStatus, appLockApi, isUserActive, lastActivityAt, markActivity, onLocked, takeBlockedCount } from '@/lib/appLock'
import { TEXT } from '@/lib/theme'
import { Lock } from '@phosphor-icons/react'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

export const APP_LOCK_EVENT = 'app-lock:request'
/** From anywhere (e.g. the user menu): 'lock' = Lock now, 'change' = change the app password. */
export function requestAppLock(action: 'lock' | 'change') {
  window.dispatchEvent(new CustomEvent(APP_LOCK_EVENT, { detail: action }))
}

// 'checking' = opaque cover while the lock state isn't known yet (page open,
// laptop woke up after the idle time) — the page must never show first and
// lock after, however slow the status call is.
type Mode = 'hidden' | 'checking' | 'first' | 'unlock' | 'reset' | 'change'
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const

const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#c2410c', fontWeight: 600, fontSize: 13, cursor: 'pointer' }

function PasswordInput({ value, onChange, onEnter, autoFocus, placeholder }: { value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input type={show ? 'text' : 'password'} value={value} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off"
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.() }}
        style={{ ...inputStyle, paddingRight: 56 }} />
      <button type="button" onClick={() => setShow((x) => !x)} tabIndex={-1}
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 11.5, fontWeight: 600, color: TEXT.muted, cursor: 'pointer' }}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export default function AppLock() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [status, setStatus] = useState<AppLockStatus | null>(null)
  const [mode, setMode] = useState<Mode>('checking')
  const [slow, setSlow] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [current, setCurrent] = useState('')
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const statusRef = useRef<AppLockStatus | null>(null)
  const modeRef = useRef<Mode>('checking')
  // Locked on the very first check (a new sign-in): the page's own data
  // never loaded, so it reloads after unlock. A lock later in the session
  // keeps the page as it is (an unsaved form survives).
  const firstCheck = useRef(true)
  const reloadAfterUnlock = useRef(false)
  useEffect(() => { modeRef.current = mode }, [mode])

  const apply = useCallback((s: AppLockStatus) => {
    statusRef.current = s
    setStatus(s)
    if (firstCheck.current) {
      firstCheck.current = false
      reloadAfterUnlock.current = s.enabled && s.state !== 'unlocked'
    }
    if (!s.enabled || s.state === 'unlocked') {
      if (modeRef.current !== 'change') setMode('hidden')
      return
    }
    setMode(!s.has_password ? 'first' : s.state === 'reset' ? 'reset' : 'unlock')
  }, [])

  const refresh = useCallback(async () => {
    try { apply(await appLockApi.status()) } catch {
      // Signed out / offline — the 401 handler takes over. Don't trap the
      // page behind the cover: the server still answers 423 while locked.
      if (modeRef.current === 'checking') setMode('hidden')
    }
  }, [apply])

  // A very slow status answer: say so on the cover instead of a silent wait.
  useEffect(() => {
    if (mode !== 'checking') return
    const t = window.setTimeout(() => setSlow(true), 6000)
    return () => { window.clearTimeout(t); setSlow(false) }
  }, [mode])

  // First check, then open on any 423 from the API.
  useEffect(() => {
    Promise.resolve().then(refresh)
    return onLocked(() => { if (modeRef.current === 'hidden') refresh() })
  }, [refresh])

  // Real activity + idle lock. Background requests never count as activity.
  useEffect(() => {
    const mark = () => markActivity()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    let lastBeat = 0
    const timer = window.setInterval(() => {
      const s = statusRef.current
      if (!s || !s.enabled || s.state !== 'unlocked' || modeRef.current !== 'hidden') return
      if (Date.now() - lastActivityAt() > s.idle_minutes * 60_000) {
        appLockApi.lock().then(apply).catch(() => refresh())
      } else if (isUserActive() && Date.now() - lastBeat > 60_000) {
        // Typing a long form makes no API call — tell the server we're here.
        lastBeat = Date.now()
        appLockApi.heartbeat().then(apply).catch(() => {})
      }
    }, 15_000)
    // Unlocked in another tab, or the laptop woke up: re-check when back.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // Idle past the limit (laptop slept, timers paused): cover the page now,
      // not when the server answers.
      const s = statusRef.current
      if (s?.enabled && s.state === 'unlocked' && modeRef.current === 'hidden' && Date.now() - lastActivityAt() > s.idle_minutes * 60_000) setMode('checking')
      refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark))
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [apply, refresh])

  // "Lock now" / "Change app password" from the user menu.
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail
      setPw(''); setPw2(''); setCurrent(''); setError([]); setNotice('')
      if (action === 'lock') appLockApi.lock().then(apply).catch((err) => setError(extractErrorMessages(err, 'Could not lock the portal.')))
      if (action === 'change') setMode('change')
    }
    window.addEventListener(APP_LOCK_EVENT, handler)
    return () => window.removeEventListener(APP_LOCK_EVENT, handler)
  }, [apply])

  const done = (s: AppLockStatus) => {
    setPw(''); setPw2(''); setCurrent(''); setError([]); setNotice('')
    const blocked = takeBlockedCount()
    statusRef.current = s
    setStatus(s)
    if (s.state === 'reset') { setMode('reset'); return }
    setMode('hidden')
    // A new sign-in's page tried to load while locked and got nothing — load it again.
    if (reloadAfterUnlock.current && blocked > 0) window.location.reload()
    reloadAfterUnlock.current = false
  }

  const run = async (fn: () => Promise<AppLockStatus>, fallback: string) => {
    setBusy(true); setError([])
    try { done(await fn()) } catch (err) {
      setError(extractErrorMessages(err, fallback))
      // Lockout / temp-password state may have changed.
      appLockApi.status().then((s) => { statusRef.current = s; setStatus(s) }).catch(() => {})
    } finally { setBusy(false) }
  }

  const minLen = status?.min_length ?? 6
  const submitNew = () => {
    const problems: string[] = []
    if (mode === 'change' && !current) problems.push('Enter your current app password.')
    if (pw.length < minLen) problems.push(`The app password must be at least ${minLen} characters.`)
    if (pw !== pw2) problems.push("The two passwords don't match — type the same password twice.")
    if (problems.length) { setError(problems); return }
    run(() => appLockApi.set(pw, mode === 'change' ? current : undefined), 'Could not save the app password.')
  }
  const submitUnlock = () => {
    if (!pw) { setError(['Enter your app password.']); return }
    run(() => appLockApi.unlock(pw), 'Could not unlock.')
  }
  const forgot = async () => {
    setBusy(true); setError([]); setNotice('')
    try {
      const r = await appLockApi.forgot()
      setNotice(`A temporary password was emailed to ${r.sent_to}. Enter it below — it works once and expires in ${r.valid_minutes} minutes.`)
      setPw('')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not send the temporary password.'))
    } finally { setBusy(false) }
  }
  const signOut = async () => {
    await logout()
    router.push('/login')
  }

  if (mode === 'hidden' || typeof document === 'undefined') return null

  if (mode === 'checking') {
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 16,
        background: 'linear-gradient(135deg, #fff7ed 0%, #fde7d6 50%, #f5ede6 100%)' }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: '#FF6A2A1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Lock size={20} color="#FF6A2A" />
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.secondary }}>Checking your session…</div>
        {slow && (
          <div style={{ fontSize: 12.5, color: TEXT.muted, textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
            The server is taking long to answer. Wait a moment, or{' '}
            <button type="button" onClick={() => { setSlow(false); refresh() }} style={linkBtn}>try again</button>.
          </div>
        )}
      </div>,
      document.body,
    )
  }

  const titles: Record<Exclude<Mode, 'hidden' | 'checking'>, string> = {
    first: 'Set your app password',
    unlock: 'Portal locked',
    reset: 'Set a new app password',
    change: 'Change app password',
  }
  const lockedUntil = status?.locked_until ? new Date(status.locked_until) : null
  const newForm = mode === 'first' || mode === 'reset' || mode === 'change'

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      background: mode === 'change' ? 'rgba(0,0,0,0.45)' : 'linear-gradient(135deg, #fff7ed 0%, #fde7d6 50%, #f5ede6 100%)' }}>
      <div style={{ background: '#fff', borderRadius: 18, width: 'min(420px, 100%)', padding: 26, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#FF6A2A1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Lock size={20} color="#FF6A2A" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{titles[mode]}</h2>
            <div style={{ fontSize: 12.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || user?.email}</div>
          </div>
        </div>

        {mode === 'first' && (
          <p style={{ fontSize: 13, color: TEXT.secondary, lineHeight: 1.6, margin: '0 0 16px' }}>
            Your own short password for this portal. It is asked after every sign-in and when you leave the portal idle, so nobody else can work
            in your name from your laptop. At least {minLen} characters. Forgot it later? You can reset it by email.
          </p>
        )}
        {mode === 'reset' && <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 16px' }}>Temporary password accepted. Set your new app password to continue.</p>}
        {mode === 'unlock' && <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 16px' }}>Enter your app password to continue. Your open pages stay as they were.</p>}

        {notice && <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#15803d', fontSize: 13 }}>{notice}</div>}
        {mode === 'unlock' && lockedUntil && lockedUntil > new Date() && !notice && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', color: '#b45309', fontSize: 13 }}>
            Too many wrong tries — locked until {lockedUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Use &quot;Forgot app password&quot; to get a temporary password by email.
          </div>
        )}

        {newForm ? (
          <>
            {mode === 'change' && (
              <div style={{ marginBottom: 12 }}><span style={label}>Current app password</span><PasswordInput value={current} onChange={setCurrent} autoFocus /></div>
            )}
            <div style={{ marginBottom: 12 }}><span style={label}>New app password</span><PasswordInput value={pw} onChange={setPw} autoFocus={mode !== 'change'} placeholder={`At least ${minLen} characters`} /></div>
            <div style={{ marginBottom: 16 }}><span style={label}>Type it again</span><PasswordInput value={pw2} onChange={setPw2} onEnter={submitNew} /></div>
          </>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <span style={label}>{notice || status?.temp_password_pending ? 'App password or temporary password' : 'App password'}</span>
            <PasswordInput value={pw} onChange={setPw} onEnter={submitUnlock} autoFocus />
          </div>
        )}

        {error.length > 0 && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: mode === 'change' ? 0 : 14 }}>
          {mode === 'change' && <button type="button" onClick={() => { setMode('hidden'); setError([]) }} disabled={busy} style={secondaryBtnStyle}>Cancel</button>}
          <button type="button" disabled={busy} onClick={newForm ? submitNew : submitUnlock} style={{ ...primaryBtnStyle, flex: mode === 'change' ? undefined : 1, justifyContent: 'center', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Please wait…' : newForm ? 'Save app password' : 'Unlock'}
          </button>
        </div>

        {mode !== 'change' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
            {mode === 'unlock' ? <button type="button" onClick={forgot} disabled={busy} style={linkBtn}>Forgot app password?</button> : <span />}
            <button type="button" onClick={signOut} style={{ ...linkBtn, color: TEXT.muted }}>Not you? Sign out</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
