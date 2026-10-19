'use client'

import { useEffect, useRef, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrLeavePreview, HrLeaveType } from '@/types'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'

function fmtDays(v: string | number | null | undefined) {
  const n = Number(v || 0)
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? 'day' : 'days'}`
}

function ddmmyyyy(iso: string) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : ''
}

// Apply-for-leave form with a live day count from the server (weekly offs and
// plant holidays excluded, half days, balance and every policy check). Used by
// My Leave, and by HR to apply on an employee's behalf (`userId`).
export default function LeaveApplyForm({
  types,
  userId,
  onSubmitted,
  onCancel,
  employeePicker,
  title,
  subtitle,
}: {
  types: HrLeaveType[]
  userId?: number
  onSubmitted: (requestNo: string) => void
  onCancel?: () => void
  /** HR "apply on behalf": the employee picker, shown as the first section. */
  employeePicker?: React.ReactNode
  title?: string
  subtitle?: string
}) {
  const [pickedTypeId, setLeaveTypeId] = useState<string>('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [pickedFromSession, setFromSession] = useState('full')
  const [toSession, setToSession] = useState('full')
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [rawPreview, setPreview] = useState<HrLeavePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // Derived instead of synced in effects: default to the first leave type, and
  // a multi-day leave can't start with only the first half.
  const leaveTypeId = pickedTypeId || (types[0] ? String(types[0].id) : '')
  const lt = types.find((t) => String(t.id) === leaveTypeId)
  const single = !!fromDate && (!toDate || toDate === fromDate)
  const fromSession = !single && pickedFromSession === 'first_half' ? 'full' : pickedFromSession
  const preview = leaveTypeId && fromDate ? rawPreview : null

  useEffect(() => {
    if (!leaveTypeId || !fromDate) return
    const to = toDate || fromDate
    const handle = setTimeout(() => {
      setPreviewing(true)
      hrApi.previewLeaveRequest({
        leave_type_id: Number(leaveTypeId), from_date: fromDate, to_date: to,
        from_session: fromSession, to_session: to === fromDate ? fromSession : toSession,
        has_attachment: !!file, user_id: userId ?? null,
      })
        .then((d) => { setPreview(d); setError([]) })
        .catch((err) => { setPreview(null); setError(extractErrorMessages(err, 'Could not work out the leave days.')) })
        .finally(() => setPreviewing(false))
    }, 350)
    return () => clearTimeout(handle)
  }, [leaveTypeId, fromDate, toDate, fromSession, toSession, file, userId])

  const submit = async () => {
    setError([])
    const missing: string[] = []
    if (!leaveTypeId) missing.push('Pick a leave type.')
    if (!fromDate) missing.push('Pick the first day of leave.')
    if (!reason.trim()) missing.push('Give a short reason for the leave.')
    if (missing.length) { setError(missing); return }
    const to = toDate || fromDate
    setSubmitting(true)
    try {
      const res = await hrApi.applyLeave({
        leave_type_id: Number(leaveTypeId), from_date: fromDate, to_date: to,
        from_session: fromSession, to_session: to === fromDate ? fromSession : toSession,
        reason: reason.trim(), contact_during_leave: contact.trim(), user_id: userId ?? null,
      }, file)
      setFromDate(''); setToDate(''); setFromSession('full'); setToSession('full'); setReason(''); setContact(''); setFile(null); setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      onSubmitted(res.request_no)
    } catch (err) {
      setError(extractErrorMessages(err, 'The leave request could not be submitted.'))
    } finally {
      setSubmitting(false)
    }
  }

  const skipped = preview?.breakdown.filter((d) => d.kind !== 'working') || []
  const canSubmit = !!preview && preview.errors.length === 0 && !submitting && !previewing && !!reason.trim()

  const close = onCancel ?? (() => {})
  return (
    <FormSheet tour="hr-leave-form-sheet" icon="calendar" title={title || 'Apply for leave'}
      subtitle={subtitle || 'Weekly offs and plant holidays are not counted. The request goes to the approver shown on the right.'}
      onClose={close} busy={submitting}
      footer={<>
        {onCancel && <button type="button" style={sheetBtn('secondary', SHEET.INK, submitting)} disabled={submitting} onClick={onCancel}>Cancel</button>}
        <button type="button" data-tour="hr-leave-form-submit" disabled={!canSubmit} onClick={submit} style={sheetBtn('primary', SHEET.BLUE, !canSubmit)}>
          <SheetIcon name="send" size={16} />{submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </>}>
      <SheetColumns
        left={<>
          {error.length > 0 && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {error.join(' ')}
            </div>
          )}
          {employeePicker && <SheetSection icon="user" title="Employee">{employeePicker}</SheetSection>}
          <SheetSection icon="calendar" title="Leave">
            <div style={{ maxWidth: 320, marginBottom: 12 }}>
              <label style={sheetLabel}>Leave type <Req /></label>
              <select data-tour="hr-leave-form-type" style={sheetInput} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code}){t.is_paid ? '' : ' — unpaid'}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="hr-leave-form-from" style={{ flex: '0 1 160px', minWidth: 150 }}>
                <label style={sheetLabel}>From <Req /></label>
                <DateField value={fromDate} onChange={(v) => { setFromDate(v); if (toDate && v > toDate) setToDate(v) }} />
              </div>
              <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                <label style={sheetLabel}>{single ? 'Session' : 'Start session'}</label>
                <select data-tour="hr-leave-form-from-session" style={sheetInput} value={fromSession} onChange={(e) => setFromSession(e.target.value)}>
                  <option value="full">Full day</option>
                  {lt?.allow_half_day !== false && (single ? <option value="first_half">First half</option> : null)}
                  {lt?.allow_half_day !== false && <option value="second_half">{single ? 'Second half' : 'From second half'}</option>}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <div data-tour="hr-leave-form-to" style={{ flex: '0 1 160px', minWidth: 150 }}>
                <label style={sheetLabel}>To</label>
                <DateField value={toDate} onChange={setToDate} />
              </div>
              {!single && (
                <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                  <label style={sheetLabel}>End session</label>
                  <select data-tour="hr-leave-form-to-session" style={sheetInput} value={toSession} onChange={(e) => setToSession(e.target.value)}>
                    <option value="full">Full day</option>
                    {lt?.allow_half_day !== false && <option value="first_half">Till first half</option>}
                  </select>
                </div>
              )}
            </div>
          </SheetSection>
          <SheetSection icon="chat" title="Details">
            <label style={sheetLabel}>Reason <Req /></label>
            <textarea data-tour="hr-leave-form-reason" style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family function in hometown" />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Contact during leave <Optional /></label>
            <input data-tour="hr-leave-form-contact" style={sheetInput} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone / email" />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="clock" title="Days & Balance">
            <div data-tour="hr-leave-form-preview" style={{ padding: '12px 14px', borderRadius: 12, background: '#fff', border: `1px solid ${SHEET.LINE}` }}>
              {!fromDate ? (
                <span style={{ fontSize: 13, color: SHEET.MUTED }}>Pick the dates to see the day count, the balance and the approver.</span>
              ) : previewing && !preview ? (
                <span style={{ fontSize: 13, color: SHEET.MUTED }}>Working out the days…</span>
              ) : preview ? (
                <>
                  <div style={{ fontSize: 22, fontWeight: 800, color: SHEET.INK }}>{fmtDays(preview.days)}{previewing && <span style={{ fontSize: 12, fontWeight: 400, color: SHEET.MUTED, marginLeft: 8 }}>updating…</span>}</div>
                  {preview.balance_checked && preview.balance_available != null && (
                    <div style={{ fontSize: 13, color: SHEET.BODY, marginTop: 4 }}>
                      Balance {fmtDays(preview.balance_available)}
                      {Number(preview.balance_pending) > 0 ? ` (${fmtDays(preview.balance_pending)} in pending requests)` : ''}
                    </div>
                  )}
                  {!preview.balance_checked && <div style={{ fontSize: 13, color: SHEET.BODY, marginTop: 4 }}>No balance needed (unpaid leave)</div>}
                  <div style={{ fontSize: 13, color: SHEET.MUTED, marginTop: 4 }}>Approver: {preview.approver_name || 'HR (no reporting manager set)'}</div>
                  {skipped.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 12, color: SHEET.MUTED }}>Not counted:</span>
                      {skipped.map((d) => (
                        <span key={d.date} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: d.kind === 'holiday' ? '#0EA5E91a' : '#94A3B81a', color: d.kind === 'holiday' ? '#0369A1' : '#475569' }}>
                          {ddmmyyyy(d.date)} {d.kind === 'holiday' ? d.holiday_name : 'weekly off'}
                        </span>
                      ))}
                    </div>
                  )}
                  {preview.errors.length > 0 && (
                    <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: '#b91c1c', fontSize: 13 }}>
                      {preview.errors.map((e) => <li key={e} style={{ marginBottom: 3 }}>{e}</li>)}
                    </ul>
                  )}
                </>
              ) : null}
            </div>
          </SheetSection>
          <SheetSection icon="clip" title="Supporting Document" extra={preview?.document_required ? <Req /> : <Optional />}>
            <input ref={fileRef} data-tour="hr-leave-form-document" type="file" accept="image/*,.pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} style={sheetInput} />
            {lt?.requires_document_after_days != null && (
              <p style={sheetHint}>Required for {lt.name} longer than {fmtDays(lt.requires_document_after_days)} (e.g. a medical certificate).</p>
            )}
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}
