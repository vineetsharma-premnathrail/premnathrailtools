'use client'

// BD answers a question R&D asked on a requirement it is working on (no new revision, same request).
// R&D's clock was paused while the question was open; the due date entered here is R&D's new one.

import { useState } from 'react'
import { crmApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { RndQueryChannel, RndRequest, RndRequestQuery } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import { segmentBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError, FileDropZone } from '@/components/shared/FormSheet'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const CHANNELS: { value: RndQueryChannel; label: string; placeholder: string }[] = [
  { value: 'portal', label: 'Portal', placeholder: 'The details R&D asked for — e.g. axle load 22.5 t, track gauge 1676 mm' },
  { value: 'phone', label: 'Phone', placeholder: 'Summary of what you told R&D on the call' },
  { value: 'email', label: 'Email', placeholder: 'Summary of what you emailed R&D, and when' },
  { value: 'meeting', label: 'Meeting', placeholder: 'Summary of what was agreed with R&D in the meeting' },
]

// Mounted only while open, so every opening starts fresh.
export default function RndReplySheet({ request, question, onClose, onReplied }: {
  request: RndRequest
  question: RndRequestQuery
  onClose: () => void
  onReplied: (updated: RndRequest) => void
}) {
  const [channel, setChannel] = useState<RndQueryChannel>('portal')
  const [answer, setAnswer] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const close = () => { if (!saving) onClose() }

  const submit = async () => {
    if (question.id == null) { setError('This question has no reference yet — reload the page and try again.'); return }
    if (answer.trim().length < 10) {
      setError(channel === 'portal'
        ? 'Write the details R&D asked for (at least 10 characters).'
        : `Write a short summary of what you gave R&D by ${channel === 'meeting' ? 'meeting' : channel} (at least 10 characters) so the record shows it.`)
      return
    }
    if (!dueDate) { setError("Set R&D's new due date — the date R&D must reply by now that you have answered."); return }
    if (dueDate < todayIso()) { setError("R&D's due date is in the past — pick today or a later date."); return }
    setSaving(true)
    setError('')
    try {
      const updated = await crmApi.answerRndQuery(request.id, question.id, { answer: answer.trim(), channel, due_date: dueDate, files })
      onReplied(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not send your reply to R&D. Check your connection and try again — what you typed is still here.'))
    } finally {
      setSaving(false)
    }
  }

  const placeholder = CHANNELS.find((c) => c.value === channel)?.placeholder

  return (
    <FormSheet width={600} icon="chat" title="Reply to R&D" onClose={close} busy={saving} tour="rnd-reply-sheet"
      subtitle={`R&D asked on ${formatDateTime(question.asked_at)} · currently due ${formatDate(request.due_date)}`}
      footer={<>
        <button type="button" onClick={close} disabled={saving} data-tour="rnd-reply-cancel" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} data-tour="rnd-reply-send" style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name="send" size={16} />{saving ? 'Sending…' : 'Send reply to R&D'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <div data-tour="rnd-reply-question" style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)', marginBottom: 18 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6d28d9', margin: '0 0 4px' }}>R&amp;D asked — {question.asked_by || 'R&D'}</p>
          <p style={{ fontSize: 13, color: SHEET.INK, margin: 0, whiteSpace: 'pre-wrap' }}>{question.remarks}</p>
        </div>

        <SheetSection icon="chat" title="Your answer">
          <label style={sheetLabel} id="rnd-reply-channel-label">How did you give the details <Req /></label>
          <div data-tour="rnd-reply-channel" role="radiogroup" aria-labelledby="rnd-reply-channel-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {CHANNELS.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={channel === c.value} onClick={() => { setChannel(c.value); setError('') }} style={segmentBtnStyle(channel === c.value)}>{c.label}</button>
            ))}
          </div>
          <div data-tour="rnd-reply-answer">
            <label style={sheetLabel} htmlFor="rnd-reply-answer">{channel === 'portal' ? 'Answer' : 'What you told R&D'} <Req /></label>
            <textarea id="rnd-reply-answer" autoFocus maxLength={4000} style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={placeholder} />
            <p style={sheetHint}>{channel === 'portal' ? 'R&D reads this on the same request — no new revision is made.' : 'R&D sees this note on the same request, so the record shows what was told off the portal.'}</p>
          </div>
        </SheetSection>

        <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
          <FileDropZone files={files} onChange={setFiles} tour="rnd-reply-files" />
        </SheetSection>

        <SheetSection icon="calendar" title="R&D due date">
          <div data-tour="rnd-reply-due" style={{ maxWidth: 200 }}>
            <label style={sheetLabel}>New due date for R&amp;D <Req /></label>
            <DateField value={dueDate} onChange={setDueDate} />
          </div>
          <p style={sheetHint}>R&amp;D&apos;s due date was on hold while it waited for you. This is the date R&amp;D must respond by now; it replaces {formatDate(request.due_date)}.</p>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
