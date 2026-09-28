'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItemCategory } from '@/types'
import { TEXT } from '@/lib/theme'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
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

export default function NewStoreItemPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const [itemCode, setItemCode] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemType, setItemType] = useState('raw_material')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [description, setDescription] = useState('')
  const [uom, setUom] = useState('')
  const [hsnSacCode, setHsnSacCode] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [batchControlled, setBatchControlled] = useState(false)
  const [serialControlled, setSerialControlled] = useState(false)
  const [expiryControlled, setExpiryControlled] = useState(false)
  const [minimumStock, setMinimumStock] = useState('')
  const [maximumStock, setMaximumStock] = useState('')
  const [reorderLevel, setReorderLevel] = useState('')
  const [standardCost, setStandardCost] = useState('')

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (isAuthorized) storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
  }, [isAuthorized])

  const topLevelCategories = categories.filter((c) => !c.parent_id)
  const subcategories = category ? categories.filter((c) => c.parent_name === category) : []

  const save = async () => {
    const problems: string[] = []
    if (!itemCode.trim()) problems.push('Item Code is required.')
    if (!itemName.trim()) problems.push('Item Name is required.')
    if (problems.length) {
      setErrors(problems)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const item = await storeApi.createItem({
        item_code: itemCode.trim(),
        item_name: itemName.trim(),
        item_type: itemType,
        category: category || undefined,
        subcategory: subcategory || undefined,
        description: description.trim() || undefined,
        uom: uom.trim() || undefined,
        hsn_sac_code: hsnSacCode.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        batch_controlled: batchControlled,
        serial_controlled: serialControlled,
        expiry_controlled: expiryControlled,
        minimum_stock: minimumStock ? Number(minimumStock) : undefined,
        maximum_stock: maximumStock ? Number(maximumStock) : undefined,
        reorder_level: reorderLevel ? Number(reorderLevel) : undefined,
        standard_cost: standardCost ? Number(standardCost) : undefined,
      })
      router.push(`/dashboard/store/${item.id}`)
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create item.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Add Item</h1>
        </div>
        <button type="button" data-tour="item-back-btn" onClick={() => router.push('/dashboard/store')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Item" message={errors} onClose={() => setErrors([])} />

      <Section title="Item Details" style={{ marginBottom: 20 }}>
        <Row>
          <Field label="Item Code *">
            <input data-tour="item-code" style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="RM-0001" />
          </Field>
          <Field label="Item Name *">
            <input data-tour="item-name" style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Mild Steel Rod 12mm" />
          </Field>
          <Field label="UOM">
            <input data-tour="item-uom" style={inputStyle} value={uom} onChange={(e) => setUom(e.target.value)} placeholder="KG, NOS, MTR…" />
          </Field>
        </Row>
        <Row>
          <Field label="Item Type">
            <select data-tour="item-type" style={inputStyle} value={itemType} onChange={(e) => setItemType(e.target.value)}>
              {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select data-tour="item-category" style={inputStyle} value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory('') }}>
              <option value="">— None —</option>
              {topLevelCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subcategory">
            <select data-tour="item-subcategory" style={inputStyle} value={subcategory} onChange={(e) => setSubcategory(e.target.value)} disabled={!subcategories.length}>
              <option value="">— None —</option>
              {subcategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </Field>
        </Row>
        <Field label="Description">
          <textarea data-tour="item-description" style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Row>
          <Field label="HSN / SAC Code">
            <input data-tour="item-hsn" style={inputStyle} value={hsnSacCode} onChange={(e) => setHsnSacCode(e.target.value)} />
          </Field>
          <Field label="Manufacturer">
            <input data-tour="item-manufacturer" style={inputStyle} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </Field>
        </Row>
      </Section>

      <Section title="Serial / Batch / Expiry Control" style={{ marginBottom: 20 }}>
        <div data-tour="item-tracking-flags" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body }}>
            <input type="checkbox" checked={batchControlled} onChange={(e) => setBatchControlled(e.target.checked)} /> Batch Controlled
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body }}>
            <input type="checkbox" checked={serialControlled} onChange={(e) => setSerialControlled(e.target.checked)} /> Serial Controlled
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body }}>
            <input type="checkbox" checked={expiryControlled} onChange={(e) => setExpiryControlled(e.target.checked)} /> Expiry Controlled
          </label>
        </div>
      </Section>

      <Section title="Stock Levels" style={{ marginBottom: 20 }}>
        <Row>
          <Field label="Minimum Stock">
            <input data-tour="item-min-stock" type="number" style={inputStyle} value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} />
          </Field>
          <Field label="Maximum Stock">
            <input data-tour="item-max-stock" type="number" style={inputStyle} value={maximumStock} onChange={(e) => setMaximumStock(e.target.value)} />
          </Field>
          <Field label="Reorder Level">
            <input data-tour="item-reorder-level" type="number" style={inputStyle} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
          </Field>
          <Field label="Standard Cost">
            <input data-tour="item-standard-cost" type="number" style={inputStyle} value={standardCost} onChange={(e) => setStandardCost(e.target.value)} />
          </Field>
        </Row>
      </Section>

      <div style={{ display: 'flex', gap: 10 }}>
        <button data-tour="item-save-btn" disabled={busy} onClick={save} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save Item'}</button>
        <button data-tour="item-cancel-btn" disabled={busy} onClick={() => router.push('/dashboard/store')} style={{ ...secondaryBtnStyle, opacity: busy ? 0.6 : 1 }}>Cancel</button>
      </div>
    </div>
  )
}
