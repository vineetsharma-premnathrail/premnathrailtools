'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { useCan } from '@/lib/permissions'
import { securityApi } from '@/lib/api'
import { SecuritySettings, SignInEvent, UserSessionInfo } from '@/types'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { Field, inputStyle, primaryBtnStyle, secondaryBtnStyle, RowCount } from '@/components/shared/ui'
import OrganizationNav from '@/components/organization/OrganizationNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

// Organization › Security & Sessions. Sign-in is Microsoft Entra ID SSO, so
// MFA / password / lockout policy is set in Entra — this page owns what the
// portal controls after sign-in, including the app password lock (shared
// laptops share the Windows / Microsoft password).

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const hint: React.CSSProperties = { fontSize: 12, color: '#57534e', margin: '4px 0 0' }
const EVENT_LABEL: Record<string, string> = { login: 'Signed in', login_failed: 'Blocked', logout: 'Signed out', session_revoked: 'Signed out by admin' }
const EVENT_HEX: Record<string, string> = { login: '#16A34A', login_failed: '#DC2626', logout: '#78716c', session_revoked: '#F59E0B' }

function fmt(d?: string | null) {
  if (!d) return '—'
  const x = new Date(d)
  return `${x.toLocaleDateString('en-GB')} ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
function device(ua?: string | null) {
  if (!ua) return '—'
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /Teams/.test(ua) ? 'Teams' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${b} on ${os}` : b
}

export default function SecurityPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('security')
  const { can } = useCan()
  const [values, setValues] = useState<SecuritySettings | null>(null)
  const [defaults, setDefaults] = useState<SecuritySettings | null>(null)
  const [savedValues, setSavedValues] = useState<SecuritySettings | null>(null)
  const [sessions, setSessions] = useState<UserSessionInfo[]>([])
  const [events, setEvents] = useState<SignInEvent[]>([])
  const [failedOnly, setFailedOnly] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revoke, setRevoke] = useState<UserSessionInfo | null>(null)
  const [revokeAll, setRevokeAll] = useState<UserSessionInfo | null>(null)
  const [resetFor, setResetFor] = useState<UserSessionInfo | null>(null)
  const canEdit = can('organization', 'security', 'edit')

  const loadSessions = useCallback(() => {
    securityApi.sessions().then(setSessions).catch((e) => setError(extractErrorMessages(e, 'Could not load sessions.').join(' ')))
  }, [])
  useEffect(() => {
    if (!isAuthorized) return
    securityApi.getSettings().then((r) => { setValues(r.values); setSavedValues(r.values); setDefaults(r.defaults) }).catch((e) => setError(extractErrorMessages(e, 'Could not load security settings.').join(' ')))
    loadSessions()
  }, [isAuthorized, loadSessions])
  const [eventsLoaded, setEventsLoaded] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [eventsTick, setEventsTick] = useState(0)
  useEffect(() => {
    if (!isAuthorized) return
    // alive guard: an older request finishing after a newer one must not overwrite it.
    let alive = true
    setEventsLoaded(false); setEventsError('')
    securityApi.signIns({ failed_only: failedOnly, limit: 1000 })
      .then((r) => { if (alive) { setEvents(r); setEventsLoaded(true) } })
      .catch((e) => { if (alive) setEventsError(extractErrorMessages(e, 'Check your connection and try again.').join(' ')) })
    return () => { alive = false }
  }, [isAuthorized, failedOnly, eventsTick])

  if (isLoading || !isAuthorized) return null

  const save = async () => {
    if (!values) return
    try {
      const r = await securityApi.saveSettings(values)
      setValues(r.values)
      setSavedValues(r.values)
      setNotice('Security settings saved. New lifetimes apply from each user’s next sign-in or token refresh.')
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not save security settings.').join(' '))
    }
  }
  const doRevoke = async () => {
    const s = revoke; setRevoke(null)
    if (!s) return
    try { await securityApi.revokeSession(s.id); loadSessions() } catch (e) { setError(extractErrorMessages(e, 'Could not sign out that session.').join(' ')) }
  }
  const doRevokeAll = async () => {
    const s = revokeAll; setRevokeAll(null)
    if (!s) return
    try {
      const r = await securityApi.revokeAll(s.user_id)
      setNotice(`${s.user_name} was signed out of ${r.revoked} session(s). They stay signed out until they sign in again.`)
      loadSessions()
    } catch (e) { setError(extractErrorMessages(e, 'Could not sign the user out.').join(' ')) }
  }

  const doReset = async () => {
    const s = resetFor; setResetFor(null)
    if (!s) return
    try {
      const r = await securityApi.sendAppPasswordReset(s.user_id)
      setNotice(`A one-time temporary app password was emailed to ${r.sent_to}. ${s.user_name} enters it on the lock screen and sets a new app password.`)
    } catch (e) { setError(extractErrorMessages(e, 'Could not send the app password reset.').join(' ')) }
  }

  const dirty = !!values && !!savedValues && JSON.stringify(values) !== JSON.stringify(savedValues)
  const num = (k: Exclude<keyof SecuritySettings, 'app_lock_enabled'>, label: string, help: string, min: number, max: number) => (
    <div style={{ minWidth: 0 }}>
      <Field label={label}>
        <input type="number" min={min} max={max} style={inputStyle} disabled={!canEdit} value={values?.[k] ?? ''}
          placeholder={defaults ? String(defaults[k]) : undefined}
          onChange={(e) => setValues((v) => (v ? { ...v, [k]: Number(e.target.value) } : v))} />
      </Field>
      <p style={hint}>{help}{defaults && values && values[k] !== defaults[k] ? ` Default ${defaults[k]}.` : ''}</p>
    </div>
  )
  const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, alignItems: 'start' }

  return (
    <div>
      <OrganizationNav />
      <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Security &amp; Sessions</h1>
      <MessageDialog open={!!error} variant="error" title="Security" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Done" message={notice} onClose={() => setNotice('')} />
      <ConfirmDialog open={!!revoke} title="Sign out this session?" confirmLabel="Sign out"
        message={revoke ? `${revoke.user_name} will be signed out on ${device(revoke.user_agent)} at their next request.` : ''}
        onConfirm={doRevoke} onCancel={() => setRevoke(null)} />
      <ConfirmDialog open={!!revokeAll} title="Sign out everywhere?" confirmLabel="Sign out everywhere"
        message={revokeAll ? `Sign ${revokeAll.user_name} out of every device and browser?` : ''}
        onConfirm={doRevokeAll} onCancel={() => setRevokeAll(null)} />
      <ConfirmDialog open={!!resetFor} title="Email a temporary app password?" confirmLabel="Send email"
        message={resetFor ? `${resetFor.user_name} gets a one-time temporary password at ${resetFor.user_email} (valid 15 minutes) to set a new app password. You won't see it. Their current app password keeps working until they change it.` : ''}
        onConfirm={doReset} onCancel={() => setResetFor(null)} />

      <div style={{ ...cardStyle, background: 'rgba(37,99,235,0.06)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: '#1e3a8a', margin: 0, flex: '1 1 420px' }}>
          Sign-in uses <b>Microsoft Entra ID</b>. Multi-factor authentication, password rules and account lockout are set in Entra, not here.
          Deactivating a user in Organization › Users also blocks portal sign-in.
        </p>
        <a href="https://entra.microsoft.com" target="_blank" rel="noopener noreferrer" style={{ ...secondaryBtnStyle, textDecoration: 'none', whiteSpace: 'nowrap' }}>Open Entra admin</a>
      </div>

      {values && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Session policy</h2>
          <div style={gridStyle}>
            {num('access_token_minutes', 'Access token (minutes)', 'How long a page session is trusted before it silently renews.', 5, 120)}
            {num('refresh_token_days', 'Stay signed in (days)', 'Days without opening the portal before the session ends. Every visit restarts the count; after it ends the portal signs the user back in with Microsoft on its own.', 1, 30)}
            {num('idle_timeout_minutes', 'Idle sign-out (minutes)', '0 = off. Signs out a session nobody has used for this long.', 0, 10080)}
            {num('max_sessions_per_user', 'Devices per user', '0 = unlimited. Signing in on one more device signs out the oldest.', 0, 20)}
          </div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '20px 0 6px' }}>App password lock</h2>
          <p style={{ ...hint, margin: '0 0 12px', maxWidth: 760 }}>
            Laptops share one Windows / Microsoft password, so the portal asks each user&apos;s own app password after every sign-in and after idle
            time. Users set it themselves at their first sign-in and reset it by email (a one-time temporary password). 5 wrong tries lock it for 15 minutes.
          </p>
          <div style={gridStyle}>
            <div style={{ minWidth: 0 }}>
              <Field label="App password lock">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '9px 0', cursor: canEdit ? 'pointer' : 'default' }}>
                  <input type="checkbox" disabled={!canEdit} checked={!!values.app_lock_enabled}
                    onChange={(e) => setValues((v) => (v ? { ...v, app_lock_enabled: e.target.checked } : v))} />
                  {values.app_lock_enabled ? 'On' : 'Off'}
                </label>
              </Field>
              <p style={hint}>Off = Microsoft sign-in alone opens the portal.</p>
            </div>
            {num('app_lock_idle_minutes', 'Lock after idle (minutes)', 'No mouse / keyboard for this long locks the portal.', 1, 480)}
            {num('app_password_min_length', 'Minimum length', 'Shortest app password allowed.', 4, 32)}
          </div>
          {canEdit && (
            <div style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14, padding: '10px 0', background: dirty ? 'rgba(255,247,237,0.96)' : 'transparent', borderTop: dirty ? '1px solid rgba(194,65,12,0.25)' : '1px solid transparent' }}>
              {dirty && <span role="status" style={{ fontSize: 13, fontWeight: 600, color: '#c2410c' }}>Unsaved changes</span>}
              {dirty && <button type="button" style={secondaryBtnStyle} onClick={() => setValues(savedValues)}>Discard</button>}
              <button type="button" style={{ ...primaryBtnStyle, opacity: dirty ? 1 : 0.55 }} disabled={!dirty} onClick={save}>Save policy</button>
            </div>
          )}
        </div>
      )}

      <div style={{ ...cardStyle, overflowX: 'auto' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Signed-in sessions ({sessions.length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead><tr>{['User', 'Device', 'IP address', 'Signed in / renewed', 'Expires', 'App lock', ''].map((h, hi) => <th key={h} style={th}>{h}{hi === 0 && <RowCount count={sessions.length} />}</th>)}</tr></thead>
          <tbody>
            {sessions.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#57534e' }}>No live sessions.</td></tr>}
            {sessions.map((s) => (
              <tr key={s.id}>
                <td style={td}><b>{s.user_name}</b><div style={{ color: '#57534e', fontSize: 12 }}>{s.user_email}</div></td>
                <td style={td} title={s.user_agent || ''}>{device(s.user_agent)}</td>
                <td style={td}>{s.ip_address || '—'}</td>
                <td style={td}>{fmt(s.created_at)}</td>
                <td style={td}>{fmt(s.expires_at)}</td>
                <td style={td}>{s.app_lock_state === 'unlocked' ? 'Unlocked' : s.app_lock_state === 'reset' ? 'Resetting' : 'Locked'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {canEdit && (
                    <>
                      <span style={{ color: '#DC2626', fontWeight: 600, cursor: 'pointer', marginRight: 12 }} onClick={() => setRevoke(s)}>Sign out</span>
                      <span style={{ color: TEXT.secondary, fontWeight: 600, cursor: 'pointer', marginRight: 12 }} onClick={() => setRevokeAll(s)}>Everywhere</span>
                      <span style={{ color: '#c2410c', fontWeight: 600, cursor: 'pointer' }} onClick={() => setResetFor(s)}>Reset app password</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Sign-in activity</h2>
          <button type="button" style={{ ...secondaryBtnStyle, ...(failedOnly ? { borderColor: '#DC2626', color: '#DC2626' } : {}) }} onClick={() => setFailedOnly((v) => !v)}>
            {failedOnly ? 'Showing blocked only' : 'Show blocked only'}
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>{['When', 'Event', 'Details', 'IP address', 'Device'].map((h, hi) => <th key={h} style={th}>{h}{hi === 0 && eventsLoaded && !eventsError && <RowCount count={events.length} />}</th>)}</tr></thead>
          <tbody>
            {eventsError && (
              <tr><td colSpan={5} role="alert" style={{ ...td, color: '#b91c1c' }}>
                The sign-in log could not be loaded: {eventsError}{' '}
                <button type="button" style={{ ...secondaryBtnStyle, marginLeft: 8 }} onClick={() => setEventsTick((n) => n + 1)}>Try again</button>
              </td></tr>
            )}
            {!eventsError && !eventsLoaded && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>}
            {!eventsError && eventsLoaded && events.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No sign-in events recorded yet.</td></tr>}
            {!eventsError && events.map((e) => (
              <tr key={e.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(e.created_at)}</td>
                <td style={{ ...td, color: EVENT_HEX[e.action], fontWeight: 600 }}>{EVENT_LABEL[e.action] || e.action}</td>
                <td style={td}>{e.summary}</td>
                <td style={td}>{e.ip_address || '—'}</td>
                <td style={td}>{device(e.user_agent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
