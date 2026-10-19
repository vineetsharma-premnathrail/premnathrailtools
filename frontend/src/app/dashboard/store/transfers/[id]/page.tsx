'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreStockTransfer } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { Row, InfoRow, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { FormSheet, SheetSection, SheetIcon, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import ManagedDocumentPanel, { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
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
  const [busy, setBusy] = useState<'' | 'dispatch' | 'receive' | 'cancel' | 'word' | 'pdf'>('')
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [docKey, setDocKey] = useState(0)
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

  const openWord = () => {
    if (!transfer) return
    setBusy('word')
    setActionError('')
    const tab = window.open('', '_blank')
    openRecordInWord('store_stock_transfer_note', transfer.id, tab)
      .then(() => setTimeout(() => setDocKey((k) => k + 1), 1500))
      .catch((err) => setActionError(`Could not open the Stock Transfer Note in Word: ${extractErrorMessages(err, 'unknown error').join(' ')}`))
      .finally(() => setBusy(''))
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{transfer.transfer_number}</h1>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, color: '#fff', background: TRANSFER_STATUS_HEX[status] || '#78716c' }}>{transfer.status_label || status}</span>
              </div>
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

          <div data-tour="transfer-detail-summary" style={card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row>
                <InfoRow label="From Store" value={transfer.from_location_name || '—'} />
                <InfoRow label="To Store" value={transfer.to_location_name || '—'} />
                <InfoRow label="Transfer Date" value={transfer.transfer_date} />
              </Row>
              <Row>
                <InfoRow label="Reason" value={transfer.reason || '—'} />
                <InfoRow label="Raised By" value={transfer.transferred_by_name || '—'} />
                <InfoRow label="Approved By" value={transfer.approved_by_name && status !== 'rejected' ? `${transfer.approved_by_name}, ${formatDateTime(transfer.decided_at)}` : '—'} />
              </Row>
              {(transfer.dispatched_at || status === 'in_transit' || status === 'received') && (
                <Row>
                  <InfoRow label="Dispatched" value={transfer.dispatched_at ? `${transfer.dispatched_by_name || '—'}, ${formatDateTime(transfer.dispatched_at)}` : '—'} />
                  <InfoRow label="Vehicle / Transporter" value={[transfer.vehicle_number, transfer.transporter_name].filter(Boolean).join(' · ') || '—'} />
                  <InfoRow label="Driver / E-way Bill" value={[transfer.driver_name, transfer.driver_phone, transfer.eway_bill_number && `EWB ${transfer.eway_bill_number}`].filter(Boolean).join(' · ') || '—'} />
                </Row>
              )}
              {(() => {
                // GST between plants (backend store/services/transfer_gst.py).
                const g = transfer as typeof transfer & { document_type?: string | null; inter_state?: boolean; tax_invoice_number?: string | null;
                  from_gstin?: string | null; to_gstin?: string | null; taxable_value?: number | null; cgst_amount?: number | null; sgst_amount?: number | null; igst_amount?: number | null }
                if (!g.document_type) return null
                const inr = (n?: number | null) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                return (
                  <Row>
                    <InfoRow label="GST document" value={g.document_type === 'tax_invoice' ? `Tax invoice ${g.tax_invoice_number || ''}${g.inter_state ? ' (inter-state)' : ''}` : 'Delivery challan (same GSTIN)'} />
                    <InfoRow label="GSTIN from → to" value={`${g.from_gstin || '—'} → ${g.to_gstin || '—'}`} />
                    {g.document_type === 'tax_invoice' && (
                      <InfoRow label="Taxable / GST" value={`${inr(g.taxable_value)} + ${g.inter_state ? `IGST ${inr(g.igst_amount)}` : `CGST ${inr(g.cgst_amount)} + SGST ${inr(g.sgst_amount)}`}`} />
                    )}
                  </Row>
                )
              })()}
              {transfer.received_at && (
                <Row>
                  <InfoRow label="Received" value={`${transfer.received_by_name || '—'}, ${formatDateTime(transfer.received_at)}`} />
                  <InfoRow label="Receipt Remarks" value={transfer.receipt_remarks || '—'} />
                </Row>
              )}
              <InfoRow label="Remarks" value={transfer.remarks || '—'} />
            </div>
          </div>

          {status === 'pending_approval' || (closed && status !== 'cancelled') ? (
            <div style={{ marginBottom: 20 }}>
              <ApprovalPanel entityType="stock_transfer" entityId={transfer.id} onChanged={load} />
            </div>
          ) : null}

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="transfer-detail-items" style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr>
                  {['Item', 'Quantity', 'Batch', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transfer.items.map((line) => (
                  <tr key={line.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{line.item_code} — {line.item_name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.quantity} {line.uom}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.batch_number || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {noteReady && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {canEditDoc && <button type="button" disabled={!!busy} onClick={openWord} style={primaryBtnStyle}>{busy === 'word' ? 'Opening…' : 'Save & Edit in Word'}</button>}
                  <button type="button" disabled={!!busy} onClick={openPdf} style={secondaryBtnStyle}>{busy === 'pdf' ? 'Building…' : 'Print / Download PDF'}</button>
                </div>
              )}
            </div>
            {noteReady && (
              <ManagedDocumentPanel key={docKey} entityType="store_stock_transfer_note" entityId={transfer.id} revision={NOTE_REVISION[status] || 0}
                canModify={canEditDoc} recordLabel="stock transfer note" downloadName={`Stock-Transfer-Note-${transfer.transfer_number}`} />
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
