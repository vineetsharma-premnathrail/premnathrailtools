'use client'

import { useEffect, useMemo, useState } from 'react'
import { productionApi } from '@/lib/api'
import { ProductionBom, ProductionLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import Checkbox from '@/components/Checkbox'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

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
const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: 12, borderRadius: 12,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.45)',
}
const removeBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '9px 12px', color: DANGER.primary, borderColor: DANGER.border }

interface ItemRow { key: number; component_item_id: string; quantity: string; scrap_percent: string; remarks: string }
interface OpRow {
  key: number; sequence: string; operation_name: string; workstation_id: string
  setup_hours: string; run_hours_per_unit: string; requires_inspection: boolean; instructions: string
}

let rowKey = 0
const nextKey = () => ++rowKey

export default function BomForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ProductionBom | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [productId, setProductId] = useState(initial ? String(initial.product_item_id) : '')
  const [baseQty, setBaseQty] = useState(String(initial?.base_quantity ?? 1))
  const [description, setDescription] = useState(initial?.description || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [items, setItems] = useState<ItemRow[]>(
    initial?.items.map((i) => ({ key: nextKey(), component_item_id: String(i.component_item_id), quantity: String(i.quantity), scrap_percent: String(i.scrap_percent), remarks: i.remarks || '' }))
    || [{ key: nextKey(), component_item_id: '', quantity: '1', scrap_percent: '0', remarks: '' }],
  )
  const [ops, setOps] = useState<OpRow[]>(
    initial?.operations.map((o) => ({
      key: nextKey(), sequence: String(o.sequence), operation_name: o.operation_name, workstation_id: o.workstation_id ? String(o.workstation_id) : '',
      setup_hours: String(o.setup_hours), run_hours_per_unit: String(o.run_hours_per_unit), requires_inspection: o.requires_inspection, instructions: o.instructions || '',
    })) || [],
  )
  const [itemOptions, setItemOptions] = useState<ProductionLookupOption[]>([])
  const [workstations, setWorkstations] = useState<ProductionLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    productionApi.lookupItems({ limit: 5000 }).then(setItemOptions).catch((err) => setError(extractErrorMessages(err, 'Failed to load Store items.')))
    productionApi.lookupWorkstations().then(setWorkstations).catch((err) => setError(extractErrorMessages(err, 'Failed to load workstations.')))
  }, [])

  const itemSelectOptions = useMemo(() => itemOptions.map((i) => ({ value: String(i.id), label: i.label })), [itemOptions])
  const uomOf = (id: string) => itemOptions.find((i) => String(i.id) === id)?.extra || ''

  const updateItem = (key: number, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const updateOp = (key: number, patch: Partial<OpRow>) => setOps((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addOp = () => {
    const maxSeq = ops.reduce((m, o) => Math.max(m, Number(o.sequence) || 0), 0)
    setOps([...ops, { key: nextKey(), sequence: String(maxSeq + 10), operation_name: '', workstation_id: '', setup_hours: '0', run_hours_per_unit: '0', requires_inspection: false, instructions: '' }])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!productId) { setError('Pick the product this BOM builds.'); return }
    const base = Number(baseQty)
    if (!(base > 0)) { setError('Base quantity must be more than zero.'); return }
    const filledItems = items.filter((r) => r.component_item_id)
    if (filledItems.some((r) => !(Number(r.quantity) > 0))) { setError('Every component needs a quantity above zero.'); return }
    if (filledItems.some((r) => Number(r.scrap_percent) < 0 || Number(r.scrap_percent) >= 100)) { setError('Scrap % must be between 0 and 99.'); return }
    if (ops.some((o) => !o.operation_name.trim())) { setError('Every routing operation needs a name — remove empty operation rows.'); return }
    if (ops.some((o) => !(Number(o.sequence) >= 1))) { setError('Every routing operation needs a sequence number of 1 or more.'); return }

    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { product_item_id: Number(productId) }),
        base_quantity: base,
        description: description.trim() || null,
        remarks: remarks.trim() || null,
        items: filledItems.map((r) => ({
          component_item_id: Number(r.component_item_id), quantity: Number(r.quantity),
          scrap_percent: Number(r.scrap_percent) || 0, remarks: r.remarks.trim() || null,
        })),
        operations: ops.map((o) => ({
          sequence: Number(o.sequence), operation_name: o.operation_name.trim(),
          workstation_id: o.workstation_id ? Number(o.workstation_id) : null,
          setup_hours: Number(o.setup_hours) || 0, run_hours_per_unit: Number(o.run_hours_per_unit) || 0,
          requires_inspection: o.requires_inspection, instructions: o.instructions.trim() || null,
        })),
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save BOM.'))
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
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Product</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
            <label style={labelStyle}>Product (Store item) *</label>
            {initial ? (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)' }}>{initial.product_code} — {initial.product_name}</div>
            ) : (
              <SearchableSelect value={productId} onChange={setProductId} options={itemSelectOptions} placeholder="Search finished / semi-finished item…" />
            )}
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Base Quantity *</label>
            <input style={inputStyle} type="number" min={0} step="any" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>
          Component quantities below are per {baseQty || '1'} unit(s) of the product. The product must exist in the Store item master.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <p style={sectionTitle}>Components ({items.filter((r) => r.component_item_id).length})</p>
          <button type="button" style={secondaryBtnStyle}
            onClick={() => setItems([...items, { key: nextKey(), component_item_id: '', quantity: '1', scrap_percent: '0', remarks: '' }])}>
            + Add Component
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((r) => (
            <div key={r.key} style={rowStyle}>
              <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
                <label style={labelStyle}>Component</label>
                <SearchableSelect value={r.component_item_id} onChange={(v) => updateItem(r.key, { component_item_id: v })} options={itemSelectOptions} placeholder="Search item…" />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 100 }}>
                <label style={labelStyle}>Qty {uomOf(r.component_item_id) && `(${uomOf(r.component_item_id)})`}</label>
                <input style={inputStyle} type="number" min={0} step="any" value={r.quantity} onChange={(e) => updateItem(r.key, { quantity: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                <label style={labelStyle}>Scrap %</label>
                <input style={inputStyle} type="number" min={0} max={99} step="any" value={r.scrap_percent} onChange={(e) => updateItem(r.key, { scrap_percent: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 180px', maxWidth: 280 }}>
                <label style={labelStyle}>Remarks</label>
                <input style={inputStyle} value={r.remarks} onChange={(e) => updateItem(r.key, { remarks: e.target.value })} />
              </div>
              <button type="button" style={removeBtn} onClick={() => setItems(items.filter((x) => x.key !== r.key))} aria-label="Remove component">×</button>
            </div>
          ))}
          {items.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No components yet — a BOM needs at least one before it can be activated.</p>}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <p style={sectionTitle}>Routing Operations ({ops.length})</p>
          <button type="button" style={secondaryBtnStyle} onClick={addOp}>+ Add Operation</button>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Planned hours on a work order = setup + run hours × quantity. Tick &quot;Quality gate&quot; to require a passed Quality inspection before the step can be completed.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ops.map((o) => (
            <div key={o.key} style={rowStyle}>
              <div style={{ flex: '0 1 80px', minWidth: 70 }}>
                <label style={labelStyle}>Seq</label>
                <input style={inputStyle} type="number" min={1} value={o.sequence} onChange={(e) => updateOp(o.key, { sequence: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                <label style={labelStyle}>Operation</label>
                <input style={inputStyle} value={o.operation_name} placeholder="Cutting, Welding, Assembly…" onChange={(e) => updateOp(o.key, { operation_name: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                <label style={labelStyle}>Workstation</label>
                <SearchableSelect value={o.workstation_id} onChange={(v) => updateOp(o.key, { workstation_id: v })} placeholder="Select…"
                  options={[{ value: '', label: '— Unassigned —' }, ...workstations.map((w) => ({ value: String(w.id), label: w.label }))]} />
              </div>
              <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                <label style={labelStyle}>Setup hrs</label>
                <input style={inputStyle} type="number" min={0} step="any" value={o.setup_hours} onChange={(e) => updateOp(o.key, { setup_hours: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                <label style={labelStyle}>Run hrs/unit</label>
                <input style={inputStyle} type="number" min={0} step="any" value={o.run_hours_per_unit} onChange={(e) => updateOp(o.key, { run_hours_per_unit: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 110px', minWidth: 100, display: 'flex', flexDirection: 'column' }}>
                <label style={labelStyle}>Quality gate</label>
                <div style={{ paddingTop: 6 }}>
                  <Checkbox checked={o.requires_inspection} onChange={(e) => updateOp(o.key, { requires_inspection: e.target.checked })} />
                </div>
              </div>
              <button type="button" style={removeBtn} onClick={() => setOps(ops.filter((x) => x.key !== o.key))} aria-label="Remove operation">×</button>
              <div style={{ flex: '1 1 100%' }}>
                <label style={labelStyle}>Work instructions</label>
                <input style={inputStyle} value={o.instructions} placeholder="Drawing ref, torque values, WPS number…" onChange={(e) => updateOp(o.key, { instructions: e.target.value })} />
              </div>
            </div>
          ))}
          {ops.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No operations yet. A work order needs at least one operation before it can be released.</p>}
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
