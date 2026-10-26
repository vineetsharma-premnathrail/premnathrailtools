'use client'

// Header / commercial-terms fields of a sales order. Shared by the new-order
// form and the draft edit view on the detail page.

import Select from '@/components/shared/Select'
import DateField from '@/components/erp/DateField'
import { PRICE_BASIS_LABELS, LD_PERIOD_LABELS, LD_BASIS_LABELS, WARRANTY_RULE_LABELS, ORDER_TYPE_OPTIONS, ORDER_TYPE_LABELS, CURRENCY_OPTIONS } from '@/components/sales/labels'
import { SheetSection, Req, SHEET, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

export type OrderTerms = Record<string, string | number | boolean | null>

const inputStyle = sheetInput

// A label ending in " *" is a required field — shown with the kit's red <Req />.
function F({ label, w, grow, children, tour }: { label: string; w: number; grow?: boolean; children: React.ReactNode; tour?: string }) {
  const req = label.endsWith(' *')
  return (
    <div data-tour={tour} style={{ flex: grow ? `1 1 ${w}px` : `0 1 ${w}px`, minWidth: Math.min(w, 140), maxWidth: grow ? w * 2 : w }}>
      <label style={sheetLabel}>{req ? <>{label.slice(0, -2)} <Req /></> : label}</label>
      {children}
    </div>
  )
}
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, marginTop: 20 }

export default function OrderTermsFields({ v, set, agencies }: {
  v: OrderTerms
  set: (patch: OrderTerms) => void
  agencies: { value: string; label: string }[]
}) {
  const txt = (k: string) => (v[k] as string) || ''
  const num = (k: string) => (v[k] === null || v[k] === undefined ? '' : String(v[k]))
  const numSet = (k: string, raw: string) => set({ [k]: raw === '' ? null : Number(raw) })
  const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
  return (
    <div>
      <SheetSection icon="doc" title="Customer PO & Contract">
      <div style={row}>
        <F label="Order type" w={200}>
          <Select style={inputStyle} value={txt('order_type') || 'road_rail_vehicle'} onChange={(e) => set({ order_type: e.target.value })}>
            {Object.entries(ORDER_TYPE_OPTIONS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            {txt('order_type') && !(txt('order_type') in ORDER_TYPE_OPTIONS) && <option value={txt('order_type')}>{ORDER_TYPE_LABELS[txt('order_type')] || txt('order_type')}</option>}
          </Select>
        </F>
        <F label="Currency" w={200} tour="sales-form-currency">
          <Select searchable style={inputStyle} value={txt('currency') || 'INR'} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            {txt('currency') && !CURRENCY_OPTIONS.some((c) => c.value === txt('currency')) && <option value={txt('currency')}>{txt('currency')}</option>}
          </Select>
        </F>
        <F label="Customer PO no. *" w={200} tour="sales-form-po">
          <input style={inputStyle} value={txt('customer_po_number')} onChange={(e) => set({ customer_po_number: e.target.value })} />
        </F>
        <F label="PO date *" w={160}><DateField value={txt('customer_po_date')} onChange={(x) => set({ customer_po_date: x || null })} /></F>
        <F label="PO received on" w={160}><DateField value={txt('customer_po_received_date')} onChange={(x) => set({ customer_po_received_date: x || null })} /></F>
      </div>
      {!!txt('currency') && txt('currency') !== 'INR' && (
        <div role="note" style={{ margin: '-4px 0 14px', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Currency is recorded as a label only. Billing plan, invoices and Finance reports use the amounts as entered, without conversion.
        </div>
      )}
      <div style={row}>
        <F label="Contract agreement ref." w={200}><input style={inputStyle} value={txt('contract_reference')} onChange={(e) => set({ contract_reference: e.target.value })} /></F>
        <F label="Purchase Person Name" w={240} grow><input style={inputStyle} value={txt('purchaser_name')} onChange={(e) => set({ purchaser_name: e.target.value })} placeholder="Name of the person who placed the order" /></F>
        <F label="Paying authority" w={240} grow><input style={inputStyle} value={txt('paying_authority')} onChange={(e) => set({ paying_authority: e.target.value })} placeholder="e.g. FA&CAO, Central Railway" /></F>
      </div>
      </SheetSection>
      <SheetSection icon="rupee" title="Commercial Terms">
      <div style={row}>
        <F label="Price basis" w={190} tour="sales-form-price-basis">
          <Select style={inputStyle} value={txt('price_basis') || 'for_destination'} onChange={(e) => set({ price_basis: e.target.value })}>
            {Object.entries(PRICE_BASIS_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </Select>
        </F>
        <F label="Freight terms" w={200} grow><input style={inputStyle} value={txt('freight_terms')} onChange={(e) => set({ freight_terms: e.target.value })} /></F>
        <F label="Transit insurance" w={200} grow><input style={inputStyle} value={txt('insurance_terms')} onChange={(e) => set({ insurance_terms: e.target.value })} /></F>
        <F label="Payment terms (label)" w={240} grow><input style={inputStyle} value={txt('payment_terms_label')} onChange={(e) => set({ payment_terms_label: e.target.value })} /></F>
      </div>
      </SheetSection>
      <SheetSection icon="shield" title="Inspection, LD & Warranty">
      <div style={row}>
        <F label="Inspection agency" w={180} tour="sales-form-inspection">
          <Select style={inputStyle} value={txt('inspection_agency')} onChange={(e) => set({ inspection_agency: e.target.value || null })}>
            <option value="">— none / self —</option>
            {agencies.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </Select>
        </F>
        <label style={checkLabel}>
          <input type="checkbox" checked={!!v.third_party_inspection_required} onChange={(e) => set({ third_party_inspection_required: e.target.checked })} />
          Third-party inspection required before dispatch
        </label>
      </div>
      <div data-tour="sales-form-ld" style={row}>
        <label style={{ ...checkLabel, flex: '0 0 auto' }}>
          <input type="checkbox" checked={!!v.ld_applicable} onChange={(e) => set({ ld_applicable: e.target.checked })} /> LD applicable
        </label>
        {!!v.ld_applicable && (
          <>
            <F label="LD rate %" w={100}><input type="number" min={0} step="0.1" style={inputStyle} value={num('ld_rate_percent')} onChange={(e) => numSet('ld_rate_percent', e.target.value)} /></F>
            <F label="Per" w={200}>
              <Select style={inputStyle} value={txt('ld_rate_period') || 'week'} onChange={(e) => set({ ld_rate_period: e.target.value })}>
                {Object.entries(LD_PERIOD_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </Select>
            </F>
            <F label="Of" w={200}>
              <Select style={inputStyle} value={txt('ld_basis') || 'delayed_value'} onChange={(e) => set({ ld_basis: e.target.value })}>
                {Object.entries(LD_BASIS_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </Select>
            </F>
            <F label="Cap % (blank = no cap)" w={150}><input type="number" min={0} step="0.5" style={inputStyle} value={num('ld_max_percent')} onChange={(e) => numSet('ld_max_percent', e.target.value)} /></F>
          </>
        )}
      </div>
      <div data-tour="sales-form-warranty" style={row}>
        <F label="Warranty rule" w={200}>
          <Select style={inputStyle} value={txt('warranty_rule')} onChange={(e) => set({ warranty_rule: e.target.value || null })}>
            <option value="">— pick —</option>
            {Object.entries(WARRANTY_RULE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </Select>
        </F>
        <F label="Months from delivery" w={160}><input type="number" min={0} style={inputStyle} value={num('warranty_months_from_delivery')} onChange={(e) => numSet('warranty_months_from_delivery', e.target.value)} /></F>
        <F label="Months from commissioning" w={190}><input type="number" min={0} style={inputStyle} value={num('warranty_months_from_commissioning')} onChange={(e) => numSet('warranty_months_from_commissioning', e.target.value)} /></F>
        <F label="Warranty wording (as in contract)" w={300} grow><input style={inputStyle} value={txt('warranty_terms_text')} onChange={(e) => set({ warranty_terms_text: e.target.value })} /></F>
      </div>
      </SheetSection>
      <SheetSection icon="truck" title="Delivery & Special Conditions">
      <div style={row}>
        <F label="Delivery terms" w={320} grow><textarea rows={2} style={{ ...inputStyle, resize: 'vertical' }} value={txt('delivery_terms_text')} onChange={(e) => set({ delivery_terms_text: e.target.value })} /></F>
        <F label="Special conditions (our understanding)" w={320} grow><textarea rows={2} style={{ ...inputStyle, resize: 'vertical' }} value={txt('special_conditions')} onChange={(e) => set({ special_conditions: e.target.value })} /></F>
      </div>
      </SheetSection>
    </div>
  )
}
