'use client'

import { useEffect, useMemo, useState } from 'react'
import { productionApi } from '@/lib/api'
import { ProductionBom, ProductionLookupOption } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import Checkbox from '@/components/Checkbox'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import { productionEngineeringLookups } from '@/lib/productionEngineeringApi'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

// SAP item categories (CS01): stock = reserved + issued from Store;
// non-stock = bought directly for the order; text / document = information lines.
const CATEGORY_LABELS: Record<string, string> = { stock: 'Stock', non_stock: 'Non-stock', text: 'Text', document: 'Document' }

const inputStyle = sheetInput
const labelStyle = sheetLabel
const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: 12, borderRadius: 12,
  border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT,
}
const removeBtn: React.CSSProperties = { ...sheetBtn('secondary'), padding: '9px 12px', color: '#dc2626', borderColor: '#fecaca' }

interface ItemRow {
  key: number; component_item_id: string; quantity: string; scrap_percent: string; remarks: string
  item_category: string; line_text: string; document_id: string; make_buy: string | null; source_tag: string | null
}
interface OpRow {
  key: number; sequence: string; operation_name: string; workstation_id: string
  setup_hours: string; run_hours_per_unit: string; requires_inspection: boolean; instructions: string
  control_key: string; confirmation: string; print_on_job_card: boolean; vendor_id: string; external_cost: string
}
const blankItem = (): ItemRow => ({
  key: nextKey(), component_item_id: '', quantity: '1', scrap_percent: '0', remarks: '',
  item_category: 'stock', line_text: '', document_id: '', make_buy: null, source_tag: null,
})

let rowKey = 0
const nextKey = () => ++rowKey

export default function BomForm({
  initial,
  submitLabel,
  onSubmit,
  title,
  subtitle,
  onBack,
  nav,
  backTour,
}: {
  initial?: ProductionBom | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  title: string
  subtitle: string
  /** Leaves the form without saving (Back pill + footer Cancel). */
  onBack: () => void
  nav?: React.ReactNode
  /** data-tour on the "← Back" pill. */
  backTour?: string
}) {
  // Job-work charges are cost data (Production › BOM › costs switch).
  const seeCosts = useCan().canFeature('production', 'bom', 'costs', 'view')
  const [productId, setProductId] = useState(initial ? String(initial.product_item_id) : '')
  const [baseQty, setBaseQty] = useState(String(initial?.base_quantity ?? 1))
  const [description, setDescription] = useState(initial?.description || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [validFrom, setValidFrom] = useState(initial?.valid_from || '')
  const [validTo, setValidTo] = useState(initial?.valid_to || '')
  const [changeNumber, setChangeNumber] = useState(initial?.change_number || '')
  const [items, setItems] = useState<ItemRow[]>(
    initial?.items.map((i) => ({
      key: nextKey(), component_item_id: i.component_item_id ? String(i.component_item_id) : '', quantity: String(i.quantity),
      scrap_percent: String(i.scrap_percent), remarks: i.remarks || '', item_category: i.item_category || 'stock',
      line_text: i.line_text || '', document_id: i.document_id ? String(i.document_id) : '', make_buy: i.make_buy || null,
      source_tag: i.source_tag || null,
    }))
    || [blankItem()],
  )
  const [ops, setOps] = useState<OpRow[]>(
    initial?.operations.map((o) => ({
      key: nextKey(), sequence: String(o.sequence), operation_name: o.operation_name, workstation_id: o.workstation_id ? String(o.workstation_id) : '',
      setup_hours: String(o.setup_hours), run_hours_per_unit: String(o.run_hours_per_unit), requires_inspection: o.requires_inspection, instructions: o.instructions || '',
      control_key: o.control_key || 'internal', confirmation: o.confirmation || 'optional', print_on_job_card: o.print_on_job_card !== false,
      vendor_id: o.vendor_id ? String(o.vendor_id) : '', external_cost: o.external_cost != null ? String(o.external_cost) : '',
    })) || [],
  )
  const [vendors, setVendors] = useState<ProductionLookupOption[]>([])
  const [documents, setDocuments] = useState<ProductionLookupOption[]>([])
  const [itemOptions, setItemOptions] = useState<ProductionLookupOption[]>([])
  const [workstations, setWorkstations] = useState<ProductionLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    productionApi.lookupItems({ limit: 5000 }).then(setItemOptions).catch((err) => setError(extractErrorMessages(err, 'Failed to load Store items.')))
    productionApi.lookupWorkstations().then(setWorkstations).catch((err) => setError(extractErrorMessages(err, 'Failed to load workstations.')))
    productionEngineeringLookups.vendors().then(setVendors).catch((err) => setError(extractErrorMessages(err, 'Failed to load job-work vendors.')))
    productionEngineeringLookups.designDocuments().then(setDocuments).catch(() => setDocuments([]))
  }, [])

  const itemSelectOptions = useMemo(() => itemOptions.map((i) => ({ value: String(i.id), label: i.label })), [itemOptions])
  const uomOf = (id: string) => itemOptions.find((i) => String(i.id) === id)?.extra || ''

  const updateItem = (key: number, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const updateOp = (key: number, patch: Partial<OpRow>) => setOps((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addOp = () => {
    const maxSeq = ops.reduce((m, o) => Math.max(m, Number(o.sequence) || 0), 0)
    setOps([...ops, {
      key: nextKey(), sequence: String(maxSeq + 10), operation_name: '', workstation_id: '', setup_hours: '0', run_hours_per_unit: '0',
      requires_inspection: false, instructions: '', control_key: 'internal', confirmation: 'optional', print_on_job_card: true, vendor_id: '', external_cost: '',
    }])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!productId) { setError('Pick the product this BOM builds.'); return }
    const base = Number(baseQty)
    if (!(base > 0)) { setError('Base quantity must be more than zero.'); return }
    const filledItems = items.filter((r) => (r.item_category === 'text' ? r.line_text.trim() : r.item_category === 'document' ? r.document_id : r.component_item_id))
    if (filledItems.some((r) => !(Number(r.quantity) > 0))) { setError('Every component needs a quantity above zero.'); return }
    if (validFrom && validTo && validTo < validFrom) { setError("'Valid to' is before 'Valid from' — clear it or pick a later date."); return }
    const extNoVendor = ops.find((o) => o.control_key === 'external' && !o.vendor_id)
    if (extNoVendor) { setError(`Operation ${extNoVendor.sequence} is external (subcontracted) — pick the job-work vendor.`); return }
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
        valid_from: validFrom || null,
        valid_to: validTo || null,
        change_number: changeNumber.trim() || null,
        items: filledItems.map((r) => ({
          component_item_id: r.item_category === 'text' || !r.component_item_id ? null : Number(r.component_item_id), quantity: Number(r.quantity),
          scrap_percent: Number(r.scrap_percent) || 0, remarks: r.remarks.trim() || null,
          item_category: r.item_category, line_text: r.line_text.trim() || null,
          document_id: r.item_category === 'document' && r.document_id ? Number(r.document_id) : null,
          make_buy: r.make_buy, source_tag: r.source_tag,
        })),
        operations: ops.map((o) => ({
          sequence: Number(o.sequence), operation_name: o.operation_name.trim(),
          workstation_id: o.workstation_id ? Number(o.workstation_id) : null,
          setup_hours: Number(o.setup_hours) || 0, run_hours_per_unit: Number(o.run_hours_per_unit) || 0,
          requires_inspection: o.requires_inspection, instructions: o.instructions.trim() || null,
          control_key: o.control_key, confirmation: o.confirmation, print_on_job_card: o.print_on_job_card,
          vendor_id: o.control_key === 'external' && o.vendor_id ? Number(o.vendor_id) : null,
          external_cost: o.control_key === 'external' && o.external_cost !== '' ? Number(o.external_cost) : null,
        })),
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save BOM.'))
    } finally {
      setSaving(false)
    }
  }

  const filledCount = items.filter((r) => r.component_item_id || r.line_text || r.document_id).length

  return (
    <form onSubmit={handleSubmit}>
      <FormPage icon={initial ? 'edit' : 'box'} title={title} subtitle={subtitle} onBack={onBack} backTour={backTour} nav={nav}
        footer={<>
          <button type="button" onClick={onBack} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="production-bom-form-submit-btn" type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}>
        <SheetColumns
          left={<>
            {error && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(error) ? error.join(' ') : error}
              </div>
            )}
            <SheetSection icon="box" title="Product">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="production-bom-form-product" style={{ flex: '1 1 300px', maxWidth: 480 }}>
                  <label style={labelStyle}>Product (Store item) <Req /></label>
                  {initial ? (
                    <div style={{ ...inputStyle, background: SHEET.SOFT }}>{initial.product_code} — {initial.product_name}</div>
                  ) : (
                    <SearchableSelect value={productId} onChange={setProductId} options={itemSelectOptions} placeholder="Search finished / semi-finished item…" />
                  )}
                </div>
                <div data-tour="production-bom-form-base-qty" style={{ flex: '0 1 150px', minWidth: 140 }}>
                  <label style={labelStyle}>Base Quantity <Req /></label>
                  <input style={inputStyle} type="number" min={0} step="any" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} />
                </div>
              </div>
              <p style={sheetHint}>
                Component quantities below are per {baseQty || '1'} unit(s) of the product. The product must exist in the Store item master.
              </p>
            </SheetSection>
            <SheetSection icon="calendar" title="Validity & Change" extra={<Optional />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Valid From</label>
                  <DateField value={validFrom} onChange={setValidFrom} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Valid To</label>
                  <DateField value={validTo} onChange={setValidTo} />
                </div>
                <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
                  <label style={labelStyle}>Change Number</label>
                  <input style={inputStyle} value={changeNumber} placeholder="ECN no. or change ref" onChange={(e) => setChangeNumber(e.target.value)} />
                </div>
              </div>
              <p style={sheetHint}>
                Work orders can only use this version when their planned start falls inside its validity. A future &quot;Valid From&quot; keeps the current version in force until the day before.
              </p>
            </SheetSection>
          </>}
          right={
            <SheetSection icon="chat" title="Notes" extra={<Optional />}>
              <div data-tour="production-bom-form-description">
                <label style={labelStyle}>Description</label>
                <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div data-tour="production-bom-form-remarks" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Remarks</label>
                <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </SheetSection>
          }
        />

        <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="list" title={`Components (${filledCount})`}
            extra={<button data-tour="production-bom-form-add-component-btn" type="button" style={{ ...sheetBtn('secondary'), marginLeft: 'auto' }}
              onClick={() => setItems([...items, blankItem()])}>
              <SheetIcon name="plus" size={14} />Add Component
            </button>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((r) => (
                <div key={r.key} style={rowStyle}>
                  <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                    <label style={labelStyle}>Category</label>
                    <Select style={inputStyle} value={r.item_category} onChange={(e) => updateItem(r.key, { item_category: e.target.value })}>
                      {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </div>
                  {r.item_category === 'text' ? (
                    <div style={{ flex: '1 1 300px', maxWidth: 560 }}>
                      <label style={labelStyle}>Text</label>
                      <input style={inputStyle} value={r.line_text} placeholder="Assembly note, e.g. torque all M16 to 210 Nm" onChange={(e) => updateItem(r.key, { line_text: e.target.value })} />
                    </div>
                  ) : r.item_category === 'document' ? (
                    <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
                      <label style={labelStyle}>Design document</label>
                      <SearchableSelect value={r.document_id} onChange={(v) => updateItem(r.key, { document_id: v })} placeholder="Search drawing…"
                        options={documents.map((d) => ({ value: String(d.id), label: d.label }))} />
                    </div>
                  ) : (
                    <div data-tour="production-bom-form-component" style={{ flex: '1 1 300px', maxWidth: 460 }}>
                      <label style={labelStyle}>Component{r.source_tag ? ` · ${r.source_tag}` : ''}</label>
                      <SearchableSelect value={r.component_item_id} onChange={(v) => updateItem(r.key, { component_item_id: v })} options={itemSelectOptions} placeholder="Search item…" />
                    </div>
                  )}
                  <div data-tour="production-bom-form-component-qty" style={{ flex: '0 1 120px', minWidth: 100 }}>
                    <label style={labelStyle}>Qty {uomOf(r.component_item_id) && `(${uomOf(r.component_item_id)})`}</label>
                    <input style={inputStyle} type="number" min={0} step="any" value={r.quantity} onChange={(e) => updateItem(r.key, { quantity: e.target.value })} />
                  </div>
                  <div data-tour="production-bom-form-scrap" style={{ flex: '0 1 100px', minWidth: 90 }}>
                    <label style={labelStyle}>Scrap %</label>
                    <input style={inputStyle} type="number" min={0} max={99} step="any" value={r.scrap_percent} onChange={(e) => updateItem(r.key, { scrap_percent: e.target.value })} />
                  </div>
                  <div style={{ flex: '1 1 180px', maxWidth: 280 }}>
                    <label style={labelStyle}>Remarks</label>
                    <input style={inputStyle} value={r.remarks} onChange={(e) => updateItem(r.key, { remarks: e.target.value })} />
                  </div>
                  <button data-tour="production-bom-form-remove-component-btn" type="button" style={removeBtn} onClick={() => setItems(items.filter((x) => x.key !== r.key))} aria-label="Remove component"><SheetIcon name="trash" size={15} /></button>
                </div>
              ))}
              {items.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No components yet — a BOM needs at least one before it can be activated.</p>}
            </div>
          </SheetSection>

          <SheetSection icon="gear" title={`Routing Operations (${ops.length})`}
            extra={<button data-tour="production-bom-form-add-op-btn" type="button" style={{ ...sheetBtn('secondary'), marginLeft: 'auto' }} onClick={addOp}><SheetIcon name="plus" size={14} />Add Operation</button>}>
            <p style={{ ...sheetHint, margin: '0 0 12px' }}>
              Planned hours on a work order = setup + run hours × quantity. Tick &quot;Quality gate&quot; to require a passed Quality inspection before the step can be completed.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ops.map((o) => (
                <div key={o.key} style={rowStyle}>
                  <div data-tour="production-bom-form-op-seq" style={{ flex: '0 1 80px', minWidth: 70 }}>
                    <label style={labelStyle}>Seq</label>
                    <input style={inputStyle} type="number" min={1} value={o.sequence} onChange={(e) => updateOp(o.key, { sequence: e.target.value })} />
                  </div>
                  <div data-tour="production-bom-form-op-name" style={{ flex: '1 1 200px', maxWidth: 280 }}>
                    <label style={labelStyle}>Operation <Req /></label>
                    <input style={inputStyle} value={o.operation_name} placeholder="Cutting, Welding, Assembly…" onChange={(e) => updateOp(o.key, { operation_name: e.target.value })} />
                  </div>
                  <div data-tour="production-bom-form-op-workstation" style={{ flex: '1 1 200px', maxWidth: 280 }}>
                    <label style={labelStyle}>Workstation</label>
                    <SearchableSelect value={o.workstation_id} onChange={(v) => updateOp(o.key, { workstation_id: v })} placeholder="Select…"
                      options={[{ value: '', label: '— Unassigned —' }, ...workstations.map((w) => ({ value: String(w.id), label: w.label }))]} />
                  </div>
                  <div data-tour="production-bom-form-op-setup" style={{ flex: '0 1 100px', minWidth: 90 }}>
                    <label style={labelStyle}>Setup hrs</label>
                    <input style={inputStyle} type="number" min={0} step="any" value={o.setup_hours} onChange={(e) => updateOp(o.key, { setup_hours: e.target.value })} />
                  </div>
                  <div data-tour="production-bom-form-op-run" style={{ flex: '0 1 110px', minWidth: 100 }}>
                    <label style={labelStyle}>Run hrs/unit</label>
                    <input style={inputStyle} type="number" min={0} step="any" value={o.run_hours_per_unit} onChange={(e) => updateOp(o.key, { run_hours_per_unit: e.target.value })} />
                  </div>
                  <div data-tour="production-bom-form-op-gate" style={{ flex: '0 1 110px', minWidth: 100, display: 'flex', flexDirection: 'column' }}>
                    <label style={labelStyle}>Quality gate</label>
                    <div style={{ paddingTop: 6 }}>
                      <Checkbox checked={o.requires_inspection} onChange={(e) => updateOp(o.key, { requires_inspection: e.target.checked })} />
                    </div>
                  </div>
                  <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                    <label style={labelStyle}>Control key</label>
                    <Select style={inputStyle} value={o.control_key} onChange={(e) => updateOp(o.key, { control_key: e.target.value })}>
                      <option value="internal">Internal</option>
                      <option value="external">External (job work)</option>
                    </Select>
                  </div>
                  <div style={{ flex: '0 1 140px', minWidth: 130 }}>
                    <label style={labelStyle}>Confirmation</label>
                    <Select style={inputStyle} value={o.confirmation} onChange={(e) => updateOp(o.key, { confirmation: e.target.value })}>
                      <option value="optional">Optional</option>
                      <option value="required">Required</option>
                      <option value="none">None (milestone)</option>
                    </Select>
                  </div>
                  <div style={{ flex: '0 1 100px', minWidth: 90, display: 'flex', flexDirection: 'column' }}>
                    <label style={labelStyle}>Print</label>
                    <div style={{ paddingTop: 6 }}>
                      <Checkbox checked={o.print_on_job_card} onChange={(e) => updateOp(o.key, { print_on_job_card: e.target.checked })} />
                    </div>
                  </div>
                  {o.control_key === 'external' && (
                    <>
                      <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                        <label style={labelStyle}>Job-work vendor <Req /></label>
                        <SearchableSelect value={o.vendor_id} onChange={(v) => updateOp(o.key, { vendor_id: v })} placeholder="Select vendor…"
                          options={vendors.map((v) => ({ value: String(v.id), label: v.label }))} />
                      </div>
                      {seeCosts && (
                        <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                          <label style={labelStyle}>Charge / unit (₹)</label>
                          <input style={inputStyle} type="number" min={0} step="any" value={o.external_cost} onChange={(e) => updateOp(o.key, { external_cost: e.target.value })} />
                        </div>
                      )}
                    </>
                  )}
                  <button type="button" style={removeBtn} onClick={() => setOps(ops.filter((x) => x.key !== o.key))} aria-label="Remove operation"><SheetIcon name="trash" size={15} /></button>
                  <div data-tour="production-bom-form-op-instructions" style={{ flex: '1 1 100%' }}>
                    <label style={labelStyle}>Work instructions</label>
                    <input style={inputStyle} value={o.instructions} placeholder="Drawing ref, torque values, WPS number…" onChange={(e) => updateOp(o.key, { instructions: e.target.value })} />
                  </div>
                </div>
              ))}
              {ops.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No operations yet. A work order needs at least one operation before it can be released.</p>}
            </div>
          </SheetSection>
        </div>
      </FormPage>
    </form>
  )
}
