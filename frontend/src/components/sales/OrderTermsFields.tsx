'use client'

// Header / commercial-terms fields of a sales order. Shared by the new-order
// form and the draft edit view on the detail page. A Rental order (bare machine
// on hire) shows Hire terms instead of order type, inspection, LD and warranty.

import { useEffect, useState } from 'react'
import Select from '@/components/shared/Select'
import DateField from '@/components/erp/DateField'
import { apiClient } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { LD_PERIOD_LABELS, LD_BASIS_LABELS, WARRANTY_RULE_LABELS, ORDER_TYPE_OPTIONS, ORDER_TYPE_LABELS, CURRENCY_OPTIONS, HIRE_RATE_BASIS_LABELS } from '@/components/sales/labels'
import { SheetSection, Req, SHEET, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ComboBox } from '@/components/crm/ui'
import { QUOTE_CONDITIONS } from '@/components/crm/constants'

export type OrderTerms = Record<string, string | number | boolean | null>

// ---- Terms & conditions — the same blocks as the CRM quotation's terms (Payment Terms,
// Quote Conditions, Notes; printed under TERMS AND CONDITIONS on the quotation), picked
// from the same saved lists (owner, 2026-10-28: picked, never copied from a quotation;
// the delivery schedule carries the delivery dates, so there is no Delivery Time). They
// are kept together in special_conditions as "Payment Terms: …\n\nQuote Conditions: …
// \n\nNotes: …" (backend sales/routes/orders.py terms_text) and split back here.
const TC_PARTS = [['payment', 'Payment Terms'], ['conditions', 'Quote Conditions'], ['notes', 'Notes']] as const
type TcKey = typeof TC_PARTS[number][0]
type Tc = Record<TcKey, string>
const TC_SPLIT = /(?:^|\n\n)(Payment Terms|Quote Conditions|Notes): /
const CUSTOM = 'Other/Custom'

export function splitTerms(text: string | null | undefined): Tc {
  const out: Tc = { payment: '', conditions: '', notes: '' }
  const s = text || ''
  if (!s.trim()) return out
  const bits = s.split(TC_SPLIT)
  // Older orders: plain text with no headings — it is all conditions.
  if (bits.length === 1) return { ...out, conditions: s }
  if (bits[0].trim()) out.conditions = bits[0].trim()
  for (let i = 1; i < bits.length; i += 2) {
    const key = TC_PARTS.find(([, label]) => label === bits[i])?.[0]
    if (key) out[key] = out[key] ? `${out[key]}\n\n${bits[i + 1] || ''}` : (bits[i + 1] || '')
  }
  return out
}
export function joinTerms(tc: Tc): string {
  return TC_PARTS.filter(([k]) => tc[k].trim()).map(([k, label]) => `${label}: ${tc[k].trim()}`).join('\n\n')
}
/** special_conditions + payment_terms_label (255 chars — the full text stays in special_conditions). */
function termsPatch(tc: Tc): OrderTerms {
  return { special_conditions: joinTerms(tc) || null, payment_terms_label: tc.payment.trim().slice(0, 255) || null }
}

type SavedTerm = { id: number; label: string; description?: string | null }

function TermsAndConditions({ v, set, rental }: { v: OrderTerms; set: (p: OrderTerms) => void; rental?: boolean }) {
  const [saved, setSaved] = useState<SavedTerm[]>([])
  const [loadError, setLoadError] = useState('')
  // "Other/Custom" picked with nothing typed yet — keep the custom box open.
  const [customOpen, setCustomOpen] = useState(false)
  useEffect(() => {
    apiClient.get<SavedTerm[]>('/sales/lookups/payment-terms').then(({ data }) => setSaved(data))
      .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the saved Payment Terms — type the terms, or reload the page.').join(' ')))
  }, [])
  const tc = splitTerms(v.special_conditions as string)
  const edit = (k: TcKey, text: string) => set(termsPatch({ ...tc, [k]: text }))
  const known = (QUOTE_CONDITIONS as readonly string[]).includes(tc.conditions) && tc.conditions !== CUSTOM
  const condChoice = known ? tc.conditions : (tc.conditions || customOpen ? CUSTOM : '')
  const area: React.CSSProperties = { ...sheetInput, resize: 'vertical', minHeight: 64 }
  const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
  return (
    <div data-tour="sales-form-terms">
      {/* Same layout as the CRM quotation's "Terms" block: conditions on the first row,
          Payment Terms full width, Notes full width. */}
      <SheetSection icon="doc" title="Terms">
        <div style={row}>
          <F label="Quote Conditions" w={220}>
            <Select style={sheetInput} value={condChoice} onChange={(e) => { const c = e.target.value; setCustomOpen(c === CUSTOM); edit('conditions', c === CUSTOM ? '' : c) }}>
              <option value="">— Select —</option>
              {QUOTE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </F>
          {rental && (
            <F label="Delivery & Return Terms" w={320} grow><input style={sheetInput} value={(v.delivery_terms_text as string) || ''} onChange={(e) => set({ delivery_terms_text: e.target.value })} placeholder="e.g. Delivered to site by us; returned at our yard" /></F>
          )}
        </div>
        {condChoice === CUSTOM && (
          <div style={row}>
            <F label="Custom Quote Conditions" w={640} grow><textarea rows={2} style={area} value={tc.conditions} onChange={(e) => edit('conditions', e.target.value)} placeholder="e.g. Prices are ex-works; freight and insurance extra." /></F>
          </div>
        )}
        <div style={row}>
          <F label="Payment Terms" w={640} grow>
            <ComboBox value={tc.payment} onChange={(t) => edit('payment', t)}
              onPick={(o) => { const t = saved.find((s) => String(s.id) === o.key); edit('payment', t ? (t.description || t.label) : o.label) }}
              options={saved.map((t) => ({ key: String(t.id), label: t.label, sublabel: t.description || undefined }))}
              placeholder="Select from Payment Terms list or type your own" style={sheetInput} />
          </F>
        </div>
        <div style={row}>
          <F label="Notes" w={640} grow><textarea rows={2} style={area} value={tc.notes} onChange={(e) => edit('notes', e.target.value)} placeholder="Any additional remarks for this order (optional)" /></F>
        </div>
        {loadError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C', marginTop: -6 }}>{loadError}</p>}
      </SheetSection>
    </div>
  )
}

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

export default function OrderTermsFields({ v, set, agencies, category, requirePoReceived }: {
  v: OrderTerms
  set: (patch: OrderTerms) => void
  agencies: { value: string; label: string }[]
  category?: string | null
  /** The order's CRM source — no longer used by the terms (picked from saved lists). */
  inquiryId?: number | null
  tenderId?: number | null
  /** New order form: "PO received on" is required. */
  requirePoReceived?: boolean
}) {
  const rental = category === 'rental'
  const txt = (k: string) => (v[k] as string) || ''
  const num = (k: string) => (v[k] === null || v[k] === undefined ? '' : String(v[k]))
  const numSet = (k: string, raw: string) => set({ [k]: raw === '' ? null : Number(raw) })
  const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
  // Warranty: applies (from each vehicle's handover = "from_delivery") or not ("not_applicable").
  // Older orders may carry another rule — shown as applying, with a note.
  const warrantyOn = !!txt('warranty_rule') && txt('warranty_rule') !== 'not_applicable'
  const warrantyLegacy = warrantyOn && txt('warranty_rule') !== 'from_delivery'
  return (
    <div>
      <SheetSection icon="doc" title="Customer PO & Contract">
      <div style={row}>
        {!rental && (
          <F label="Order type" w={200}>
            <Select style={inputStyle} value={txt('order_type') || 'road_rail_vehicle'} onChange={(e) => set({ order_type: e.target.value })}>
              {Object.entries(ORDER_TYPE_OPTIONS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              {txt('order_type') && !(txt('order_type') in ORDER_TYPE_OPTIONS) && <option value={txt('order_type')}>{ORDER_TYPE_LABELS[txt('order_type')] || txt('order_type')}</option>}
            </Select>
          </F>
        )}
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
        <F label={requirePoReceived ? 'PO received on *' : 'PO received on'} w={160}><DateField value={txt('customer_po_received_date')} onChange={(x) => set({ customer_po_received_date: x || null })} /></F>
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
      <TermsAndConditions v={v} set={set} rental={rental} />
      {rental ? (
      <div data-tour="sales-form-hire">
      <SheetSection icon="calendar" title="Hire terms">
      <div style={row}>
        <F label="Hire from *" w={160}><DateField value={txt('hire_start_date')} onChange={(x) => set({ hire_start_date: x || null })} /></F>
        <F label="Hire to" w={160}><DateField value={txt('hire_end_date')} onChange={(x) => set({ hire_end_date: x || null })} /></F>
        <F label="Rate basis *" w={220}>
          <Select style={inputStyle} value={txt('hire_rate_basis')} onChange={(e) => set({ hire_rate_basis: e.target.value || null })}>
            <option value="">— pick —</option>
            {Object.entries(HIRE_RATE_BASIS_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </Select>
        </F>
        <F label="Security deposit" w={170}><input type="number" min={0} step="1" style={inputStyle} value={num('security_deposit')} onChange={(e) => numSet('security_deposit', e.target.value)} placeholder="Blank = none" /></F>
      </div>
      <div style={row}>
        <F label="Site where the machine works *" w={420} grow><textarea rows={2} style={{ ...inputStyle, resize: 'vertical' }} value={txt('hire_site')} onChange={(e) => set({ hire_site: e.target.value })} placeholder="e.g. Ambala Cantt yard, Ambala Division, Haryana" /></F>
      </div>
      <p style={{ ...sheetHint, marginTop: -6 }}>Bare machine on hire — no operator, no LD, no warranty. Leave &quot;Hire to&quot; blank for an open-ended hire. Put the hire rate itself in the line&apos;s unit price (per the rate basis). Starred fields are needed before the order is submitted for approval.</p>
      </SheetSection>
      </div>
      ) : (
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
        <label style={{ ...checkLabel, flex: '0 0 auto' }}>
          <input type="checkbox" checked={warrantyOn}
            onChange={(e) => set(e.target.checked
              ? { warranty_rule: 'from_delivery', warranty_months_from_commissioning: null, warranty_months_from_delivery: v.warranty_months_from_delivery ?? null }
              : { warranty_rule: 'not_applicable', warranty_months_from_delivery: null, warranty_months_from_commissioning: null })} /> Warranty applies
        </label>
        {warrantyOn && (
          <F label="Warranty period (months) *" w={190}>
            <input type="number" min={1} step={1} style={inputStyle} value={num('warranty_months_from_delivery')}
              onChange={(e) => set({ warranty_rule: 'from_delivery', warranty_months_from_commissioning: null, warranty_months_from_delivery: e.target.value === '' ? null : Number(e.target.value) })} />
          </F>
        )}
        {warrantyOn && <F label="Warranty wording (as in contract)" w={300} grow><input style={inputStyle} value={txt('warranty_terms_text')} onChange={(e) => set({ warranty_terms_text: e.target.value })} /></F>}
      </div>
      {warrantyOn && (
        <p style={{ ...sheetHint, marginTop: -6 }}>
          Starts automatically on the handover date of each vehicle; ends after these months.
          {warrantyLegacy && ` This order was saved with the older rule "${WARRANTY_RULE_LABELS[txt('warranty_rule')] || txt('warranty_rule')}"${v.warranty_months_from_commissioning ? ` (${v.warranty_months_from_commissioning} months from commissioning)` : ''} — changing the months switches it to "from handover".`}
        </p>
      )}
      </SheetSection>
      )}
    </div>
  )
}
