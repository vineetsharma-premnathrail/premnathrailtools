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
import { StoreItem, StoreItemCategory, StoreItemMeta } from '@/types'
import { ItemErpForm, ItemErpInfo, ItemVendorSuggestions, erpPayload } from '@/components/store/ItemErpSections'
import { TEXT } from '@/lib/theme'
import { Section, Row, InfoRow, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import ItemPlantData from '@/components/store/ItemPlantData'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'discontinued', label: 'Discontinued' },
]

export default function StoreItemDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const { can, canDelete, canFeature } = useCan()
  // Store › Items features: "Stock value & rates" (sensitive — the backend
  // blanks the rates without it; standard cost stays for item editors),
  // Plant data and Who can supply this item (sections).
  const seeValues = canFeature('store', 'items', 'stock_values', 'view')
  const seeStandardCost = seeValues || can('store', 'items', 'edit')
  const seePlantData = canFeature('store', 'items', 'plant_data', 'view')
  const seeVendors = canFeature('store', 'items', 'vendor_suggestions', 'view')
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedItemId, error: linkError } = useRecordId(ref)
  const itemId = resolvedItemId ?? 0

  const [item, setItem] = useState<StoreItem | null>(null)
  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const [itemTypes, setItemTypes] = useState<ItemTypeOption[]>([])
  const [uoms, setUoms] = useState<{ value: string; label: string }[]>([])
  const [meta, setMeta] = useState<StoreItemMeta | null>(null)
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
      storeApi.getItemMeta().then((m) => { setMeta(m); setUoms(m.uoms); setItemTypes(m.item_types) }).catch(() => setUoms([]))
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
        // null (not undefined) so a cleared field is saved as cleared — the PATCH skips missing keys.
        category: form.category || null,
        subcategory: form.subcategory || null,
        description: form.description?.trim() || null,
        part_number: form.part_number?.trim() || null,
        uom: form.uom || undefined,
        ...erpPayload(form),
        lead_time_days: form.lead_time_days ?? null,
        legacy_code: form.legacy_code?.trim() || null,
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

  // System weighted average (read-only — maintained by priced receipts).
  const averageText = (it: StoreItem) => {
    if (it.moving_average_cost == null) return 'Not valued yet'
    const last = it.last_receipt_rate != null
      ? ` · last receipt ₹${it.last_receipt_rate.toLocaleString('en-IN')}${it.last_receipt_date ? ` on ${formatDate(it.last_receipt_date)}` : ''}`
      : ''
    return `₹${it.moving_average_cost.toLocaleString('en-IN', { maximumFractionDigits: 4 })} (system weighted average${last})`
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store" listLabel="Back to items" /></div>)
  if (!itemId) return <div><StoreNav /></div>

  // Edit mode: the same sectioned sheet layout as Add Item, in place of the view.
  if (editing && item) {
    const cancelEdit = () => { setEditing(false); setForm(item) }
    return (
      <FormPage nav={<StoreNav />} icon="edit" title={`Edit ${item.item_name}`} subtitle={`${item.item_code} · changes apply from now on; posted documents keep their values.`}
        onBack={cancelEdit} backLabel="← Back" backTour="item-edit-back-btn"
        footer={<>
          <button type="button" data-tour="item-edit-cancel-btn" disabled={busy} onClick={cancelEdit} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
          <button type="button" data-tour="item-edit-save-btn" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Changes'}</button>
        </>}>
        <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Item" message={errors} onClose={() => setErrors([])} />
        <SheetColumns
          left={<>
            <SheetSection icon="list" title="Item Details">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>Item Type</label>
                  <div data-tour="item-edit-type">
                    <ItemTypeSelect value={form.item_type || ''} types={itemTypes}
                      onChange={(v) => { if (v !== form.item_type) setForm({ ...form, item_type: v, category: null, subcategory: null }) }} />
                  </div>
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>Category</label>
                  <div data-tour="item-edit-category">
                    <CategorySelect itemType={form.item_type || ''} value={form.category || ''}
                      onChange={(v) => { if (v !== (form.category || '')) setForm({ ...form, category: v || null, subcategory: null }) }} categories={categories} />
                  </div>
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>Subcategory</label>
                  <div data-tour="item-edit-subcategory">
                    <SubcategorySelect category={selectedCategory} value={form.subcategory || ''} onChange={(v) => setForm({ ...form, subcategory: v || null })} categories={categories} />
                  </div>
                </div>
              </div>
              <label style={sheetLabel}>Item Name <Req /></label>
              <input data-tour="item-edit-name" style={sheetInput} value={form.item_name || ''} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
                <div style={{ flex: '0 1 200px', minWidth: 160 }}>
                  <label style={sheetLabel}>UOM <Req /></label>
                  <div data-tour="item-edit-uom">
                    <UomSelect value={form.uom || ''} onChange={(v) => setForm({ ...form, uom: v })} options={uoms} onOptionsChange={setUoms} manage={false} />
                  </div>
                </div>
                <div style={{ flex: '1 1 180px', maxWidth: 300 }}>
                  <label style={sheetLabel}>Part Code <Optional /></label>
                  <input data-tour="item-edit-part-code" style={sheetInput} value={form.part_number || ''} onChange={(e) => setForm({ ...form, part_number: e.target.value })} placeholder="Part code" />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Status</label>
                  <Select data-tour="item-edit-status" style={sheetInput} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StoreItem['status'] })}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Technical Specification</label>
              <textarea data-tour="item-edit-description" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </SheetSection>

            <SheetSection icon="calendar" title="Planning & Cost">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <div style={{ flex: '0 1 220px', minWidth: 180 }}>
                  <label style={sheetLabel}>Purchase lead time (days)</label>
                  <input data-tour="item-edit-lead-time" type="number" min={0} max={730} step={1} style={sheetInput}
                    value={form.lead_time_days ?? ''}
                    onChange={(e) => setForm({ ...form, lead_time_days: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="e.g. 21" />
                </div>
                <div style={{ flex: '0 1 220px', minWidth: 180 }}>
                  <label style={sheetLabel}>Legacy code <Optional /></label>
                  <input data-tour="item-edit-legacy-code" style={sheetInput} value={form.legacy_code || ''} maxLength={50}
                    onChange={(e) => setForm({ ...form, legacy_code: e.target.value })} placeholder="v3 / Tally code" />
                </div>
              </div>
              <p style={sheetHint}>Lead time = calendar days from PO to goods in store. Used by MRP and the Engineering long-lead list.</p>
            </SheetSection>

            <div data-tour="item-edit-erp">
              <ItemErpForm values={form} onChange={(patch) => setForm({ ...form, ...patch })} meta={meta}
                itemType={form.item_type || ''} uom={form.uom} effective={item} />
            </div>
          </>}
          right={<>
            <SheetSection icon="tag" title="Item Code">
              <input data-tour="item-edit-code" style={{ ...sheetInput, background: SHEET.SOFT, color: SHEET.BODY, fontWeight: 600 }} value={item.item_code} readOnly />
              <p style={sheetHint}>Fixed once created.</p>
            </SheetSection>
            {seeValues && (
              <SheetSection icon="rupee" title="Weighted Average">
                <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0 }}>{averageText(item)}</p>
                <p style={sheetHint}>Read-only — kept by priced receipts.</p>
              </SheetSection>
            )}
            <SheetSection icon="clip" title="Photo">
              <div data-tour="item-detail-photo">
                <ItemPhoto itemId={item.id} hasPhoto={!!item.has_photo} editable={can('store', 'items', 'edit')} onChanged={(has) => setItem({ ...item, has_photo: has })} />
              </div>
            </SheetSection>
          </>}
        />
      </FormPage>
    )
  }
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
              <button type="button" data-tour="item-detail-back-btn" onClick={() => router.push('/dashboard/store')} style={secondaryBtnStyle}>← Back</button>
              {can('store', 'items', 'edit') && <button type="button" data-tour="item-detail-edit-btn" onClick={startEdit} style={secondaryBtnStyle}>Edit</button>}
              {/* Items carry no creator, so anyone holding Items › Delete may delete. */}
              {canDelete('store', 'items', null) && <button type="button" data-tour="item-detail-delete-btn" onClick={() => setDeleteConfirmOpen(true)} style={dangerBtnStyle}>Delete</button>}
            </div>
          </div>

          <Section title="Photo" style={{ marginBottom: 20 }}>
            <div data-tour="item-detail-photo">
              <ItemPhoto itemId={item.id} hasPhoto={!!item.has_photo} editable={can('store', 'items', 'edit')} onChanged={(has) => setItem({ ...item, has_photo: has })} />
            </div>
          </Section>

          {!editing ? (
            <Section title="Item Details" style={{ marginBottom: 20 }}>
              <div data-tour="item-detail-info" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              </div>
            </Section>
          ) : null}
          {!editing ? (
            <Section title="Planning & Cost" style={{ marginBottom: 20 }}>
              <div data-tour="item-detail-planning">
              <Row>
                <InfoRow label="Purchase lead time" value={item.lead_time_days != null ? `${item.lead_time_days} calendar day(s)` : 'Not set — MRP will assume one'} />
                <InfoRow label="Legacy code (v3 / Tally)" value={item.legacy_code || '—'} />
                {seeStandardCost && <InfoRow label="Standard cost" value={item.standard_cost != null ? `₹${item.standard_cost.toLocaleString('en-IN')}` : '—'} />}
                {seeValues && <InfoRow label="Weighted average" value={averageText(item)} />}
              </Row>
              </div>
            </Section>
          ) : null}
          {!editing ? (
            <>
              <ItemErpInfo item={item} />
              {seePlantData && <ItemPlantData itemId={item.id} canEdit={canFeature('store', 'items', 'plant_data', 'edit')} />}
              {seeVendors && <ItemVendorSuggestions itemId={item.id} />}
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
