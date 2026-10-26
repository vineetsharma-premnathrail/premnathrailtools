'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi, vendorReturnsApi } from '@/lib/api'
import { P2PGoodsReceipt, P2PVendorReturn } from '@/types'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import { TEXT, GLASS, SHADOWS, BORDER, SUCCESS, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, smallSecondaryBtnStyle, primaryBtnStyle, RowCount, Pill, pillStyle, TableScroll, thStyle, tdStyle, numThStyle, numTdStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'
import Select from '@/components/shared/Select'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const primaryBtn = primaryBtnStyle
const STATUS_LABELS: Record<string, string> = { draft: 'Pending Inspection', completed: 'Completed', reversed: 'Reversed' }
const STATUS_HEX: Record<string, string> = { draft: '#d97706', completed: '#16a34a', reversed: '#dc2626' }
const qty = (v?: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }))

const QUALITY_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'partial', label: 'Partially Accepted' },
]
// Lines for items flagged "inspection on receipt" are inspected by Quality
// (an inspection lot holds them in Quality stock); the lot's usage decision
// fills in their accepted / rejected split.
const QUALITY_LOT_LABEL = 'In Quality inspection'

// Why goods go back (backend P2P_RETURN_REASONS).
const RETURN_REASONS = [
  { value: 'quality_rejection', label: 'Rejected in inspection' },
  { value: 'damaged', label: 'Damaged in transit / on receipt' },
  { value: 'wrong_item', label: 'Wrong item supplied' },
  { value: 'excess', label: 'Excess quantity supplied' },
  { value: 'other', label: 'Other' },
]

interface InspectionRow {
  accepted_quantity: string
  rejected_quantity: string
  quality_status: string
  rejection_reason: string
  // Serialised line, partly rejected: which units failed.
  rejected_serials: string[]
}

export default function StoreGrnDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('store')
  // Inspection is a Purchase/QC step (backend: POST /inspect needs the Purchase
  // module); Store-only users record the GRN but don't inspect it.
  const { canFeature } = useCan()
  // Store › GRN & Inspection features (server-side too): Quality inspection
  // decision › Approve decides who inspects; Reverse a GRN › Approve;
  // Return to vendor › View / Create. RTV value = Items › Stock value & rates.
  const canInspect = !!user && canFeature('store', 'grn', 'inspection', 'approve')
  const canReverseGrn = canFeature('store', 'grn', 'reverse', 'approve')
  const seeReturns = canFeature('store', 'grn', 'return_to_vendor', 'view')
  const seeValues = canFeature('store', 'items', 'stock_values', 'view')
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedGrnId, error: linkError } = useRecordId(ref)
  const grnId = resolvedGrnId ?? 0

  const [grn, setGrn] = useState<P2PGoodsReceipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Record<number, InspectionRow>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [stockNotes, setStockNotes] = useState<string[]>([])
  // Return to Vendor (goods sent back) and GRN reversal (wrong entry undone).
  const canReturn = canFeature('store', 'grn', 'return_to_vendor', 'create')
  const [returns, setReturns] = useState<P2PVendorReturn[]>([])
  const [showReturn, setShowReturn] = useState(false)
  const [rtvQty, setRtvQty] = useState<Record<string, string>>({})
  const [rtvReason, setRtvReason] = useState('')
  const [rtvDate, setRtvDate] = useState('')
  const [rtvVehicle, setRtvVehicle] = useState('')
  const [rtvRemarks, setRtvRemarks] = useState('')
  const [reversing, setReversing] = useState(false)
  const [notice, setNotice] = useState('')

  const load = () => {
    goodsReceiptsApi.get(grnId).then((g: P2PGoodsReceipt) => {
      setGrn(g)
      const initial: Record<number, InspectionRow> = {}
      for (const it of g.items) {
        initial[it.id] = {
          accepted_quantity: it.accepted_quantity != null ? String(it.accepted_quantity) : String(it.received_quantity),
          rejected_quantity: it.rejected_quantity != null ? String(it.rejected_quantity) : '0',
          quality_status: it.quality_status !== 'pending' ? it.quality_status : 'passed',
          rejection_reason: it.rejection_reason || '',
          rejected_serials: [],
        }
      }
      setRows(initial)
    })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load this goods receipt.')))
      .finally(() => setLoading(false))
    // Without Return to vendor › View the list is skipped (Reverse stays blocked server-side if returns exist).
    if (seeReturns) vendorReturnsApi.list({ goods_receipt_id: grnId }).then(setReturns).catch(() => setReturns([]))
  }

  useEffect(() => {
    if (!isAuthorized || !grnId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, grnId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/grn" listLabel="Back to goods receipts" /></div>)
  if (!grnId) return <div><StoreNav /></div>
  if (loading) return null

  if (!grn) {
    return (
      <div>
        <StoreNav />
        <MessageDialog open={!!error} variant="error" title="Cannot Load Goods Receipt" message={error} onClose={() => setError('')} />
        <p style={{ fontSize: 13, color: TEXT.muted }}>{typeof error === 'string' ? error : 'Goods receipt not found.'}</p>
      </div>
    )
  }

  const setRow = (itemId: number, patch: Partial<InspectionRow>) => {
    setRows((r) => ({ ...r, [itemId]: { ...r[itemId], ...patch } }))
  }

  const complete = async () => {
    setError('')
    setBusy(true)
    try {
      const items = grn.items.filter((it) => it.quality_status === 'pending').map((it) => {
        const r = rows[it.id]
        return {
          item_id: it.id,
          accepted_quantity: Number(r.accepted_quantity || 0),
          rejected_quantity: Number(r.rejected_quantity || 0),
          quality_status: r.quality_status,
          rejection_reason: r.quality_status === 'passed' ? undefined : (r.rejection_reason.trim() || undefined),
          rejected_serials: r.quality_status === 'partial' ? r.rejected_serials : [],
        }
      })
      const updated = await goodsReceiptsApi.inspect(grn.id, { items })
      setStockNotes(updated.stock_sync_notes || [])
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to complete quality inspection.'))
    } finally {
      setBusy(false)
    }
  }

  const isDraft = grn.status === 'draft'
  const isReversed = grn.status === 'reversed'
  const decided = (q: string) => ['passed', 'failed', 'partial'].includes(q)
  const acceptedLeft = (it: P2PGoodsReceipt['items'][number]) => Math.max((it.accepted_quantity || 0) - (it.returned_quantity || 0), 0)
  const rejectedLeft = (it: P2PGoodsReceipt['items'][number]) => Math.max((it.rejected_quantity || 0) - (it.rejected_returned_quantity || 0), 0)
  const returnable = grn.items.filter((it) => decided(it.quality_status) && (acceptedLeft(it) > 0 || rejectedLeft(it) > 0))
  const canReverse = canReverseGrn && !isReversed && !returns.length

  const submitReturn = async () => {
    setError('')
    if (!rtvReason) { setError('Pick why the goods are going back.'); return }
    const items = Object.entries(rtvQty)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => { const [id, source] = k.split(':'); return { grn_item_id: Number(id), source, quantity: Number(v) } })
    if (!items.length) { setError('Enter the quantity to return on at least one line.'); return }
    setBusy(true)
    try {
      const rtv: P2PVendorReturn = await vendorReturnsApi.create({
        goods_receipt_id: grn.id, reason: rtvReason, return_date: rtvDate || undefined,
        vehicle_number: rtvVehicle.trim() || undefined, remarks: rtvRemarks.trim() || undefined, items,
      })
      setShowReturn(false); setRtvQty({}); setRtvReason(''); setRtvDate(''); setRtvVehicle(''); setRtvRemarks('')
      setNotice(`${rtv.rtv_number} saved — the goods are out of stock and the PO is open again for the replacement. ${rtv.debit_note_message || ''}`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the return to vendor.'))
    } finally {
      setBusy(false)
    }
  }

  const reverse = async (reason: string) => {
    setReversing(false)
    setError('')
    setBusy(true)
    try {
      await goodsReceiptsApi.reverse(grn.id, reason)
      setNotice(`${grn.grn_number} reversed — its stock was taken back out and the PO is open again.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not reverse this GRN.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store & Inventory · Goods Receipt
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{grn.grn_number}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isReversed && canReturn && returnable.length > 0 && (
            <button data-tour="store-grn-detail-return-btn" type="button" onClick={() => { setError(''); setShowReturn(true) }} style={secondaryBtnStyle}>↩ Return to Vendor</button>
          )}
          {canReverse && (
            <button data-tour="store-grn-detail-reverse-btn" type="button" onClick={() => setReversing(true)} disabled={busy}
              style={{ ...secondaryBtnStyle, color: DANGER.text, borderColor: 'rgba(220,38,38,0.35)' }}>Reverse GRN</button>
          )}
          <button data-tour="store-grn-detail-back-btn" onClick={() => router.push('/dashboard/store/grn')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>
      <PromptDialog
        open={reversing}
        title={`Reverse ${grn.grn_number}?`}
        message="Use this only when the GRN was entered by mistake (wrong PO, wrong quantity, wrong store). The accepted stock is taken back out at the PO rate and the PO is open again. Goods that really came and must go back use Return to Vendor instead."
        placeholder="Why is it being reversed? (e.g. entered against the wrong PO)"
        confirmLabel="Reverse GRN"
        danger
        requireValue
        onConfirm={reverse}
        onCancel={() => setReversing(false)}
      />
      <MessageDialog open={!!notice} variant="success" title="Done" message={notice} onClose={() => setNotice('')} />

      <MessageDialog open={!!error && !showReturn} variant="error" title="Cannot Complete" message={error} onClose={() => setError('')} />

      {isReversed && (
        <div style={{ ...sectionStyle, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)' }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: DANGER.text, margin: '0 0 4px' }}>This GRN was reversed</p>
          <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
            {grn.reversal_reason}{grn.reversed_by_name ? ` — by ${grn.reversed_by_name}` : ''}{grn.reversed_at ? ` on ${formatDate(grn.reversed_at)}` : ''}. Its stock was taken back out; it no longer counts as received.
          </p>
        </div>
      )}

      {stockNotes.length > 0 && (
        <div style={{ ...sectionStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)' }}>
          <h2 style={{ fontSize: 13.5, fontWeight: 700, color: '#b45309', margin: '0 0 8px' }}>Stock was not fully updated</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#92400e' }}>
            {stockNotes.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}
          </ul>
          <button
            type="button"
            onClick={() => router.push('/dashboard/store/new')}
            style={{ ...smallSecondaryBtnStyle, marginTop: 10 }}
          >
            + Add Item to Item Master
          </button>
        </div>
      )}

      <DetailCard tour="store-grn-detail-header">
        <DetailSummary
          title={grn.grn_number}
          text={`Goods received${grn.vendor_name ? ` from ${grn.vendor_name}` : ''} against ${grn.po_number || 'the purchase order'}${grn.store_location_name ? ` into ${grn.store_location_name}` : ''}.`}
          meta={<>
            <Pill label={STATUS_LABELS[grn.status] || grn.status} hex={STATUS_HEX[grn.status] || '#64748b'} />
            <span>· Received {formatDate(grn.received_date)}</span>
            {grn.received_by_name && <span>· by <strong style={{ color: TEXT.heading }}>{grn.received_by_name}</strong></span>}
            {grn.status === 'completed' && grn.inspected_by_name && <span>· Inspected by <strong style={{ color: TEXT.heading }}>{grn.inspected_by_name}</strong></span>}
          </>}
        />
        <DetailGroup title="Order">
          <DetailRow label="PO Number">{grn.po_number}</DetailRow>
          <DetailRow label="PR Number">{grn.p2p_number}</DetailRow>
          <DetailRow label="Vendor">{grn.vendor_name}</DetailRow>
          <DetailRow label="Store Location">{grn.store_location_name}</DetailRow>
        </DetailGroup>
        <div data-tour="store-grn-detail-docs">
          <DetailGroup title="Delivery Documents" last={!grn.remarks}>
            <DetailRow label="Gate Entry">{[grn.gate_entry_number, grn.gate_entry_at ? formatDateTime(grn.gate_entry_at) : null].filter(Boolean).join(' · ') || null}</DetailRow>
            <DetailRow label="Vendor Invoice">{grn.vendor_invoice_number ? `${grn.vendor_invoice_number}${grn.vendor_invoice_date ? ` dt. ${formatDate(grn.vendor_invoice_date)}` : ''}` : null}</DetailRow>
            <DetailRow label="Delivery Challan">{grn.delivery_challan_number ? `${grn.delivery_challan_number}${grn.delivery_challan_date ? ` dt. ${formatDate(grn.delivery_challan_date)}` : ''}` : null}</DetailRow>
            <DetailRow label="E-way Bill">{grn.eway_bill_number}</DetailRow>
            <DetailRow label="Vehicle / Transporter">{[grn.vehicle_number, grn.transporter_name].filter(Boolean).join(' · ') || null}</DetailRow>
            <DetailRow label="LR No.">{grn.lr_number}</DetailRow>
          </DetailGroup>
        </div>
        {grn.remarks && (
          <DetailGroup last>
            <DetailRow label="Remarks">{grn.remarks}</DetailRow>
          </DetailGroup>
        )}
      </DetailCard>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>
          {isDraft ? 'Quality Inspection' : 'Inspection Result'}
        </h2>
        <div data-tour="store-grn-detail-lines">
          <TableScroll maxHeight="none" minWidth={900}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Item <RowCount count={grn.items.length} /></th>
                {['Ordered', 'Invoice Qty', 'Received', 'Accepted', 'Rejected'].map((h) => <th key={h} style={numThStyle}>{h}</th>)}
                {['Returned', 'Quality Status', 'Rejection Reason'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {grn.items.map((it) => {
                const r = rows[it.id]
                const editable = canInspect && isDraft && it.quality_status === 'pending'
                return (
                  <tr key={it.id}>
                    <td style={tdStyle}>
                      {it.item_code && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{it.item_code}</div>}
                      {it.item_name}{it.unit ? ` (${it.unit})` : ''}
                      {it.bin_code && <div style={{ fontSize: 11.5, color: TEXT.muted }}>Bin {it.bin_code}</div>}
                      {!!it.serial_numbers?.length && <div style={{ fontSize: 11.5, color: TEXT.muted }}>S/N {it.serial_numbers.join(', ')}</div>}
                      {it.order_project_number && (
                        <div style={{ marginTop: 4 }}><OrderProjectChip opNumber={it.order_project_number} elementNo={it.order_project_element_no} label={it.order_project_element_label} /></div>
                      )}
                    </td>
                    <td style={numTdStyle}>{qty(it.ordered_quantity)}</td>
                    <td style={numTdStyle}>{qty(it.invoice_quantity)}</td>
                    <td style={numTdStyle}>
                      {qty(it.received_quantity)}
                      {it.receipt_variance != null && it.receipt_variance !== 0 && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: it.receipt_variance < 0 ? DANGER.text : '#d97706' }}>
                          {it.receipt_variance < 0 ? `Short ${qty(-it.receipt_variance)} vs bill` : `Excess ${qty(it.receipt_variance)} vs bill`}
                        </div>
                      )}
                    </td>
                    <td style={numTdStyle}>
                      {editable ? (
                        <input type="number" min={0} max={it.received_quantity} step="any" value={r.accepted_quantity}
                          onChange={(e) => setRow(it.id, { accepted_quantity: e.target.value })} style={{ ...inputStyle, width: 80 }} />
                      ) : (
                        <span style={{ fontWeight: 600, color: SUCCESS.text }}>{qty(it.accepted_quantity)}</span>
                      )}
                    </td>
                    <td style={numTdStyle}>
                      {editable ? (
                        <>
                        <input type="number" min={0} max={it.received_quantity} step="any" value={r.rejected_quantity}
                          onChange={(e) => setRow(it.id, { rejected_quantity: e.target.value })} style={{ ...inputStyle, width: 80 }} />
                        {!!it.serial_numbers?.length && r.quality_status === 'partial' && (
                          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 220, marginLeft: 'auto', whiteSpace: 'normal', textAlign: 'left' }}>
                            <span style={{ fontSize: 11, color: TEXT.muted, width: '100%' }}>Tap the rejected serial(s):</span>
                            {it.serial_numbers.map((s) => {
                              const on = r.rejected_serials.includes(s)
                              return (
                                <button type="button" key={s} aria-pressed={on} onClick={() => setRow(it.id, { rejected_serials: on ? r.rejected_serials.filter((x) => x !== s) : [...r.rejected_serials, s] })}
                                  style={{ ...pillStyle(on ? '#dc2626' : '#57534e'), border: 'none', cursor: 'pointer' }}>{s}</button>
                              )
                            })}
                          </div>
                        )}
                        </>
                      ) : (
                        <span style={{ fontWeight: 600, color: it.rejected_quantity ? DANGER.text : TEXT.muted }}>{qty(it.rejected_quantity)}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                      {(it.returned_quantity || 0) + (it.rejected_returned_quantity || 0) > 0
                        ? [it.returned_quantity ? `${qty(it.returned_quantity)} accepted` : '', it.rejected_returned_quantity ? `${qty(it.rejected_returned_quantity)} rejected` : ''].filter(Boolean).join(' · ')
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      {editable ? (
                        <Select value={r.quality_status} onChange={(e) => setRow(it.id, { quality_status: e.target.value })} style={{ ...inputStyle, width: 150 }}>
                          {QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      ) : (
                        <Pill
                          label={it.quality_status === 'in_quality' ? QUALITY_LOT_LABEL : QUALITY_OPTIONS.find((o) => o.value === it.quality_status)?.label || (it.quality_status === 'pending' ? 'Pending' : it.quality_status)}
                          hex={it.quality_status === 'passed' ? '#16a34a' : it.quality_status === 'failed' ? '#dc2626' : it.quality_status === 'partial' ? '#d97706' : '#64748b'} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      {editable && r.quality_status !== 'passed' ? (
                        <input value={r.rejection_reason} onChange={(e) => setRow(it.id, { rejection_reason: e.target.value })} style={{ ...inputStyle, width: 180 }} placeholder="Reason" />
                      ) : (
                        <span style={{ fontSize: 12.5, color: TEXT.muted }}>{it.rejection_reason || (it.quality_status === 'in_quality' ? it.remarks : null) || '—'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </TableScroll>
        </div>

        {isDraft && grn.items.some((it) => it.quality_status === 'in_quality') && (
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '12px 0 0' }}>
            Lines marked &ldquo;{QUALITY_LOT_LABEL}&rdquo; are held in Quality stock; the GRN completes once Quality makes the usage decision on their inspection lots.
          </p>
        )}
        {isDraft && !canInspect && grn.items.some((it) => it.quality_status === 'pending') && (
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '12px 0 0' }}>
            The goods are already in this store&apos;s Quality stock (not issuable). Someone with &lsquo;Approve&rsquo; on Store › GRN &amp; Inspection
            completes the inspection — accepted quantity then moves to Free stock, rejected to Blocked stock until it goes back to the vendor.
          </p>
        )}
        {isDraft && canInspect && grn.items.some((it) => it.quality_status === 'pending') && (
          <div style={{ marginTop: 16 }}>
            <button data-tour="store-grn-detail-complete-btn" disabled={busy} onClick={complete} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>{busy ? 'Completing…' : 'Complete Inspection'}</button>
          </div>
        )}
      </div>

      {showReturn && (
        <FormSheet tour="store-grn-detail-return-form" width={860} icon="undo" title="Return to Vendor"
          subtitle={`${grn.grn_number}${grn.vendor_name ? ` · ${grn.vendor_name}` : ''} — goods going back to the vendor.`}
          onClose={() => setShowReturn(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setShowReturn(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" disabled={busy} onClick={submitReturn} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="undo" size={16} />{busy ? 'Saving…' : 'Save Return'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {(Array.isArray(error) ? error.length > 0 : !!error) && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {(Array.isArray(error) ? error : [error]).map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '0 0 16px', lineHeight: 1.55 }}>
              Accepted goods leave stock at the PO rate and the PO opens again for the replacement; if the vendor&apos;s invoice is already booked, a debit note is raised for Finance.
              Rejected goods were never taken into stock — this records that they went back. Material rejected by a Quality lot goes back through its NCR.
            </p>
            <SheetSection icon="box" title="Quantities Going Back">
              <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead><tr style={{ background: SHEET.SOFT }}>
                    {['Item', 'Accepted left', 'Return accepted', 'Rejected left', 'Return rejected'].map((h, hi) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: SHEET.MUTED }}>{h}{hi === 0 && <RowCount count={returnable.length} />}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {returnable.map((it) => (
                      <tr key={it.id} style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.item_code ? `${it.item_code} — ` : ''}{it.item_name}{it.unit ? ` (${it.unit})` : ''}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{acceptedLeft(it)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          {acceptedLeft(it) > 0 ? <input type="number" min={0} max={acceptedLeft(it)} step="any" value={rtvQty[`${it.id}:accepted`] || ''}
                            onChange={(e) => setRtvQty((q) => ({ ...q, [`${it.id}:accepted`]: e.target.value }))} style={{ ...sheetInput, width: 100, padding: '7px 10px' }} /> : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{rejectedLeft(it)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          {rejectedLeft(it) > 0 ? <input type="number" min={0} max={rejectedLeft(it)} step="any" value={rtvQty[`${it.id}:rejected`] || ''}
                            onChange={(e) => setRtvQty((q) => ({ ...q, [`${it.id}:rejected`]: e.target.value }))} style={{ ...sheetInput, width: 100, padding: '7px 10px' }} /> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SheetSection>
            <SheetSection icon="truck" title="Return Details">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
                  <label style={sheetLabel}>Reason <Req /></label>
                  <Select value={rtvReason} onChange={(e) => setRtvReason(e.target.value)} style={sheetInput}>
                    <option value="">Select…</option>
                    {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Return Date</label>
                  <DateField value={rtvDate} onChange={setRtvDate} />
                </div>
                <div style={{ flex: '0 1 180px', minWidth: 150 }}>
                  <label style={sheetLabel}>Vehicle No.</label>
                  <input value={rtvVehicle} onChange={(e) => setRtvVehicle(e.target.value)} style={sheetInput} placeholder="e.g. HR55 AB 1234" />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks {rtvReason === 'other' ? <Req /> : <Optional />}</label>
              <input value={rtvRemarks} onChange={(e) => setRtvRemarks(e.target.value)} style={sheetInput} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {seeReturns && returns.length > 0 && (
        <div data-tour="store-grn-detail-returns" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Returns to Vendor</h2>
          <TableScroll maxHeight="none" minWidth={760}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Return No. <RowCount count={returns.length} /></th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Goods sent back</th>
                  {seeValues && <th style={numThStyle}>Value</th>}
                  <th style={thStyle}>Vehicle</th>
                  <th style={thStyle}>By</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.rtv_number}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(r.return_date)}</td>
                    <td style={tdStyle}>{r.reason_label || RETURN_REASONS.find((x) => x.value === r.reason)?.label || r.reason}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>
                      {r.items.map((i, k) => <div key={k}>{i.item_name}: {qty(i.quantity)} {i.unit || ''} ({i.source})</div>)}
                      {r.debit_note_message && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 4 }}>{r.debit_note_message}</div>}
                      {r.remarks && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>Remarks: {r.remarks}</div>}
                    </td>
                    {seeValues && <td style={numTdStyle}>{r.total_value != null ? `₹${r.total_value.toLocaleString('en-IN')}` : '—'}</td>}
                    <td style={tdStyle}>{r.vehicle_number || '—'}</td>
                    <td style={tdStyle}>{r.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </div>
  )
}
