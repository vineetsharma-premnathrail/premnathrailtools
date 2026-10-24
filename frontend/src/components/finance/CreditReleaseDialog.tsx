'use client'

// Ask Finance to release a credit block (FD32/UKM) — submitted to the central
// approval engine (Finance approver; a Partner too for a large excess).
// A FormSheet popup (portaled to <body>, so glass-card ancestors can't clip it).
import { useState } from 'react'
import { accountsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { CreditPosition } from '@/types'
import { inr, ErrorBanner } from '@/components/finance/financeUi'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

export default function CreditReleaseDialog({ position, salesOrderId, soNumber, defaultCheckpoint = 'so_confirmation', onClose, onDone }: {
  position: Pick<CreditPosition, 'customer_id' | 'customer_name' | 'block_reasons' | 'exposure' | 'credit_limit' | 'overdue_amount'>
  salesOrderId?: number | null
  soNumber?: string | null
  defaultCheckpoint?: 'so_confirmation' | 'dispatch'
  onClose: () => void
  onDone: () => void
}) {
  const [checkpoint, setCheckpoint] = useState(defaultCheckpoint)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    if (!reason.trim()) { setError(['Say why the order / dispatch should go ahead despite the credit block.']); return }
    setSaving(true)
    try {
      await accountsApi.requestCreditRelease({ customer_id: position.customer_id, checkpoint, sales_order_id: salesOrderId || undefined, reason })
      onDone()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not request the credit release.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet tour="fin-credit-release-dialog" width={580} icon="shield" title="Request credit release" subtitle={position.customer_name}
      onClose={onClose} busy={saving}
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={onClose}>Close</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={save}><SheetIcon name="send" size={16} />{saving ? 'Sending…' : 'Send for approval'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="alert" title="Why it is blocked" color="#b91c1c">
          <p style={{ margin: '0 0 8px', fontSize: 13, color: SHEET.BODY }}>
            Exposure {inr(position.exposure)}{position.credit_limit != null && <> vs limit {inr(position.credit_limit)}</>}
            {position.overdue_amount > 0 && <> · overdue {inr(position.overdue_amount)}</>}.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#b91c1c' }}>
            {position.block_reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </SheetSection>
        <SheetSection icon="send" title="Release request">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: '0 1 230px', minWidth: 200 }}>
              <label style={sheetLabel}>For <Req /></label>
              <Select style={sheetInput} value={checkpoint} onChange={(e) => setCheckpoint(e.target.value as 'so_confirmation' | 'dispatch')}>
                <option value="so_confirmation">Sales order confirmation</option>
                <option value="dispatch">Dispatch</option>
              </Select>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={sheetLabel}>Order</label>
              <div style={{ fontSize: 13, padding: '10px 0', color: SHEET.INK }}>{soNumber || (salesOrderId ? `#${salesOrderId}` : 'Any order of this customer')}</div>
            </div>
          </div>
          <label style={sheetLabel}>Why should it go ahead? <Req /></label>
          <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder="e.g. Customer confirmed payment of ₹12 L on 20-Oct; UTR to follow" />
          <p style={sheetHint}>A Finance approver decides; the release is valid for the days set in Finance › Settings.</p>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
