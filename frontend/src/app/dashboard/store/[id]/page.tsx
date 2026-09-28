'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreItemCategory } from '@/types'
import { TEXT } from '@/lib/theme'
import { Field, Section, Row, InfoRow, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const ITEM_TYPES = [
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'spare_part', label: 'Spare Part' },
  { value: 'finished_good', label: 'Finished Good' },
  { value: 'semi_finished', label: 'Semi-Finished' },
  { value: 'asset', label: 'Asset' },
  { value: 'other', label: 'Other' },
]

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'discontinued', label: 'Discontinued' },
]

export default function StoreItemDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const params = useParams()
  const itemId = Number(params.id)

  const [item, setItem] = useState<StoreItem | null>(null)
  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<StoreItem>>({})
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await storeApi.getItem(itemId)
      setItem(data)
      setForm(data)
    } catch {
      setLoadError('Failed to load this item — it may have been removed.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && itemId) {
      load()
      storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, itemId])

  const topLevelCategories = categories.filter((c) => !c.parent_id)
  const subcategories = form.category ? categories.filter((c) => c.parent_name === form.category) : []

  const startEdit = () => {
    if (!item) return
    setForm(item)
    setEditing(true)
  }

  const save = async () => {
    if (!form.item_name?.trim()) {
      setErrors(['Item Name is required.'])
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const updated = await storeApi.updateItem(itemId, {
        item_name: form.item_name.trim(),
        item_type: form.item_type,
        category: form.category || undefined,
        subcategory: form.subcategory || undefined,
        description: form.description?.trim() || undefined,
        uom: form.uom?.trim() || undefined,
        hsn_sac_code: form.hsn_sac_code?.trim() || undefined,
        manufacturer: form.manufacturer?.trim() || undefined,
        batch_controlled: form.batch_controlled,
        serial_controlled: form.serial_controlled,
        expiry_controlled: form.expiry_controlled,
        minimum_stock: form.minimum_stock ?? undefined,
        maximum_stock: form.maximum_stock ?? undefined,
        reorder_level: form.reorder_level ?? undefined,
        standard_cost: form.standard_cost ?? undefined,
        status: form.status,
      })
      setItem(updated)
      setForm(updated)
      setEditing(false)
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to update item.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await storeApi.deleteItem(itemId)
      router.push('/dashboard/store')
    } catch (err) {
      setDeleteConfirmOpen(false)
      setErrors(extractErrorMessages(err, 'Failed to delete item.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Item" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Items" onAction={() => router.push('/dashboard/store')} />
      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Item" message={errors} onClose={() => setErrors([])} />
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete this item?"
        message={`This permanently removes "${item?.item_name}" from the item master. This cannot be undone.`}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={remove}
      />

      {loading || !item ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · {item.item_code}
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{item.item_name}</h1>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {editing ? (
                <button type="button" data-tour="item-edit-cancel-btn" onClick={() => { setEditing(false); setForm(item) }} style={secondaryBtnStyle}>Cancel</button>
              ) : (
                <>
                  <button type="button" data-tour="item-detail-back-btn" onClick={() => router.push('/dashboard/store')} style={secondaryBtnStyle}>← Back</button>
                  <button type="button" data-tour="item-detail-edit-btn" onClick={startEdit} style={secondaryBtnStyle}>Edit</button>
                  <button type="button" data-tour="item-detail-delete-btn" onClick={() => setDeleteConfirmOpen(true)} style={dangerBtnStyle}>Delete</button>
                </>
              )}
            </div>
          </div>

          {!editing ? (
            <Section title="Item Details" style={{ marginBottom: 20 }}>
              <Row>
                <InfoRow label="Item Code" value={item.item_code} />
                <InfoRow label="Item Type" value={ITEM_TYPES.find((t) => t.value === item.item_type)?.label || item.item_type || '—'} />
                <InfoRow label="UOM" value={item.uom || '—'} />
              </Row>
              <Row>
                <InfoRow label="Category" value={item.category || '—'} />
                <InfoRow label="Subcategory" value={item.subcategory || '—'} />
                <InfoRow label="Status" value={STATUSES.find((s) => s.value === item.status)?.label || item.status} />
              </Row>
              <InfoRow label="Description" value={item.description || '—'} />
              <Row>
                <InfoRow label="HSN / SAC Code" value={item.hsn_sac_code || '—'} />
                <InfoRow label="Manufacturer" value={item.manufacturer || '—'} />
              </Row>
              <Row>
                <InfoRow label="Batch Controlled" value={item.batch_controlled ? 'Yes' : 'No'} />
                <InfoRow label="Serial Controlled" value={item.serial_controlled ? 'Yes' : 'No'} />
                <InfoRow label="Expiry Controlled" value={item.expiry_controlled ? 'Yes' : 'No'} />
              </Row>
              <Row>
                <InfoRow label="Minimum Stock" value={item.minimum_stock != null ? String(item.minimum_stock) : '—'} />
                <InfoRow label="Maximum Stock" value={item.maximum_stock != null ? String(item.maximum_stock) : '—'} />
                <InfoRow label="Reorder Level" value={item.reorder_level != null ? String(item.reorder_level) : '—'} />
                <InfoRow label="Standard Cost" value={item.standard_cost != null ? String(item.standard_cost) : '—'} />
              </Row>
            </Section>
          ) : (
            <>
              <Section title="Item Details" style={{ marginBottom: 20 }}>
                <Row>
                  <Field label="Item Name *">
                    <input style={inputStyle} value={form.item_name || ''} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
                  </Field>
                  <Field label="Item Type">
                    <select style={inputStyle} value={form.item_type || ''} onChange={(e) => setForm({ ...form, item_type: e.target.value as StoreItem['item_type'] })}>
                      {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  <Field label="UOM">
                    <input style={inputStyle} value={form.uom || ''} onChange={(e) => setForm({ ...form, uom: e.target.value })} />
                  </Field>
                </Row>
                <Row>
                  <Field label="Category">
                    <select style={inputStyle} value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value || null, subcategory: null })}>
                      <option value="">— None —</option>
                      {topLevelCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Subcategory">
                    <select style={inputStyle} value={form.subcategory || ''} onChange={(e) => setForm({ ...form, subcategory: e.target.value || null })} disabled={!subcategories.length}>
                      <option value="">— None —</option>
                      {subcategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StoreItem['status'] })}>
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </Field>
                </Row>
                <Field label="Description">
                  <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
                <Row>
                  <Field label="HSN / SAC Code">
                    <input style={inputStyle} value={form.hsn_sac_code || ''} onChange={(e) => setForm({ ...form, hsn_sac_code: e.target.value })} />
                  </Field>
                  <Field label="Manufacturer">
                    <input style={inputStyle} value={form.manufacturer || ''} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
                  </Field>
                </Row>
              </Section>

              <Section title="Serial / Batch / Expiry Control" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body }}>
                    <input type="checkbox" checked={!!form.batch_controlled} onChange={(e) => setForm({ ...form, batch_controlled: e.target.checked })} /> Batch Controlled
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body }}>
                    <input type="checkbox" checked={!!form.serial_controlled} onChange={(e) => setForm({ ...form, serial_controlled: e.target.checked })} /> Serial Controlled
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body }}>
                    <input type="checkbox" checked={!!form.expiry_controlled} onChange={(e) => setForm({ ...form, expiry_controlled: e.target.checked })} /> Expiry Controlled
                  </label>
                </div>
              </Section>

              <Section title="Stock Levels" style={{ marginBottom: 20 }}>
                <Row>
                  <Field label="Minimum Stock">
                    <input type="number" style={inputStyle} value={form.minimum_stock ?? ''} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                  <Field label="Maximum Stock">
                    <input type="number" style={inputStyle} value={form.maximum_stock ?? ''} onChange={(e) => setForm({ ...form, maximum_stock: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                  <Field label="Reorder Level">
                    <input type="number" style={inputStyle} value={form.reorder_level ?? ''} onChange={(e) => setForm({ ...form, reorder_level: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                  <Field label="Standard Cost">
                    <input type="number" style={inputStyle} value={form.standard_cost ?? ''} onChange={(e) => setForm({ ...form, standard_cost: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                </Row>
              </Section>

              <div style={{ display: 'flex', gap: 10 }}>
                <button data-tour="item-edit-save-btn" disabled={busy} onClick={save} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save Changes'}</button>
                <button disabled={busy} onClick={() => { setEditing(false); setForm(item) }} style={{ ...secondaryBtnStyle, opacity: busy ? 0.6 : 1 }}>Cancel</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
