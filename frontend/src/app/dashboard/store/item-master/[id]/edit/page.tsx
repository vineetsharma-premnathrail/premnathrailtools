'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { itemsApi, storeApi } from '@/lib/api'
import { Item, StoreLocation } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import { Field, Row, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'

const ITEM_TYPES = ['Stock Item', 'Non-Stock Item', 'Service Item', 'Fixed Asset']
const ITEM_GROUPS = [
  'Raw Material', 'Consumable', 'Spare Part', 'Hardware', 'Electrical',
  'Hydraulic', 'Pneumatic', 'Finished Good', 'Packaging', 'Other',
]
const UNITS_OF_MEASURE = ['Nos', 'Kg', 'Ltr', 'Mtr', 'Box', 'Set', 'Pcs', 'Roll', 'Pair', 'Unit']
const MAKE_OR_BUY = ['Make', 'Buy']
const BATCH_SERIAL_OPTIONS = ['None', 'Batch', 'Serial', 'Batch & Serial']
const GST_RATES = ['0%', '5%', '12%', '18%', '28%']
const ITEM_STATUSES = ['Active', 'Inactive']

const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 70, fontFamily: 'inherit' }

export default function EditItemPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const params = useParams()
  const itemId = Number(params.id)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locations, setLocations] = useState<StoreLocation[]>([])

  const [form, setForm] = useState<Partial<Item>>({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([itemsApi.get(itemId), storeApi.listLocations()])
      .then(([item, locs]: [Item, StoreLocation[]]) => {
        setForm(item)
        setLocations(locs)
      })
      .catch(() => setError('Failed to load item.'))
      .finally(() => setLoading(false))
  }, [isAuthorized, itemId])

  const set = <K extends keyof Item>(field: K) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    setFormError('')
    if (!form.item_code?.trim() || !form.item_name?.trim()) {
      setFormError('Item Code and Item Name are required.')
      return
    }
    setSubmitting(true)
    try {
      await itemsApi.update(itemId, {
        item_code: form.item_code.trim(),
        item_name: form.item_name.trim(),
        item_type: form.item_type || undefined,
        item_group: form.item_group || undefined,
        description: form.description || undefined,
        unit_of_measure: form.unit_of_measure || undefined,
        purchase_uom: form.purchase_uom || undefined,
        item_specification: form.item_specification || undefined,
        manufacturer_part_number: form.manufacturer_part_number || undefined,
        make_or_buy: form.make_or_buy || undefined,
        default_warehouse_id: form.default_warehouse_id || undefined,
        minimum_stock: form.minimum_stock === undefined || form.minimum_stock === null ? undefined : Number(form.minimum_stock),
        maximum_stock: form.maximum_stock === undefined || form.maximum_stock === null ? undefined : Number(form.maximum_stock),
        hsn_sac: form.hsn_sac || undefined,
        gst_tax: form.gst_tax || undefined,
        quality_inspection_required: !!form.quality_inspection_required,
        batch_serial_tracking: form.batch_serial_tracking || undefined,
        item_status: form.item_status || undefined,
      })
      router.push('/dashboard/store/item-master')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFormError(err.response?.data?.detail || 'Failed to update item.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Edit Item</h1>
        </div>
        <button onClick={() => router.push('/dashboard/store/item-master')} type="button" style={secondaryBtnStyle}>
          ← Back
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ width: '100%' }}>
          {formError && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {formError}
            </div>
          )}

          <Section title="Basic Details" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Item Code *">
                <input style={inputStyle} value={form.item_code || ''} onChange={set('item_code')} />
              </Field>
              <Field label="Item Name *">
                <input style={inputStyle} value={form.item_name || ''} onChange={set('item_name')} />
              </Field>
              <Field label="Item Type">
                <select style={inputStyle} value={form.item_type || ''} onChange={set('item_type')}>
                  <option value="">—</option>
                  {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Item Category / Group">
                <select style={inputStyle} value={form.item_group || ''} onChange={set('item_group')}>
                  <option value="">—</option>
                  {ITEM_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Description">
              <textarea style={textareaStyle} value={form.description || ''} onChange={set('description')} rows={3} />
            </Field>
          </Section>

          <Section title="Units & Specification" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Stock UOM">
                <select style={inputStyle} value={form.unit_of_measure || ''} onChange={set('unit_of_measure')}>
                  <option value="">—</option>
                  {UNITS_OF_MEASURE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Purchase UOM">
                <select style={inputStyle} value={form.purchase_uom || ''} onChange={set('purchase_uom')}>
                  <option value="">—</option>
                  {UNITS_OF_MEASURE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Manufacturer / Part Number">
                <input style={inputStyle} value={form.manufacturer_part_number || ''} onChange={set('manufacturer_part_number')} />
              </Field>
              <Field label="Make or Buy">
                <select style={inputStyle} value={form.make_or_buy || ''} onChange={set('make_or_buy')}>
                  <option value="">—</option>
                  {MAKE_OR_BUY.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Item Specification">
              <textarea style={textareaStyle} value={form.item_specification || ''} onChange={set('item_specification')} rows={3} />
            </Field>
          </Section>

          <Section title="Stock & Warehouse" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Default Warehouse">
                <select
                  style={inputStyle}
                  value={form.default_warehouse_id ? String(form.default_warehouse_id) : ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, default_warehouse_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Minimum Stock">
                <input type="number" style={inputStyle} value={form.minimum_stock ?? ''} onChange={set('minimum_stock')} />
              </Field>
              <Field label="Maximum Stock">
                <input type="number" style={inputStyle} value={form.maximum_stock ?? ''} onChange={set('maximum_stock')} />
              </Field>
            </Row>
          </Section>

          <Section title="Tax & Compliance" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="HSN Code">
                <input style={inputStyle} value={form.hsn_sac || ''} onChange={set('hsn_sac')} />
              </Field>
              <Field label="GST / Tax">
                <select style={inputStyle} value={form.gst_tax || ''} onChange={set('gst_tax')}>
                  <option value="">—</option>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Batch / Serial Tracking">
                <select style={inputStyle} value={form.batch_serial_tracking || ''} onChange={set('batch_serial_tracking')}>
                  <option value="">—</option>
                  {BATCH_SERIAL_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Item Status">
                <select style={inputStyle} value={form.item_status || 'Active'} onChange={set('item_status')}>
                  {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </Row>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, marginTop: 4 }}>
              <Checkbox checked={!!form.quality_inspection_required} onChange={set('quality_inspection_required')} />
              Quality Inspection Required
            </span>
          </Section>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => router.push('/dashboard/store/item-master')} disabled={submitting} type="button" style={{ padding: '12px 22px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting} type="button" style={{ ...primaryBtnStyle, padding: '12px 26px', fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
