'use client'

import { useState } from 'react'
import { rndApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { RequirementMovementDoc, RndRequest, RndRequestQuery } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { chipBtnStyle, pillStyle, segmentBtnStyle } from '@/components/shared/ui'

const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function rndRequestBadge(r: RndRequest): { label: string; hex: string } {
  if (r.status === 'superseded') return { label: 'Superseded by re-send', hex: '#78716c' }
  if (r.status === 'closed') return { label: 'Closed by R&D', hex: '#78716c' }
  if (r.status === 'withdrawn') return { label: 'Taken back by BD', hex: '#78716c' }
  if (r.status === 'responded') return r.is_late ? { label: 'Responded late', hex: '#D97706' } : { label: 'Responded on time', hex: '#16A34A' }
  // R&D's question is with BD: R&D's clock is paused, so it is never "Overdue" meanwhile.
  if (r.waiting_on === 'bd') return { label: 'Waiting for BD', hex: '#7C3AED' }
  return r.is_late ? { label: 'Overdue', hex: '#DC2626' } : { label: 'Awaiting R&D', hex: '#2563EB' }
}

export const QUERY_CHANNEL_LABEL: Record<string, string> = { portal: 'Portal', phone: 'Phone', email: 'Email', meeting: 'Meeting' }
const BD_TOLD_CHANNELS = ['portal', 'phone', 'email', 'meeting'] as const

// The open (unanswered) question of a request, if any.
export const openQuery = (r: RndRequest): RndRequestQuery | null =>
  r.waiting_on === 'bd' ? ([...(r.queries || [])].reverse().find((q) => !q.answered_at && !q.answer) ?? null) : null

// Whole days from an ISO date/time to today (>= 0).
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const d = new Date(iso.slice(0, 10) + 'T00:00:00')
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((t.getTime() - d.getTime()) / 86400000))
}

// "Close without response" (R&D has nothing to share): a reason is required for the audit trail,
// the request becomes "Closed by R&D" and BD is told. BD can re-send the requirement later.
export function RndRequestCloseSheet({ request, open, onClose, onClosed }: {
  request: RndRequest
  open: boolean
  onClose: () => void
  onClosed: (r: RndRequest) => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  if (!open) return null

  const close = () => { if (!saving) { setError(''); onClose() } }
  const submit = async () => {
    if (reason.trim().length < 10) { setError('Write why R&D has nothing to share, so BD understands (at least 10 characters), e.g. "Standard product — no R&D input needed".'); return }
    setSaving(true)
    setError('')
    try {
      const updated = await rndApi.closeRequest(request.id, reason.trim())
      setReason('')
      onClosed(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not close this requirement without a response.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet width={520} icon="check" title="Close without response" onClose={close} busy={saving}
      subtitle={`Requested by ${request.requested_by || 'CRM'} · due ${formatDate(request.due_date)}`}
      footer={<>
        <button type="button" onClick={close} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.INK, saving)}>
          <SheetIcon name="check" size={16} />{saving ? 'Closing…' : 'Close requirement'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <label style={sheetLabel}>Reason <Req /></label>
        <textarea autoFocus maxLength={2000} style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Standard product — no R&D input needed" />
        <p style={sheetHint}>Use this when R&amp;D has nothing to share — BD continues without R&amp;D input. BD is notified and can re-send the requirement later if R&amp;D work is needed.</p>
      </div>
    </FormSheet>
  )
}

// One CRM → R&D ask inside a Requirement Movement card: who owns it, by when,
// CRM's remark, R&D's questions and R&D's answer. `canRespond` turns on the answer form (R&D side):
// a final response closes the request; "Ask BD for more details" keeps it open (owner, 2026-10-30).
// `buttonOnly` renders just the respond button + its form, without the request
// card; `renderButton` lets the caller keep its own button (it gets `open`).
export default function RndRequestBlock({
  request, canRespond, onOpenDoc, onResponded, buttonOnly, renderButton, threadOnly,
}: {
  request: RndRequest
  canRespond?: boolean
  onOpenDoc: (doc: RequirementMovementDoc) => void
  onResponded?: (r: RndRequest) => void
  buttonOnly?: boolean
  renderButton?: (open: () => void) => React.ReactNode
  /** Only the question / answer thread (R&D requirement page). */
  threadOnly?: boolean
}) {
  const [remarks, setRemarks] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [toldChannel, setToldChannel] = useState('')
  const [toldNote, setToldNote] = useState('')
  const badge = rndRequestBadge(request)
  // A question is with BD: R&D's due date is paused, so a final response is never "late" meanwhile.
  const waitingBd = request.waiting_on === 'bd'
  const lateNow = !waitingBd && todayIso() > request.due_date

  const submit = async () => {
    if (asking) {
      if (remarks.trim().length < 10) { setError('Write which details R&D needs from BD (at least 10 characters).'); return }
      setSaving(true)
      setError('')
      try {
        const updated = await rndApi.respondToRequest(request.id, { remarks: remarks.trim(), ask_details: true })
        setOpen(false)
        setRemarks('')
        onResponded?.(updated)
      } catch (err) {
        setError(extractErrorMessages(err, 'Could not send the question to BD.'))
      } finally {
        setSaving(false)
      }
      return
    }
    if (remarks.trim().length < 10) { setError('Write your response to BD (at least 10 characters), e.g. feasibility, deviations or the answer itself.'); return }
    if (waitingBd && !toldChannel) { setError('Pick how BD gave you the details (Portal, Phone, Email or Meeting) so the record shows where the answer came from.'); return }
    if (waitingBd && toldNote.trim().length < 10) { setError('Write what BD told you (at least 10 characters), e.g. "Axle load 22.5 t, gauge 1676 mm — confirmed on phone".'); return }
    if (lateNow && !delayReason.trim()) { setError(`This response is late — it was due on ${formatDate(request.due_date)}. Enter the reason for the delay.`); return }
    setSaving(true)
    setError('')
    try {
      const updated = await rndApi.respondToRequest(request.id, {
        remarks: remarks.trim(),
        delay_reason: lateNow ? delayReason.trim() : undefined,
        ...(waitingBd ? { bd_told_channel: toldChannel, bd_told_note: toldNote.trim() } : {}),
      })
      setToldChannel('')
      setToldNote('')
      setOpen(false)
      onResponded?.(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not submit the response.'))
    } finally {
      setSaving(false)
    }
  }

  const canAnswer = !!canRespond && request.status === 'open'
  const respondButton = canAnswer && (
    <button type="button" data-tour="rnd-respond-form" onClick={() => { setError(''); setAsking(false); setOpen(true) }} style={sheetBtn('primary', SHEET.BLUE)}>
      <SheetIcon name="send" size={15} />Respond to CRM
    </button>
  )
  const respondSheet = open && canAnswer && (
    <FormSheet width={600} icon="send" title="Respond to CRM" onClose={() => setOpen(false)} busy={saving}
      subtitle={`Requested by ${request.requested_by || 'CRM'} · due ${formatDate(request.due_date)}`}
      footer={<>
        <button type="button" onClick={() => setOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name="send" size={16} />{saving ? 'Submitting…' : asking ? 'Send question to BD' : 'Submit Response to CRM'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <div data-tour="rnd-respond-kind" role="radiogroup" aria-label="Response type" style={{ display: 'inline-flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {([[false, 'Final response'], [true, 'Ask BD for more details']] as const).map(([v, label]) => {
            const blocked = v && waitingBd
            return (
              <button key={label} type="button" role="radio" aria-checked={asking === v} disabled={blocked}
                title={blocked ? 'A question to BD is already open. Wait for BD\'s reply, or give your final response and note what BD told you.' : undefined}
                onClick={() => { setAsking(v); setError('') }}
                style={{ ...segmentBtnStyle(asking === v), ...(blocked ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>{label}</button>
            )
          })}
        </div>
        <p style={{ ...sheetHint, marginTop: 0, marginBottom: 12 }}>
          {asking
            ? 'The request stays open and R&D\'s due date is paused. BD replies here with the details and a new due date — no new revision.'
            : waitingBd
              ? 'Closes this request and the open question: BD told you the details outside the portal, so note how below. No delay reason is needed while R&D was waiting for BD.'
              : 'Closes this request: BD gets your answer and can prepare the quotation.'}
        </p>
        <SheetSection icon="chat" title={asking ? 'Your question to BD' : 'Your Response'}>
          <label style={sheetLabel}>{asking ? <>Details R&amp;D needs <Req /></> : <>Response remarks <Req /></>}</label>
          <textarea autoFocus style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder={asking ? 'e.g. Axle load and track gauge are missing — please add them' : 'Answer, feasibility notes, deviations…'} />
          {!asking && lateNow && (
            <>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Reason for delay <Req /> <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(was due {formatDate(request.due_date)})</span></label>
              <textarea style={{ ...sheetInput, minHeight: 56, resize: 'vertical', borderColor: 'rgba(220,38,38,0.35)' }} value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Why this couldn't be answered by the due date" />
            </>
          )}
        </SheetSection>
        {!asking && waitingBd && (
          <SheetSection icon="chat" title="What BD told R&D">
            <label style={sheetLabel}>How did BD give the details <Req /></label>
            <div data-tour="rnd-respond-bd-channel" role="radiogroup" aria-label="How BD gave the details" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              {BD_TOLD_CHANNELS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={toldChannel === c} onClick={() => { setToldChannel(c); setError('') }} style={segmentBtnStyle(toldChannel === c)}>{QUERY_CHANNEL_LABEL[c]}</button>
              ))}
            </div>
            <label style={{ ...sheetLabel, marginTop: 14 }}>What BD told <Req /></label>
            <textarea maxLength={2000} style={{ ...sheetInput, minHeight: 56, resize: 'vertical' }} value={toldNote} onChange={(e) => setToldNote(e.target.value)}
              placeholder="e.g. Axle load 22.5 t and gauge 1676 mm, confirmed by the BD owner on the phone" />
          </SheetSection>
        )}
        {!asking && <p style={sheetHint}>The BD owner is notified of your response.</p>}
      </div>
    </FormSheet>
  )

  if (buttonOnly) return <>{canAnswer && renderButton ? renderButton(() => { setError(''); setOpen(true) }) : respondButton}{respondSheet}</>

  const thread = (request.queries || []).map((q, i) => {
    const answered = !!(q.answer || q.answered_at)
    const byRnd = q.answered_side === 'rnd'
    return (
      <div key={q.id ?? i} data-tour="rnd-request-query" style={{ marginTop: 10 }}>
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)' }}>
          <p style={sectionLabel}>R&amp;D asked for more details — {q.asked_by || 'R&D'} · {formatDateTime(q.asked_at)}</p>
          <p style={{ fontSize: 12.5, color: '#1f1108', margin: 0, whiteSpace: 'pre-wrap' }}>{q.remarks}</p>
          {!answered && request.status === 'open' && <p style={{ fontSize: 11.5, color: '#6d28d9', margin: '4px 0 0' }}>Waiting for BD&apos;s reply</p>}
        </div>
        {answered && (
          <div style={{ marginTop: 6, marginLeft: 18, padding: '8px 10px', borderRadius: 8, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)' }}>
            <p style={sectionLabel}>
              {byRnd ? 'What BD told R&D' : 'BD replied'} — {q.answered_by || (byRnd ? 'R&D' : 'BD')} · {formatDateTime(q.answered_at)}
              {q.answer_channel ? ` · by ${QUERY_CHANNEL_LABEL[q.answer_channel] || q.answer_channel}` : ''}
              {byRnd ? ' · noted by R&D' : ''}
            </p>
            {q.answer && <p style={{ fontSize: 12.5, color: '#1f1108', margin: 0, whiteSpace: 'pre-wrap' }}>{q.answer}</p>}
            {q.due_date_after && (
              <p style={{ fontSize: 11.5, color: '#57534e', margin: '4px 0 0' }}>
                R&amp;D due date: {q.due_date_before ? <>{formatDate(q.due_date_before)} → </> : null}<strong style={{ color: '#1f1108' }}>{formatDate(q.due_date_after)}</strong>
              </p>
            )}
            {(q.answer_documents || []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {(q.answer_documents || []).map((d) => (
                  <button key={d.id} type="button" onClick={() => onOpenDoc(d)} title="Open document"
                    style={{ ...chipBtnStyle(), borderColor: 'rgba(22,163,74,0.25)', background: 'rgba(22,163,74,0.08)', color: '#15803d' }}>
                    📄 {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  })

  if (threadOnly) return <div>{thread}</div>

  return (
    <div data-tour="rnd-request-block" style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)', background: 'rgba(255,255,255,0.45)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>
          Assigned to <strong style={{ color: '#1f1108' }}>{request.assigned_to_id ? (request.assigned_to || 'Unknown') : 'R&D team'}</strong>
          {waitingBd
            ? <>{' · '}due date <strong style={{ color: '#6d28d9' }}>paused</strong> <span style={{ color: '#a8a29e' }}>(was {formatDate(request.due_date)})</span></>
            : <>{' · '}due <strong style={{ color: request.is_late && request.status === 'open' ? '#DC2626' : '#1f1108' }}>{formatDate(request.due_date)}</strong></>}
        </p>
        <span style={pillStyle(badge.hex)}>
          {badge.label}
        </span>
      </div>

      {request.crm_remarks && (
        <div style={{ marginTop: 8 }}>
          <p style={sectionLabel}>CRM remark{request.requested_by ? ` — ${request.requested_by}` : ''}</p>
          <p style={{ fontSize: 12.5, color: '#1f1108', margin: 0, whiteSpace: 'pre-wrap' }}>{request.crm_remarks}</p>
        </div>
      )}

      {thread}

      {request.status === 'responded' && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(0,0,0,0.1)' }}>
          <p style={sectionLabel}>R&amp;D response — {request.responded_by || 'Unknown'} · {formatDateTime(request.responded_at)}</p>
          {request.response_remarks && <p style={{ fontSize: 12.5, color: '#1f1108', margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{request.response_remarks}</p>}
          {request.delay_reason && (
            <div style={{ fontSize: 12.5, color: '#92400E', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, padding: '6px 10px', margin: '0 0 6px' }}>
              <strong>Reason for delay:</strong> {request.delay_reason}
            </div>
          )}
          {request.response_documents.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {request.response_documents.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenDoc(d)}
                  title="Open document"
                  style={{ ...chipBtnStyle(), borderColor: 'rgba(22,163,74,0.25)', background: 'rgba(22,163,74,0.08)', color: '#15803d' }}
                >
                  📄 {d.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {request.status === 'closed' && (
        <div data-tour="rnd-request-closed" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(0,0,0,0.1)' }}>
          <p style={sectionLabel}>Closed by R&amp;D without a response — {request.responded_by || 'Unknown'} · {formatDateTime(request.responded_at)}</p>
          {request.response_remarks && <p style={{ fontSize: 12.5, color: '#1f1108', margin: 0, whiteSpace: 'pre-wrap' }}>{request.response_remarks}</p>}
        </div>
      )}

      {respondButton && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'flex-end' }}>
          {respondButton}
        </div>
      )}

      {respondSheet}
    </div>
  )
}
