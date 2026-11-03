'use client'

import { Fragment, useMemo, useState } from 'react'
import { PermissionRegistry } from '@/types'
import Checkbox from '@/components/Checkbox'
import { SHEET, SheetIcon, sheetInput } from '@/components/shared/FormSheet'
import { expandGrants } from '@/components/organization/PermissionMatrixEditor'
import { permissionWords } from '@/lib/permissionWords'
import { RowCount, pillStyle } from '@/components/shared/ui'

/**
 * A role's notification subscriptions (Organization › Roles › Notifications):
 * per module, which events the role's members are told about and on which
 * channels. A member only receives an event they could act on — they must hold
 * its permission (shown per event) and be able to open the record. `value` is
 * { "<module>.<event>": ["bell" | "email" | "teams"] }.
 */

export interface NotificationEventSpec {
  label: string
  trigger: string
  /** permission id a member needs to receive it (null for a direct notification) */
  access: string | null
  kind: 'approval' | 'assignment' | 'reminder' | 'info'
  default_channels: string[]
  /** direct = the code names the person (assignee, requester …), the role only picks channels;
   * watchers = role members are told about everyone's records */
  audience?: 'direct' | 'watchers'
  /** who receives it, in plain words */
  recipient?: string
}

export interface NotificationEventCatalog {
  channels: { key: string; label: string }[]
  modules: Record<string, { label: string; events: Record<string, NotificationEventSpec> }>
}

const KIND: Record<string, { text: string; c: string; bg: string }> = {
  approval: { text: 'Needs approval', c: '#b45309', bg: '#fef3c7' },
  assignment: { text: 'Assignment', c: '#1d4ed8', bg: '#dbeafe' },
  reminder: { text: 'Reminder', c: '#7c3aed', bg: '#ede9fe' },
  info: { text: 'Information', c: '#475569', bg: '#f1f5f9' },
}

interface Props {
  catalog: NotificationEventCatalog
  registry: PermissionRegistry
  /** the role's raw permission grants — to warn when it can't receive an event */
  permissions: string[]
  value: Record<string, string[]>
  onChange?: (next: Record<string, string[]>) => void
  readOnly?: boolean
  /** Personal mode (one user): what the user's roles give per event. `value` then
   * holds only the user's overrides — an entry replaces the roles' channels, an
   * empty list switches the event off for that user, no entry follows the roles. */
  fromRoles?: Record<string, string[]>
}

export default function RoleNotificationsEditor({ catalog, registry, permissions, value, onChange, readOnly, fromRoles }: Props) {
  const personal = !!fromRoles
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const granted = useMemo(() => expandGrants(registry, permissions), [registry, permissions])
  const channels = catalog.channels

  const specOf = (key: string): NotificationEventSpec | undefined => {
    const [mk, ek] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)]
    return catalog.modules[mk]?.events[ek]
  }
  const isDirect = (key: string) => specOf(key)?.audience === 'direct'
  const setEvent = (key: string, chans: string[]) => {
    if (readOnly) return
    const next = { ...value }
    // A direct notification keeps an empty entry = "off" (no entry = its default channels).
    if (chans.length || personal || isDirect(key)) next[key] = channels.map((c) => c.key).filter((c) => chans.includes(c))
    else delete next[key]
    onChange?.(next)
  }
  // What applies for an event: the personal entry if there is one, else the roles',
  // else (direct notifications only) the event's default channels.
  const shown = (key: string) => {
    if (key in value) return value[key]
    if (personal && fromRoles && key in fromRoles) return fromRoles[key]
    return isDirect(key) ? (specOf(key)?.default_channels || []) : []
  }
  /** true when a direct notification follows its default channels here */
  const onDefault = (key: string) => isDirect(key) && !(key in value) && !(personal && fromRoles && key in fromRoles)
  const toggle = (key: string, channel: string) => {
    const cur = shown(key)
    setEvent(key, cur.includes(channel) ? cur.filter((c) => c !== channel) : [...cur, channel])
  }
  const followRoles = (key: string) => {
    if (readOnly) return
    const next = { ...value }
    delete next[key]
    onChange?.(next)
  }
  const permLabel = (id: string) => permissionWords(registry, id)

  const q = query.trim().toLowerCase()
  const modules = Object.entries(catalog.modules).filter(([, m]) =>
    !q || m.label.toLowerCase().includes(q) || Object.values(m.events).some((e) => e.label.toLowerCase().includes(q)))

  if (Object.keys(catalog.modules).length === 0) {
    return <p style={{ fontSize: 13, color: SHEET.MUTED }}>No module has notifiable events yet.</p>
  }

  return (
    <div data-tour="org-role-notifications">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search module or event…" style={{ ...sheetInput, maxWidth: 280 }} />
        <span style={{ fontSize: 12, color: SHEET.MUTED }}>
          {personal
            ? `${Object.keys(value).length} personal change${Object.keys(value).length === 1 ? '' : 's'} · faded ticks come from this user's roles or the default`
            : `${Object.keys(value).length} setting${Object.keys(value).length === 1 ? '' : 's'} changed · faded ticks are the default`}
        </span>
      </div>
      <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
        <b style={{ color: SHEET.INK }}>Sent to a person directly</b>: the portal picks who gets it (the assignee, the requester, the approver …).
        Ticks here only choose how those people are told; they never add people. <b style={{ color: SHEET.INK }}>Watch everyone&apos;s activity</b>: every
        member of this role is told about other people&apos;s records too. Use it only for supervisors.
      </p>
      {modules.map(([mk, m]) => {
        const evs = Object.entries(m.events)
        const shownEvs = evs.filter(([, e]) => !q || e.label.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
        // Changed here = an explicit entry in this role / for this user (defaults don't count).
        const on = evs.filter(([ek]) => `${mk}.${ek}` in value).length
        const isOpen = !!open[mk] || !!q
        return (
          <div key={mk} style={{ marginBottom: 12, borderRadius: 12, border: `1px solid ${SHEET.LINE}`, overflow: 'hidden', background: '#fff' }}>
            {/* ui-audit-ignore-next-line custom-button — full-width accordion section header, not an action pill */}
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [mk]: !isOpen }))}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'rgba(244,113,59,0.06)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <span style={{ fontSize: 11, color: SHEET.MUTED, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: SHEET.INK }}>{m.label}</span>
              <span style={{ ...pillStyle(on ? '#047857' : '#64748b'), fontWeight: 600 }}>
                {on ? `${on} changed` : 'Default'}
              </span>
            </button>
            {isOpen && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                      <th style={th('left')}>Event <RowCount count={shownEvs.length} /></th>
                      {channels.map((c) => <th key={c.key} style={th('center')}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(['direct', 'watchers'] as const).map((aud) => {
                      const rows = shownEvs.filter(([, e]) => (e.audience || 'watchers') === aud)
                      if (!rows.length) return null
                      return (
                        <Fragment key={aud}>
                          <tr style={{ borderTop: `1px solid ${SHEET.LINE}`, background: 'rgba(0,0,0,0.015)' }}>
                            <td colSpan={channels.length + 1} style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, color: SHEET.MUTED, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                              {aud === 'direct' ? 'Sent to a person directly' : 'Watch everyone’s activity (supervisors)'}
                            </td>
                          </tr>
                    {rows.map(([ek, e]) => {
                      const key = `${mk}.${ek}`
                      const cur = shown(key)
                      const own = personal && key in value
                      const kind = KIND[e.kind] || KIND.info
                      const canReceive = !e.access || granted.has(e.access)
                      const dflt = onDefault(key)
                      const direct = e.audience === 'direct'
                      // An approval request always reaches the bell (backend utils/notifications._deliver).
                      const bellLocked = direct && e.kind === 'approval'
                      return (
                        <tr key={ek} style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
                          <td style={{ padding: '8px 14px', fontSize: 12.5, color: SHEET.BODY }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, color: SHEET.INK }}>{e.label}</span>
                              <span style={{ ...pillStyle(kind.c), background: kind.bg, fontSize: 10.5, padding: '1px 7px' }}>{kind.text}</span>
                              {!readOnly && !direct && !cur.length && !own && (
                                <button type="button" onClick={() => setEvent(key, e.default_channels)} style={{ fontSize: 11.5, fontWeight: 600, color: SHEET.BLUE, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                  + Subscribe
                                </button>
                              )}
                              {own && (
                                <span style={{ ...pillStyle('#1d4ed8'), fontSize: 10.5, padding: '1px 7px' }}>
                                  {cur.length ? 'Only for this user' : 'Off for this user'}
                                </span>
                              )}
                              {own && !readOnly && (
                                <button type="button" onClick={() => followRoles(key)} style={{ fontSize: 11.5, fontWeight: 600, color: SHEET.BLUE, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                  Follow roles
                                </button>
                              )}
                            </div>
                            {direct && dflt && (
                              <div style={{ marginTop: 3 }}><span style={{ ...pillStyle('#64748b'), fontSize: 10.5, padding: '1px 7px' }}>Default</span></div>
                            )}
                            {direct && !personal && !readOnly && key in value && (
                              <button type="button" onClick={() => followRoles(key)} style={{ fontSize: 11.5, fontWeight: 600, color: SHEET.BLUE, background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 3 }}>
                                Reset to default
                              </button>
                            )}
                            {direct
                              ? <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>To: <b style={{ color: SHEET.BODY }}>{e.recipient || 'The person concerned'}</b>. Sent when {e.trigger}.{bellLocked ? ' The portal bell is always on for approvals.' : !cur.length ? ' Switched off: they will not be told.' : ''}</div>
                              : <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>To: every member of this role. Sent when {e.trigger}. Needs: {e.access ? permLabel(e.access) : '—'}.</div>}
                            {cur.length > 0 && !canReceive && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#b45309', marginTop: 3 }}>
                                <SheetIcon name="alert" size={13} color="#b45309" />
                                {personal ? 'This user doesn’t hold that permission, so they won’t receive it.' : <>This role doesn&apos;t grant that permission — members get it only if another role or an extra grant gives it.</>}
                              </div>
                            )}
                          </td>
                          {channels.map((c) => (
                            <td key={c.key} style={{ padding: 6, textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', opacity: ((personal && !own) || dflt) && cur.includes(c.key) ? 0.55 : 1 }} title={dflt && cur.includes(c.key) ? 'Default — click to change it' : personal && !own && cur.includes(c.key) ? 'From this user’s roles — click to change it for this user only' : undefined}>
                                <Checkbox checked={cur.includes(c.key) || (bellLocked && c.key === 'bell')} disabled={readOnly || (bellLocked && c.key === 'bell')} onChange={() => toggle(key, c.key)} />
                              </div>
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function th(align: 'left' | 'center'): React.CSSProperties {
  return { textAlign: align, padding: '8px 6px', paddingLeft: align === 'left' ? 14 : 6, fontSize: 10.5, fontWeight: 700, color: SHEET.MUTED, textTransform: 'uppercase', whiteSpace: 'nowrap' }
}
