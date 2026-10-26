'use client'

import Select from '@/components/shared/Select'
import { useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrChecklistItem, HrLifecycleEvent, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, pillStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import ConfirmDialog from '@/components/erp/ConfirmDialog'

const CATEGORY_ORDER = ['hr', 'manager', 'it', 'admin', 'store', 'finance']
const CATEGORY_LABELS: Record<string, string> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager: 'Manager', store: 'Store' }
const ITEM_STATUS_LABELS: Record<string, string> = { pending: 'Pending', done: 'Done', not_applicable: 'Not applicable' }
const ITEM_STATUS_HEX: Record<string, string> = { pending: '#F59E0B', done: '#16A34A', not_applicable: '#78716C' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
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
  const [addOpen, setAddOpen] = useState(false)
  const [text, setText] = useState('')
  const openNa = (it: HrChecklistItem) => { setText(''); setNaItem(it) }
  const openRemark = (it: HrChecklistItem) => { setText(it.remarks || ''); setRemarkItem(it) }
  const submitText = () => {
    const v = text
    if (naItem) {
      const it = naItem
      setNaItem(null)
      if (!v.trim()) { setError(['Give a reason when marking an item Not applicable.']); return }
      update(it, { status: 'not_applicable', remarks: v.trim() })
    } else if (remarkItem) {
      const it = remarkItem
      setRemarkItem(null)
      update(it, { remarks: v.trim() || null })
    }
  }

  const groups = useMemo(() => {
    const by: Record<string, HrChecklistItem[]> = {}
    for (const it of event.items) (by[it.category] ||= []).push(it)
    const keys = [...CATEGORY_ORDER.filter((k) => by[k]), ...Object.keys(by).filter((k) => !CATEGORY_ORDER.includes(k))]
    return keys.map((k) => ({ key: k, items: by[k] }))
  }, [event.items])

  // The role's "Assign to" rule (Role & Permissions) narrows who can be made task owner.
  const allowOwner = useAssigneeFilter('hr:lifecycle.checklist')
  const userOptions = useMemo(
    () => [{ value: '', label: '— Unassigned —' }, ...(meta?.users || []).filter((u) => allowOwner(u.id)).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.designation || u.email}` }))],
    [meta, allowOwner],
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
      setAddOpen(false)
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not add the checklist item.'))
    } finally {
      setAdding(false)
    }
  }

  const errorBox = error.length > 0 && (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {error.join(' ')}
    </div>
  )
  const done = event.items.filter((i) => i.status !== 'pending').length
  const pct = event.items.length ? Math.round((done / event.items.length) * 100) : 0

  return (
    <div data-tour="hr-lcd-checklist" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Checklist</h3>
          {isHr && open && <button type="button" data-tour="hr-lcd-add-open-btn" onClick={() => { setError([]); setAddOpen(true) }} style={{ ...primaryBtnStyle, padding: '7px 14px', fontSize: 12.5 }}>+ Add item</button>}
        </div>
        <div data-tour="hr-lcd-checklist-progress" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
          <span style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{done} of {event.items.length} closed</span>
          <div style={{ flex: 1, height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.07)', overflow: 'hidden', minWidth: 90 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16A34A' : '#F59E0B' }} />
          </div>
        </div>
      </div>

      {!addOpen && errorBox}

      {event.items.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px' }}>
          No checklist items. {isHr && open ? 'Use + Add item, or set up templates in HR > Masters > Checklist Templates.' : ''}
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
                          <span data-tour="hr-lcd-item-owner-change" onClick={() => setOwnerEditId(it.id)} style={{ marginLeft: 6, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>change</span>
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
                    <div data-tour="hr-lcd-item-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {!it.can_edit || !open ? (
                        <span style={pillStyle(ITEM_STATUS_HEX[it.status])}>
                          {ITEM_STATUS_LABELS[it.status] || it.status}
                        </span>
                      ) : it.status === 'pending' ? (
                        <>
                          <button type="button" data-tour="hr-lcd-item-done" disabled={busy} onClick={() => update(it, { status: 'done' })} style={chip('#16A34A')}>✓ Done</button>
                          <button type="button" data-tour="hr-lcd-item-na" disabled={busy} onClick={() => openNa(it)} style={chip('#78716C')}>N/A</button>
                        </>
                      ) : (
                        <>
                          <span style={pillStyle(ITEM_STATUS_HEX[it.status])}>
                            {ITEM_STATUS_LABELS[it.status]}
                          </span>
                          <button type="button" data-tour="hr-lcd-item-reopen" disabled={busy} onClick={() => update(it, { status: 'pending' })} style={chip('#F59E0B')}>Reopen</button>
                        </>
                      )}
                      {it.can_edit && open && (
                        <button type="button" data-tour="hr-lcd-item-remark" disabled={busy} onClick={() => openRemark(it)} style={chip('#2563EB')}>Remark</button>
                      )}
                      {isHr && open && it.status !== 'done' && (
                        <button type="button" data-tour="hr-lcd-item-remove" disabled={busy} onClick={() => setDeleteItem(it)} style={chip('#DC2626')}>Remove</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {isHr && open && addOpen && (
        <FormSheet width={580} tour="hr-lcd-add-sheet" icon="plus" title="Add a checklist item"
          subtitle={`Added to ${event.event_no} only — the template in HR > Masters is not changed.`}
          onClose={() => setAddOpen(false)} busy={adding}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, adding)} disabled={adding} onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="button" data-tour="hr-lcd-add-btn" disabled={adding} onClick={addItem} style={sheetBtn('primary', SHEET.BLUE, adding)}><SheetIcon name="plus" size={16} />{adding ? 'Adding…' : 'Add item'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {errorBox}
            <SheetSection icon="list" title="Item">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="hr-lcd-add-category" style={{ flex: '0 1 140px', minWidth: 120 }}>
                  <label style={sheetLabel}>Category</label>
                  <Select style={sheetInput} value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}>
                    {(meta?.categories || CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </div>
                <div data-tour="hr-lcd-add-title" style={{ flex: '1 1 260px' }}>
                  <label style={sheetLabel}>What needs doing <Req /></label>
                  <input autoFocus style={sheetInput} value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} placeholder="e.g. Hand over site keys" onKeyDown={(e) => { if (e.key === 'Enter') addItem() }} />
                </div>
              </div>
            </SheetSection>
            <SheetSection icon="user" title="Owner" extra={<Optional />}>
              <div data-tour="hr-lcd-add-owner">
                <SearchableSelect value={newItem.owner_user_id} onChange={(v) => setNewItem({ ...newItem, owner_user_id: v })} options={userOptions} placeholder="— Unassigned —" />
                <p style={sheetHint}>The owner is notified and sees the task under &quot;My checklist tasks&quot;.</p>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {(naItem || remarkItem) && (
        <FormSheet width={580} icon={naItem ? 'x' : 'chat'} iconColor={naItem ? '#78716C' : SHEET.BLUE}
          title={naItem ? 'Mark as not applicable' : 'Add a remark'}
          subtitle={naItem ? `Why doesn't “${naItem.title}” apply here? The reason is kept on the checklist.` : `Replaces the current remark on “${remarkItem?.title}”.`}
          onClose={() => { setNaItem(null); setRemarkItem(null) }} busy={false}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => { setNaItem(null); setRemarkItem(null) }}>Cancel</button>
            <button type="button" style={sheetBtn('primary', naItem ? '#78716C' : SHEET.BLUE)} onClick={submitText}><SheetIcon name="check" size={16} />{naItem ? 'Mark N/A' : 'Save remark'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <label style={sheetLabel}>{naItem ? <>Reason <Req /></> : 'Remark'}</label>
            <textarea autoFocus style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={naItem ? 'Reason…' : 'Remark…'} />
          </div>
        </FormSheet>
      )}
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
