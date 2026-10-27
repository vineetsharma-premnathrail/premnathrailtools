'use client'

// Detail popup of one Before PO receipt: lines, linked PR / PO, and Cancel
// (with a reason) while Procurement has not made the PO yet.

import { useState } from 'react'
import Link from 'next/link'
import { prePoStoreApi, PrePoReceipt, PRE_PO_STATUS_HEX, PRE_PO_STATUS_LABEL } from '@/lib/prePoApi'
import { recordPath } from '@/lib/recordRef'
import { formatDate } from '@/lib/format'
import { Pill, RowCount } from '@/components/shared/ui'
import PrePoAttachments from '@/components/store/PrePoAttachments'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { FormSheet, SheetSection, SHEET, sheetBtn, sheetLabel } from '@/components/shared/FormSheet'

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: SHEET.MUTED, background: SHEET.SOFT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: `1px solid ${SHEET.LINE}` }

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 170 }}>
      <span style={sheetLabel}>{label}</span>
      <div style={{ fontSize: 14, color: SHEET.INK, padding: '2px 0 6px' }}>{children || '—'}</div>
    </div>
  )
}

export default function BeforePOReceiptDetail({ receipt, canCancel, onClose, onChanged, onUpdated }: {
  receipt: PrePoReceipt; canCancel: boolean; onClose: () => void; onChanged: (r: PrePoReceipt) => void
  /** A file was attached or deleted: the receipt with its new file list. */
  onUpdated: (r: PrePoReceipt) => void
}) {
  const [cancelling, setCancelling] = useState(false)
  const pending = receipt.status === 'pending_po'
  const prLink = receipt.p2p_number && receipt.p2p_request_id_ref ? recordPath('/dashboard/p2p', receipt, 'p2p_request_id') : null

  return (
    <>
      <FormSheet icon="box" title={receipt.receipt_number} subtitle={`${receipt.vendor_name} · received ${formatDate(receipt.received_date)}`} onClose={onClose} busy={false} tour="store-bpo-detail"
        footer={<>
          {pending && canCancel && <button type="button" onClick={() => setCancelling(true)} data-tour="store-bpo-cancel-receipt-btn" style={sheetBtn('danger')}>Cancel receipt</button>}
          {pending && !canCancel && <span style={{ fontSize: 12, color: SHEET.MUTED, alignSelf: 'center' }}>Cancelling needs Create permission on GRN.</span>}
          <button type="button" onClick={onClose} style={sheetBtn('secondary', SHEET.INK)}>Close</button>
        </>}>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ marginBottom: 14 }}><Pill label={PRE_PO_STATUS_LABEL[receipt.status] || receipt.status} hex={PRE_PO_STATUS_HEX[receipt.status] || '#64748b'} /></div>
          {receipt.status === 'cancelled' && receipt.cancel_reason && (
            <p style={{ fontSize: 13, color: '#b91c1c', margin: '0 0 14px' }}>Cancelled — {receipt.cancel_reason}</p>
          )}
          <SheetSection icon="building" title="Receipt">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <Fact label="Vendor">{receipt.vendor_name}</Fact>
              <Fact label="Received on">{formatDate(receipt.received_date)}</Fact>
              <Fact label="Store location">{receipt.store_location_name}</Fact>
              <Fact label="Delivery challan no.">{receipt.delivery_challan_number}</Fact>
              <Fact label="Vendor invoice no.">{receipt.vendor_invoice_number}</Fact>
              <Fact label="Recorded by">{receipt.created_by_name}</Fact>
              <Fact label="Purchase request">{prLink ? <Link href={prLink} style={{ color: '#2563eb' }}>{receipt.p2p_number}</Link> : receipt.p2p_number}</Fact>
              <Fact label="Purchase order">{receipt.po_number ? `${receipt.po_number}${receipt.po_status ? ` · ${receipt.po_status.replace(/_/g, ' ')}` : ''}` : null}</Fact>
            </div>
            {receipt.remarks && <p style={{ fontSize: 13, color: SHEET.BODY, margin: '6px 0 0' }}>{receipt.remarks}</p>}
          </SheetSection>
          <SheetSection icon="list" title="Items received">
            <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                <thead><tr>{['Code', 'Item', 'Quantity', 'Remarks'].map((h, hi) => <th key={h} style={h === 'Quantity' ? { ...th, textAlign: 'right' } : th}>{h}{hi === 0 && <RowCount count={receipt.items.length} />}</th>)}</tr></thead>
                <tbody>
                  {receipt.items.map((i) => (
                    <tr key={i.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{i.item_code || '—'}</td>
                      <td style={td}>{i.item_name}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{i.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {i.unit || ''}</td>
                      <td style={td}>{i.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SheetSection>
          <SheetSection icon="clip" title="Invoice & challan files">
            <PrePoAttachments receipt={receipt} side="store" canUpload={canCancel} onChanged={onUpdated} />
          </SheetSection>
        </div>
      </FormSheet>
      <ReasonSheet open={cancelling} title={`Cancel ${receipt.receipt_number}?`} requireValue confirmLabel="Cancel receipt" cancelLabel="Keep it"
        message="The receipt leaves Procurement's Before PO list. Give the reason, e.g. goods returned to the vendor."
        placeholder="Why is this receipt being cancelled?"
        onCancel={() => setCancelling(false)}
        onConfirm={async (reason) => { const r = await prePoStoreApi.cancel(receipt.id, reason); setCancelling(false); onChanged(r) }} />
    </>
  )
}
