'use client'

// A Customer Requirement already sent to R&D is changed only here (the normal Edit locks it):
// old text next to the new text, a reason, and either a new revision for R&D or a typo fix in the
// same revision (only while R&D has not accepted it). Also holds the reason fields every re-send asks for.

import { useEffect, useMemo, useState } from 'react'
import { crmApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { CrmDocument, Inquiry, RequirementChangeReason } from '@/types'
import type { RndRevisionStatus } from '@/types/rndIntake'
import { extractErrorMessages } from '@/lib/validation'
import Checkbox from '@/components/Checkbox'
import Select from '@/components/shared/Select'
import DateField from '@/components/erp/DateField'
import { segmentBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const CHANGE_REASON_LABEL: Record<RequirementChangeReason, string> = {
  customer_changed: 'Customer changed requirement',
  bd_correction: "Correction of BD's mistake",
  other: 'Other',
}

/** Null when the reason (and its note for "Other") is complete, else the message to show. */
export function changeReasonError(reason: RequirementChangeReason | '', note: string): string | null {
  if (!reason) return 'Pick why the requirement is being sent again — Customer changed requirement, Correction of BD\'s mistake or Other. R&D sees it with the new revision.'
  if (reason === 'other' && note.trim().length < 10) return 'You picked Other — write the reason in the note (at least 10 characters) so R&D understands why it was sent again.'
  return null
}

/** Reason select + note, same fields in the change popup and the re-send popup. */
export function ChangeReasonFields({ reason, note, onReason, onNote, tourPrefix }: {
  reason: RequirementChangeReason | ''
  note: string
  onReason: (r: RequirementChangeReason | '') => void
  onNote: (n: string) => void
  tourPrefix: string
}) {
  return (
    <>
      <div data-tour={`${tourPrefix}-reason`}>
        <label style={sheetLabel} htmlFor={`${tourPrefix}-reason-select`}>Reason <Req /></label>
        <Select id={`${tourPrefix}-reason-select`} value={reason} onChange={(e) => onReason(e.target.value as RequirementChangeReason | '')} style={sheetInput}>
          <option value="">-- Select reason --</option>
          {(Object.keys(CHANGE_REASON_LABEL) as RequirementChangeReason[]).map((r) => <option key={r} value={r}>{CHANGE_REASON_LABEL[r]}</option>)}
        </Select>
      </div>
      <div data-tour={`${tourPrefix}-note`} style={{ marginTop: 14 }}>
        <label style={sheetLabel} htmlFor={`${tourPrefix}-note-text`}>Note {reason === 'other' ? <Req /> : <Optional />}</label>
        <textarea id={`${tourPrefix}-note-text`} maxLength={1000} style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={note} onChange={(e) => onNote(e.target.value)}
          placeholder={reason === 'other' ? 'Why is the requirement being sent again?' : 'Anything R&D should know about this change'} />
      </div>
    </>
  )
}

type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }

/** Line-by-line difference (longest common subsequence); specs are a few lines, so this stays cheap. */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n').map((l) => l.trimEnd())
  const b = newText.split('\n').map((l) => l.trimEnd())
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ kind: 'removed', text: a[i] }); i++ }
    else { out.push({ kind: 'added', text: b[j] }); j++ }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] })
  while (j < b.length) out.push({ kind: 'added', text: b[j++] })
  return out
}

function DiffHint({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = useMemo(() => diffLines(oldText, newText).filter((l) => l.text.trim() !== '' || l.kind !== 'same'), [oldText, newText])
  const added = lines.filter((l) => l.kind === 'added').length
  const removed = lines.filter((l) => l.kind === 'removed').length
  return (
    <div style={{ marginTop: 6 }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, color: '#b45309', margin: '0 0 4px' }}>Changed — {added} line{added === 1 ? '' : 's'} added, {removed} removed</p>
      <div style={{ borderRadius: 8, border: `1px solid ${SHEET.LINE}`, background: '#fff', padding: '6px 8px', maxHeight: 140, overflowY: 'auto' }}>
        {lines.map((l, i) => (
          <div key={i} style={{
            fontSize: 12, whiteSpace: 'pre-wrap', padding: '1px 4px', borderRadius: 4,
            background: l.kind === 'added' ? 'rgba(22,163,74,0.12)' : l.kind === 'removed' ? 'rgba(220,38,38,0.10)' : 'transparent',
            color: l.kind === 'removed' ? '#b91c1c' : SHEET.BODY, textDecoration: l.kind === 'removed' ? 'line-through' : 'none',
          }}>{l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '− ' : '  '}{l.text || ' '}</div>
        ))}
      </div>
    </div>
  )
}

const norm = (s: string | null | undefined) => (s || '').trim()

// Mounted only while open, so every opening starts fresh.
export default function ChangeRequirementSheet({ inquiry, latestStatus, onClose, onChanged }: {
  inquiry: Inquiry
  /** Review state of R&D's latest revision (CrmRndRequirement.status); the typo fix needs 'submitted'. */
  latestStatus: RndRevisionStatus | null
  onClose: () => void
  /** Called after the backend accepted the change; the caller reloads the inquiry and the R&D area. */
  onChanged: () => void
}) {
  const items = inquiry.additional_items || []
  const canCorrect = latestStatus === 'submitted'
  const [mode, setMode] = useState<'revision' | 'correction'>('revision')
  const [spec, setSpec] = useState(inquiry.product_spec || '')
  const [itemSpecs, setItemSpecs] = useState<string[]>(items.map((it) => it.product_spec || ''))
  const [reason, setReason] = useState<RequirementChangeReason | ''>('')
  const [note, setNote] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [clientDocs, setClientDocs] = useState<CrmDocument[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // Picking reference documents needs Inquiries & Tenders › Documents › View; without it the list is skipped.
  const seeDocs = useCan().canFeature('crm', 'inquiries_tenders', 'documents', 'view')

  useEffect(() => {
    if (!seeDocs) { Promise.resolve().then(() => { setClientDocs([]); setLoadingDocs(false) }); return }
    crmApi.listDocuments({ related_module: 'inquiry', related_id: inquiry.id })
      .then((docs: CrmDocument[]) => setClientDocs(docs.filter((d) => d.folder_type === 'client')))
      .catch(() => setClientDocs([]))
      .finally(() => setLoadingDocs(false))
  }, [inquiry.id, seeDocs])

  const close = () => { if (!saving) onClose() }
  const toggle = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const mainChanged = norm(spec) !== norm(inquiry.product_spec)
  const itemChanged = (i: number) => norm(itemSpecs[i]) !== norm(items[i]?.product_spec)
  const anyChanged = mainChanged || items.some((_, i) => itemChanged(i))
  const isRevision = mode === 'revision'

  const submit = async () => {
    if (!anyChanged) { setError('Nothing has changed yet — edit the Customer Requirement of at least one product, or close this window.'); return }
    if (!norm(spec)) { setError('The main product\'s Customer Requirement cannot be empty — R&D needs it to work on.'); return }
    if (isRevision) {
      const msg = changeReasonError(reason, note)
      if (msg) { setError(msg); return }
      if (!dueDate) { setError('Set the R&D due date — the date R&D must reply to this new revision by.'); return }
      if (dueDate < todayIso()) { setError('The R&D due date is in the past — pick today or a later date.'); return }
    }
    setSaving(true)
    setError('')
    try {
      await crmApi.changeInquiryRequirement(inquiry.id, {
        mode,
        product_spec: norm(spec),
        // An emptied additional requirement goes as "" (clears it); null would mean keep the old text.
        item_specs: itemSpecs.map((s) => norm(s)),
        ...(isRevision && reason ? { change_reason: reason, change_note: note.trim() || undefined, response_due_date: dueDate, remarks: remarks.trim() || undefined, document_ids: selected } : {}),
      })
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not change the requirement. Check your connection and try again — what you typed is still here.'))
    } finally {
      setSaving(false)
    }
  }

  const block = (key: string, label: string, product: string | null | undefined, oldText: string, value: string, onValue: (v: string) => void, changed: boolean, tour?: string) => (
    <div key={key} style={{ padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 12 }}>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: SHEET.INK, margin: '0 0 8px' }}>{label}: {product || '—'}</p>
      <label style={{ ...sheetLabel, fontSize: 11.5, color: SHEET.MUTED, marginBottom: 3 }}>Now sent to R&amp;D</label>
      <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f1f5f9', border: `1px solid ${SHEET.LINE}`, fontSize: 13, color: SHEET.BODY, whiteSpace: 'pre-wrap', marginBottom: 10, minHeight: 20 }}>{oldText || 'Not provided'}</div>
      <div data-tour={tour}>
        <label style={{ ...sheetLabel, fontSize: 11.5, marginBottom: 3 }} htmlFor={`chg-${key}`}>New Customer Requirement</label>
        <textarea id={`chg-${key}`} style={{ ...sheetInput, minHeight: 70, resize: 'vertical', ...(changed ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}) }} value={value} onChange={(e) => onValue(e.target.value)} />
      </div>
      {changed && <DiffHint oldText={oldText} newText={value} />}
    </div>
  )

  return (
    <FormSheet width={760} icon="edit" title="Change requirement" onClose={close} busy={saving} tour="change-req-sheet"
      subtitle={`${inquiry.universal_id} · already sent to R&D — the change is recorded and R&D is told`}
      footer={<>
        <button type="button" onClick={close} disabled={saving} data-tour="change-req-cancel" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} data-tour="change-req-save" style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name={isRevision ? 'send' : 'check'} size={16} />{saving ? 'Saving…' : isRevision ? 'Send new revision to R&D' : 'Save correction'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />

        <SheetSection icon="list" title="Type of change">
          <div data-tour="change-req-mode" role="radiogroup" aria-label="Type of change" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" role="radio" aria-checked={isRevision} onClick={() => { setMode('revision'); setError('') }} style={segmentBtnStyle(isRevision)}>New revision for R&amp;D</button>
            <button type="button" role="radio" aria-checked={!isRevision} disabled={!canCorrect} onClick={() => { setMode('correction'); setError('') }}
              title={canCorrect ? 'Fix a typo in the revision R&D has not accepted yet' : 'R&D already accepted or answered the latest revision, so it cannot be corrected in place. Send a new revision instead.'}
              style={{ ...segmentBtnStyle(!isRevision), opacity: canCorrect ? 1 : 0.5, cursor: canCorrect ? 'pointer' : 'not-allowed' }}>Fix a typo (same revision)</button>
          </div>
          <p style={sheetHint}>
            {isRevision
              ? 'R&D gets the new text as the next revision (R1, R2, …) with your reason and a new due date, and reviews it again.'
              : 'The text is corrected inside the current revision — no new revision and no new due date. R&D is told it was corrected before they accepted it.'}
          </p>
        </SheetSection>

        <SheetSection icon="box" title="Customer Requirement">
          {block('main', 'Product', inquiry.product, inquiry.product_spec || '', spec, setSpec, mainChanged, 'change-req-new-text')}
          {items.map((it, i) => block(`item-${it.id ?? i}`, `Additional product ${i + 1}`, it.product, it.product_spec || '', itemSpecs[i] ?? '', (v) => setItemSpecs((rows) => rows.map((r, j) => (j === i ? v : r))), itemChanged(i)))}
        </SheetSection>

        {isRevision && (
          <>
            <SheetSection icon="shield" title="Why">
              <ChangeReasonFields reason={reason} note={note} onReason={(r) => { setReason(r); setError('') }} onNote={setNote} tourPrefix="change-req" />
            </SheetSection>
            <SheetSection icon="calendar" title="Response">
              <div data-tour="change-req-due" style={{ maxWidth: 200 }}>
                <label style={sheetLabel}>R&amp;D due date <Req /></label>
                <DateField value={dueDate} onChange={setDueDate} />
              </div>
              <div data-tour="change-req-remarks" style={{ marginTop: 14 }}>
                <label style={sheetLabel} htmlFor="chg-remarks">Remarks to R&amp;D <Optional /></label>
                <textarea id="chg-remarks" style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What R&D should look at again" />
              </div>
            </SheetSection>
            <SheetSection icon="clip" title="Reference client documents" extra={<Optional />}>
              {loadingDocs ? (
                <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading client documents…</p>
              ) : clientDocs.length === 0 ? (
                <p style={{ fontSize: 13, color: SHEET.MUTED, fontStyle: 'italic', margin: 0 }}>No client documents uploaded yet.</p>
              ) : (
                <div data-tour="change-req-docs" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {clientDocs.map((d) => (
                    <div key={d.id} onClick={() => toggle(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, cursor: 'pointer', fontSize: 13, background: '#fff' }}>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                      </span>
                      <span style={{ color: SHEET.INK }}>{d.file_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </SheetSection>
          </>
        )}
      </div>
    </FormSheet>
  )
}
