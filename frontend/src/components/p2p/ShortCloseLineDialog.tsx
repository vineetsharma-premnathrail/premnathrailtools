'use client'

// Short-close a requisition line: write off its NOT-YET-ORDERED quantity (all of it, or part). What is already
// on a PO is not touched. Used on My Lines; the requisition page can mount it for its own line rows (same props).
import { useState } from 'react'
import { p2pApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SheetSection, SheetIcon, SheetError, SheetField, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'

/** The line this dialog works on. */
export interface ShortCloseLine {
  pr_item_id: number
  item_name: string
  unit: string | null
  /** Quantity not yet on any PO: the most that can be short-closed. */
  open_to_order: number
  buyer_id: number | null
}

const fmtQty = (n: number) => Number(n.toFixed(3)).toLocaleString('en-IN')

export default function ShortCloseLineDialog({ open, prId, line, onClose, onDone }: {
  open: boolean
  prId: number
  line: ShortCloseLine | null
  onClose: () => void
  onDone: () => void
}) {
  if (!open || !line) return null
  return <Body prId={prId} line={line} onClose={onClose} onDone={onDone} />
}

function Body({ prId, line, onClose, onDone }: { prId: number; line: ShortCloseLine; onClose: () => void; onDone: () => void }) {
  const open = line.open_to_order
  const [qty, setQty] = useState(String(Number(open.toFixed(3))))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = () => { if (!busy) onClose() }
  const save = async () => {
    const n = Number(qty)
    if (!qty.trim() || !Number.isFinite(n) || n <= 0) { setError(`Enter how much to short-close: more than 0 and at most ${fmtQty(open)} ${line.unit || ''}.`.replace('  ', ' ')); return }
    if (n - open > 1e-6) { setError(`Only ${fmtQty(open)} ${line.unit || ''} is not yet ordered, so you can short-close at most that. Lower the quantity.`.replace('  ', ' ')); return }
    if (reason.trim().length < 5) { setError('Write why this quantity is not needed (at least 5 characters). The requester is told the reason.'); return }
    setBusy(true); setError('')
    try {
      // Whole open quantity = leave quantity out, so the server uses what is really open at this moment.
      await p2pApi.shortCloseLine(prId, line.pr_item_id, { ...(Math.abs(n - open) > 1e-6 ? { quantity: n } : {}), reason: reason.trim() })
      onDone()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not short-close this line.').join(' '))
      setBusy(false)
    }
  }

  const unit = line.unit || ''
  return (
    <FormSheet width={560} icon="alert" iconColor="#b91c1c" title="Short-close line" subtitle={line.item_name}
      onClose={close} busy={busy} onSubmit={save}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" data-tour="short-close-line-save" disabled={busy} style={sheetBtn('primary', '#b91c1c', busy)}>{busy ? 'Saving…' : 'Short-close'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="alert" title="Quantity to write off" color="#b91c1c">
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e', fontSize: 13 }}>
            This cannot be undone. The quantity is taken off what must be bought, any award above the new quantity is trimmed, and the requester is told.
            Quantity already on a PO is not touched.
          </div>
          <SheetField label={`Quantity to short-close${unit ? ` (${unit})` : ''}`} required hint={`${fmtQty(open)} ${unit} is not yet ordered — that is the most you can short-close.`.replace('  ', ' ')}>
            <input type="number" min="0" step="any" max={open} value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...sheetInput, maxWidth: 200 }} />
          </SheetField>
          <SheetField label="Reason" required style={{ marginTop: 14 }} hint="At least 5 characters. It is saved in the requisition history.">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Requirement cancelled by the project; stock issued instead"
              style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} />
          </SheetField>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
