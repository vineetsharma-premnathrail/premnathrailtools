'use client'

// Delivery costs / landed cost on a PO (SAP ME21N delivery-cost conditions,
// MIRO unplanned delivery costs). Freight, packing, insurance, clearing and
// customs duty (BCD + SWS) are part of the material's cost and go into stock
// value; GST on them is input credit and is never loaded.
import { useCallback, useEffect, useState } from 'react'
import { landedCostApi, PoChargesView } from '@/lib/mmLogisticsApi'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const cell: React.CSSProperties = { padding: '7px 10px', fontSize: 13, color: TEXT.body }
const head: React.CSSProperties = { ...cell, fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, textAlign: 'left' }
const money = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

const EMPTY = { charge_type: 'freight', basis: 'value', amount: '', gst_rate: '', description: '', bill_reference: '', voucher_date: '' }

export default function PoDeliveryCostsPanel({ poId, onChanged }: { poId: number; onChanged?: () => void }) {
  const { can, canFeature } = useCan()
  // Purchase Orders › Delivery costs: adding / posting needs its 'create', removing its 'delete'.
  const canEdit = can('p2p', 'purchase_orders', 'edit') && canFeature('p2p', 'purchase_orders', 'delivery_costs', 'create')
  const canRemove = can('p2p', 'purchase_orders', 'edit') && canFeature('p2p', 'purchase_orders', 'delivery_costs', 'delete')
  const [view, setView] = useState<PoChargesView | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [removeId, setRemoveId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(() => {
    landedCostApi.get(poId).then(setView).catch((e) => setError(extractErrorMessages(e, 'Delivery costs could not be loaded.').join(' ')))
  }, [poId])
  useEffect(() => { load() }, [load])

  if (!view) return error ? <div style={sectionStyle}><p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p></div> : null
  const voucherMode = !view.editable

  const submit = async () => {
    setBusy(true); setFormError('')
    const payload: Record<string, unknown> = {
      charge_type: form.charge_type, basis: form.basis, amount: Number(form.amount) || 0,
      gst_rate: form.gst_rate === '' ? null : Number(form.gst_rate), description: form.description || null,
    }
    try {
      if (voucherMode) {
        await landedCostApi.postVoucher(poId, { ...payload, bill_reference: form.bill_reference || null, voucher_date: form.voucher_date || null })
        load()
      } else {
        setView(await landedCostApi.addCharge(poId, payload))
      }
      setForm({ ...EMPTY })
      setAdding(false)
      onChanged?.()
    } catch (e) {
      setFormError(extractErrorMessages(e, 'The delivery cost could not be saved.').join(' '))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (removeId == null) return
    try { setView(await landedCostApi.deleteCharge(poId, removeId)) } catch (e) {
      setError(extractErrorMessages(e, 'The delivery cost could not be removed.').join(' '))
    } finally { setRemoveId(null) }
  }

  return (
    <div style={sectionStyle}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, color: TEXT.heading }}>Delivery costs &amp; landed cost</h3>
      <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 12px' }}>
        Amounts before GST. Planned costs are spread over the stock lines and every GRN is valued at the landed rate;
        a cost billed after receipt is posted as a landed-cost voucher into the stock still on hand. GST is input credit and is never loaded.
      </p>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {view.charges.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr>{['Planned cost', 'Basis', 'Amount', 'GST (credit)', ''].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
          <tbody>
            {view.charges.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <td style={cell}>{c.charge_label}{c.description ? ` — ${c.description}` : ''}</td>
                <td style={cell}>{c.basis === 'quantity' ? 'By quantity' : 'By value'}</td>
                <td style={cell}>{money(c.amount)}</td>
                <td style={cell}>{c.gst_rate != null ? `${c.gst_rate}%` : '—'}</td>
                <td style={cell}>{view.editable && canRemove && <button type="button" onClick={() => setRemoveId(c.id)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr>{['Line', 'Qty', 'PO rate', 'Delivery cost', 'Landed rate'].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.po_item_id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={cell}>{l.item_code ? `${l.item_code} · ` : ''}{l.item_name}{l.category !== 'stock' ? ` (${l.category} — not loaded)` : ''}</td>
              <td style={cell}>{l.quantity} {l.unit || ''}</td>
              <td style={cell}>{money(l.po_rate)}</td>
              <td style={cell}>{money(l.allocated)}</td>
              <td style={{ ...cell, fontWeight: 700 }}>{money(l.landed_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {view.vouchers.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr>{['Voucher', 'Date', 'Cost', 'Amount', 'Into stock', 'Consumed share'].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
          <tbody>
            {view.vouchers.map((v) => (
              <tr key={v.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <td style={cell}>{v.voucher_number}{v.bill_reference ? ` · ${v.bill_reference}` : ''}</td>
                <td style={cell}>{formatDate(v.voucher_date)}</td>
                <td style={cell}>{v.charge_label}</td>
                <td style={cell}>{money(v.amount)}</td>
                <td style={cell}>{money(v.value_to_stock)}</td>
                <td style={cell}>{money(v.value_to_consumption)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <button type="button" onClick={() => { setForm({ ...EMPTY }); setFormError(''); setAdding(true) }} style={primaryBtnStyle}>
          {voucherMode ? '+ Post landed-cost voucher' : '+ Add delivery cost'}
        </button>
      )}
      {adding && canEdit && (
        <FormSheet width={580} icon={voucherMode ? 'doc' : 'truck'} title={voucherMode ? 'Post landed-cost voucher' : 'Add delivery cost'}
          subtitle={voucherMode ? 'A cost billed after receipt — posted into the stock still on hand.' : 'A planned cost — spread over the stock lines; every GRN is valued at the landed rate.'}
          onClose={() => { if (!busy) setAdding(false) }} busy={busy}
          footer={<>
            <button type="button" onClick={() => setAdding(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name={voucherMode ? 'check' : 'plus'} size={16} />{busy ? 'Saving…' : voucherMode ? 'Post landed-cost voucher' : 'Add delivery cost'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formError && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{formError}</div>}
            <SheetSection icon="truck" title="Cost">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>{voucherMode ? 'Cost billed after receipt' : 'Planned cost'} <Req /></label>
                  <select style={sheetInput} value={form.charge_type} onChange={(e) => setForm({ ...form, charge_type: e.target.value })}>
                    {view.meta.charge_types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 1 160px' }}>
                  <label style={sheetLabel}>Apportion</label>
                  <select style={sheetInput} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
                    {view.meta.bases.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Description</label>
              <input style={sheetInput} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </SheetSection>
            <SheetSection icon="rupee" title="Amount">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 170px' }}>
                  <label style={sheetLabel}>Amount (₹, excl. GST) <Req /></label>
                  <input type="number" min={0} step="any" style={sheetInput} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
                </div>
                <div style={{ flex: '0 1 100px' }}>
                  <label style={sheetLabel}>GST %</label>
                  <input type="number" min={0} max={28} step="any" style={sheetInput} value={form.gst_rate} onChange={(e) => setForm({ ...form, gst_rate: e.target.value })} />
                </div>
              </div>
              <p style={sheetHint}>GST is input credit and is never loaded into the stock value.</p>
            </SheetSection>
            {voucherMode && (
              <SheetSection icon="doc" title="Voucher">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label style={sheetLabel}>Bill / BOE ref.</label>
                    <input style={sheetInput} value={form.bill_reference} onChange={(e) => setForm({ ...form, bill_reference: e.target.value })} />
                  </div>
                  <div style={{ flex: '0 1 170px' }}>
                    <label style={sheetLabel}>Voucher date</label>
                    <DateField value={form.voucher_date} onChange={(v) => setForm({ ...form, voucher_date: v })} />
                  </div>
                </div>
              </SheetSection>
            )}
          </div>
        </FormSheet>
      )}
      <ConfirmDialog open={removeId != null} title="Remove delivery cost" message="Remove this planned delivery cost from the PO? The landed rate of its lines is recalculated."
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoveId(null)} />
    </div>
  )
}
