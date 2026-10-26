'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreStockTransfer } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { primaryBtnStyle, secondaryBtnStyle, RowCount, Pill, TableScroll, thStyle, tdStyle, numThStyle, numTdStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { FormSheet, SheetSection, SheetIcon, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

// Transfer order → approval → dispatch (stock leaves the sending store, in
// transit) → receipt at the receiving store. The Stock Transfer Note is a
// managed Word document from approval on (PDF secondary).
const TRANSFER_STATUS_HEX: Record<string, string> = {
  pending_approval: '#f59e0b', approved: '#2563EB', in_transit: '#7c3aed', received: '#16a34a', rejected: '#dc2626', cancelled: '#78716c',
}
const STEPS = [
  { key: 'pending_approval', label: 'Approval' },
  { key: 'approved', label: 'Dispatch' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'received', label: 'Received' },
]
const NOTE_REVISION: Record<string, number> = { in_transit: 1, received: 2 }

const card: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }

export default function StoreStockTransferDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedTransferId, error: linkError } = useRecordId(ref)
  const transferId = resolvedTransferId ?? 0

  const [transfer, setTransfer] = useState<StoreStockTransfer | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState<string | string[]>('')
  const [docKey, setDocKey] = useState(0)
  const [busy, setBusy] = useState<'' | 'dispatch' | 'receive' | 'cancel' | 'pdf'>('')
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [vehicle, setVehicle] = useState({ vehicle_number: '', transporter_name: '', driver_name: '', driver_phone: '', eway_bill_number: '' })
  const [receiptRemarks, setReceiptRemarks] = useState('')

  const load = useCallback(() => {
    storeApi.getStockTransfer(transferId).then(setTransfer)
      .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load this stock transfer — check your connection and reload; if it persists your account may lack access to this module.').join(' ')))
      .finally(() => setLoading(false))
  }, [transferId])

  useEffect(() => {
    if (!isAuthorized || !transferId) return
    load()
  }, [isAuthorized, transferId, load])

  const run = async (kind: 'dispatch' | 'receive' | 'cancel', fn: () => Promise<StoreStockTransfer>, after?: () => void) => {
    setBusy(kind)
    setActionError('')
    try {
      setTransfer(await fn())
      after?.()
    } catch (err) {
      setActionError(extractErrorMessages(err, `Could not ${kind} the transfer.`))
    } finally {
      setBusy('')
    }
  }

  const openPdf = async () => {
    if (!transfer) return
    setBusy('pdf')
    setActionError('')
    const tab = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await storeApi.stockTransferNotePdf(transfer.id))
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      tab?.close()
      setActionError(extractErrorMessages(err, 'Could not build the Stock Transfer Note PDF.'))
    } finally {
      setBusy('')
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/transfers" listLabel="Back to transfers" /></div>)
  if (!transferId) return <div><StoreNav /></div>

  const status = transfer?.status || ''
  const stepIndex = STEPS.findIndex((s) => s.key === status)
  const closed = status === 'rejected' || status === 'cancelled'
  const noteReady = ['approved', 'in_transit', 'received'].includes(status)
  const canEditDoc = can('store', 'transfers', 'edit')

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Transfer" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Transfers" onAction={() => router.push('/dashboard/store/transfers')} />
      <MessageDialog open={!dispatchOpen && !receiveOpen && !!actionError && (Array.isArray(actionError) ? actionError.length > 0 : true)} variant="error" title="Action Failed" message={actionError} onClose={() => setActionError('')} />
      <ConfirmDialog open={confirmCancel} title="Cancel this transfer?" danger confirmLabel="Cancel Transfer" cancelLabel="Keep"
        message={`${transfer?.transfer_number || 'The transfer'} will be closed without moving any stock. This can't be undone — raise a new transfer if it is needed later.`}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { setConfirmCancel(false); if (transfer) run('cancel', () => storeApi.cancelStockTransfer(transfer.id)) }} />

      {loading || !transfer ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Stock Transfer
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{transfer.transfer_number}</h1>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {transfer.can_dispatch && <button data-tour="transfer-dispatch-btn" onClick={() => { setActionError(''); setDispatchOpen(true) }} disabled={!!busy} style={primaryBtnStyle}>Dispatch</button>}
              {transfer.can_receive && <button data-tour="transfer-receive-btn" onClick={() => { setActionError(''); setReceiveOpen(true) }} disabled={!!busy} style={primaryBtnStyle}>Confirm Receipt</button>}
              {transfer.can_cancel && <button data-tour="transfer-cancel-btn" onClick={() => setConfirmCancel(true)} disabled={!!busy} style={secondaryBtnStyle}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel Transfer'}</button>}
              <button type="button" data-tour="transfer-detail-back-btn" onClick={() => router.push('/dashboard/store/transfers')} style={secondaryBtnStyle}>← Back</button>
            </div>
          </div>

          {/* Progress */}
          <div data-tour="transfer-progress" style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {STEPS.map((s, i) => {
              const done = !closed && (i < stepIndex || status === 'received')
              const current = !closed && i === stepIndex && status !== 'received'
              return (
                <div key={s.key} style={{ flex: '1 1 120px', padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                  background: done ? 'rgba(22,163,74,0.10)' : current ? 'rgba(255,122,69,0.12)' : 'rgba(0,0,0,0.03)',
                  color: done ? '#16a34a' : current ? '#E85A1F' : TEXT.muted }}>
                  {done ? '✓ ' : `${i + 1}. `}{s.label}
                </div>
              )
            })}
          </div>
          {closed && transfer.rejected_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              Rejected: {transfer.rejected_reason}
            </div>
          )}

          {/* One record view: what moves where, then every fact as label–value rows. */}
          <DetailCard tour="transfer-detail-summary">
            <DetailSummary
              title={transfer.transfer_number}
              text={`Moves ${transfer.items.length} item line${transfer.items.length === 1 ? '' : 's'} from ${transfer.from_location_name || '—'} to ${transfer.to_location_name || '—'}${transfer.reason ? ` — ${transfer.reason}` : ''}.`}
              meta={<>
                <Pill label={transfer.status_label || status} hex={TRANSFER_STATUS_HEX[status] || '#78716c'} />
                <span>· {formatDate(transfer.transfer_date)}</span>
                {transfer.transferred_by_name && <span>· Raised by <strong style={{ color: TEXT.heading }}>{transfer.transferred_by_name}</strong></span>}
              </>}
            />
            <DetailGroup title="Transfer">
              <DetailRow label="From Store">{transfer.from_location_name}</DetailRow>
              <DetailRow label="To Store">{transfer.to_location_name}</DetailRow>
              <DetailRow label="Reason">{transfer.reason}</DetailRow>
              <DetailRow label="Approved By">{transfer.approved_by_name && status !== 'rejected' ? `${transfer.approved_by_name}, ${formatDateTime(transfer.decided_at)}` : null}</DetailRow>
            </DetailGroup>
            {(transfer.dispatched_at || status === 'in_transit' || status === 'received') && (
              <DetailGroup title="Dispatch">
                <DetailRow label="Dispatched">{transfer.dispatched_at ? `${transfer.dispatched_by_name || '—'}, ${formatDateTime(transfer.dispatched_at)}` : null}</DetailRow>
                <DetailRow label="Vehicle / Transporter">{[transfer.vehicle_number, transfer.transporter_name].filter(Boolean).join(' · ') || null}</DetailRow>
                <DetailRow label="Driver / E-way Bill">{[transfer.driver_name, transfer.driver_phone, transfer.eway_bill_number && `EWB ${transfer.eway_bill_number}`].filter(Boolean).join(' · ') || null}</DetailRow>
              </DetailGroup>
            )}
            {(() => {
              // GST between plants (backend store/services/transfer_gst.py).
              const g = transfer as typeof transfer & { document_type?: string | null; inter_state?: boolean; tax_invoice_number?: string | null;
                from_gstin?: string | null; to_gstin?: string | null; taxable_value?: number | null; cgst_amount?: number | null; sgst_amount?: number | null; igst_amount?: number | null }
              if (!g.document_type) return null
              const inr = (n?: number | null) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              return (
                <DetailGroup title="GST">
                  <DetailRow label="GST document">{g.document_type === 'tax_invoice' ? `Tax invoice ${g.tax_invoice_number || ''}${g.inter_state ? ' (inter-state)' : ''}` : 'Delivery challan (same GSTIN)'}</DetailRow>
                  <DetailRow label="GSTIN from → to">{`${g.from_gstin || '—'} → ${g.to_gstin || '—'}`}</DetailRow>
                  {g.document_type === 'tax_invoice' && (
                    <DetailRow label="Taxable / GST">{`${inr(g.taxable_value)} + ${g.inter_state ? `IGST ${inr(g.igst_amount)}` : `CGST ${inr(g.cgst_amount)} + SGST ${inr(g.sgst_amount)}`}`}</DetailRow>
                  )}
                </DetailGroup>
              )
            })()}
            {transfer.received_at && (
              <DetailGroup title="Receipt">
                <DetailRow label="Received">{`${transfer.received_by_name || '—'}, ${formatDateTime(transfer.received_at)}`}</DetailRow>
                <DetailRow label="Receipt Remarks">{transfer.receipt_remarks}</DetailRow>
              </DetailGroup>
            )}
            <DetailGroup last>
              <DetailRow label="Remarks">{transfer.remarks}</DetailRow>
            </DetailGroup>
          </DetailCard>

          {status === 'pending_approval' || (closed && status !== 'cancelled') ? (
            <div style={{ marginBottom: 20 }}>
              <ApprovalPanel entityType="stock_transfer" entityId={transfer.id} onChanged={load} />
            </div>
          ) : null}

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="transfer-detail-items" style={{ marginBottom: 20 }}>
            <TableScroll maxHeight="none" minWidth={520}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Item <RowCount count={transfer.items.length} /></th>
                    <th style={numThStyle}>Quantity</th>
                    <th style={thStyle}>Batch</th>
                    <th style={thStyle}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {transfer.items.map((line) => (
                    <tr key={line.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{line.item_code} — {line.item_name}</td>
                      <td style={numTdStyle}>{line.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {line.uom}</td>
                      <td style={tdStyle}>{line.batch_number || '—'}</td>
                      <td style={tdStyle}>{line.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>

          {/* Stock Transfer Note — Word primary, PDF secondary */}
          <div data-tour="transfer-note" style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Stock Transfer Note</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>
                  {noteReady
                    ? 'Print it and send it with the material; the receiving store signs it on arrival. It refreshes after dispatch (vehicle details) and after receipt.'
                    : 'Available once the transfer is approved.'}
                </p>
              </div>
            </div>
            {noteReady && (
              <ManagedDocumentPanel key={docKey} entityType="store_stock_transfer_note" entityId={transfer.id} revision={NOTE_REVISION[status] || 0}
                canModify={canEditDoc} recordLabel="stock transfer note" downloadName={`Stock-Transfer-Note-${transfer.transfer_number}`}
                extraItems={[{ label: busy === 'pdf' ? 'Building PDF…' : 'Print / Download PDF', onClick: openPdf }]} />
            )}
          </div>
        </>
      )}

      {dispatchOpen && transfer && (
        <FormSheet width={580} icon="truck" title={`Dispatch ${transfer.transfer_number}`}
          subtitle={`${transfer.from_location_name} → ${transfer.to_location_name} · stock is in transit until the receiving store confirms.`}
          onClose={() => setDispatchOpen(false)} busy={!!busy}
          footer={<>
            <button type="button" onClick={() => setDispatchOpen(false)} disabled={!!busy} style={sheetBtn('secondary', SHEET.INK, !!busy)}>Cancel</button>
            <button type="button" onClick={() => run('dispatch', () => storeApi.dispatchStockTransfer(transfer.id, vehicle), () => { setDispatchOpen(false); setDocKey((k) => k + 1) })}
              disabled={!!busy} style={sheetBtn('primary', SHEET.BLUE, !!busy)}><SheetIcon name="truck" size={16} />{busy === 'dispatch' ? 'Dispatching…' : 'Dispatch'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <PopupError error={actionError} />
            <SheetSection icon="truck" title="Vehicle & E-way Bill">
              {([
                ['vehicle_number', 'Vehicle Number', 'e.g. HR55 AB 1234'],
                ['transporter_name', 'Transporter', 'Own vehicle / transporter name'],
                ['driver_name', 'Driver Name', ''],
                ['driver_phone', 'Driver Phone', ''],
                ['eway_bill_number', 'E-way Bill Number', '12 digits — required when the plants are in different states'],
              ] as const).map(([k, l, ph], i) => (
                <div key={k} style={{ marginTop: i === 0 ? 0 : 12 }}>
                  <label style={sheetLabel}>{l}</label>
                  <input style={sheetInput} value={vehicle[k]} placeholder={ph} autoFocus={i === 0} onChange={(e) => setVehicle((v) => ({ ...v, [k]: e.target.value }))} />
                </div>
              ))}
              <p style={sheetHint}>
                These details are printed on the Stock Transfer Note. Between plants with different GSTINs the note becomes a tax invoice at average cost (GST from the Item Master); within one GSTIN it is a delivery challan.
              </p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {receiveOpen && transfer && (
        <FormSheet width={580} icon="check" iconColor="#16a34a" title="Confirm Receipt"
          subtitle={`${transfer.transfer_number} · ${transfer.items.length} line(s) into ${transfer.to_location_name}`}
          onClose={() => setReceiveOpen(false)} busy={!!busy}
          footer={<>
            <button type="button" onClick={() => setReceiveOpen(false)} disabled={!!busy} style={sheetBtn('secondary', SHEET.INK, !!busy)}>Cancel</button>
            <button type="button" onClick={() => run('receive', () => storeApi.receiveStockTransfer(transfer.id, { remarks: receiptRemarks.trim() || undefined }), () => { setReceiveOpen(false); setDocKey((k) => k + 1) })}
              disabled={!!busy} style={sheetBtn('primary', '#16a34a', !!busy)}><SheetIcon name="check" size={16} />{busy === 'receive' ? 'Receiving…' : 'Confirm Receipt'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <PopupError error={actionError} />
            <SheetSection icon="box" title="Receipt">
              <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 14px', lineHeight: 1.55 }}>
                All {transfer.items.length} line(s) are added to {transfer.to_location_name}&apos;s stock at the quantities dispatched.
                If anything arrived short or damaged, receive it and then raise a Stock Adjustment at {transfer.to_location_name} for the difference.
              </p>
              <label style={sheetLabel}>Remarks <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={receiptRemarks} onChange={(e) => setReceiptRemarks(e.target.value)} placeholder="Condition on arrival, gate entry no. …" autoFocus />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}

function PopupError({ error }: { error: string | string[] }) {
  const list = Array.isArray(error) ? error : error ? [error] : []
  if (!list.length) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {list.map((e, i) => <div key={i}>{e}</div>)}
    </div>
  )
}
