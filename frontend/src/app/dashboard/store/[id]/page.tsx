'use client'

import UomSelect from '@/components/erp/UomSelect'
import ItemPhoto from '@/components/store/ItemPhoto'
import ItemTypeSelect, { ItemTypeOption } from '@/components/store/ItemTypeSelect'
import CategorySelect from '@/components/store/CategorySelect'
import SubcategorySelect from '@/components/store/SubcategorySelect'
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
  const [itemTypes, setItemTypes] = useState<ItemTypeOption[]>([])
  const [uoms, setUoms] = useState<{ value: string; label: string }[]>([])
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
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load this item — it may have been removed.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && itemId) {
      load()
      storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
      storeApi.getItemMeta().then((m) => { setUoms(m.uoms); setItemTypes(m.item_types) }).catch(() => setUoms([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, itemId])

  // Only the standard categories for the item type (plus its current one, if older).
  const typeLabel = (v?: string | null) => itemTypes.find((t) => t.value === v)?.label || v || '—'
  const topLevelCategories = categories.filter((c) => !c.parent_id && (c.item_type === form.item_type || c.name === form.category))
  const selectedCategory = topLevelCategories.find((c) => c.name === form.category)

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
        part_number: form.part_number?.trim() || null,
        uom: form.uom || undefined,
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

          <Section title="Photo" style={{ marginBottom: 20 }}>
            <ItemPhoto itemId={item.id} hasPhoto={!!item.has_photo} onChanged={(has) => setItem({ ...item, has_photo: has })} />
          </Section>

          {!editing ? (
            <Section title="Item Details" style={{ marginBottom: 20 }}>
              <Row>
                <InfoRow label="Item Code" value={item.item_code} />
                <InfoRow label="Item Type" value={typeLabel(item.item_type)} />
                <InfoRow label="Category" value={item.category || '—'} />
                <InfoRow label="Subcategory" value={item.subcategory || '—'} />
              </Row>
              <Row>
                <InfoRow label="Item Name" value={item.item_name} />
                <InfoRow label="UOM" value={item.uom || '—'} />
                <InfoRow label="Part Code" value={item.part_number || '—'} />
                <InfoRow label="Status" value={STATUSES.find((s) => s.value === item.status)?.label || item.status} />
              </Row>
              <InfoRow label="Technical Specification" value={item.description || '—'} />
            </Section>
          ) : (
            <>
              <Section title="Item Details" style={{ marginBottom: 20 }}>
                <Row>
                  <Field label="Item Code">
                    <input style={{ ...inputStyle, background: 'rgba(0,0,0,0.04)', color: TEXT.secondary, fontWeight: 600 }} value={item.item_code} readOnly />
                  </Field>
                  <Field label="Item Type">
                    <ItemTypeSelect value={form.item_type || ''} types={itemTypes}
                      onChange={(v) => { if (v !== form.item_type) setForm({ ...form, item_type: v, category: null, subcategory: null }) }} />
                  </Field>
                  <Field label="Category">
                    <CategorySelect itemType={form.item_type || ''} value={form.category || ''}
                      onChange={(v) => { if (v !== (form.category || '')) setForm({ ...form, category: v || null, subcategory: null }) }} categories={categories} />
                  </Field>
                  <Field label="Subcategory">
                    <SubcategorySelect category={selectedCategory} value={form.subcategory || ''} onChange={(v) => setForm({ ...form, subcategory: v || null })} categories={categories} />
                  </Field>
                </Row>
                <Row>
                  <Field label="Item Name *">
                    <input style={inputStyle} value={form.item_name || ''} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
                  </Field>
                  <Field label="UOM *">
                    <UomSelect value={form.uom || ''} onChange={(v) => setForm({ ...form, uom: v })} options={uoms} onOptionsChange={setUoms} manage={false} />
                  </Field>
                  <Field label="Part Code (optional)">
                    <input style={inputStyle} value={form.part_number || ''} onChange={(e) => setForm({ ...form, part_number: e.target.value })} placeholder="Part code" />
                  </Field>
                  <Field label="Status">
                    <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StoreItem['status'] })}>
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </Field>
                </Row>
                <Field label="Technical Specification">
                  <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
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
