'use client'

import { useEffect, useMemo, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydLookupOption, HydSparePart } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { SPARE_CATEGORY_LABELS, MEDIA_TYPE_LABELS, CRITICALITY_LABELS } from '@/components/hydraulic/labels'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const hintStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const numStr = (n: number | null | undefined) => (n == null ? '' : String(n))

export default function SparePartForm({
  initial,
  defaultComponentId,
  submitLabel,
  onSubmit,
}: {
  initial?: HydSparePart | null
  defaultComponentId?: string
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name || '')
  const [category, setCategory] = useState(initial?.category || 'seal_kit')
  const [systemType, setSystemType] = useState<string>(initial?.system_type || 'hydraulic')
  const [criticality, setCriticality] = useState<string>(initial?.criticality || 'essential')
  const [status, setStatus] = useState<string>(initial?.status || 'active')
  const [componentId, setComponentId] = useState(initial?.component_id ? String(initial.component_id) : defaultComponentId || '')
  const [storeItemId, setStoreItemId] = useState(initial?.store_item_id ? String(initial.store_item_id) : '')
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer || '')
  const [partNumber, setPartNumber] = useState(initial?.part_number || '')
  const [uom, setUom] = useState(initial?.uom || 'NOS')
  const [unitCost, setUnitCost] = useState(String(initial?.unit_cost ?? 0))
  const [minStock, setMinStock] = useState(String(initial?.min_stock_qty ?? 0))
  const [reorderQty, setReorderQty] = useState(String(initial?.reorder_qty ?? 0))
  const [leadTime, setLeadTime] = useState(numStr(initial?.lead_time_days))
  const [shelfLife, setShelfLife] = useState(numStr(initial?.shelf_life_months))
  const [interchangeable, setInterchangeable] = useState(initial?.interchangeable_with || '')
  const [storageNotes, setStorageNotes] = useState(initial?.storage_notes || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [components, setComponents] = useState<HydLookupOption[]>([])
  const [storeItems, setStoreItems] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    hydraulicApi.lookupComponents().then(setComponents).catch((err) => setError(extractErrorMessages(err, 'Failed to load the component list.')))
    hydraulicApi.lookupStoreItems().then(setStoreItems).catch((err) => setError(extractErrorMessages(err, 'Failed to load Store items.')))
  }, [])

  const componentOptions = useMemo(() => {
    const opts = components.map((c) => ({ value: String(c.id), label: c.label }))
    // The lookup hides obsolete components — keep the current link readable.
    if (initial?.component_id && !components.some((c) => c.id === initial.component_id)) {
      opts.unshift({ value: String(initial.component_id), label: `${initial.component_code || `#${initial.component_id}`} — ${initial.component_name || 'Component'} (obsolete)` })
    }
    return [{ value: '', label: '— Not tied to a component —' }, ...opts]
  }, [components, initial])

  const storeItemOptions = useMemo(() => {
    const opts = storeItems.map((i) => ({ value: String(i.id), label: i.label }))
    if (initial?.store_item_id && !storeItems.some((i) => i.id === initial.store_item_id)) {
      opts.unshift({ value: String(initial.store_item_id), label: `${initial.store_item_code || `#${initial.store_item_id}`} — ${initial.store_item_name || 'Store item'} (inactive)` })
    }
    return [{ value: '', label: '— Not linked to Store —' }, ...opts]
  }, [storeItems, initial])

  const pickStoreItem = (v: string) => {
    setStoreItemId(v)
    // Adopt the Store item's unit so issues and stock read in the same unit.
    const itemUom = storeItems.find((i) => String(i.id) === v)?.extra
    if (itemUom) setUom(itemUom.toUpperCase())
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Spare name is required, e.g. "Piston seal kit Ø63/36".'); return }
    if (!uom.trim()) { setError('Unit of measure is required (NOS, SET, L, M…).'); return }
    const checks: [string, string, boolean][] = [
      ['Unit cost', unitCost, false], ['Minimum stock', minStock, false], ['Reorder quantity', reorderQty, false],
      ['Lead time', leadTime, true], ['Shelf life', shelfLife, true],
    ]
    for (const [label, v, whole] of checks) {
      const n = numOrNull(v)
      if (n == null) continue
      if (Number.isNaN(n) || n < 0) { setError(`${label} must be zero or more.`); return }
      if (whole && !Number.isInteger(n)) { setError(`${label} must be a whole number.`); return }
    }

    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        category,
        system_type: systemType,
        criticality,
        status,
        component_id: componentId ? Number(componentId) : null,
        store_item_id: storeItemId ? Number(storeItemId) : null,
        manufacturer: manufacturer.trim() || null,
        part_number: partNumber.trim() || null,
        uom: uom.trim().toUpperCase(),
        unit_cost: numOrNull(unitCost) ?? 0,
        min_stock_qty: numOrNull(minStock) ?? 0,
        reorder_qty: numOrNull(reorderQty) ?? 0,
        lead_time_days: numOrNull(leadTime),
        shelf_life_months: numOrNull(shelfLife),
        interchangeable_with: interchangeable.trim() || null,
        storage_notes: storageNotes.trim() || null,
        remarks: remarks.trim() || null,
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save spare part.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Identity</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Piston seal kit Ø63/36" />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(SPARE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Medium</label>
            <select style={inputStyle} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
              {Object.entries(MEDIA_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Criticality</label>
            <select style={inputStyle} value={criticality} onChange={(e) => setCriticality(e.target.value)}>
              {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="obsolete">Obsolete</option>
            </select>
          </div>
        </div>
        {!initial && <p style={hintStyle}>The part code (HSP-00001…) is generated when you save.</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Manufacturer</label>
            <input style={inputStyle} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} maxLength={150} placeholder="Parker, Hallite, Hydac…" />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={labelStyle}>Part / Order Number</label>
            <input style={inputStyle} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
            <label style={labelStyle}>Interchangeable With</label>
            <input style={inputStyle} value={interchangeable} onChange={(e) => setInterchangeable(e.target.value)} maxLength={255} placeholder="Equivalent part numbers from other makes" />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Links</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 440 }}>
            <label style={labelStyle}>Spare For Component</label>
            <SearchableSelect value={componentId} onChange={setComponentId} placeholder="Search component…" options={componentOptions} />
            <p style={hintStyle}>Which component this spare fits — used to show the systems that carry it.</p>
          </div>
          <div style={{ flex: '1 1 300px', maxWidth: 440 }}>
            <label style={labelStyle}>Linked Store Item</label>
            <SearchableSelect value={storeItemId} onChange={pickStoreItem} placeholder="Search Store item…" options={storeItemOptions} />
            <p style={hintStyle}>
              This module keeps no stock of its own — when linked, on-hand and available quantities come from the Store item, and completing a service job can issue it from a Store location.
            </p>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Stocking</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 110px', minWidth: 100 }}>
            <label style={labelStyle}>UOM *</label>
            <input style={inputStyle} value={uom} onChange={(e) => setUom(e.target.value)} maxLength={20} placeholder="NOS" />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Unit Cost (₹)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Min Stock Qty</label>
            <input style={inputStyle} type="number" min={0} step="any" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Reorder Qty</label>
            <input style={inputStyle} type="number" min={0} step="any" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Lead Time (days)</label>
            <input style={inputStyle} type="number" min={0} step={1} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Shelf Life (months)</label>
            <input style={inputStyle} type="number" min={0} step={1} value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
          </div>
        </div>
        <p style={hintStyle}>
          Leave unit cost at 0 to use the Store item&apos;s cost on service jobs. Stock below the minimum shows as Low.
          Elastomer seals, O-rings and hoses age on the shelf — set a shelf life for them (see ISO 2230).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Storage Notes</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={storageNotes} onChange={(e) => setStorageNotes(e.target.value)}
              placeholder="Store flat in sealed bags, away from ozone and sunlight, 5–25 °C…" />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" disabled={saving} style={{
          padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
          background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
          boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
        }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
