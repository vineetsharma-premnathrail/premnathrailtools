'use client'

// Purchase head: move one requisition line's NOT-YET-ORDERED quantity to another buyer.
// Quantity that is already on a PO stays with that PO's buyer. Used on My Lines; the requisition page
// can mount it for its own line rows (same props).
import { useEffect, useMemo, useState } from 'react'
import { p2pApi, usersApi } from '@/lib/api'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { extractErrorMessages } from '@/lib/validation'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, SheetIcon, SheetError, SheetField, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'

/** The line this dialog works on. */
export interface ReassignLine {
  pr_item_id: number
  item_name: string
  unit: string | null
  /** Quantity not yet on any PO: the part that moves. */
  open_to_order: number
  /** Current buyer (left out of the picker). */
  buyer_id: number | null
}

const fmtQty = (n: number) => Number(n.toFixed(3)).toLocaleString('en-IN')
// The role's "Assign buyer" rule decides who may be picked (Role & Permissions > Procurement > Purchase Requisitions).
const BUYER_RULE_KEY = 'p2p:purchase_requisitions.buyer'

export default function ReassignLineDialog({ open, prId, line, onClose, onDone }: {
  open: boolean
  prId: number
  line: ReassignLine | null
  onClose: () => void
  onDone: () => void
}) {
  if (!open || !line) return null
  return <Body prId={prId} line={line} onClose={onClose} onDone={onDone} />
}

function Body({ prId, line, onClose, onDone }: { prId: number; line: ReassignLine; onClose: () => void; onDone: () => void }) {
  const allow = useAssigneeFilter(BUYER_RULE_KEY)
  const [people, setPeople] = useState<{ id: number; name: string; designation?: string | null }[] | null>(null)
  const [buyerId, setBuyerId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    usersApi.directory()
      .then((list) => { if (alive) setPeople(list.map((u) => ({ id: u.id, name: u.name, designation: u.designation }))) })
      .catch((err) => { if (alive) { setPeople([]); setError(extractErrorMessages(err, 'Could not load the list of people.').join(' ') + ' Close this window and open it again.') } })
    return () => { alive = false }
  }, [])

  const options = useMemo(() => (people || [])
    .filter((p) => p.id !== line.buyer_id && allow(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: String(p.id), label: p.designation ? `${p.name} (${p.designation})` : p.name })), [people, line.buyer_id, allow])

  const close = () => { if (!busy) onClose() }
  const reasonOk = reason.trim().length >= 5
  const save = async () => {
    if (!buyerId) { setError('Pick the buyer who should take this line over.'); return }
    if (!reasonOk) { setError('Write why the line is moving (at least 5 characters), so the old buyer and the requester can see the reason.'); return }
    setBusy(true); setError('')
    try {
      await p2pApi.reassignLineBuyer(prId, line.pr_item_id, { buyer_id: Number(buyerId), reason: reason.trim() })
      onDone()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not move the line to the other buyer.').join(' '))
      setBusy(false)
    }
  }

  const unit = line.unit || ''
  return (
    <FormSheet width={560} icon="user" title="Move line to another buyer" subtitle={line.item_name}
      onClose={close} busy={busy} onSubmit={save}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" data-tour="reassign-line-save" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Moving…' : 'Move line'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="user" title="New buyer">
          <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 14px' }}>
            This moves <b>{fmtQty(line.open_to_order)} {unit}</b> not yet ordered; quantity already on POs stays with its buyer.
            The old buyer&apos;s RFQ line is taken off, and awards without a PO are cleared. Their quotes stay as history.
          </p>
          <SheetField label="Move to buyer" required>
            <SearchableSelect value={buyerId} onChange={setBuyerId} options={options} disabled={people === null}
              placeholder={people === null ? 'Loading people…' : options.length ? 'Search a buyer…' : 'No one else can take this line'} />
          </SheetField>
          <SheetField label="Reason" required style={{ marginTop: 14 }} hint="At least 5 characters. It is saved in the requisition history and sent with the notice to the old buyer and the requester.">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Rahul is on leave; this vendor is handled by Anita"
              style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} />
          </SheetField>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
