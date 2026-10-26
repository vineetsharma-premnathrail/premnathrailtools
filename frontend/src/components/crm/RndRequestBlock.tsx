'use client'

import { useState } from 'react'
import { rndApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { RequirementMovementDoc, RndRequest } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { chipBtnStyle, pillStyle } from '@/components/shared/ui'

const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function rndRequestBadge(r: RndRequest): { label: string; hex: string } {
  if (r.status === 'superseded') return { label: 'Superseded by re-send', hex: '#78716c' }
  if (r.status === 'responded') return r.is_late ? { label: 'Responded late', hex: '#D97706' } : { label: 'Responded on time', hex: '#16A34A' }
  return r.is_late ? { label: 'Overdue', hex: '#DC2626' } : { label: 'Awaiting R&D', hex: '#2563EB' }
}

// One CRM → R&D ask inside a Requirement Movement card: who owns it, by when,
// CRM's remark, and R&D's answer. `canRespond` turns on the answer form (R&D side).
// `buttonOnly` renders just the respond button + its form, without the request
// card; `renderButton` lets the caller keep its own button (it gets `open`).
export default function RndRequestBlock({
  request, canRespond, onOpenDoc, onResponded, buttonOnly, renderButton,
}: {
  request: RndRequest
  canRespond?: boolean
  onOpenDoc: (doc: RequirementMovementDoc) => void
  onResponded?: (r: RndRequest) => void
  buttonOnly?: boolean
  renderButton?: (open: () => void) => React.ReactNode
}) {
  const [remarks, setRemarks] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const badge = rndRequestBadge(request)
  const lateNow = todayIso() > request.due_date

  const submit = async () => {
    if (!remarks.trim() && files.length === 0) { setError('Add response remarks or attach at least one response document.'); return }
    if (lateNow && !delayReason.trim()) { setError(`This response is late — it was due on ${formatDate(request.due_date)}. Enter the reason for the delay.`); return }
    setSaving(true)
    setError('')
    try {
      const updated = await rndApi.respondToRequest(request.id, { remarks: remarks.trim() || undefined, delay_reason: lateNow ? delayReason.trim() : undefined, files })
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
    <button type="button" data-tour="rnd-respond-form" onClick={() => { setError(''); setOpen(true) }} style={sheetBtn('primary', SHEET.BLUE)}>
      <SheetIcon name="send" size={15} />Respond to CRM
    </button>
  )
  const respondSheet = open && canAnswer && (
    <FormSheet width={600} icon="send" title="Respond to CRM" onClose={() => setOpen(false)} busy={saving}
      subtitle={`Requested by ${request.requested_by || 'CRM'} · due ${formatDate(request.due_date)}`}
      footer={<>
        <button type="button" onClick={() => setOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name="send" size={16} />{saving ? 'Submitting…' : 'Submit Response to CRM'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="chat" title="Your Response">
          <label style={sheetLabel}>Response remarks</label>
          <textarea autoFocus style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Answer, feasibility notes, deviations…" />
          {lateNow && (
            <>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Reason for delay <Req /> <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(was due {formatDate(request.due_date)})</span></label>
              <textarea style={{ ...sheetInput, minHeight: 56, resize: 'vertical', borderColor: 'rgba(220,38,38,0.35)' }} value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Why this couldn't be answered by the due date" />
            </>
          )}
        </SheetSection>
        <SheetSection icon="clip" title="Response documents">
          <FileDropZone files={files} onChange={setFiles} />
          <p style={sheetHint}>Give remarks, at least one document, or both. The BD owner is notified.</p>
        </SheetSection>
      </div>
    </FormSheet>
  )

  if (buttonOnly) return <>{canAnswer && renderButton ? renderButton(() => { setError(''); setOpen(true) }) : respondButton}{respondSheet}</>

  return (
    <div data-tour="rnd-request-block" style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)', background: 'rgba(255,255,255,0.45)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>
          Assigned to <strong style={{ color: '#1f1108' }}>{request.assigned_to_id ? (request.assigned_to || 'Unknown') : 'R&D team'}</strong>
          {' · '}due <strong style={{ color: request.is_late && request.status === 'open' ? '#DC2626' : '#1f1108' }}>{formatDate(request.due_date)}</strong>
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

      {respondButton && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'flex-end' }}>
          {respondButton}
        </div>
      )}

      {respondSheet}
    </div>
  )
}
