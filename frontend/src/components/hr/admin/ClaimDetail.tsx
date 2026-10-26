'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useRef, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import type { HrExpenseClaim, HrExpenseClaimItem, HrLinkableTrip } from '@/types'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { secondaryBtnStyle, dangerBtnStyle, smallPrimaryBtnStyle, RowCount, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import {
  ErrorBanner, SuccessBanner, Pill, EmptyRow, FormDialog, primaryActionStyle, sectionStyle,
  thStyle, tdStyle, linkActionStyle, fmtDate, fmtDateTime, fmtINR, todayIso,
} from './adminUi'
import { TEXT, BORDER } from '@/lib/theme'
import { SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

export const CLAIM_STATUS_LABELS: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', paid: 'Paid', cancelled: 'Cancelled' }
export const CLAIM_STATUS_HEX: Record<string, string> = { draft: '#64748B', submitted: '#F59E0B', approved: '#2563EB', rejected: '#DC2626', paid: '#16A34A', cancelled: '#94A3B8' }
export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  travel: 'Travel / tickets', lodging: 'Lodging', food: 'Food', local_conveyance: 'Local conveyance', fuel: 'Fuel', phone: 'Phone / data', other: 'Other',
}

type LineDraft = { expense_date: string; category: string; description: string; amount: string }
const emptyLine = (): LineDraft => ({ expense_date: todayIso(), category: 'food', description: '', amount: '' })

function lineProblems(l: LineDraft): string[] {
  const p: string[] = []
  if (!l.expense_date) p.push('Pick the date of the expense.')
  if (!(Number(l.amount) > 0)) p.push('Enter an amount greater than ₹0.')
  if (l.expense_date && l.expense_date > todayIso()) p.push('The expense date cannot be in the future.')
  return p
}

/** Title / date / linked-trip editor for a claim header (also used to create). */
export function ClaimHeaderDialog({
  open, claim, onClose, onSaved,
}: {
  open: boolean
  claim?: HrExpenseClaim | null
  onClose: () => void
  onSaved: (c: HrExpenseClaim) => void
}) {
  const [title, setTitle] = useState('')
  const [claimDate, setClaimDate] = useState(todayIso())
  const [tripId, setTripId] = useState('')
  const [trips, setTrips] = useState<HrLinkableTrip[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setTitle(claim?.title || ''); setClaimDate(claim?.claim_date || todayIso()); setTripId(claim?.travel_request_id ? String(claim.travel_request_id) : ''); setError([])
    hrApi.claimTravelOptions().then(setTrips).catch(() => setTrips([]))
  }, [open, claim])

  const save = async () => {
    if (!title.trim()) { setError(['Give the claim a title, e.g. "Delhi site visit — Sept".']); return }
    setSaving(true); setError([])
    try {
      const c = claim
        ? await hrApi.updateClaim(claim.id, { title: title.trim(), claim_date: claimDate || null, ...(tripId ? { travel_request_id: Number(tripId) } : { clear_travel_request: true }) })
        : await hrApi.createClaim({ title: title.trim(), claim_date: claimDate || null, travel_request_id: tripId ? Number(tripId) : null })
      onSaved(c)
    } catch (err) {
      setError(extractErrorMessages(err, 'The claim could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title={claim ? `Edit ${claim.claim_no}` : 'New expense claim'}
      subtitle={claim ? undefined : 'Creates a draft. Add the expense lines and receipts next, then submit it for approval.'}
      icon={claim ? 'edit' : 'rupee'}
      onClose={onClose}
      busy={saving}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-claim-header-save" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}><SheetIcon name={claim ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : claim ? 'Save' : 'Create draft'}</button>
      </>}
    >
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="doc" title="Claim">
          <label style={sheetLabel}>Title <Req /></label>
          <input autoFocus data-tour="hr-claim-header-title" style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Delhi site visit — Sept" />
          <div data-tour="hr-claim-header-date" style={{ maxWidth: 200, marginTop: 14 }}>
            <label style={sheetLabel}>Claim date</label>
            <DateField value={claimDate} onChange={setClaimDate} />
          </div>
        </SheetSection>
        <SheetSection icon="truck" title="Linked Trip" extra={<Optional />}>
          <Select data-tour="hr-claim-header-trip" style={sheetInput} value={tripId} onChange={(e) => setTripId(e.target.value)}>
            <option value="">— Not linked to a trip —</option>
            {trips.map((t) => <option key={t.id} value={t.id}>{t.request_no} · {t.from_city} → {t.to_city} · {fmtDate(t.depart_date)}</option>)}
          </Select>
          {trips.length === 0 && <p style={sheetHint}>Only your approved or completed travel requests can be linked.</p>}
        </SheetSection>
      </div>
    </FormDialog>
  )
}

function MarkPaidDialog({ claim, onClose, onDone }: { claim: HrExpenseClaim | null; onClose: () => void; onDone: (c: HrExpenseClaim) => void }) {
  const [paidOn, setPaidOn] = useState(todayIso())
  const [ref, setRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])
  useEffect(() => { if (claim) { setPaidOn(todayIso()); setRef(''); setError([]) } }, [claim])

  const submit = async () => {
    if (!claim) return
    if (!ref.trim()) { setError(['Enter the payment reference (NEFT / UTR / cheque no. or ADP batch) so the employee can trace it.']); return }
    setSaving(true); setError([])
    try {
      onDone(await hrApi.markClaimPaid(claim.id, { paid_on: paidOn || null, payment_reference: ref.trim() }))
    } catch (err) {
      setError(extractErrorMessages(err, 'The payment could not be recorded.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={!!claim}
      title={`Record payment for ${claim?.claim_no || ''}`}
      subtitle={claim ? `${fmtINR(claim.total_amount)} to ${claim.user_name}. The payment itself is made outside the portal (bank / ADP); this records it.` : undefined}
      icon="rupee"
      iconColor="#16A34A"
      onClose={onClose}
      busy={saving}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" style={sheetBtn('primary', '#16A34A', saving)} onClick={submit} disabled={saving}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Mark paid'}</button>
      </>}
    >
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="rupee" title="Payment">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 170px' }}><label style={sheetLabel}>Paid on</label><DateField value={paidOn} onChange={setPaidOn} /></div>
            <div style={{ flex: '1 1 220px', maxWidth: 320 }}><label style={sheetLabel}>Payment reference <Req /></label><input autoFocus style={sheetInput} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR / NEFT / cheque no." /></div>
          </div>
        </SheetSection>
      </div>
    </FormDialog>
  )
}

export default function ClaimDetail({ claimId, onChanged }: { claimId: number; onChanged?: (c: HrExpenseClaim) => void }) {
  const [claim, setClaim] = useState<HrExpenseClaim | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [newLine, setNewLine] = useState<LineDraft>(emptyLine())
  const [newFile, setNewFile] = useState<File | null>(null)
  const newFileRef = useRef<HTMLInputElement>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [editLine, setEditLine] = useState<LineDraft>(emptyLine())
  const [uploadFor, setUploadFor] = useState<number | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const [headerOpen, setHeaderOpen] = useState(false)
  const [deleteLine, setDeleteLine] = useState<HrExpenseClaimItem | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [decision, setDecision] = useState<'approve' | 'reject' | 'cancel' | null>(null)
  const [payOpen, setPayOpen] = useState(false)

  const apply = useCallback((c: HrExpenseClaim, msg?: string) => {
    setClaim(c); setError([]); if (msg) setNotice(msg); onChanged?.(c)
  }, [onChanged])

  useEffect(() => {
    if (!claimId) return
    setLoading(true)
    hrApi.getClaim(claimId)
      .then((c) => { setClaim(c); setError([]); onChanged?.(c) })
      .catch((err) => setError(extractErrorMessages(err, 'This claim could not be loaded.')))
      .finally(() => setLoading(false))
    // onChanged is a notification callback; reloading when its identity
    // changes would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId])

  const run = async (fn: () => Promise<HrExpenseClaim>, msg: string, fallback: string) => {
    setBusy(true)
    try {
      apply(await fn(), msg)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback)); setNotice('')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loading && !claim) return <div style={sectionStyle}><p style={{ margin: 0, fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
  if (!claim) return <ErrorBanner error={error.length ? error : ['This claim could not be loaded.']} />

  const items = claim.items || []
  const threshold = Number(claim.receipt_threshold ?? 500)
  const missingReceipts = items.filter((i) => i.receipt_required && !i.has_receipt)
  const editable = claim.can_edit

  const addLine = async () => {
    const p = lineProblems(newLine)
    if (p.length) { setError(p); return }
    const payload = { expense_date: newLine.expense_date, category: newLine.category, description: newLine.description || null, amount: newLine.amount }
    setBusy(true)
    try {
      let c = await hrApi.addClaimItem(claim.id, payload)
      let msg = 'Line added.'
      if (newFile) {
        const before = new Set(items.map((i) => i.id))
        const added = (c.items || []).find((i) => !before.has(i.id))
        if (added) {
          try {
            c = await hrApi.uploadClaimReceipt(claim.id, added.id, newFile)
            msg = 'Line and receipt added.'
          } catch (err) {
            // The line is saved either way; tell the user the receipt still needs uploading.
            msg = ''
            setError([`The line was added, but the receipt upload failed: ${extractErrorMessages(err, 'upload failed').join(' ')} Use “Upload” on the line to try again.`])
          }
        }
      }
      setClaim(c); onChanged?.(c); if (msg) { setNotice(msg); setError([]) }
      setNewLine({ ...emptyLine(), expense_date: newLine.expense_date, category: newLine.category }); setNewFile(null)
      if (newFileRef.current) newFileRef.current.value = ''
    } catch (err) {
      setError(extractErrorMessages(err, 'The line could not be added.'))
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (editId == null) return
    const p = lineProblems(editLine)
    if (p.length) { setError(p); return }
    const ok = await run(() => hrApi.updateClaimItem(claim.id, editId, {
      expense_date: editLine.expense_date, category: editLine.category, description: editLine.description || null, amount: editLine.amount,
    }), 'Line updated.', 'The line could not be updated.')
    if (ok) setEditId(null)
  }

  const onPickReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const itemId = uploadFor
    e.target.value = ''
    if (!file || itemId == null) return
    await run(() => hrApi.uploadClaimReceipt(claim.id, itemId, file), `Receipt “${file.name}” uploaded.`, 'The receipt could not be uploaded.')
    setUploadFor(null)
  }

  const viewReceipt = async (item: HrExpenseClaimItem) => {
    try {
      await openAttachmentBlob(() => hrApi.getClaimReceiptBlob(claim.id, item.id))
    } catch (err) {
      setError(extractErrorMessages(err, 'The receipt could not be opened.'))
    }
  }

  const runDecision = async (remarks: string) => {
    const kind = decision
    setDecision(null)
    if (kind === 'approve') await run(() => hrApi.approveClaim(claim.id, remarks), `${claim.claim_no} approved.`, 'The claim could not be approved.')
    if (kind === 'reject') await run(() => hrApi.rejectClaim(claim.id, remarks), `${claim.claim_no} rejected and sent back to ${claim.user_name}.`, 'The claim could not be rejected.')
    if (kind === 'cancel') await run(() => hrApi.cancelClaim(claim.id, remarks), `${claim.claim_no} cancelled.`, 'The claim could not be cancelled.')
  }

  const lineInputs = (l: LineDraft, set: (l: LineDraft) => void) => (
    <>
      <td data-tour="hr-claim-line-date" style={{ ...tdStyle, minWidth: 150 }}><DateField value={l.expense_date} onChange={(v) => set({ ...l, expense_date: v })} /></td>
      <td style={{ ...tdStyle, minWidth: 150 }}>
        <Select data-tour="hr-claim-line-category" style={sheetInput} value={l.category} onChange={(e) => set({ ...l, category: e.target.value })}>
          {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </td>
      <td style={{ ...tdStyle, minWidth: 200 }}><input data-tour="hr-claim-line-description" style={sheetInput} value={l.description} onChange={(e) => set({ ...l, description: e.target.value })} placeholder="Hotel, cab to site, lunch with client…" /></td>
      <td style={{ ...tdStyle, width: 120 }}><input data-tour="hr-claim-line-amount" style={{ ...sheetInput, textAlign: 'right' }} inputMode="decimal" value={l.amount} onChange={(e) => set({ ...l, amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.00" /></td>
    </>
  )

  return (
    <div>
      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      {/* One record card: what the claim is, its key facts on one line, the
          actions for its current stage, then the approval / payment trail. */}
      <DetailCard tour="hr-claim-summary">
        <DetailSummary
          title={claim.title}
          text={`Expense claim by ${claim.user_name || 'the employee'}${claim.user_department ? ` (${claim.user_department})` : ''} — ${items.length} expense line${items.length === 1 ? '' : 's'} totalling ${fmtINR(claim.total_amount)}.`}
          meta={<>
            <Pill hex={CLAIM_STATUS_HEX[claim.status] || '#64748B'} label={CLAIM_STATUS_LABELS[claim.status] || claim.status} />
            <span>·</span><span>{claim.claim_no}</span>
            <span>·</span><span>Claim date {fmtDate(claim.claim_date)}</span>
            <span>·</span><strong style={{ color: TEXT.heading, fontSize: 14 }}>{fmtINR(claim.total_amount)}</strong>
          </>}
          actions={<>
            {editable && <button type="button" data-tour="hr-claim-submit-btn" style={primaryActionStyle} disabled={busy} onClick={() => setConfirmSubmit(true)}>{claim.status === 'rejected' ? 'Resubmit for approval' : 'Submit for approval'}</button>}
            {editable && <button type="button" data-tour="hr-claim-edit-header-btn" style={secondaryBtnStyle} onClick={() => setHeaderOpen(true)}>Edit title / trip</button>}
            {/* Claims submitted before the central approval engine keep the old buttons; engine-routed ones are decided in the Approval panel below. */}
            {claim.can_decide && !claim.approval_request_id && <button type="button" data-tour="hr-claim-approve-btn" style={primaryActionStyle} disabled={busy} onClick={() => setDecision('approve')}>Approve</button>}
            {claim.can_decide && !claim.approval_request_id && <button type="button" data-tour="hr-claim-reject-btn" style={dangerBtnStyle} disabled={busy} onClick={() => setDecision('reject')}>Reject</button>}
            {claim.can_mark_paid && <button type="button" data-tour="hr-claim-paid-btn" style={primaryActionStyle} disabled={busy} onClick={() => setPayOpen(true)}>Mark paid</button>}
            {claim.can_cancel && <button type="button" data-tour="hr-claim-cancel-btn" style={dangerBtnStyle} disabled={busy} onClick={() => setDecision('cancel')}>{claim.status === 'submitted' ? 'Withdraw claim' : 'Cancel claim'}</button>}
          </>}
        />
        <DetailGroup last>
          <DetailRow label="Linked trip">{claim.travel_request_no ? `${claim.travel_request_no} · ${claim.travel_route}` : 'Not linked to a trip'}</DetailRow>
          <DetailRow label="Approver">{claim.decided_by_name || claim.approver_name || (claim.status === 'draft' ? 'Set when submitted' : 'HR')}</DetailRow>
          {claim.submitted_at && <DetailRow label="Submitted">{fmtDateTime(claim.submitted_at)}</DetailRow>}
          {claim.decided_at && <DetailRow label="Decided">{fmtDateTime(claim.decided_at)}</DetailRow>}
          {claim.decision_remarks && (
            <DetailRow label={claim.status === 'rejected' ? 'Why it was rejected' : 'Approver remarks'}>
              <span style={{ color: claim.status === 'rejected' ? '#B91C1C' : undefined }}>{claim.decision_remarks}</span>
              {claim.status === 'rejected' && editable && <span style={{ display: 'block', fontSize: 12.5, color: TEXT.muted, marginTop: 4 }}>Fix the lines below, then submit again.</span>}
            </DetailRow>
          )}
          {claim.paid_on && <DetailRow label="Paid">{`${fmtDate(claim.paid_on)} · ref ${claim.payment_reference || '—'}${claim.paid_by_name ? ` · by ${claim.paid_by_name}` : ''}`}</DetailRow>}
        </DetailGroup>
      </DetailCard>

      {claim.approval_request_id && (
        <ApprovalPanel
          key={claim.approval_request_id}
          entityType="hr_expense_claim"
          entityId={claim.id}
          onChanged={() => { hrApi.getClaim(claim.id).then((c) => apply(c)).catch((err) => setError(extractErrorMessages(err, 'The claim could not be reloaded.'))) }}
        />
      )}

      {editable && missingReceipts.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
          {missingReceipts.length} line{missingReceipts.length > 1 ? 's need' : ' needs'} a receipt — every expense above {fmtINR(threshold)} must have one before you can submit.
        </div>
      )}

      <div data-tour="hr-claim-lines" style={{ background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 18, padding: '18px 20px 4px', marginBottom: 20 }}>
        <SheetSection icon="list" title="Expense Lines" extra={<span style={{ fontSize: 12, color: SHEET.MUTED }}>{items.length} line{items.length === 1 ? '' : 's'} · {fmtINR(claim.total_amount)}</span>}>
        <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>{['Date', 'Category', 'Description', 'Amount', 'Receipt', ''].map((h, hi) => <th key={h} style={{ ...thStyle, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}{hi === 0 && <RowCount count={items.length} />}</th>)}</tr>
          </thead>
          <tbody>
            {items.length === 0 && !editable && <EmptyRow colSpan={6} text="No expense lines on this claim." />}
            {items.map((it) => editId === it.id ? (
              <tr key={it.id} style={{ background: 'rgba(255,106,42,0.04)' }}>
                {lineInputs(editLine, setEditLine)}
                <td style={tdStyle} />
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" style={linkActionStyle} disabled={busy} onClick={saveEdit}>Save</button>
                    <button type="button" style={{ ...linkActionStyle, color: TEXT.muted }} onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={it.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(it.expense_date)}</td>
                <td style={tdStyle}>{EXPENSE_CATEGORY_LABELS[it.category] || it.category}</td>
                <td style={{ ...tdStyle, maxWidth: 320 }}>{it.description || '—'}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtINR(it.amount)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {it.has_receipt ? (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button type="button" style={linkActionStyle} onClick={() => viewReceipt(it)} title={it.receipt_filename || ''}>View</button>
                      {editable && <button type="button" style={{ ...linkActionStyle, color: TEXT.muted }} onClick={() => { setUploadFor(it.id); uploadRef.current?.click() }}>Replace</button>}
                      {editable && <button type="button" style={{ ...linkActionStyle, color: '#DC2626' }} disabled={busy} onClick={() => run(() => hrApi.deleteClaimReceipt(claim.id, it.id), 'Receipt removed.', 'The receipt could not be removed.')}>Remove</button>}
                    </div>
                  ) : editable ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button type="button" style={linkActionStyle} disabled={busy} onClick={() => { setUploadFor(it.id); uploadRef.current?.click() }}>{busy && uploadFor === it.id ? 'Uploading…' : 'Upload'}</button>
                      {it.receipt_required && <Pill hex="#DC2626" label="Required" />}
                    </div>
                  ) : it.receipt_required ? <Pill hex="#DC2626" label="Missing" /> : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {editable && (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="button" style={linkActionStyle} onClick={() => { setEditId(it.id); setEditLine({ expense_date: it.expense_date, category: it.category, description: it.description || '', amount: String(it.amount) }) }}>Edit</button>
                      <button type="button" style={{ ...linkActionStyle, color: '#DC2626' }} onClick={() => setDeleteLine(it)}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {editable && (
              <tr style={{ background: 'rgba(255,255,255,.5)' }}>
                {lineInputs(newLine, setNewLine)}
                <td style={{ ...tdStyle, minWidth: 170 }}>
                  <input ref={newFileRef} data-tour="hr-claim-line-receipt" type="file" accept="image/*,.pdf" onChange={(e) => setNewFile(e.target.files?.[0] || null)} style={{ fontSize: 12, maxWidth: 190 }} />
                </td>
                <td style={tdStyle}>
                  <button type="button" data-tour="hr-claim-add-line-btn" style={smallPrimaryBtnStyle} disabled={busy} onClick={addLine}>{busy ? 'Saving…' : '+ Add line'}</button>
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, borderTop: `2px solid ${BORDER.normal}` }}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, fontSize: 14, borderTop: `2px solid ${BORDER.normal}`, whiteSpace: 'nowrap' }}>{fmtINR(claim.total_amount)}</td>
                <td colSpan={2} style={{ ...tdStyle, borderTop: `2px solid ${BORDER.normal}` }} />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
        {editable && <p style={sheetHint}>Receipts: images or PDF, up to 10 MB each. Required for any line above {fmtINR(threshold)}.</p>}
        </SheetSection>
      </div>

      <input ref={uploadRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={onPickReceipt} />

      <ClaimHeaderDialog open={headerOpen} claim={claim} onClose={() => setHeaderOpen(false)} onSaved={(c) => { setHeaderOpen(false); apply(c, 'Claim details saved.') }} />
      <MarkPaidDialog claim={payOpen ? claim : null} onClose={() => setPayOpen(false)} onDone={(c) => { setPayOpen(false); apply(c, `${c.claim_no} marked paid.`) }} />
      <ConfirmDialog
        open={!!deleteLine}
        title="Delete this line?"
        message={deleteLine ? `${fmtDate(deleteLine.expense_date)} · ${EXPENSE_CATEGORY_LABELS[deleteLine.category] || deleteLine.category} · ${fmtINR(deleteLine.amount)}${deleteLine.has_receipt ? ' — its receipt is deleted too.' : ''}` : ''}
        confirmLabel="Delete line"
        onConfirm={async () => { const it = deleteLine; setDeleteLine(null); if (it) await run(() => hrApi.deleteClaimItem(claim.id, it.id), 'Line deleted.', 'The line could not be deleted.') }}
        onCancel={() => setDeleteLine(null)}
      />
      <ConfirmDialog
        open={confirmSubmit}
        title={`Submit ${claim.claim_no}?`}
        message={`${fmtINR(claim.total_amount)} across ${items.length} line${items.length === 1 ? '' : 's'} goes to your reporting manager (or HR if you have none). You cannot edit it while it is being reviewed.`}
        confirmLabel="Submit"
        danger={false}
        onConfirm={async () => { setConfirmSubmit(false); await run(() => hrApi.submitClaim(claim.id), `${claim.claim_no} submitted for approval.`, 'The claim could not be submitted.') }}
        onCancel={() => setConfirmSubmit(false)}
      />
      <PromptDialog
        open={!!decision}
        title={decision === 'approve' ? `Approve ${claim.claim_no}?` : decision === 'reject' ? `Reject ${claim.claim_no}?` : `Cancel ${claim.claim_no}?`}
        message={decision === 'approve' ? `${fmtINR(claim.total_amount)} for ${claim.user_name}. HR then records the payment.` : decision === 'reject' ? 'The employee can correct and resubmit it. Say what needs fixing (required).' : 'The claim will be withdrawn and cannot be reopened.'}
        placeholder={decision === 'reject' ? 'What needs to be corrected…' : 'Remarks (optional)…'}
        confirmLabel={decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Cancel claim'}
        cancelLabel="Back"
        danger={decision !== 'approve'}
        onConfirm={runDecision}
        onCancel={() => setDecision(null)}
      />
    </div>
  )
}
