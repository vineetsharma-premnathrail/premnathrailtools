'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrChecklistTemplate, HrLifecycleEventType, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { Field, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'

const TYPES: { value: HrLifecycleEventType; label: string; hex: string }[] = [
  { value: 'joining', label: 'Joining', hex: '#16A34A' },
  { value: 'confirmation', label: 'Confirmation', hex: '#0891B2' },
  { value: 'transfer', label: 'Transfer', hex: '#2563EB' },
  { value: 'promotion', label: 'Promotion', hex: '#7C3AED' },
  { value: 'exit', label: 'Exit', hex: '#DC2626' },
]
const CATEGORY_LABELS: Record<string, string> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager: 'Manager', store: 'Store' }
const CATEGORY_HEX: Record<string, string> = { hr: '#FF6A2A', it: '#2563EB', admin: '#7C3AED', finance: '#16A34A', manager: '#0891B2', store: '#B45309' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

interface FormState { id: number | null; category: string; title: string; description: string; default_owner_user_id: string; sort_order: string; is_active: boolean }
const EMPTY: FormState = { id: null, category: 'hr', title: '', description: '', default_owner_user_id: '', sort_order: '', is_active: true }

export default function ChecklistTemplatesMaster() {
  const [type, setType] = useState<HrLifecycleEventType>('joining')
  const [rows, setRows] = useState<HrChecklistTemplate[]>([])
  const [meta, setMeta] = useState<HrLifecycleMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<HrChecklistTemplate | null>(null)

  const load = useCallback(() => {
    hrApi.listChecklistTemplates({ event_type: type })
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the checklist templates.')))
      .finally(() => setLoading(false))
  }, [type])

  useEffect(() => { load() }, [load])
  useEffect(() => { hrApi.getLifecycleMeta().then(setMeta).catch(() => setMeta(null)) }, [])

  const userOptions = useMemo(
    () => [{ value: '', label: '— No fixed owner —' }, ...(meta?.users || []).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.designation || u.email}` }))],
    [meta],
  )

  const save = async () => {
    if (!form) return
    setError([])
    if (!form.title.trim()) { setError(['Enter the checklist item title.']); return }
    if (form.sort_order && !/^\d+$/.test(form.sort_order)) { setError(['Order must be a whole number (lower shows first).']); return }
    setSaving(true)
    const payload: Record<string, unknown> = {
      event_type: type, category: form.category, title: form.title.trim(), description: form.description.trim() || null,
      default_owner_user_id: form.default_owner_user_id ? Number(form.default_owner_user_id) : null,
      is_active: form.is_active,
    }
    if (form.sort_order) payload.sort_order = Number(form.sort_order)
    try {
      if (form.id) await hrApi.updateChecklistTemplate(form.id, payload)
      else await hrApi.createChecklistTemplate(payload)
      setForm(null)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the checklist template.'))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (t: HrChecklistTemplate) => {
    setError([])
    try {
      await hrApi.updateChecklistTemplate(t.id, { is_active: !t.is_active })
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not update the template.'))
    }
  }

  const activeType = TYPES.find((t) => t.value === type)!

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Checklist Templates</h3>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            Copied onto every new lifecycle event of that type. Changing a template doesn&apos;t touch events already raised.
            Manager items with no fixed owner go to the employee&apos;s (new) manager.
          </p>
        </div>
        {!form && <button type="button" onClick={() => setForm({ ...EMPTY })} style={primaryBtnStyle}>+ Add item</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {TYPES.map((t) => {
          const active = t.value === type
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => { if (t.value !== type) setLoading(true); setType(t.value); setForm(null) }}
              style={{
                fontSize: 12.5, fontWeight: 600, padding: '6px 13px', borderRadius: 9999, cursor: 'pointer',
                border: active ? `1px solid ${t.hex}` : '1px solid rgba(0,0,0,0.1)',
                background: active ? `${t.hex}14` : 'rgba(255,255,255,0.7)', color: active ? t.hex : '#57534e',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      {form && (
        <div style={{ padding: 16, borderRadius: 14, border: `1px solid ${activeType.hex}40`, background: `${activeType.hex}06`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, marginBottom: 12 }}>{form.id ? 'Edit' : 'New'} {activeType.label.toLowerCase()} checklist item</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 140px', minWidth: 120 }}>
              <Field label="Category">
                <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: '1 1 280px', maxWidth: 440 }}>
              <Field label="Title *">
                <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Return ID / access card" />
              </Field>
            </div>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <Field label="Default owner">
                <SearchableSelect value={form.default_owner_user_id} onChange={(v) => setForm({ ...form, default_owner_user_id: v })} options={userOptions} placeholder="— No fixed owner —" />
              </Field>
            </div>
            <div style={{ flex: '0 1 90px', minWidth: 80 }}>
              <Field label="Order">
                <input style={inputStyle} inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value.replace(/[^0-9]/g, '') })} placeholder="auto" />
              </Field>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Description">
              <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — what exactly has to be checked" />
            </Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active (copied onto new events)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setForm(null)} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" disabled={saving} onClick={save} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ borderRadius: 14, border: `1px solid ${BORDER.light}`, overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>{['#', 'Category', 'Item', 'Default owner', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No {activeType.label.toLowerCase()} checklist items yet. Use + Add item.</td></tr>
            ) : rows.map((t) => (
              <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                <td style={{ ...td, width: 50, color: TEXT.muted }}>{t.sort_order}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${CATEGORY_HEX[t.category] || '#78716C'}1a`, color: CATEGORY_HEX[t.category] || '#78716C' }}>
                    {CATEGORY_LABELS[t.category] || t.category}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: TEXT.heading }}>{t.title}</div>
                  {t.description && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>{t.description}</div>}
                </td>
                <td style={td}>{t.default_owner_name || <span style={{ color: TEXT.muted }}>{t.category === 'manager' ? "Employee's manager" : '—'}</span>}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: t.is_active ? '#16A34A1a' : '#78716C1a', color: t.is_active ? '#16A34A' : '#78716C' }}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <span
                    onClick={() => setForm({
                      id: t.id, category: t.category, title: t.title, description: t.description || '',
                      default_owner_user_id: t.default_owner_user_id ? String(t.default_owner_user_id) : '', sort_order: String(t.sort_order), is_active: t.is_active,
                    })}
                    style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', marginRight: 12 }}
                  >Edit</span>
                  <span onClick={() => toggleActive(t)} style={{ fontSize: 12, fontWeight: 600, color: '#57534e', cursor: 'pointer', marginRight: 12 }}>
                    {t.is_active ? 'Deactivate' : 'Activate'}
                  </span>
                  <span onClick={() => setToDelete(t)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Delete</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete checklist template?"
        message={toDelete ? `“${toDelete.title}” won't be added to new ${toDelete.event_type} events. Events already raised keep their copy. To pause it instead, use Deactivate.` : ''}
        confirmLabel="Delete"
        danger
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const t = toDelete
          setToDelete(null)
          if (!t) return
          setError([])
          try {
            await hrApi.deleteChecklistTemplate(t.id)
            load()
          } catch (err) {
            setError(extractErrorMessages(err, 'Could not delete the template.'))
          }
        }}
      />
    </div>
  )
}
