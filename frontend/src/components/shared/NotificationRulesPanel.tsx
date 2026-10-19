'use client'

// Compact editor for the notification-rule groups of the shared settings
// framework (backend app/core/notify_rules.py). Each event is one row —
// on/off switch, what triggers it and a one-line summary of who/how — and the
// people / channels / extra-address editor opens only when the row is expanded.
// State stays in ModuleSettingsPage's draft, so Save / Discard / Unsaved work as before.

import { useEffect, useState } from 'react'
import { DirectoryUser, SettingSpecDto } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { inputStyle } from '@/components/shared/ui'

export interface NotificationEvent {
  group: string
  label: string
  trigger: string
  keys: { enabled: string; users: string; channels: string; emails: string }
  channelOptions: { value: string; label: string }[]
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const colLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px',
}
const helpStyle: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }
const badgeStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${BRAND.primary}1a`, color: BRAND.primaryActive, whiteSpace: 'nowrap',
}
const linkBtnStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: BRAND.primary, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
}
const chipStyle = (active: boolean, bad = false): React.CSSProperties => ({
  fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 9999, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  border: `1px solid ${bad ? 'rgba(220,38,38,0.5)' : active ? BRAND.primaryBorder : BORDER.normal}`,
  background: bad ? 'rgba(220,38,38,0.08)' : active ? BRAND.primarySoft : 'rgba(255,255,255,.7)',
  color: bad ? '#b91c1c' : active ? BRAND.primaryActive : TEXT.secondary,
})

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!on) }}
      style={{
        width: 38, height: 22, borderRadius: 9999, border: 'none', padding: 2, flexShrink: 0,
        background: on ? BRAND.primary : '#cbd5e1', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1, transition: 'background .15s', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
      }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
    </button>
  )
}

const splitEmails = (raw: unknown): string[] => String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/** "Sent when X. The person who did it…" → "Sent when X." */
export function triggerText(spec: SettingSpecDto | undefined): string {
  const help = spec?.help || ''
  const m = help.match(/^(Sent when .*?\.)\s/)
  return m ? m[1] : help
}

export default function NotificationRulesPanel({
  events, draft, setField, users, canEdit, dirtyKeys, fieldErrors, isDefault, onReset, tourPrefix,
}: {
  events: NotificationEvent[]
  draft: Record<string, unknown>
  setField: (key: string, value: unknown) => void
  users: DirectoryUser[]
  canEdit: boolean
  dirtyKeys: Set<string>
  fieldErrors: Record<string, string>
  isDefault: Record<string, boolean>
  onReset: (keys: string[], label: string) => void
  tourPrefix?: string
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState<Record<string, string>>({})
  const [emailInput, setEmailInput] = useState<Record<string, string>>({})

  // A save that failed on a field inside a collapsed row opens that row.
  useEffect(() => {
    const withErr = events.filter((ev) => Object.values(ev.keys).some((k) => k in fieldErrors)).map((ev) => ev.group)
    if (withErr.length) setOpen((o) => ({ ...o, ...Object.fromEntries(withErr.map((g) => [g, true])) }))
  }, [fieldErrors, events])

  const onCount = events.filter((ev) => !!draft[ev.keys.enabled]).length
  const userName = (id: number) => users.find((u) => u.id === id)?.name || `User #${id}`

  const addEmails = (ev: NotificationEvent) => {
    const typed = splitEmails(emailInput[ev.group])
    if (!typed.length) return
    const current = splitEmails(draft[ev.keys.emails])
    const merged = [...current, ...typed.filter((t) => !current.some((c) => c.toLowerCase() === t.toLowerCase()))]
    setField(ev.keys.emails, merged.join(', '))
    setEmailInput((s) => ({ ...s, [ev.group]: '' }))
  }

  return (
    <div style={sectionStyle} data-tour={tourPrefix ? `${tourPrefix}-notifications` : undefined}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Notifications</h2>
        <span style={{ fontSize: 12, color: TEXT.muted }}>{onCount} of {events.length} on</span>
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
        Switch on the events someone should hear about, then open the row to choose who and how.
        The person who did the action is never notified about it.
      </p>

      <div style={{ border: `1px solid ${BORDER.light}`, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,.55)' }}>
        {events.map((ev, idx) => {
          const enabled = !!draft[ev.keys.enabled]
          const ids = Array.isArray(draft[ev.keys.users]) ? (draft[ev.keys.users] as number[]) : []
          const channels = Array.isArray(draft[ev.keys.channels]) ? (draft[ev.keys.channels] as string[]) : []
          const emails = splitEmails(draft[ev.keys.emails])
          const isOpen = !!open[ev.group]
          const rowDirty = Object.values(ev.keys).some((k) => dirtyKeys.has(k))
          const rowErrors = Object.values(ev.keys).map((k) => fieldErrors[k]).filter(Boolean)
          const customised = Object.values(ev.keys).filter((k) => !isDefault[k])
          const nobody = enabled && ids.length === 0 && emails.length === 0
          const noChannel = ids.length > 0 && channels.length === 0
          const channelNames = ev.channelOptions.filter((o) => channels.includes(o.value)).map((o) => o.label.replace('Portal bell', 'Bell').replace('Microsoft Teams', 'Teams'))
          const q = (search[ev.group] || '').trim().toLowerCase()
          const matches = q ? users.filter((u) => !ids.includes(u.id) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 8) : []

          let summary: React.ReactNode
          if (!enabled) summary = <span style={{ color: TEXT.muted }}>Off</span>
          else if (nobody) summary = <span style={{ color: '#b91c1c' }}>Nobody to notify — add people</span>
          else if (noChannel) summary = <span style={{ color: '#b91c1c' }}>No channel ticked</span>
          else {
            const parts: string[] = []
            if (ids.length) parts.push(`${ids.length} ${ids.length === 1 ? 'person' : 'people'} · ${channelNames.join(', ')}`)
            if (emails.length) parts.push(`${emails.length} extra address${emails.length === 1 ? '' : 'es'}`)
            summary = <span style={{ color: TEXT.secondary }}>{parts.join(' · ')}</span>
          }

          return (
            <div key={ev.group} data-tour={tourPrefix ? `${tourPrefix}-group-${ev.group}` : undefined}
              style={{ borderTop: idx ? `1px solid ${BORDER.light}` : 'none', background: isOpen ? 'rgba(255,255,255,.75)' : undefined }}>
              <div onClick={() => setOpen((o) => ({ ...o, [ev.group]: !isOpen }))}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer', flexWrap: 'wrap' }}>
                <Switch on={enabled} disabled={!canEdit} label={`${ev.label} on/off`}
                  onChange={(v) => {
                    setField(ev.keys.enabled, v)
                    if (v && ids.length === 0 && emails.length === 0) setOpen((o) => ({ ...o, [ev.group]: true }))
                  }} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: enabled ? TEXT.heading : TEXT.secondary }}>{ev.label}</span>
                    {rowDirty && <span style={badgeStyle}>Unsaved</span>}
                    {rowErrors.length > 0 && <span style={{ ...badgeStyle, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>Fix</span>}
                  </div>
                  <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>{ev.trigger}</div>
                </div>
                <div style={{ fontSize: 12.5, textAlign: 'right', flex: '0 1 auto' }}>{summary}</div>
                <span aria-hidden style={{ fontSize: 12, color: TEXT.muted, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▼</span>
              </div>

              {isOpen && (
                <div style={{ padding: '4px 16px 16px', paddingLeft: 'clamp(16px, 6vw, 68px)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
                    {/* Who */}
                    <div style={{ position: 'relative' }}>
                      <p style={colLabelStyle}>Who</p>
                      {ids.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {ids.map((id) => (
                            <span key={id} style={{ ...chipStyle(true), cursor: 'default' }}>
                              {userName(id)}
                              {canEdit && <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setField(ev.keys.users, ids.filter((x) => x !== id))}>×</span>}
                            </span>
                          ))}
                        </div>
                      )}
                      {canEdit ? (
                        <>
                          <input value={search[ev.group] || ''} placeholder="Search people to add..."
                            onChange={(e) => setSearch((s) => ({ ...s, [ev.group]: e.target.value }))} style={inputStyle} />
                          {matches.length > 0 && (
                            <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 5, marginTop: 4, borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', overflow: 'hidden', boxShadow: '0 8px 24px rgba(15,23,42,.12)' }}>
                              {matches.map((u) => (
                                <div key={u.id} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${BORDER.light}` }}
                                  onClick={() => { setField(ev.keys.users, [...ids, u.id]); setSearch((s) => ({ ...s, [ev.group]: '' })) }}>
                                  {u.name} <span style={{ color: TEXT.muted }}>· {u.email}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : ids.length === 0 && <div style={{ fontSize: 13, color: TEXT.muted }}>Nobody</div>}
                    </div>

                    {/* How */}
                    <div>
                      <p style={colLabelStyle}>How</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {ev.channelOptions.map((o) => {
                          const on = channels.includes(o.value)
                          return (
                            <button key={o.value} type="button" disabled={!canEdit} style={{ ...chipStyle(on), cursor: canEdit ? 'pointer' : 'default' }}
                              onClick={() => setField(ev.keys.channels, ev.channelOptions.map((x) => x.value).filter((val) => (val === o.value ? !on : channels.includes(val))))}>
                              {on ? '✓ ' : ''}{o.label}
                            </button>
                          )
                        })}
                      </div>
                      <p style={helpStyle}>Email goes to each person&apos;s work email. Teams needs them to have signed in with Microsoft.</p>
                    </div>

                    {/* Extra addresses */}
                    <div>
                      <p style={colLabelStyle}>Also email</p>
                      {emails.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {emails.map((addr) => (
                            <span key={addr} style={{ ...chipStyle(true, !EMAIL_RE.test(addr)), cursor: 'default' }} title={EMAIL_RE.test(addr) ? undefined : 'Not a valid email address'}>
                              {addr}
                              {canEdit && <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setField(ev.keys.emails, emails.filter((x) => x !== addr).join(', '))}>×</span>}
                            </span>
                          ))}
                        </div>
                      )}
                      {canEdit ? (
                        <input value={emailInput[ev.group] || ''} placeholder="team@premnathrail.com — press Enter"
                          onChange={(e) => setEmailInput((s) => ({ ...s, [ev.group]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmails(ev) } }}
                          onBlur={() => addEmails(ev)} style={inputStyle} />
                      ) : emails.length === 0 && <div style={{ fontSize: 13, color: TEXT.muted }}>None</div>}
                      <p style={helpStyle}>Addresses outside the portal, e.g. a team mailbox. Emailed whenever this is on.</p>
                    </div>
                  </div>

                  {rowErrors.map((e) => <p key={e} style={{ ...helpStyle, color: '#b91c1c' }}>{e}</p>)}
                  {canEdit && customised.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <button type="button" style={linkBtnStyle} onClick={() => onReset(customised, ev.label)}>Reset this notification to default</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
