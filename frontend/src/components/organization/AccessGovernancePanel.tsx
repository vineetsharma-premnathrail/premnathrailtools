'use client'

import { useCallback, useEffect, useState } from 'react'
import DateField from '@/components/erp/DateField'
import { grcApi, AccessValidityRow, DenialRow } from '@/lib/basisApi'
import { extractErrorMessages } from '@/lib/validation'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { FormSheet, SheetSection, SheetIcon, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { usePermissionWords } from '@/lib/permissionWords'

// Users › one user: validity dates (PFUD) on each role / extra grant, and the
// denied-access trace (SU53) — what this user was refused, and which roles
// would grant it.

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 9px', fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '8px 9px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }

interface Item { kind: 'role' | 'grant'; role_id?: number; permission?: string; label: string }

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return y && m && day ? `${day}-${m}-${y}` : d
}

function fmt(d?: string | null) {
  if (!d) return '—'
  const x = new Date(d)
  return `${x.toLocaleDateString('en-GB')} ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export default function AccessGovernancePanel({ userId, roles, extras, canEdit, canViewTrace }: {
  userId: number
  roles: { id: number; name: string }[]
  extras: string[]
  canEdit: boolean
  canViewTrace: boolean
}) {
  const [rows, setRows] = useState<AccessValidityRow[]>([])
  const [editing, setEditing] = useState<Item | null>(null)
  const [form, setForm] = useState({ from: '', to: '', reason: '' })
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [denials, setDenials] = useState<DenialRow[]>([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const { permLabel } = usePermissionWords()

  const load = useCallback(() => {
    grcApi.validity(userId).then(setRows).catch((e) => setError(extractErrorMessages(e, 'Could not load validity dates.').join(' ')))
    if (canViewTrace) grcApi.denials({ user_id: userId, days: 30 }).then(setDenials).catch(() => setDenials([]))
  }, [userId, canViewTrace])
  useEffect(() => { load() }, [load])

  const items: Item[] = [
    ...roles.map((r) => ({ kind: 'role' as const, role_id: r.id, label: `Role: ${r.name}` })),
    ...extras.map((p) => ({ kind: 'grant' as const, permission: p, label: `Extra: ${permLabel(p)}` })),
  ]
  const keyOf = (i: Item) => (i.kind === 'role' ? `r${i.role_id}` : `g${i.permission}`)
  const rowOf = (i: Item) => rows.find((r) => (i.kind === 'role' ? r.kind === 'role' && r.role_id === i.role_id : r.kind === 'grant' && r.permission === i.permission))
  const valueOf = (i: Item) => {
    const r = rowOf(i)
    return { from: r?.valid_from || '', to: r?.valid_to || '', reason: r?.reason || '' }
  }
  const openEdit = (i: Item) => { setForm(valueOf(i)); setFormError(''); setEditing(i) }

  const save = async () => {
    const i = editing
    if (!i) return
    const v = form
    setError(''); setSaved(''); setFormError(''); setBusy(true)
    try {
      const out = await grcApi.setValidity(userId, {
        kind: i.kind, role_id: i.role_id ?? null, permission: i.permission ?? null,
        valid_from: v.from || null, valid_to: v.to || null, reason: v.reason || null,
      })
      setRows(out)
      setEditing(null)
      setSaved(v.from || v.to ? `Validity saved for ${i.label}. It is removed automatically the day after "valid to".` : `${i.label} is now permanent.`)
    } catch (e) {
      setFormError(extractErrorMessages(e, 'Could not save the validity dates.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Access validity (temporary access)</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
          Give a role or extra grant a start and end date — e.g. cover for a colleague on leave. Outside the dates it grants nothing,
          and a daily job removes it once the end date has passed (the user and admins get a notification). Leave both empty for permanent access.
        </p>
        {error && <div style={errBox}>{error}</div>}
        {saved && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{saved}</div>}
        {items.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No roles or extra grants assigned yet — save roles first.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr><th style={th}>Access</th><th style={th}>Valid from</th><th style={th}>Valid to</th><th style={th}>Reason</th><th style={th}>State</th><th style={th}></th></tr></thead>
              <tbody>
                {items.map((i) => {
                  const v = valueOf(i)
                  const r = rowOf(i)
                  return (
                    <tr key={keyOf(i)}>
                      <td style={{ ...td, fontWeight: 600 }}>{i.label}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(v.from)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(v.to)}</td>
                      <td style={{ ...td, minWidth: 180 }}>{v.reason || '—'}</td>
                      <td style={td}>
                        {!r ? <span style={{ color: TEXT.muted }}>Permanent</span>
                          : <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${r.active ? '#16A34A' : '#F59E0B'}1a`, color: r.active ? '#16A34A' : '#F59E0B' }}>{r.active ? 'Active' : 'Not active today'}</span>}
                      </td>
                      <td style={td}>{canEdit && <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => openEdit(i)}><SheetIcon name="calendar" size={14} />Set dates</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <FormSheet width={580} icon="calendar" title="Access validity" subtitle={`${editing.label}`}
          onClose={() => setEditing(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setEditing(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>
              <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formError && <div style={errBox}>{formError}</div>}
            <SheetSection icon="calendar" title="Validity">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>Valid from <Optional /></label>
                  <DateField value={form.from} onChange={(x) => setForm((f) => ({ ...f, from: x }))} />
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>Valid to <Optional /></label>
                  <DateField value={form.to} onChange={(x) => setForm((f) => ({ ...f, to: x }))} />
                </div>
              </div>
              <p style={sheetHint}>Outside these dates the access grants nothing; a daily job removes it the day after &quot;valid to&quot;. Leave both empty for permanent access.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Reason">
              <label style={sheetLabel}>Why is it temporary? <Optional /></label>
              <input style={sheetInput} value={form.reason} placeholder="e.g. covering leave" onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {canViewTrace && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Denied access — last 30 days</h2>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
            Every request this user was refused, with the exact permission that was missing and the roles that would grant it.
          </p>
          {denials.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Nothing was refused in the last 30 days.</p> : (
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr><th style={th}>When</th><th style={th}>Missing permission</th><th style={th}>Request</th><th style={th}>Times</th><th style={th}>Granted by role</th></tr></thead>
                <tbody>
                  {denials.map((d) => (
                    <tr key={d.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(d.occurred_at)}</td>
                      <td style={td}><b>{d.permission_key ? permLabel(d.permission_key) : (d.permission_label || 'Record-level rule')}</b>{!d.permission_key && d.detail && <div style={{ fontSize: 11, color: TEXT.muted }}>{d.detail.slice(0, 140)}</div>}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{d.method} {d.path}</td>
                      <td style={td}>{d.repeat_count}</td>
                      <td style={td}>{d.granted_by_roles.length ? d.granted_by_roles.map((r) => r.name).join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
