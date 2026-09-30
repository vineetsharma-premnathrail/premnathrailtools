'use client'

import { useEffect, useRef, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrLeavePreview, HrLeaveType } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS, GRADIENTS } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

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
}: {
  types: HrLeaveType[]
  userId?: number
  onSubmitted: (requestNo: string) => void
  onCancel?: () => void
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

  return (
    <div style={sectionStyle}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Apply for leave</h3>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
          <label style={labelStyle}>Leave type *</label>
          <select style={inputStyle} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code}){t.is_paid ? '' : ' — unpaid'}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 160px', minWidth: 150 }}>
          <label style={labelStyle}>From *</label>
          <DateField value={fromDate} onChange={(v) => { setFromDate(v); if (toDate && v > toDate) setToDate(v) }} />
        </div>
        <div style={{ flex: '0 1 150px', minWidth: 140 }}>
          <label style={labelStyle}>{single ? 'Session' : 'Start session'}</label>
          <select style={inputStyle} value={fromSession} onChange={(e) => setFromSession(e.target.value)}>
            <option value="full">Full day</option>
            {lt?.allow_half_day !== false && (single ? <option value="first_half">First half</option> : null)}
            {lt?.allow_half_day !== false && <option value="second_half">{single ? 'Second half' : 'From second half'}</option>}
          </select>
        </div>
        <div style={{ flex: '0 1 160px', minWidth: 150 }}>
          <label style={labelStyle}>To</label>
          <DateField value={toDate} onChange={setToDate} />
        </div>
        {!single && (
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>End session</label>
            <select style={inputStyle} value={toSession} onChange={(e) => setToSession(e.target.value)}>
              <option value="full">Full day</option>
              {lt?.allow_half_day !== false && <option value="first_half">Till first half</option>}
            </select>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: '1 1 320px', maxWidth: 560 }}>
          <label style={labelStyle}>Reason *</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family function in hometown" />
        </div>
        <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
          <label style={labelStyle}>Contact during leave</label>
          <input style={inputStyle} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone / email (optional)" />
        </div>
      </div>

      <div style={{ marginBottom: 14, maxWidth: 420 }}>
        <label style={labelStyle}>Supporting document{preview?.document_required ? ' *' : ''}</label>
        <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />
        {lt?.requires_document_after_days != null && (
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }}>
            Required for {lt.name} longer than {fmtDays(lt.requires_document_after_days)} (e.g. a medical certificate).
          </p>
        )}
      </div>

      {fromDate && (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.55)', border: `1px solid ${BORDER.light}`, marginBottom: 14 }}>
          {previewing && !preview ? (
            <span style={{ fontSize: 13, color: TEXT.muted }}>Working out the days…</span>
          ) : preview ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'baseline' }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: TEXT.heading }}>{fmtDays(preview.days)}</span>
                {preview.balance_checked && preview.balance_available != null && (
                  <span style={{ fontSize: 13, color: TEXT.secondary }}>
                    Balance {fmtDays(preview.balance_available)}
                    {Number(preview.balance_pending) > 0 ? ` (${fmtDays(preview.balance_pending)} in pending requests)` : ''}
                  </span>
                )}
                {!preview.balance_checked && <span style={{ fontSize: 13, color: TEXT.secondary }}>No balance needed (unpaid leave)</span>}
                <span style={{ fontSize: 13, color: TEXT.muted }}>
                  Approver: {preview.approver_name || 'HR (no reporting manager set)'}
                </span>
                {previewing && <span style={{ fontSize: 12, color: TEXT.muted }}>updating…</span>}
              </div>
              {skipped.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>Not counted:</span>
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
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" style={secondaryBtnStyle} onClick={onCancel}>Cancel</button>}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={{
            padding: '10px 22px', borderRadius: 12, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: canSubmit ? 1 : 0.55,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </div>
  )
}
