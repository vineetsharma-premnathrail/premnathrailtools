'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { storeApi } from '@/lib/api'
import { StoreDocType, StoreDocTypeKind } from '@/types'
import { TEXT, GLASS, SHADOWS, SUCCESS } from '@/lib/theme'
import { primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

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

// Who approves a Material Return is set in Organization › Approval Workflows
// (workflow "Material return"); these are the default stages it started from.
const WORKFLOWS_HREF = '/dashboard/organization/workflows'
const RULE_SHORT: Record<string, string> = {
  none: 'None', warehouse_manager: 'Store in-charge', department_head: 'Department head', specific_users: 'Specific users',
}

type Form = { label: string; stock_effect: string; requires_issue: boolean; approver_rule: string; approver_user_ids: number[]; is_active: boolean }
const EMPTY: Form = { label: '', stock_effect: '', requires_issue: false, approver_rule: 'none', approver_user_ids: [], is_active: true }

const th = { position: 'sticky' as const, top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left' as const, padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: TEXT.muted, whiteSpace: 'nowrap' as const }
const td = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }

/** One Store → Settings list of configurable types. Each kind carries the
 *  behaviour the system acts on (stock effect, issue reference, approval),
 *  so the form only shows the fields that kind uses. */
export default function DocTypeSettings({ kind, title, noun, intro }: { kind: StoreDocTypeKind; title: string; noun: string; intro: string }) {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const perm = useCan()
  // Which Store › Settings tab manages this list (mirrors the backend's
  // _KIND_TAB): return sources / conditions fall under General settings.
  const tabKey = kind === 'stock_entry' ? 'entry_types' : kind === 'issue' ? 'issue_types' : 'settings'
  const canCreate = tabKey === 'settings' ? perm.can('store', 'settings', 'edit') : perm.can('store', tabKey, 'create')
  const canEdit = perm.can('store', tabKey, 'edit')
  const [rows, setRows] = useState<StoreDocType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<StoreDocType | 'new' | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StoreDocType | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<string[]>([])
  // Only stock entry / issue types can be deleted (and only while unused —
  // the backend explains why when it refuses); the rest are deactivated.
  const canDelete = (kind === 'stock_entry' || kind === 'issue') && perm.canDelete('store', tabKey, null)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const open = (t: StoreDocType | 'new') => {
    setForm(t === 'new' ? { ...EMPTY, stock_effect: effects?.[0].value || '' } : {
      label: t.label, stock_effect: t.stock_effect || '', requires_issue: t.requires_issue,
      approver_rule: t.approver_rule, approver_user_ids: t.approver_user_ids, is_active: t.is_active,
    })
    setErrors([])
    setEditing(t)
  }

  const save = async () => {
    if (!form.label.trim()) { setErrors([`Enter the ${noun} name.`]); return }
    setSaving(true)
    setErrors([])
    const payload = {
      label: form.label.trim(), stock_effect: effects ? form.stock_effect : null, requires_issue: form.requires_issue,
      // Approval is read-only here (sent back unchanged) — edited in Organization › Approval Workflows.
      approver_rule: hasApproval ? form.approver_rule : 'none', approver_user_ids: hasApproval ? form.approver_user_ids : [],
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

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory · Settings
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{title}</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px', maxWidth: 640 }}>{intro}</p>
        </div>
        {canCreate && (
          <button data-tour={`doctype-${kind}-add-btn`} onClick={() => open('new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add {noun.replace(/^\w/, (c) => c.toUpperCase())}
          </button>
        )}
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
        <FormSheet width={580} icon={editing === 'new' ? 'plus' : 'edit'} title={editing === 'new' ? `Add ${noun}` : `Edit ${noun}`}
          subtitle={editing === 'new' ? `A new ${noun} for the ${title} list.` : `“${editing.label}” — changes apply to new documents.`}
          onClose={close} busy={saving}
          footer={<>
            <button data-tour="store-doctype-cancel-btn" type="button" onClick={close} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="store-doctype-save-btn" type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {errors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="list" title="Basic Information">
              <div data-tour="store-doctype-name">
                <label style={sheetLabel}>Name <Req /></label>
                <input autoFocus style={sheetInput} value={form.label} maxLength={100} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
            </SheetSection>

            {(effects || kind === 'return_source') && (
              <SheetSection icon="box" title="Behaviour">
                {effects && (
                  <div data-tour="store-doctype-effect">
                    <label style={sheetLabel}>What it does to stock <Req /></label>
                    {effects.map((e) => (
                      <label key={e.value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: SHEET.BODY, marginBottom: 6, cursor: editing === 'new' ? 'pointer' : 'not-allowed', opacity: editing !== 'new' && form.stock_effect !== e.value ? 0.5 : 1 }}>
                        <input type="radio" disabled={editing !== 'new'} checked={form.stock_effect === e.value} onChange={() => setForm({ ...form, stock_effect: e.value })} style={{ marginTop: 3 }} />
                        <span><b>{e.label}</b> — {e.hint}</span>
                      </label>
                    ))}
                    {editing !== 'new' && <p style={sheetHint}>Can&apos;t be changed after creation — documents were already posted with it. Deactivate this one and add a new {noun} instead.</p>}
                  </div>
                )}
                {kind === 'return_source' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: SHEET.BODY, marginTop: effects ? 12 : 0, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.requires_issue} onChange={(e) => setForm({ ...form, requires_issue: e.target.checked })} />
                    Must reference a Material Issue (quantity checked against what was issued)
                  </label>
                )}
              </SheetSection>
            )}

            {hasApproval && (
              <SheetSection icon="shield" title="Approval">
                <div style={{ padding: '10px 12px', borderRadius: 10, background: SHEET.SOFT, border: `1px solid ${SHEET.LINE}`, fontSize: 12.5, color: SHEET.BODY }}>
                  Who approves returns using this {noun} is set in{' '}
                  <Link href={WORKFLOWS_HREF} style={{ color: SHEET.BLUE, fontWeight: 600 }}>Organization › Approval Workflows › Material return</Link>.
                  {' '}Default: {RULE_SHORT[form.approver_rule] || form.approver_rule}.
                </div>
              </SheetSection>
            )}

            {editing !== 'new' && (
              <SheetSection icon="flag" title="Status">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  Active (inactive types stay on old documents but can&apos;t be picked on new ones)
                </label>
              </SheetSection>
            )}
          </div>
        </FormSheet>
      )}

      <div data-tour={`doctype-${kind}-table`} style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr>{headers.map((h, hi) => <th key={h} style={th}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No {noun}s yet{canCreate ? ` — use + Add ${noun.replace(/^\w/, (c) => c.toUpperCase())} to create the first one` : ''}.</td></tr>}
            {!loading && rows.map((t) => (
              <tr key={t.value} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', opacity: t.is_active ? 1 : 0.55 }}>
                <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{t.label}</td>
                {effects && (
                  <td style={td}>
                    {t.stock_effect ? <Pill label={EFFECT_LABELS[t.stock_effect] || t.stock_effect} hex={EFFECT_HEX[t.stock_effect] || '#64748b'} /> : '—'}
                  </td>
                )}
                {kind === 'return_source' && <td style={td}>{t.requires_issue ? 'Required' : '—'}</td>}
                {hasApproval && (
                  <td style={td}>
                    {t.approver_rule === 'none' ? 'None' : <>Default: {RULE_SHORT[t.approver_rule] || t.approver_rule.replace(/_/g, ' ')}</>}
                    {t.approver_rule !== 'none' && (
                      <div style={{ fontSize: 12 }}><Link href={WORKFLOWS_HREF} style={{ color: '#FF6A2A' }}>Set in Approval Workflows</Link></div>
                    )}
                  </td>
                )}
                <td style={td}>
                  <Pill label={t.is_active ? 'Active' : 'Inactive'} hex={t.is_active ? SUCCESS.hover : TEXT.muted} />
                </td>
                <td style={{ padding: '0 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canEdit && <span data-tour="store-doctype-edit-link" onClick={() => open(t)} style={{ color: '#FF6A2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>}
                  {canDelete && <span data-tour="store-doctype-delete-link" onClick={() => setDeleteTarget(t)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginLeft: 14 }}>Delete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
