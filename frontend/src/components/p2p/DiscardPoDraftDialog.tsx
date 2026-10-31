'use client'

// Discard a DRAFT PO (one returned for changes, or withdrawn from approval, that the buyer no longer wants).
// The PO is cancelled, the quantity on it is open to order again, and its Tally number can be used again.
// Only the RFQ's own buyer or the Purchase head may do it; the server decides and its message is shown here.
import { useState } from 'react'
import { rfqApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SheetSection, SheetError, SheetField, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'

/** The draft PO this dialog works on. */
export interface DiscardPoDraftTarget {
  rfqId: number
  poId: number
  poNumber: string
  vendorName?: string | null
}

export default function DiscardPoDraftDialog({ target, onClose, onDone }: {
  target: DiscardPoDraftTarget | null
  onClose: () => void
  onDone: (poNumber: string) => void
}) {
  if (!target) return null
  return <Body target={target} onClose={onClose} onDone={onDone} />
}

function Body({ target, onClose, onDone }: { target: DiscardPoDraftTarget; onClose: () => void; onDone: (poNumber: string) => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = () => { if (!busy) onClose() }
  const save = async () => {
    if (reason.trim().length < 5) { setError('Write why this draft PO is discarded (at least 5 characters). It is saved in the requisition history.'); return }
    setBusy(true); setError('')
    try {
      await rfqApi.discardPoDraft(target.rfqId, target.poId, reason.trim())
      onDone(target.poNumber)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not discard this draft PO. Reload the page; if it is no longer a draft it cannot be discarded here.').join(' '))
      setBusy(false)
    }
  }

  return (
    <FormSheet width={560} icon="trash" iconColor="#b91c1c" title="Discard draft PO" subtitle={`${target.poNumber}${target.vendorName ? ` · ${target.vendorName}` : ''}`}
      onClose={close} busy={busy} onSubmit={save}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Keep the draft</button>
        <button type="submit" data-tour="discard-po-draft-save" disabled={busy} style={sheetBtn('primary', '#b91c1c', busy)}>{busy ? 'Discarding…' : 'Discard draft PO'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="alert" title="Why discard it" color="#b91c1c">
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e', fontSize: 13 }}>
            The quantity on this draft goes back to open, so you can upload a new PO for it. The Tally PO number can be used again.
            A PO that is in approval or already released cannot be discarded here.
          </div>
          <SheetField label="Reason" required hint="At least 5 characters. It is saved in the requisition history and sent to the requester and the buyers of these lines.">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Vendor changed the price; a new PO will be made in Tally"
              style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} autoFocus />
          </SheetField>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
