'use client'

// Controlled editors for an order's lines, delivery schedule and billing plan.
// Used by the new-order form, the draft detail page and the amendment editor,
// so all three present the contract the same way.

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { SalesOrderLineInput, SalesOrderScheduleInput, SalesBillingLineInput } from '@/types'
import { pricingApi } from '@/lib/sdServiceApi'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { TEXT } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import { thStyle as salesTh, tdStyle } from '@/components/sales/SalesUi'
import { LINE_TYPE_LABELS, MILESTONE_LABELS, formatINR } from '@/components/sales/labels'
import { formatDate } from '@/lib/format'
import { SheetIcon, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'

// Grid rows in the FormSheet look (white inputs, slate header) — the same
// editors sit inside the new-order / draft / amendment FormPage blocks.
const cellInput: React.CSSProperties = { ...sheetInput, padding: '7px 9px', fontSize: 12.5 }
const thStyle: React.CSSProperties = { ...salesTh, background: SHEET.SOFT, color: SHEET.MUTED }
const smallBtn: React.CSSProperties = { ...sheetBtn('secondary'), padding: '6px 12px', fontSize: 12.5 }
const removeBtn: React.CSSProperties = { border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', padding: 2, display: 'inline-flex' }
const AddIcon = () => <SheetIcon name="plus" size={14} color={SHEET.BLUE} />
const RemoveIcon = () => <SheetIcon name="x" size={15} />

export function lineTotals(l: SalesOrderLineInput) {
  const gross = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
  const disc = gross * (Number(l.discount_percent) || 0) / 100
  const taxable = gross - disc
  const gst = taxable * (Number(l.gst_rate) || 0) / 100
  return { taxable, gst, total: taxable + gst }
}

export function emptyLine(n: number): SalesOrderLineInput {
  return { line_number: n, line_type: 'rrv', description: '', rrv_model: '', uom: 'NOS', quantity: 1, unit_price: 0, discount_percent: 0, gst_rate: 18 }
}

/** Keeps one schedule row per vehicle for every RRV line (adds / trims rows to match the quantity). */
export function syncVehicleRows(lines: SalesOrderLineInput[], rows: SalesOrderScheduleInput[], consignee: string): SalesOrderScheduleInput[] {
  let out = rows.filter((r) => lines.some((l) => l.line_number === r.line_number))
  for (const l of lines) {
    if (l.line_type !== 'rrv' || !l.line_number) continue
    const qty = Math.max(0, Math.floor(Number(l.quantity) || 0))
    const mine = out.filter((r) => r.line_number === l.line_number)
    if (mine.length < qty) {
      const last = mine[mine.length - 1]
      for (let i = mine.length; i < qty; i++) {
        out.push({ line_number: l.line_number, quantity: 1, consignee_name: last?.consignee_name || consignee, consignee_address: last?.consignee_address || '', contract_delivery_date: null })
      }
    } else if (mine.length > qty) {
      const drop = new Set(mine.slice(qty))
      out = out.filter((r) => !drop.has(r))
    }
  }
  return out
}

type FP = { id: number; code: string; name: string; model_number: string | null; hsn_code: string | null; uom: string }

/** The typed price differs from the price-list price — the reason box shows. */
function overridden(l: SalesOrderLineInput) {
  return l.list_price != null && Math.abs((Number(l.unit_price) || 0) - Number(l.list_price)) > 0.005
}

export function LinesEditor({ lines, onChange, readOnly, customerId, priceDate }: {
  lines: SalesOrderLineInput[]; onChange: (l: SalesOrderLineInput[]) => void; readOnly?: boolean
  // Pricing conditions (Sales › Pricing): picking a product defaults its price for this customer on this date.
  customerId?: number | null; priceDate?: string | null
}) {
  const set = (i: number, patch: Partial<SalesOrderLineInput>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const [products, setProducts] = useState<FP[]>([])
  useEffect(() => { pricingApi.finishedProducts().then(setProducts).catch(() => setProducts([])) }, [])
  const pickProduct = async (i: number, value: string) => {
    const p = products.find((x) => String(x.id) === value)
    if (!p) { set(i, { product_id: null, list_price: null }); return }
    const base: Partial<SalesOrderLineInput> = {
      product_id: p.id, description: lines[i].description || p.name, rrv_model: lines[i].rrv_model || p.model_number || '',
      hsn_sac_code: lines[i].hsn_sac_code || p.hsn_code || '', uom: lines[i].uom || p.uom,
    }
    try {
      const r = await pricingApi.resolve({ product_id: p.id, customer_id: customerId || undefined, on: priceDate || undefined })
      if (r.price != null) Object.assign(base, { unit_price: r.price, list_price: r.price, discount_percent: r.discount_percent || 0 })
      else base.list_price = null
    } catch { /* no price list for it — the price is typed */ }
    set(i, base)
  }
  const productOptions = products.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` }))
  const next = Math.max(0, ...lines.map((l) => l.line_number || 0)) + 1
  const total = lines.reduce((s, l) => s + lineTotals(l).total, 0)
  return (
    <div>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
          <thead><tr>{['#', 'Type', 'Product', 'Description (as on PO)', 'RRV model', 'Customer item ref.', 'HSN', 'Qty', 'Unit price ₹', 'Disc %', 'GST %', 'Total', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={lines.length} />}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, width: 36 }}>{l.line_number}</td>
                <td style={{ ...tdStyle, width: 120 }}>
                  <Select disabled={readOnly} style={cellInput} value={l.line_type} onChange={(e) => set(i, { line_type: e.target.value })}>
                    {Object.entries(LINE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </td>
                <td style={{ ...tdStyle, minWidth: 200 }}>
                  {readOnly ? (products.find((p) => p.id === l.product_id)?.code || '—')
                    : <SearchableSelect value={l.product_id ? String(l.product_id) : ''} onChange={(v) => pickProduct(i, v)} options={[{ value: '', label: '— none —' }, ...productOptions]} placeholder="Product master…" />}
                </td>
                <td style={{ ...tdStyle, minWidth: 220 }}><input disabled={readOnly} style={cellInput} value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td style={{ ...tdStyle, width: 120 }}><input disabled={readOnly} style={cellInput} value={l.rrv_model || ''} onChange={(e) => set(i, { rrv_model: e.target.value })} /></td>
                <td style={{ ...tdStyle, width: 130 }}><input disabled={readOnly} style={cellInput} value={l.customer_line_ref || ''} onChange={(e) => set(i, { customer_line_ref: e.target.value })} /></td>
                <td style={{ ...tdStyle, width: 90 }}><input disabled={readOnly} style={cellInput} value={l.hsn_sac_code || ''} onChange={(e) => set(i, { hsn_sac_code: e.target.value })} /></td>
                <td style={{ ...tdStyle, width: 70 }}><input disabled={readOnly} type="number" min={0} style={cellInput} value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} /></td>
                <td style={{ ...tdStyle, width: 150 }}>
                  <input disabled={readOnly} type="number" min={0} style={cellInput} value={l.unit_price} onChange={(e) => set(i, { unit_price: Number(e.target.value) })} />
                  {l.list_price != null && <div style={{ fontSize: 11, color: overridden(l) ? '#b45309' : TEXT.muted, marginTop: 3 }}>List {formatINR(l.list_price)}</div>}
                  {overridden(l) && !readOnly && (
                    <input style={{ ...cellInput, marginTop: 4, borderColor: l.price_override_reason ? undefined : '#f59e0b' }} placeholder="Reason for manual price"
                      value={l.price_override_reason || ''} onChange={(e) => set(i, { price_override_reason: e.target.value })} />
                  )}
                </td>
                <td style={{ ...tdStyle, width: 70 }}><input disabled={readOnly} type="number" min={0} max={100} style={cellInput} value={l.discount_percent} onChange={(e) => set(i, { discount_percent: Number(e.target.value) })} /></td>
                <td style={{ ...tdStyle, width: 70 }}><input disabled={readOnly} type="number" min={0} max={28} style={cellInput} value={l.gst_rate} onChange={(e) => set(i, { gst_rate: Number(e.target.value) })} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatINR(Math.round(lineTotals(l).total * 100) / 100)}</td>
                <td style={{ ...tdStyle, width: 30 }}>{!readOnly && !l.id && <button type="button" style={removeBtn} title="Remove line" aria-label="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}><RemoveIcon /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        {!readOnly ? <button type="button" data-tour="sales-lines-add" style={smallBtn} onClick={() => onChange([...lines, emptyLine(next)])}><AddIcon />Add line</button> : <span />}
        <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>Order value (incl. GST): {formatINR(Math.round(total * 100) / 100)}</span>
      </div>
    </div>
  )
}

export function ScheduleEditor({ lines, rows, onChange, readOnly }: {
  lines: SalesOrderLineInput[]; rows: SalesOrderScheduleInput[]; onChange: (r: SalesOrderScheduleInput[]) => void; readOnly?: boolean
}) {
  const set = (i: number, patch: Partial<SalesOrderScheduleInput>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const nonRrv = lines.filter((l) => l.line_type !== 'rrv' && l.line_number)
  return (
    <div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
        One row per vehicle for RRV lines — each vehicle gets its own contractual date, build, LD and warranty. Spares lines are scheduled in lots.
      </p>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead><tr>{['Line', 'Qty', 'Consignee', 'Consignee address', 'Consignee GSTIN', 'Contractual delivery date', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} style={{ ...tdStyle, color: TEXT.muted }}>No delivery rows yet — add an RRV line and its vehicles appear here.</td></tr>}
            {rows.map((r, i) => {
              const line = lines.find((l) => l.line_number === r.line_number)
              const vehicleNo = rows.slice(0, i + 1).filter((x) => x.line_number === r.line_number).length
              return (
                <tr key={i}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>L{r.line_number}{line?.line_type === 'rrv' ? ` · vehicle ${vehicleNo}` : ''}</td>
                  <td style={{ ...tdStyle, width: 70 }}>
                    {line?.line_type === 'rrv' ? '1' : <input disabled={readOnly} type="number" min={0} style={cellInput} value={r.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />}
                  </td>
                  <td style={{ ...tdStyle, minWidth: 180 }}>
                    <input disabled={readOnly} style={cellInput} value={r.consignee_name || ''} onChange={(e) => set(i, { consignee_name: e.target.value })} />
                  </td>
                  <td style={{ ...tdStyle, minWidth: 200 }}><input disabled={readOnly} style={cellInput} value={r.consignee_address || ''} onChange={(e) => set(i, { consignee_address: e.target.value })} /></td>
                  <td style={{ ...tdStyle, width: 150 }}><input disabled={readOnly} style={cellInput} value={r.consignee_gstin || ''} onChange={(e) => set(i, { consignee_gstin: e.target.value.toUpperCase() })} /></td>
                  <td style={{ ...tdStyle, width: 170 }}>
                    {readOnly ? (r.contract_delivery_date ? formatDate(r.contract_delivery_date) : '—') : <DateField value={r.contract_delivery_date || ''} onChange={(v) => set(i, { contract_delivery_date: v || null })} />}
                  </td>
                  <td style={{ ...tdStyle, width: 30 }}>{!readOnly && line?.line_type !== 'rrv' && <button type="button" style={removeBtn} title="Remove lot" aria-label="Remove lot" onClick={() => onChange(rows.filter((_, j) => j !== i))}><RemoveIcon /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && nonRrv.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {nonRrv.map((l) => (
            <button key={l.line_number} type="button" style={smallBtn} onClick={() => onChange([...rows, { line_number: l.line_number as number, quantity: 1, consignee_name: rows[0]?.consignee_name || '', contract_delivery_date: null }])}>
              <AddIcon />Lot for line {l.line_number}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function BillingPlanEditor({ rows, onChange, grandTotal, readOnly }: {
  // grandTotal null = hidden by the server (Sales › Sales Orders › Prices & margins).
  rows: SalesBillingLineInput[]; onChange: (r: SalesBillingLineInput[]) => void; grandTotal: number | null; readOnly?: boolean
}) {
  const set = (i: number, patch: Partial<SalesBillingLineInput>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.percent) || 0), 0) * 1000) / 1000
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['#', 'Milestone', 'Description', '%', 'Amount', 'Per vehicle', 'Credit days', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, width: 30 }}>{i + 1}</td>
                <td style={{ ...tdStyle, width: 190 }}>
                  <Select disabled={readOnly} style={cellInput} value={r.milestone_type} onChange={(e) => set(i, { milestone_type: e.target.value })}>
                    {Object.entries(MILESTONE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </td>
                <td style={tdStyle}><input disabled={readOnly} style={cellInput} value={r.description || ''} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td style={{ ...tdStyle, width: 80 }}><input disabled={readOnly} type="number" min={0} max={100} style={cellInput} value={r.percent} onChange={(e) => set(i, { percent: Number(e.target.value) })} /></td>
                <td style={{ ...tdStyle, width: 130, whiteSpace: 'nowrap' }}>{grandTotal == null ? '—' : formatINR(Math.round(grandTotal * (Number(r.percent) || 0)) / 100)}</td>
                <td style={{ ...tdStyle, width: 90 }}><input disabled={readOnly} type="checkbox" checked={!!r.per_unit} onChange={(e) => set(i, { per_unit: e.target.checked })} /></td>
                <td style={{ ...tdStyle, width: 90 }}><input disabled={readOnly} type="number" min={0} style={cellInput} value={r.due_days ?? ''} onChange={(e) => set(i, { due_days: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td style={{ ...tdStyle, width: 30 }}>{!readOnly && <button type="button" style={removeBtn} title="Remove milestone" aria-label="Remove milestone" onClick={() => onChange(rows.filter((_, j) => j !== i))}><RemoveIcon /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        {!readOnly ? <button type="button" data-tour="sales-billing-add" style={smallBtn} onClick={() => onChange([...rows, { milestone_type: 'delivery', percent: Math.max(0, 100 - sum), per_unit: false }])}><AddIcon />Add milestone</button> : <span />}
        <span style={{ fontSize: 13, fontWeight: 700, color: Math.abs(sum - 100) < 0.001 ? '#16A34A' : '#DC2626' }}>
          Total {sum}% {Math.abs(sum - 100) < 0.001 ? '✓' : `— must be 100% (${sum < 100 ? `${Math.round((100 - sum) * 1000) / 1000}% not scheduled` : `${Math.round((sum - 100) * 1000) / 1000}% too much`})`}
        </span>
      </div>
    </div>
  )
}
