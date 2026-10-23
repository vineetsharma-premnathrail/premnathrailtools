'use client'

import { useMemo, useState } from 'react'
import { PermissionRegistry } from '@/types'
import Checkbox from '@/components/Checkbox'
import { SHEET, SheetIcon, sheetInput } from '@/components/shared/FormSheet'
import { expandGrants } from '@/components/organization/PermissionMatrixEditor'
import { permissionWords } from '@/lib/permissionWords'

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
  /** permission id a member needs to receive it */
  access: string
  kind: 'approval' | 'assignment' | 'reminder' | 'info'
  default_channels: string[]
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
}

export default function RoleNotificationsEditor({ catalog, registry, permissions, value, onChange, readOnly }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const granted = useMemo(() => expandGrants(registry, permissions), [registry, permissions])
  const channels = catalog.channels

  const setEvent = (key: string, chans: string[]) => {
    if (readOnly) return
    const next = { ...value }
    if (chans.length) next[key] = channels.map((c) => c.key).filter((c) => chans.includes(c))
    else delete next[key]
    onChange?.(next)
  }
  const toggle = (key: string, channel: string) => {
    const cur = value[key] || []
    setEvent(key, cur.includes(channel) ? cur.filter((c) => c !== channel) : [...cur, channel])
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
        <span style={{ fontSize: 12, color: SHEET.MUTED }}>{Object.keys(value).length} event{Object.keys(value).length === 1 ? '' : 's'} subscribed</span>
      </div>
      {modules.map(([mk, m]) => {
        const evs = Object.entries(m.events)
        const on = evs.filter(([ek]) => value[`${mk}.${ek}`]?.length).length
        const isOpen = !!open[mk] || !!q
        return (
          <div key={mk} style={{ marginBottom: 12, borderRadius: 12, border: `1px solid ${SHEET.LINE}`, overflow: 'hidden', background: '#fff' }}>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [mk]: !isOpen }))}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'rgba(244,113,59,0.06)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <span style={{ fontSize: 11, color: SHEET.MUTED, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: SHEET.INK }}>{m.label}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: on ? 'rgba(16,185,129,0.12)' : 'rgba(0,0,0,0.05)', color: on ? '#047857' : SHEET.MUTED }}>
                {on ? `${on} / ${evs.length}` : 'None'}
              </span>
            </button>
            {isOpen && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                      <th style={th('left')}>Event</th>
                      {channels.map((c) => <th key={c.key} style={th('center')}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {evs.filter(([, e]) => !q || e.label.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)).map(([ek, e]) => {
                      const key = `${mk}.${ek}`
                      const cur = value[key] || []
                      const kind = KIND[e.kind] || KIND.info
                      const canReceive = granted.has(e.access)
                      return (
                        <tr key={ek} style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
                          <td style={{ padding: '8px 14px', fontSize: 12.5, color: SHEET.BODY }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, color: SHEET.INK }}>{e.label}</span>
                              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 9999, background: kind.bg, color: kind.c }}>{kind.text}</span>
                              {!readOnly && !cur.length && (
                                <button type="button" onClick={() => setEvent(key, e.default_channels)} style={{ fontSize: 11.5, fontWeight: 600, color: SHEET.BLUE, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                  + Subscribe
                                </button>
                              )}
                            </div>
                            <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>Sent when {e.trigger}. Needs: {permLabel(e.access)}.</div>
                            {cur.length > 0 && !canReceive && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#b45309', marginTop: 3 }}>
                                <SheetIcon name="alert" size={13} color="#b45309" />
                                This role doesn&apos;t grant that permission — members get it only if another role or an extra grant gives it.
                              </div>
                            )}
                          </td>
                          {channels.map((c) => (
                            <td key={c.key} style={{ padding: 6, textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex' }}>
                                <Checkbox checked={cur.includes(c.key)} disabled={readOnly} onChange={() => toggle(key, c.key)} />
                              </div>
                            </td>
                          ))}
                        </tr>
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
  return { textAlign: align, padding: '8px 6px', paddingLeft: align === 'left' ? 14 : 6, fontSize: 10.5, fontWeight: 700, color: SHEET.MUTED, textTransform: 'uppercase' }
}
