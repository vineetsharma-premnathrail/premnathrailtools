'use client'

import { useEffect, useState } from 'react'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import Select from '@/components/shared/Select'
import { SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { useVisibility } from '@/lib/visibility'
import { VisOptionValues, VisSection } from '@/lib/visibilityComponents'

export interface PlannedOrderFormValue { item_id: string; quantity: string; finish_date: string; procurement: string; remarks: string }
type Lookup = { id: number; label: string }

const PROCUREMENT_OPTIONS = [{ value: 'make', label: 'Make' }, { value: 'buy', label: 'Buy' }]

/**
 * The New planned order form body (MRP › + New planned order), shared by the popup on the MRP page and the Role
 * editor's "Preview & choose". Procurement values follow the role's visibility (Production › Planning › Visibility);
 * "From BOM" is offered only when the role may pick both, because the server refuses a result the role can't pick.
 */
export function PlannedOrderFormBody({ form, onChange, itemOptions, plantPicked }: {
  form: PlannedOrderFormValue; onChange: (next: PlannedOrderFormValue) => void; itemOptions: Lookup[]; plantPicked: boolean
}) {
  const vis = useVisibility('production:planning')
  const allowed = vis.options('procurement', PROCUREMENT_OPTIONS, (o) => o.value)
  const fromBom = allowed.length === PROCUREMENT_OPTIONS.length
  const allowedKey = allowed.map((o) => o.value).join(',')
  // A role that may not use "From BOM" starts on the first value it may pick.
  useEffect(() => {
    const values = allowedKey.split(',').filter(Boolean)
    if (form.procurement === '' ? values.length < PROCUREMENT_OPTIONS.length : !values.includes(form.procurement)) {
      onChange({ ...form, procurement: values.length < PROCUREMENT_OPTIONS.length ? values[0] || '' : '' })
    }
  }, [allowedKey, form, onChange])
  return (
    <>
      <VisSection vis={vis} k="item_quantity">
        <SheetSection icon="box" title="Item & Quantity">
          <label style={sheetLabel}>Item <Req /></label>
          <SearchableSelect value={form.item_id} onChange={(v) => onChange({ ...form, item_id: v })} placeholder="Search the Item Master…"
            options={itemOptions.map((i) => ({ value: String(i.id), label: i.label }))} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            <div style={{ flex: '0 1 130px' }}><label style={sheetLabel}>Quantity <Req /></label><input type="number" min={0} value={form.quantity} onChange={(e) => onChange({ ...form, quantity: e.target.value })} style={sheetInput} /></div>
            <div style={{ flex: '0 1 175px' }}><label style={sheetLabel}>Needed by (finish) <Req /></label><DateField value={form.finish_date} onChange={(v) => onChange({ ...form, finish_date: v })} /></div>
            <div style={{ flex: '0 1 150px' }}>
              <label style={sheetLabel}>Procurement</label>
              <Select value={form.procurement} onChange={(e) => onChange({ ...form, procurement: e.target.value })} style={sheetInput}>
                {fromBom && <option value="">From BOM</option>}
                {allowed.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>
          <VisOptionValues vis={vis} dropdown="procurement" />
          <p style={sheetHint}>Manual planned orders are firmed; the start date is back-scheduled from the lead time{plantPicked ? ' for the selected plant' : ''}.</p>
        </SheetSection>
      </VisSection>
      <VisSection vis={vis} k="form_remarks">
        <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
          <input value={form.remarks} onChange={(e) => onChange({ ...form, remarks: e.target.value })} style={sheetInput} />
        </SheetSection>
      </VisSection>
    </>
  )
}

/** Role editor "Preview & choose" of the New planned order form: the same body on a card, Create disabled, nothing saved. */
export default function PlannedOrderFormPreview() {
  const [form, setForm] = useState<PlannedOrderFormValue>({ item_id: '', quantity: '', finish_date: '', procurement: '', remarks: '' })
  return (
    <div style={{ borderRadius: 18, border: `1px solid ${SHEET.LINE}`, background: '#fff', maxWidth: 580 }}>
      <div style={{ padding: '16px 24px', borderBottom: `1px solid ${SHEET.LINE}`, fontSize: 16, fontWeight: 700, color: SHEET.INK }}>New planned order</div>
      <div style={{ padding: '20px 24px' }}>
        <PlannedOrderFormBody form={form} onChange={setForm} itemOptions={[{ id: -1, label: '0201 — Sample brake assembly' }]} plantPicked={false} />
      </div>
      <div style={{ padding: '12px 24px', borderTop: `1px solid ${SHEET.LINE}`, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" disabled style={sheetBtn('primary', SHEET.BLUE, true)}><SheetIcon name="plus" size={16} />Create</button>
      </div>
    </div>
  )
}
