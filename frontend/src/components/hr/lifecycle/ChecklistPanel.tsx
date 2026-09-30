'use client'

import { useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrChecklistItem, HrLifecycleEvent, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { Field, primaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'

const CATEGORY_ORDER = ['hr', 'manager', 'it', 'admin', 'store', 'finance']
const CATEGORY_LABELS: Record<string, string> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager: 'Manager', store: 'Store' }
const ITEM_STATUS_LABELS: Record<string, string> = { pending: 'Pending', done: 'Done', not_applicable: 'Not applicable' }
const ITEM_STATUS_HEX: Record<string, string> = { pending: '#F59E0B', done: '#16A34A', not_applicable: '#78716C' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const chip = (hex: string, active = false): React.CSSProperties => ({
  fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 9999, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1px solid ${hex}${active ? '' : '55'}`, background: active ? `${hex}1a` : '#fff', color: hex,
})
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

export default function ChecklistPanel({
  event, meta, isHr, onChanged,
}: {
  event: HrLifecycleEvent
  meta: HrLifecycleMeta | null
  isHr: boolean
  onChanged: () => void
}) {
  const open = event.status === 'draft' || event.status === 'in_progress'
  const [error, setError] = useState<string[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [naItem, setNaItem] = useState<HrChecklistItem | null>(null)
  const [remarkItem, setRemarkItem] = useState<HrChecklistItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<HrChecklistItem | null>(null)
  const [ownerEditId, setOwnerEditId] = useState<number | null>(null)
  const [newItem, setNewItem] = useState({ category: 'hr', title: '', owner_user_id: '' })
  const [adding, setAdding] = useState(false)

  const groups = useMemo(() => {
    const by: Record<string, HrChecklistItem[]> = {}
    for (const it of event.items) (by[it.category] ||= []).push(it)
    const keys = [...CATEGORY_ORDER.filter((k) => by[k]), ...Object.keys(by).filter((k) => !CATEGORY_ORDER.includes(k))]
    return keys.map((k) => ({ key: k, items: by[k] }))
  }, [event.items])

  const userOptions = useMemo(
    () => [{ value: '', label: '— Unassigned —' }, ...(meta?.users || []).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.designation || u.email}` }))],
    [meta],
  )

  const update = async (item: HrChecklistItem, payload: Record<string, unknown>) => {
    setBusyId(item.id)
    setError([])
    try {
      await hrApi.updateLifecycleItem(item.id, payload)
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not update the checklist item.'))
    } finally {
      setBusyId(null)
    }
  }

  const addItem = async () => {
    setError([])
    if (!newItem.title.trim()) { setError(['Enter what needs to be done for the new checklist item.']); return }
    setAdding(true)
    try {
      await hrApi.addLifecycleItem(event.id, {
        category: newItem.category, title: newItem.title.trim(),
        owner_user_id: newItem.owner_user_id ? Number(newItem.owner_user_id) : null,
      })
      setNewItem({ category: newItem.category, title: '', owner_user_id: '' })
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not add the checklist item.'))
    } finally {
      setAdding(false)
    }
  }

  const done = event.items.filter((i) => i.status !== 'pending').length
  const pct = event.items.length ? Math.round((done / event.items.length) * 100) : 0

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Checklist</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
          <span style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{done} of {event.items.length} closed</span>
          <div style={{ flex: 1, height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.07)', overflow: 'hidden', minWidth: 90 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16A34A' : '#F59E0B' }} />
          </div>
        </div>
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      {event.items.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px' }}>
          No checklist items. {isHr && open ? 'Add one below, or set up templates in HR > Masters > Checklist Templates.' : ''}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>
            {CATEGORY_LABELS[g.key] || g.key} <span style={{ fontWeight: 600 }}>· {g.items.filter((i) => i.status !== 'pending').length}/{g.items.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.items.map((it) => {
              const busy = busyId === it.id
              return (
                <div key={it.id} style={{ padding: '10px 12px', borderRadius: 12, border: `1px solid ${BORDER.light}`, background: it.status === 'pending' ? 'rgba(255,255,255,0.75)' : 'rgba(250,250,249,0.7)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: it.status === 'pending' ? TEXT.heading : TEXT.muted, textDecoration: it.status === 'done' ? 'line-through' : 'none' }}>
                        {it.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>
                        Owner: {ownerEditId === it.id ? null : (it.owner_name || <span style={{ color: '#B45309' }}>unassigned</span>)}
                        {isHr && open && ownerEditId !== it.id && (
                          <span onClick={() => setOwnerEditId(it.id)} style={{ marginLeft: 6, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>change</span>
                        )}
                        {it.status !== 'pending' && it.done_by_name && <> · {ITEM_STATUS_LABELS[it.status]} by {it.done_by_name} {fmtDateTime(it.done_at)}</>}
                      </div>
                      {ownerEditId === it.id && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, maxWidth: 380 }}>
                          <div style={{ flex: 1 }}>
                            <SearchableSelect
                              value={it.owner_user_id ? String(it.owner_user_id) : ''}
                              onChange={(v) => { setOwnerEditId(null); update(it, { owner_user_id: v ? Number(v) : null }) }}
                              options={userOptions}
                              placeholder="Pick owner…"
                            />
                          </div>
                          <span onClick={() => setOwnerEditId(null)} style={{ fontSize: 12, color: TEXT.muted, cursor: 'pointer' }}>cancel</span>
                        </div>
                      )}
                      {it.remarks && <div style={{ fontSize: 12, color: TEXT.body, marginTop: 4, whiteSpace: 'pre-wrap' }}>“{it.remarks}”</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {!it.can_edit || !open ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${ITEM_STATUS_HEX[it.status]}1a`, color: ITEM_STATUS_HEX[it.status], whiteSpace: 'nowrap' }}>
                          {ITEM_STATUS_LABELS[it.status] || it.status}
                        </span>
                      ) : it.status === 'pending' ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => update(it, { status: 'done' })} style={chip('#16A34A')}>✓ Done</button>
                          <button type="button" disabled={busy} onClick={() => setNaItem(it)} style={chip('#78716C')}>N/A</button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${ITEM_STATUS_HEX[it.status]}1a`, color: ITEM_STATUS_HEX[it.status], whiteSpace: 'nowrap' }}>
                            {ITEM_STATUS_LABELS[it.status]}
                          </span>
                          <button type="button" disabled={busy} onClick={() => update(it, { status: 'pending' })} style={chip('#F59E0B')}>Reopen</button>
                        </>
                      )}
                      {it.can_edit && open && (
                        <button type="button" disabled={busy} onClick={() => setRemarkItem(it)} style={chip('#2563EB')}>Remark</button>
                      )}
                      {isHr && open && it.status !== 'done' && (
                        <button type="button" disabled={busy} onClick={() => setDeleteItem(it)} style={chip('#DC2626')}>Remove</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {isHr && open && (
        <div style={{ borderTop: `1px solid ${BORDER.light}`, paddingTop: 14, marginTop: 4 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, marginBottom: 10 }}>Add an item</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '0 1 140px', minWidth: 120 }}>
              <Field label="Category">
                <select style={inputStyle} value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}>
                  {(meta?.categories || CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <Field label="What needs doing">
                <input style={inputStyle} value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} placeholder="e.g. Hand over site keys" onKeyDown={(e) => { if (e.key === 'Enter') addItem() }} />
              </Field>
            </div>
            <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
              <Field label="Owner">
                <SearchableSelect value={newItem.owner_user_id} onChange={(v) => setNewItem({ ...newItem, owner_user_id: v })} options={userOptions} placeholder="— Unassigned —" />
              </Field>
            </div>
            <button type="button" disabled={adding} onClick={addItem} style={{ ...primaryBtnStyle, opacity: adding ? 0.7 : 1 }}>{adding ? 'Adding…' : '+ Add'}</button>
          </div>
        </div>
      )}

      <PromptDialog
        open={!!naItem}
        title="Mark as not applicable"
        message={naItem ? `Why doesn't “${naItem.title}” apply here? The reason is kept on the checklist.` : ''}
        placeholder="Reason (required)…"
        confirmLabel="Mark N/A"
        danger={false}
        onCancel={() => setNaItem(null)}
        onConfirm={(v) => {
          const it = naItem
          setNaItem(null)
          if (!it) return
          if (!v.trim()) { setError(['Give a reason when marking an item Not applicable.']); return }
          update(it, { status: 'not_applicable', remarks: v.trim() })
        }}
      />
      <PromptDialog
        open={!!remarkItem}
        title="Add a remark"
        message={remarkItem ? `Replaces the current remark on “${remarkItem.title}”.` : ''}
        placeholder="Remark…"
        confirmLabel="Save remark"
        danger={false}
        onCancel={() => setRemarkItem(null)}
        onConfirm={(v) => {
          const it = remarkItem
          setRemarkItem(null)
          if (it) update(it, { remarks: v.trim() || null })
        }}
      />
      <ConfirmDialog
        open={!!deleteItem}
        title="Remove checklist item?"
        message={deleteItem ? `“${deleteItem.title}” will be removed from ${event.event_no}.` : ''}
        confirmLabel="Remove"
        danger
        onCancel={() => setDeleteItem(null)}
        onConfirm={async () => {
          const it = deleteItem
          setDeleteItem(null)
          if (!it) return
          setError([])
          try {
            await hrApi.deleteLifecycleItem(it.id)
            onChanged()
          } catch (err) {
            setError(extractErrorMessages(err, 'Could not remove the checklist item.'))
          }
        }}
      />
    </div>
  )
}
