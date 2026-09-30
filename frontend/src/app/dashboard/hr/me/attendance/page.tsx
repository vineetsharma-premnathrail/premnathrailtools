'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrAttendanceDay, HrAttendanceMonth, HrAttendanceRegularization, HrAttendanceToday } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import AttendanceCalendar, { AttendanceLegend, MonthPicker } from '@/components/hr/attendance/AttendanceCalendar'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#64748B' }
const ATT_LABELS: Record<string, string> = {
  present: 'Present', absent: 'Absent', half_day: 'Half day', on_leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty', work_from_home: 'Work from home', unmarked: 'Not marked',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const primaryBtn: React.CSSProperties = {
  padding: '11px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
  color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}

function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

export default function MyAttendancePage() {
  // Self-service: any logged-in user.
  const { user, isLoading } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [today, setToday] = useState<HrAttendanceToday | null>(null)
  const [monthData, setMonthData] = useState<HrAttendanceMonth | null>(null)
  const [regs, setRegs] = useState<HrAttendanceRegularization[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [showReg, setShowReg] = useState(false)
  const [regDate, setRegDate] = useState('')
  const [regStatus, setRegStatus] = useState('present')
  const [regIn, setRegIn] = useState('')
  const [regOut, setRegOut] = useState('')
  const [regReason, setRegReason] = useState('')
  const [regSaving, setRegSaving] = useState(false)
  const [regError, setRegError] = useState<string[]>([])
  const [cancelTarget, setCancelTarget] = useState<HrAttendanceRegularization | null>(null)

  const loadToday = useCallback(() => hrApi.getMyAttendanceToday().then(setToday), [])
  const loadMonth = useCallback(() => hrApi.getMyAttendanceMonth(year, month).then(setMonthData), [year, month])
  const loadRegs = useCallback(() => hrApi.listMyRegularizations().then(setRegs), [])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([loadToday(), loadMonth(), loadRegs()])
      .catch((err) => setError(extractErrorMessages(err, 'Could not load your attendance.')))
      .finally(() => setLoading(false))
  }, [user, loadToday, loadMonth, loadRegs])

  const punch = async (kind: 'in' | 'out') => {
    setBusy(true); setError([]); setNotice('')
    try {
      const res: HrAttendanceToday = kind === 'in' ? await hrApi.checkIn() : await hrApi.checkOut()
      setToday(res)
      setNotice(kind === 'in' ? `Checked in at ${res.day.check_in_time}.` : `Checked out at ${res.day.check_out_time}.`)
      loadMonth().catch(() => undefined)
    } catch (err) {
      setError(extractErrorMessages(err, kind === 'in' ? 'Check-in failed.' : 'Check-out failed.'))
    } finally {
      setBusy(false)
    }
  }

  const openReg = (d?: HrAttendanceDay) => {
    setRegError([])
    setRegDate(d?.date || '')
    setRegStatus('present')
    setRegIn(d?.check_in_time || '')
    setRegOut(d?.check_out_time || '')
    setRegReason('')
    setShowReg(true)
  }

  const submitReg = async () => {
    const missing: string[] = []
    if (!regDate) missing.push('Pick the date to correct.')
    if (!regReason.trim()) missing.push('Explain what happened (e.g. forgot to check in, client visit).')
    if ((regStatus === 'present' || regStatus === 'half_day') && !regIn) missing.push('Enter the time you actually checked in.')
    if (missing.length) { setRegError(missing); return }
    setRegSaving(true); setRegError([])
    try {
      const r = await hrApi.requestRegularization({
        attendance_date: regDate, requested_status: regStatus, check_in: regIn || null, check_out: regOut || null, reason: regReason.trim(),
      })
      setShowReg(false)
      setNotice(`${r.request_no} was sent to ${r.approver_name || 'HR'} for approval.`)
      loadRegs().catch(() => undefined)
    } catch (err) {
      setRegError(extractErrorMessages(err, 'The correction request could not be submitted.'))
    } finally {
      setRegSaving(false)
    }
  }

  const doCancel = async () => {
    if (!cancelTarget) return
    const t = cancelTarget
    setCancelTarget(null)
    try {
      await hrApi.cancelRegularization(t.id)
      setNotice(`${t.request_no} was cancelled.`)
      loadRegs().catch(() => undefined)
    } catch (err) {
      setError(extractErrorMessages(err, 'The request could not be cancelled.'))
    }
  }

  if (isLoading || !user) return null

  const td0 = today?.day
  const todayIso = today?.date || ''

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>My Attendance</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Check in and out, see your month, and ask for a correction if a day is wrong.</p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => openReg()}>Request correction</button>
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>
          {notice}
        </div>
      )}

      <div style={{ ...sectionStyle, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
        {loading && !today ? (
          <span style={{ fontSize: 13, color: TEXT.muted }}>Loading today…</span>
        ) : today && td0 ? (
          <>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Today · {dmy(today.date)}</p>
              <div style={{ fontSize: 20, fontWeight: 800, color: TEXT.heading }}>
                {ATT_LABELS[td0.status || ''] || 'Not marked'}
                {td0.holiday_name && <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.muted }}> · {td0.holiday_name}</span>}
              </div>
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
                {today.shift
                  ? `${today.shift.name}: ${today.shift.start_time}–${today.shift.end_time} (${today.shift.grace_minutes} min grace)`
                  : 'No shift assigned — late marks are not calculated. HR sets your shift in your employee profile.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 28 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Check-in</p>
                <p style={{ fontSize: 20, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{td0.check_in_time || '--:--'}</p>
                {td0.late_minutes != null && td0.check_in_time && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: td0.late_minutes > 0 ? '#DC26261a' : '#16A34A1a', color: td0.late_minutes > 0 ? '#DC2626' : '#16A34A' }}>
                    {td0.late_minutes > 0 ? `Late by ${td0.late_minutes} min` : 'On time'}
                  </span>
                )}
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Check-out</p>
                <p style={{ fontSize: 20, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{td0.check_out_time || '--:--'}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {today.on_leave ? (
                <span style={{ fontSize: 13, color: TEXT.muted }}>You&apos;re on approved leave today.</span>
              ) : today.can_check_in ? (
                <button type="button" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={() => punch('in')}>{busy ? 'Saving…' : 'Check in'}</button>
              ) : today.can_check_out ? (
                <button type="button" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={() => punch('out')}>{busy ? 'Saving…' : 'Check out'}</button>
              ) : td0.check_out_time ? (
                <span style={{ fontSize: 13, color: '#16A34A', fontWeight: 600 }}>Done for today</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {showReg && (
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Request an attendance correction</h3>
          {regError.length > 0 && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {regError.join(' ')}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Date *</label>
              <DateField value={regDate} onChange={setRegDate} />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Correct status *</label>
              <select style={inputStyle} value={regStatus} onChange={(e) => setRegStatus(e.target.value)}>
                <option value="present">Present</option>
                <option value="half_day">Half day</option>
                <option value="on_duty">On duty (outside office)</option>
                <option value="work_from_home">Work from home</option>
              </select>
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>Check-in{regStatus === 'present' || regStatus === 'half_day' ? ' *' : ''}</label>
              <input type="time" style={inputStyle} value={regIn} onChange={(e) => setRegIn(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>Check-out</label>
              <input type="time" style={inputStyle} value={regOut} onChange={(e) => setRegOut(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 260px', maxWidth: 480 }}>
              <label style={labelStyle}>Reason *</label>
              <input style={inputStyle} value={regReason} onChange={(e) => setRegReason(e.target.value)} placeholder="e.g. Forgot to check in; was at vendor site" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>Corrections can be requested for the last 60 days. Your reporting manager (or HR) approves them.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={secondaryBtnStyle} onClick={() => setShowReg(false)}>Cancel</button>
            <button type="button" disabled={regSaving} style={{ ...primaryBtn, opacity: regSaving ? 0.6 : 1 }} onClick={submitReg}>{regSaving ? 'Submitting…' : 'Submit request'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
        <AttendanceLegend counts={monthData?.counts} />
      </div>
      <div style={{ marginBottom: 8 }}>
        {monthData ? (
          <AttendanceCalendar
            year={year}
            month={month}
            days={monthData.days}
            onDayClick={(d) => { if (d.date <= todayIso && d.source !== 'leave') openReg(d) }}
          />
        ) : (
          <div style={{ ...sectionStyle, fontSize: 13, color: TEXT.muted }}>Loading month…</div>
        )}
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 20px' }}>Click a past day to ask for a correction.</p>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>My correction requests</h3>
      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              {['Request', 'Date', 'Asked for', 'Times', 'Reason', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : regs.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No correction requests yet.</td></tr>
            ) : regs.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>{r.request_no}</td>
                <td style={td}>{dmy(r.attendance_date)}</td>
                <td style={td}>{ATT_LABELS[r.requested_status] || r.requested_status}</td>
                <td style={td}>{r.check_in_time || '--'} – {r.check_out_time || '--'}</td>
                <td style={{ ...td, maxWidth: 260 }}>{r.reason}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                  {r.decision_remarks && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 4 }}>“{r.decision_remarks}”</div>}
                </td>
                <td style={td}>
                  {r.can_cancel && <span onClick={() => setCancelTarget(r)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Cancel</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this correction request?"
        message={cancelTarget ? `${cancelTarget.request_no} for ${dmy(cancelTarget.attendance_date)} will be withdrawn.` : ''}
        confirmLabel="Withdraw request"
        cancelLabel="Keep it"
        danger
        onConfirm={doCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
