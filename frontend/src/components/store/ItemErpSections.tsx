'use client'

// The Item Master's ERP sections — Purchasing, Tax & Accounts, Stock Levels
// & Cost, Quality & Tracking — shared by Add Item and the item edit form, plus
// the read-only view and the vendor suggestions panel on the item page.

import { useEffect, useState } from 'react'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Section, RowCount, Pill, TableScroll, thStyle, tdStyle, numTdStyle, numThStyle, DetailGroup, DetailRow } from '@/components/shared/ui'
import { SheetSection, Optional, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { storeApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { StoreItem, StoreItemMeta, StoreItemVendorSuggestion } from '@/types'
import Select from '@/components/shared/Select'

export type ItemErpValues = Pick<StoreItem,
  'preferred_vendor_id' | 'make' | 'manufacturer' | 'manufacturer_part_number' | 'min_order_qty'
  | 'hsn_sac_code' | 'gst_rate' | 'purchase_gl_account_id' | 'sales_gl_account_id'
  | 'standard_cost' | 'minimum_stock' | 'reorder_level' | 'safety_stock' | 'reorder_quantity' | 'maximum_stock'
  | 'inspection_on_receipt' | 'test_certificate_required' | 'batch_controlled' | 'serial_controlled'
  | 'expiry_controlled' | 'shelf_life_days'>

export const EMPTY_ERP_VALUES: ItemErpValues = {
  preferred_vendor_id: null, make: null, manufacturer: null, manufacturer_part_number: null, min_order_qty: null,
  hsn_sac_code: null, gst_rate: null, purchase_gl_account_id: null, sales_gl_account_id: null,
  standard_cost: null, minimum_stock: null, reorder_level: null, safety_stock: null, reorder_quantity: null, maximum_stock: null,
  inspection_on_receipt: false, test_certificate_required: false, batch_controlled: false, serial_controlled: false,
  expiry_controlled: false, shelf_life_days: null,
}

/** The payload slice for create / update (blank text → null). */
export function erpPayload(v: Partial<ItemErpValues>): Record<string, unknown> {
  const text = (s?: string | null) => (s || '').trim() || null
  return {
    preferred_vendor_id: v.preferred_vendor_id ?? null,
    make: text(v.make), manufacturer: text(v.manufacturer), manufacturer_part_number: text(v.manufacturer_part_number),
    min_order_qty: v.min_order_qty ?? null,
    hsn_sac_code: text(v.hsn_sac_code), gst_rate: v.gst_rate ?? null,
    purchase_gl_account_id: v.purchase_gl_account_id ?? null, sales_gl_account_id: v.sales_gl_account_id ?? null,
    standard_cost: v.standard_cost ?? null, minimum_stock: v.minimum_stock ?? null, reorder_level: v.reorder_level ?? null,
    safety_stock: v.safety_stock ?? null, reorder_quantity: v.reorder_quantity ?? null, maximum_stock: v.maximum_stock ?? null,
    inspection_on_receipt: !!v.inspection_on_receipt, test_certificate_required: !!v.test_certificate_required,
    batch_controlled: !!v.batch_controlled, serial_controlled: !!v.serial_controlled,
    expiry_controlled: !!v.expiry_controlled, shelf_life_days: v.shelf_life_days ?? null,
  }
}

const hint: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted }
const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body, cursor: 'pointer' }

const SOURCE_TEXT: Record<string, string> = {
  item: 'set on this item',
  category: "from the item's category",
  default: "Finance's default ledger",
  none: 'no ledger — Finance must set the default under Finance → Masters → Ledger Settings',
}

/** Sheet-styled field / row for the edit form (matches FormPage / FormSheet). */
function SField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ ...sheetLabel, marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  )
}
function SRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>{children}</div>
}

function NumberInput({ value, onChange, placeholder, tour, step = 'any' }: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; tour?: string; step?: string
}) {
  return (
    <input data-tour={tour} type="number" min={0} step={step} style={sheetInput} value={value ?? ''} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  )
}

export function ItemErpForm({ values, onChange, meta, itemType, uom, effective, partCode, onPartCode, partCodeTour }: {
  values: Partial<ItemErpValues>
  onChange: (patch: Partial<ItemErpValues>) => void
  /** The item's part code (the vendor / drawing part number) — shown under Purchasing. */
  partCode: string
  onPartCode: (v: string) => void
  partCodeTour?: string
  meta: StoreItemMeta | null
  itemType: string
  uom?: string | null
  /** Saved item's resolved ledgers, shown under the pickers on edit. */
  effective?: Pick<StoreItem, 'effective_purchase_gl' | 'effective_purchase_gl_source' | 'effective_sales_gl' | 'effective_sales_gl_source'>
}) {
  const isService = itemType === 'service'
  const unit = uom || 'unit'
  const idOptions = (opts: { value: number; label: string }[] | undefined, blank: string) =>
    [{ value: '', label: blank }, ...(opts || []).map((o) => ({ value: String(o.value), label: o.label }))]
  const toId = (v: string) => (v ? Number(v) : null)

  return (
    <>
      <SheetSection icon="cart" title="Purchasing">
        <SRow>
          <SField label="Preferred vendor">
            <div data-tour="item-preferred-vendor">
              <SearchableSelect value={values.preferred_vendor_id ? String(values.preferred_vendor_id) : ''}
                onChange={(v) => onChange({ preferred_vendor_id: toId(v) })}
                options={idOptions(meta?.vendors, '— No preferred vendor —')} placeholder="Pick from the vendor master" />
            </div>
            <span style={hint}>Suggested first on purchase requisitions and RFQs. Add new vendors in Procurement → Vendors.</span>
          </SField>
          <SField label={`Minimum order qty (${unit})`}>
            <NumberInput tour="item-moq" value={values.min_order_qty} onChange={(v) => onChange({ min_order_qty: v })} placeholder="e.g. 100" />
            <span style={hint}>Smallest quantity the vendor sells. Planning rounds orders up to it.</span>
          </SField>
        </SRow>
        <SRow>
          <SField label={<>Part Code <Optional /></>}>
            <input data-tour={partCodeTour} style={sheetInput} value={partCode} onChange={(e) => onPartCode(e.target.value)} placeholder="Part code" />
          </SField>
          {!isService && <>
            <SField label="Make / Brand">
              <input data-tour="item-make" style={sheetInput} value={values.make || ''} onChange={(e) => onChange({ make: e.target.value })} placeholder="e.g. SKF" />
            </SField>
            <SField label="Manufacturer">
              <input style={sheetInput} value={values.manufacturer || ''} onChange={(e) => onChange({ manufacturer: e.target.value })} />
            </SField>
          </>}
        </SRow>
      </SheetSection>

      <SheetSection icon="rupee" title="Tax & Accounts">
        <SRow>
          <SField label={isService ? 'SAC code' : 'HSN code'}>
            <input data-tour="item-hsn" style={sheetInput} value={values.hsn_sac_code || ''} maxLength={12}
              onChange={(e) => onChange({ hsn_sac_code: e.target.value })} placeholder={isService ? '6 digits, starts with 99' : '4, 6 or 8 digits'} />
            <span style={hint}>From the vendor&apos;s tax invoice. Required on GST invoices and e-invoices.</span>
          </SField>
          <SField label="GST rate">
            <Select data-tour="item-gst" style={sheetInput} value={values.gst_rate ?? ''}
              onChange={(e) => onChange({ gst_rate: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">— Not set —</option>
              {(meta?.gst_rates || []).map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
            <span style={hint}>Rates come from Finance&apos;s GST rate master.</span>
          </SField>
        </SRow>
        <SRow>
          <SField label="Purchase ledger">
            <div data-tour="item-purchase-gl">
              <SearchableSelect value={values.purchase_gl_account_id ? String(values.purchase_gl_account_id) : ''}
                onChange={(v) => onChange({ purchase_gl_account_id: toId(v) })}
                options={idOptions(meta?.purchase_ledgers, '— Use category / Finance default —')} placeholder="Use category / Finance default" />
            </div>
            <span style={hint}>
              {effective?.effective_purchase_gl_source && !values.purchase_gl_account_id
                ? `Now: ${effective.effective_purchase_gl || '—'} (${SOURCE_TEXT[effective.effective_purchase_gl_source]}).`
                : 'Leave blank to use the category ledger. Assets go to a fixed-asset ledger.'}
            </span>
          </SField>
          <SField label="Sales ledger">
            <SearchableSelect value={values.sales_gl_account_id ? String(values.sales_gl_account_id) : ''}
              onChange={(v) => onChange({ sales_gl_account_id: toId(v) })}
              options={idOptions(meta?.sales_ledgers, '— Use category / Finance default —')} placeholder="Use category / Finance default" />
            <span style={hint}>
              {effective?.effective_sales_gl_source && !values.sales_gl_account_id
                ? `Now: ${effective.effective_sales_gl || '—'} (${SOURCE_TEXT[effective.effective_sales_gl_source]}).`
                : 'Only for items we also sell (spares, finished goods).'}
            </span>
          </SField>
        </SRow>
      </SheetSection>

      {!isService && (
        <SheetSection icon="box" title="Stock Levels & Cost">
          <SRow>
            <SField label="Standard cost (₹ per unit)">
              <NumberInput tour="item-standard-cost" value={values.standard_cost} onChange={(v) => onChange({ standard_cost: v })} placeholder="Planned rate" />
              <span style={hint}>Planning rate for BOM estimates. Stock is valued at the system weighted average, not this.</span>
            </SField>
            <SField label={`Reorder level (${unit})`}>
              <NumberInput tour="item-reorder-level" value={values.reorder_level} onChange={(v) => onChange({ reorder_level: v })} />
              <span style={hint}>Raise a PR when free stock falls to this.</span>
            </SField>
            <SField label={`Reorder qty (${unit})`}>
              <NumberInput value={values.reorder_quantity} onChange={(v) => onChange({ reorder_quantity: v })} />
            </SField>
          </SRow>
          <SRow>
            <SField label={`Safety stock (${unit})`}>
              <NumberInput value={values.safety_stock} onChange={(v) => onChange({ safety_stock: v })} />
            </SField>
            <SField label={`Minimum stock (${unit})`}>
              <NumberInput value={values.minimum_stock} onChange={(v) => onChange({ minimum_stock: v })} />
            </SField>
            <SField label={`Maximum stock (${unit})`}>
              <NumberInput value={values.maximum_stock} onChange={(v) => onChange({ maximum_stock: v })} />
            </SField>
          </SRow>
        </SheetSection>
      )}

      {!isService && (
        <SheetSection icon="shield" title="Quality & Tracking">
          <label data-tour="item-inspection" style={checkRow}>
            <input type="checkbox" checked={!!values.inspection_on_receipt}
              onChange={(e) => onChange({ inspection_on_receipt: e.target.checked, ...(e.target.checked ? {} : { test_certificate_required: false }) })} />
            Inspection on receipt — receipts go to Quality stock with an inspection lot instead of straight to Free stock
          </label>
          <label data-tour="item-mtc" style={{ ...checkRow, opacity: values.inspection_on_receipt ? 1 : 0.5 }}>
            <input type="checkbox" disabled={!values.inspection_on_receipt} checked={!!values.test_certificate_required}
              onChange={(e) => onChange({ test_certificate_required: e.target.checked })} />
            Test certificate (MTC) required — an incoming lot can&apos;t be accepted until the certificate is marked received
          </label>
          <label style={checkRow}>
            <input type="checkbox" checked={!!values.batch_controlled} onChange={(e) => onChange({ batch_controlled: e.target.checked })} />
            Batch / heat number tracked
          </label>
          <label style={checkRow}>
            <input type="checkbox" checked={!!values.serial_controlled} onChange={(e) => onChange({ serial_controlled: e.target.checked })} />
            Serial number tracked (one serial per unit)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={checkRow}>
              <input type="checkbox" checked={!!values.expiry_controlled} onChange={(e) => onChange({ expiry_controlled: e.target.checked })} />
              Has expiry (paint, adhesives, chemicals)
            </label>
            {values.expiry_controlled && (
              <div style={{ flex: '0 1 180px', minWidth: 150 }}>
                <NumberInput step="1" value={values.shelf_life_days} onChange={(v) => onChange({ shelf_life_days: v })} placeholder="Shelf life (days)" />
              </div>
            )}
          </div>
        </SheetSection>
      )}
    </>
  )
}

const num = (v?: number | null, unit?: string | null) => (v == null ? '—' : `${v.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`)
const yesNo = (v?: boolean) => (v ? 'Yes' : 'No')

/** The item's purchasing / tax / stock / quality facts as DetailGroups — render
 * inside the item page's DetailCard (one label–value list, no separate cards). */
export function ItemErpInfo({ item }: { item: StoreItem }) {
  const isService = item.item_type === 'service'
  const ledger = (name?: string | null, source?: string | null) =>
    name ? `${name}${source && source !== 'item' ? ` (${SOURCE_TEXT[source]})` : ''}` : source === 'none' ? SOURCE_TEXT.none : null
  return (
    <>
      <div data-tour="item-detail-purchasing">
        <DetailGroup title="Purchasing">
          <DetailRow label="Preferred vendor">{item.preferred_vendor_name || (item.preferred_supplier ? `${item.preferred_supplier} (not linked to the vendor master — pick it again)` : null)}</DetailRow>
          <DetailRow label="Minimum order qty">{item.min_order_qty == null ? null : num(item.min_order_qty, item.uom)}</DetailRow>
          {!isService && <DetailRow label="Make / Manufacturer">{[item.make, item.manufacturer].filter(Boolean).join(' · ') || null}</DetailRow>}
        </DetailGroup>
      </div>
      <div data-tour="item-detail-accounts">
        <DetailGroup title="Tax & Accounts" last={isService}>
          <DetailRow label={isService ? 'SAC code' : 'HSN code'}>{item.hsn_sac_code || 'Not set — needed on GST invoices'}</DetailRow>
          <DetailRow label="GST rate">{item.gst_rate != null ? `${item.gst_rate}%` : 'Not set'}</DetailRow>
          <DetailRow label="Purchase ledger">{ledger(item.effective_purchase_gl, item.effective_purchase_gl_source)}</DetailRow>
          <DetailRow label="Sales ledger">{ledger(item.effective_sales_gl, item.effective_sales_gl_source)}</DetailRow>
        </DetailGroup>
      </div>
      {!isService && (
        <DetailGroup title="Stock Levels">
          <DetailRow label="Reorder level / qty">{`${num(item.reorder_level, item.uom)} / ${num(item.reorder_quantity, item.uom)}`}</DetailRow>
          <DetailRow label="Safety stock">{item.safety_stock == null ? null : num(item.safety_stock, item.uom)}</DetailRow>
          <DetailRow label="Min / Max stock">{`${num(item.minimum_stock, item.uom)} / ${num(item.maximum_stock, item.uom)}`}</DetailRow>
        </DetailGroup>
      )}
      {!isService && (
        <div data-tour="item-detail-quality">
          <DetailGroup title="Quality & Tracking" last>
            <DetailRow label="Inspection on receipt">{item.inspection_on_receipt ? 'Yes — GRN / production receipts go to Quality stock and get an inspection lot' : 'No — receipts go straight to Free stock'}</DetailRow>
            <DetailRow label="Test certificate required">{item.test_certificate_required ? "Yes — an incoming lot can't be accepted without the MTC / test certificate" : 'No'}</DetailRow>
            <DetailRow label="Batch / Serial tracked">{`${yesNo(item.batch_controlled)} / ${yesNo(item.serial_controlled)}`}</DetailRow>
            <DetailRow label="Expiry">{item.expiry_controlled ? (item.shelf_life_days != null ? `Yes — shelf life ${item.shelf_life_days.toLocaleString('en-IN')} day(s)` : 'Yes — shelf life not set') : 'No'}</DetailRow>
          </DetailGroup>
        </div>
      )}
    </>
  )
}

const rupees = (v?: number | null, unit?: string | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ` / ${unit}` : ''}`)

export function ItemVendorSuggestions({ itemId }: { itemId: number }) {
  const [rows, setRows] = useState<StoreItemVendorSuggestion[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    storeApi.getItemVendors(itemId)
      .then((r) => { setRows(r); setError('') })
      .catch((err) => { setRows([]); setError(extractErrorMessages(err, "Couldn't load vendor suggestions.").join(' ')) })
  }, [itemId])

  return (
    <Section title="Vendors for this item" style={{ marginBottom: 20 }}>
      <div data-tour="item-detail-vendors">
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <span style={hint}>Preferred vendor first, then vendors we bought it from (latest first), then vendors whose catalog lists it. Matched by item / part code, or the exact item name.</span>
        <TableScroll maxHeight={320} minWidth={680} style={{ marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Vendor <RowCount count={rows?.length ?? 0} /></th>
                <th style={numThStyle}>Last PO rate</th>
                <th style={thStyle}>Last PO</th>
                <th style={numThStyle}>POs / Qty bought</th>
                <th style={numThStyle}>Catalog price</th>
                <th style={numThStyle}>Catalog lead time</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={6} style={tdStyle}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...tdStyle, color: TEXT.muted }}>No vendor has supplied or listed this item yet. Pick a preferred vendor, or add it to a vendor&apos;s catalog in Procurement → Vendors.</td></tr>
              ) : rows.map((r) => (
                <tr key={`${r.vendor_id ?? ''}-${r.vendor_name}`}>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {r.vendor_name}
                      {r.preferred && <Pill label="Preferred" hex="#16a34a" />}
                    </span>
                  </td>
                  <td style={numTdStyle}>{rupees(r.last_po_rate, r.last_po_unit)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.last_po_number ? `${r.last_po_number} · ${formatDate(r.last_po_date)}` : '—'}</td>
                  <td style={numTdStyle}>{r.po_count ? `${r.po_count.toLocaleString('en-IN')} / ${r.total_qty.toLocaleString('en-IN')}` : '—'}</td>
                  <td style={numTdStyle}>{rupees(r.catalog_price, r.catalog_unit)}</td>
                  <td style={numTdStyle}>{r.catalog_lead_time_days != null ? `${r.catalog_lead_time_days} day(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </Section>
  )
}
