'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { storeApi, usersApi } from '@/lib/api'
import { DirectoryUser, StoreDocType, StoreDocTypeKind } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const EFFECTS: Partial<Record<StoreDocTypeKind, { value: string; label: string; hint: string }[]>> = {
  stock_entry: [
    { value: 'in', label: 'Stock in', hint: 'Adds to on-hand stock' },
    { value: 'out', label: 'Stock out', hint: 'Removes from on-hand stock' },
  ],
  return_condition: [
    { value: 'usable', label: 'Usable stock', hint: 'Goes back to on-hand stock, can be issued again' },
    { value: 'quarantine', label: 'Quarantine', hint: 'Held separately, not issuable until scrapped / returned to vendor / released' },
  ],
}
const EFFECT_LABELS: Record<string, string> = { in: 'Stock in', out: 'Stock out', usable: 'Usable stock', quarantine: 'Quarantine' }
const EFFECT_HEX: Record<string, string> = { in: '#16a34a', out: '#dc2626', usable: '#16a34a', quarantine: '#d97706' }

const RULES = [
  { value: 'none', label: 'No approval — posts immediately' },
  { value: 'warehouse_manager', label: 'Store in-charge (Stores → Manager)' },
  { value: 'department_head', label: 'Head of the department the material belonged to' },
  { value: 'specific_users', label: 'Specific users (e.g. QC in-charge)' },
]
const RULE_SHORT: Record<string, string> = {
  none: 'None', warehouse_manager: 'Store in-charge', department_head: 'Department head', specific_users: 'Specific users',
}

type Form = { label: string; stock_effect: string; requires_issue: boolean; approver_rule: string; approver_user_ids: number[]; is_active: boolean }
const EMPTY: Form = { label: '', stock_effect: '', requires_issue: false, approver_rule: 'none', approver_user_ids: [], is_active: true }

const th = { position: 'sticky' as const, top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left' as const, padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: TEXT.muted }
const td = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }
const lbl = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }

/** One Store → Settings list of configurable types. Each kind carries the
 *  behaviour the system acts on (stock effect, issue reference, approval),
 *  so the form only shows the fields that kind uses. */
export default function DocTypeSettings({ kind, title, noun, intro }: { kind: StoreDocTypeKind; title: string; noun: string; intro: string }) {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [rows, setRows] = useState<StoreDocType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<StoreDocType | 'new' | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<StoreDocType | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<string[]>([])
  // Only stock entry / issue types can be deleted (and only while unused —
  // the backend explains why when it refuses); the rest are deactivated.
  const canDelete = kind === 'stock_entry' || kind === 'issue'

  const effects = EFFECTS[kind]
  const hasApproval = kind === 'return_source' || kind === 'return_condition'
  const close = () => !saving && setEditing(null)
  useEscapeKey(editing !== null, close)

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await storeApi.deleteDocType(kind, deleteTarget.value)
      setRows((r) => r.filter((x) => x.value !== deleteTarget.value))
    } catch (err) {
      setDeleteErrors(extractErrorMessages(err, `Failed to delete ${noun} ${deleteTarget.label}.`))
    } finally {
      setDeleteTarget(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      setRows(await storeApi.listDocTypes(kind, true))
    } catch (err) {
      setLoadError(extractErrorMessages(err, `Failed to load ${noun}s.`).join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    load()
    if (hasApproval) usersApi.directory().then(setUsers).catch(() => setUsers([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const open = (t: StoreDocType | 'new') => {
    setForm(t === 'new' ? { ...EMPTY, stock_effect: effects?.[0].value || '' } : {
      label: t.label, stock_effect: t.stock_effect || '', requires_issue: t.requires_issue,
      approver_rule: t.approver_rule, approver_user_ids: t.approver_user_ids, is_active: t.is_active,
    })
    setErrors([])
    setUserSearch('')
    setEditing(t)
  }

  const save = async () => {
    if (!form.label.trim()) { setErrors([`Enter the ${noun} name.`]); return }
    if (form.approver_rule === 'specific_users' && !form.approver_user_ids.length) { setErrors(['Pick at least one approver.']); return }
    setSaving(true)
    setErrors([])
    const payload = {
      label: form.label.trim(), stock_effect: effects ? form.stock_effect : null, requires_issue: form.requires_issue,
      approver_rule: hasApproval ? form.approver_rule : 'none', approver_user_ids: form.approver_rule === 'specific_users' ? form.approver_user_ids : [],
      is_active: form.is_active,
    }
    try {
      if (editing === 'new') await storeApi.createDocType(kind, payload)
      else if (editing) await storeApi.updateDocType(kind, editing.value, payload)
      setEditing(null)
      load()
    } catch (err) {
      setErrors(extractErrorMessages(err, `Could not save the ${noun}.`))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const headers = ['Name', ...(effects ? ['Stock Effect'] : []), ...(kind === 'return_source' ? ['Issue Ref'] : []), ...(hasApproval ? ['Approval'] : []), 'Status', '']
  const userMatches = userSearch.trim()
    ? users.filter((u) => !form.approver_user_ids.includes(u.id) && `${u.name} ${u.email}`.toLowerCase().includes(userSearch.trim().toLowerCase())).slice(0, 8)
    : []
  const userName = (id: number) => { const u = users.find((x) => x.id === id); return u ? u.name || u.email : `User #${id}` }

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory · Settings
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{title}</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px', maxWidth: 640 }}>{intro}</p>
        </div>
        <button data-tour={`doctype-${kind}-add-btn`} onClick={() => open('new')} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add {noun.replace(/^\w/, (c) => c.toUpperCase())}
        </button>
      </div>

      <StoreSettingsNav />

      <MessageDialog open={!!loadError} variant="error" title={`Failed to Load ${title}`} message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={deleteErrors.length > 0} variant="error" title={`Cannot Delete ${noun.replace(/^./, (c) => c.toUpperCase())}`} message={deleteErrors} onClose={() => setDeleteErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete this ${noun}?`}
        message={`This permanently removes "${deleteTarget?.label}". This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {editing !== null && (
        <div onClick={close} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: TEXT.heading }}>{editing === 'new' ? `Add ${noun}` : `Edit ${noun}`}</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Name *</label>
              <input autoFocus style={inputStyle} value={form.label} maxLength={100} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>

            {effects && (
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>What it does to stock *</label>
                {effects.map((e) => (
                  <label key={e.value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: TEXT.body, marginBottom: 6, cursor: editing === 'new' ? 'pointer' : 'not-allowed', opacity: editing !== 'new' && form.stock_effect !== e.value ? 0.5 : 1 }}>
                    <input type="radio" disabled={editing !== 'new'} checked={form.stock_effect === e.value} onChange={() => setForm({ ...form, stock_effect: e.value })} style={{ marginTop: 3 }} />
                    <span><b>{e.label}</b> — {e.hint}</span>
                  </label>
                ))}
                {editing !== 'new' && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>Can&apos;t be changed after creation — documents were already posted with it. Deactivate this one and add a new {noun} instead.</p>}
              </div>
            )}

            {kind === 'return_source' && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: TEXT.body, marginBottom: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.requires_issue} onChange={(e) => setForm({ ...form, requires_issue: e.target.checked })} />
                Must reference a Material Issue (quantity checked against what was issued)
              </label>
            )}

            {hasApproval && (
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Who approves returns using this {noun}?</label>
                <select style={inputStyle} value={form.approver_rule} onChange={(e) => setForm({ ...form, approver_rule: e.target.value })}>
                  {RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {form.approver_rule === 'specific_users' && (
                  <div style={{ marginTop: 10 }}>
                    {form.approver_user_ids.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {form.approver_user_ids.map((id) => (
                          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, background: `${BRAND.primary}1a`, color: BRAND.primaryActive, fontSize: 12, fontWeight: 600 }}>
                            {userName(id)}
                            <span style={{ cursor: 'pointer' }} onClick={() => setForm({ ...form, approver_user_ids: form.approver_user_ids.filter((x) => x !== id) })}>×</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <input style={inputStyle} value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search user by name or email…" />
                    {userMatches.length > 0 && (
                      <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, marginTop: 4, overflow: 'hidden' }}>
                        {userMatches.map((u) => (
                          <div key={u.id} onClick={() => { setForm({ ...form, approver_user_ids: [...form.approver_user_ids, u.id] }); setUserSearch('') }}
                            style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                            <b>{u.name}</b> <span style={{ color: TEXT.muted }}>{u.email}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {form.approver_rule !== 'none' && <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>The person who raises the return can never approve it, even if they are in this list.</p>}
              </div>
            )}

            {editing !== 'new' && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: TEXT.body, marginBottom: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Active (inactive types stay on old documents but can&apos;t be picked on new ones)
              </label>
            )}

            {errors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      <div data-tour={`doctype-${kind}-table`} style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr>{headers.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No {noun}s yet.</td></tr>}
            {!loading && rows.map((t) => (
              <tr key={t.value} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', opacity: t.is_active ? 1 : 0.55 }}>
                <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{t.label}</td>
                {effects && (
                  <td style={td}>
                    {t.stock_effect && <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${EFFECT_HEX[t.stock_effect]}1a`, color: EFFECT_HEX[t.stock_effect], whiteSpace: 'nowrap' }}>{EFFECT_LABELS[t.stock_effect]}</span>}
                  </td>
                )}
                {kind === 'return_source' && <td style={td}>{t.requires_issue ? 'Required' : '—'}</td>}
                {hasApproval && (
                  <td style={td}>
                    {RULE_SHORT[t.approver_rule]}
                    {t.approver_rule === 'specific_users' && (
                      <div style={{ fontSize: 12, color: t.approver_names.length ? TEXT.muted : '#b91c1c' }}>{t.approver_names.join(', ') || 'No approvers set — returns will be blocked'}</div>
                    )}
                  </td>
                )}
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: t.is_active ? `${BRAND.primary}1a` : 'rgba(100,116,139,0.12)', color: t.is_active ? BRAND.primaryActive : TEXT.muted }}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '0 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span onClick={() => open(t)} style={{ color: '#FF6A2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>
                  {canDelete && <span onClick={() => setDeleteTarget(t)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginLeft: 14 }}>Delete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
