'use client'

// Quotation document status (SAP VA21-VA23 + release): Draft → Awaiting approval
// → Approved → Sent → Accepted / Lost / Expired. The approval itself runs on the
// central approval engine (Sales › Settings › Quotation approval sets the limits).
// Replaces the old free-text "customer response" select.

import { useEffect, useState } from 'react'
import { crmQuotationStatusApi, QuotationAction } from '@/lib/sdApi'
import { extractErrorMessages } from '@/lib/validation'
import { QuotationItem, QuotationStatusView } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { pillStyle, smallPrimaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle } from '@/components/shared/ui'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved', sent: 'Sent to customer',
  accepted: 'Accepted', lost: 'Lost', expired: 'Expired',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#64748B', submitted: '#D97706', approved: '#2563EB', sent: '#7C3AED', accepted: '#16A34A', lost: '#DC2626', expired: '#DC2626',
}

type Prompt = { action: QuotationAction; title: string; message: string; placeholder: string; label: string; required: boolean; danger: boolean; icon?: 'undo' | 'check' | 'x' }

export default function QuotationStatusBar({ inquiryId, quot, canModify, canSubmit = canModify, canWork = false, onChanged, tour }: {
  inquiryId: number
  quot: QuotationItem
  /** Inquiries & Tenders › Quotations › Edit (default for canSubmit). */
  canModify: boolean
  /** Submit for approval / withdraw (Inquiries & Tenders › Quotations › Submit). */
  canSubmit?: boolean
  /** Inquiries & Tenders > Quotations > Edit - needed for send / accepted / lost / reopen (the server also checks creator / owner / admin). */
  canWork?: boolean
  onChanged: () => void
  tour?: boolean
}) {
  const [view, setView] = useState<QuotationStatusView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [reason, setReason] = useState('')
  const [promptError, setPromptError] = useState<string | string[]>('')
  const [confirm, setConfirm] = useState<{ action: QuotationAction; title: string; message: string; label: string } | null>(null)
  const status = (quot.status || 'draft') as string

  const [viewError, setViewError] = useState(false)
  const [viewTick, setViewTick] = useState(0)

  useEffect(() => {
    let alive = true
    setViewError(false)
    crmQuotationStatusApi.status(inquiryId, quot.id)
      .then((v) => { if (alive) setView(v) })
      .catch(() => { if (alive) { setView(null); setViewError(true) } })
    return () => { alive = false }
  }, [inquiryId, quot.id, quot.status, quot.revision_number, viewTick])

  // Returns the error (if any) so a reason popup can show it in place.
  const run = async (action: QuotationAction, comment?: string, inPopup = false) => {
    setBusy(true); setError('')
    try {
      const r = await crmQuotationStatusApi.act(inquiryId, quot.id, action, comment ? { comment } : {})
      setView(r.status_view)
      onChanged()
      return true
    } catch (e) {
      const verb: Record<string, string> = { send: 'mark as sent', accept: 'record as accepted', lost: 'mark as lost', reopen: 'reopen', withdraw: 'withdraw', submit: 'submit' }
      const msg = extractErrorMessages(e, `Couldn't ${verb[action] || action} quotation ${quot.quot_number || ''}. Reload the inquiry and try again; if it persists, check your connection.`)
      if (inPopup) setPromptError(msg)
      else setError(msg)
      return false
    } finally { setBusy(false) }
  }

  const openPrompt = (p: Prompt) => { setReason(''); setPromptError(''); setPrompt(p) }
  const submitPrompt = async () => {
    if (!prompt) return
    const v = reason.trim()
    if (prompt.required && !v) { setPromptError(prompt.action === 'lost' ? "Enter why the customer didn't take this quotation (price, delivery, competitor …) — it is saved on the quotation." : 'Enter the reason — it is saved on the quotation and shown to the creator.'); return }
    if (await run(prompt.action, v || undefined, true)) setPrompt(null)
  }

  // Server rule (_ensure_actor): quotation creator, inquiry owner / BD owner or admin, plus the Edit permission.
  const mayWork = canWork && view?.can_work !== false
  const hex = STATUS_HEX[status] || '#64748B'
  const btn = (label: string, onClick: () => void, style: React.CSSProperties = smallSecondaryBtnStyle, tourId?: string) => (
    <button type="button" disabled={busy} onClick={onClick} data-tour={tour ? tourId : undefined}
      aria-label={`${label} — quotation ${quot.quot_number || ''}`.trim()} style={{ ...style, opacity: busy ? 0.6 : 1 }}>{label}</button>
  )

  return (
    <div data-tour={tour ? 'quot-status-bar' : undefined} style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={pillStyle(hex)}>
          {STATUS_LABELS[status] || status}
        </span>
        {quot.customer_response === 'Negotiating' && status === 'sent' && <span style={{ fontSize: 11.5, color: '#7C3AED' }}>Customer negotiating</span>}
        {/* Only a quotation that really needs approval says so; no "No approval needed" note (owner, 2026-10-28). */}
        {view && status === 'draft' && view.approval_label && view.approval_rank !== 0 && (
          <span style={{ fontSize: 11.5, color: '#57534e' }}>
            Needs {view.approval_label} approval
            {view.approval_reasons.length ? ` (${view.approval_reasons.join('; ')})` : ''}
          </span>
        )}
        {view?.approval_pending && (
          <span style={{ fontSize: 11.5, color: '#b45309' }}>
            {view.approval_stage} stage{view.approval_waiting_on.length ? ` — waiting on ${view.approval_waiting_on.join(', ')}` : ''}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {/* No approval needed → submitting approves it at once, so say that instead of "for approval". */}
        {canSubmit && status === 'draft' && btn(view?.approval_rank === 0 ? 'Finalise quotation' : 'Submit for approval', () => run('submit'), smallPrimaryBtnStyle, 'quot-submit-btn')}
        {canSubmit && status === 'submitted' && btn('Withdraw', () => setConfirm({ action: 'withdraw', title: 'Withdraw from approval?', message: 'The quotation goes back to draft so you can change it.', label: 'Withdraw' }))}
        {view?.can_decide && status === 'submitted' && (
          <>
            {btn('Approve', () => setConfirm({ action: 'approve', title: 'Approve this quotation?', message: `Quotation ${quot.quot_number || ''} is approved and can then be sent to the customer.`, label: 'Approve' }), smallPrimaryBtnStyle, 'quot-approve-btn')}
            {btn('Return', () => openPrompt({ action: 'return', title: 'Return for changes', message: 'Tell the creator what to change.', placeholder: 'e.g. Discount too high — max 8%', label: 'Return', required: true, danger: false }))}
            {btn('Reject', () => openPrompt({ action: 'reject', title: 'Reject this quotation', message: 'The quotation goes back to draft with your reason.', placeholder: 'Reason', label: 'Reject', required: true, danger: true }), smallDangerBtnStyle)}
          </>
        )}
        {mayWork && status === 'approved' && btn('Mark as sent to customer', () => run('send'), smallPrimaryBtnStyle, 'quot-send-btn')}
        {mayWork && status === 'sent' && btn('Customer accepted', () => openPrompt({ action: 'accept', title: 'Customer accepted this quotation', message: 'Any remarks from the customer (optional).', placeholder: 'e.g. PO to follow by Friday', label: 'Record acceptance', required: false, danger: false, icon: 'check' }), smallPrimaryBtnStyle, 'quot-accept-btn')}
        {mayWork && (status === 'approved' || status === 'sent') && btn('Customer rejected / lost', () => openPrompt({ action: 'lost', title: 'Customer did not take this quotation', message: "Why didn't the customer take it?", placeholder: 'e.g. Price high — competitor quoted less', label: 'Mark as lost', required: true, danger: true }), smallDangerBtnStyle, 'quot-lost-btn')}
      </div>
      {quot.status_comment && ['draft', 'lost', 'accepted'].includes(status) && (
        <div style={{ fontSize: 11.5, color: '#57534e', marginTop: 4 }}>{quot.status_comment}</div>
      )}
      {status === 'approved' && !mayWork && <div style={{ fontSize: 11.5, color: '#78716c', marginTop: 4 }}>Approved — the quotation&apos;s creator or the inquiry owner marks it as sent to the customer.</div>}
      {status === 'expired' && <div style={{ fontSize: 11.5, color: '#78716c', marginTop: 4 }}>Validity ended without a decision — use &quot;Create revision from this quotation&quot; to offer it again (a finalised quotation can&apos;t be edited).</div>}
      {viewError && (
        <div role="alert" style={{ padding: '10px 14px', marginTop: 8, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>Approval details could not be loaded — reload the inquiry; if it persists check your connection.</span>
          <button type="button" onClick={() => setViewTick((n) => n + 1)} style={smallSecondaryBtnStyle}>Try again</button>
        </div>
      )}
      {error && (
        <div role="alert" style={{ padding: '10px 14px', marginTop: 8, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.map((m, i) => <div key={i}>{m}</div>) : error}
        </div>
      )}
      {prompt && (
        <FormSheet width={560} icon={prompt.danger ? 'alert' : (prompt.icon || 'undo')} iconColor={prompt.danger ? '#dc2626' : SHEET.BLUE} title={prompt.title}
          subtitle={`Quotation ${quot.quot_number || ''}${quot.revision_number ? ` · Rev ${quot.revision_number}` : ''}`} onClose={() => setPrompt(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setPrompt(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={submitPrompt} disabled={busy} style={sheetBtn('primary', prompt.danger ? '#dc2626' : SHEET.BLUE, busy)}>
              <SheetIcon name={prompt.danger ? 'x' : (prompt.icon || 'undo')} size={16} />{busy ? 'Saving…' : prompt.label}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={promptError} />
            <SheetSection icon="chat" title="Reason" color={prompt.danger ? '#dc2626' : SHEET.BLUE}>
              <label style={sheetLabel}>{prompt.message} {prompt.required && <Req />}</label>
              <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={prompt.placeholder} style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} />
              <p style={sheetHint}>Saved on the quotation&apos;s status history.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.message || ''} confirmLabel={confirm?.label} danger={false}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) run(c.action) }} onCancel={() => setConfirm(null)} />
    </div>
  )
}
