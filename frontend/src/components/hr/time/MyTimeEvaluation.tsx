'use client'

import { useCallback, useEffect, useState } from 'react'
import { hrTimeApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { MonthPicker } from '@/components/hr/attendance/AttendanceCalendar'
import TimeDaysTable from './TimeDaysTable'
import { TimeDay, TimeEmployeeMonth, hhmm } from '@/components/hr/safety/types'

const card: React.CSSProperties = {
  borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '12px 14px',
}

/** My HR › Attendance: my time evaluation (worked / short / late / OT) and
 *  overtime claims, which go to my reporting manager for approval. */
export default function MyTimeEvaluation() {
  const { can } = useCan()
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [data, setData] = useState<TimeEmployeeMonth | null>(null)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [claim, setClaimDay] = useState<TimeDay | null>(null)
  const [otReason, setOtReason] = useState('')
  const setClaim = (d: TimeDay | null) => { setOtReason(''); setClaimDay(d) }
  // Claiming overtime is self-service create (backend require_me_create).
  const canClaim = can('hr', 'me', 'create')

  const load = useCallback(() => {
    hrTimeApi.me({ year: ym.y, month: ym.m }).then(setData).catch((err) => setError(extractErrorMessages(err, 'Could not load your time evaluation.')))
  }, [ym])
  useEffect(() => { load() }, [load])

  const doClaim = async (reason: string) => {
    const d = claim
    setClaim(null)
    if (!d) return
    if (reason.trim().length < 3) { setError(['Say what the overtime was for (at least a few words) so your manager can approve it.']); return }
    setError([])
    try {
      const ot = await hrTimeApi.claimOvertime({ work_date: d.date, reason: reason.trim() })
      setNotice(`${ot.request_no} sent to your reporting manager for ${hhmm(ot.claimed_minutes)} h overtime.`)
      load()
    } catch (err) { setError(extractErrorMessages(err, 'The overtime claim could not be sent.')) }
  }

  const t = data?.totals
  const tiles: [string, string][] = t ? [
    ['Worked', hhmm(t.worked_minutes)], ['Planned', hhmm(t.planned_minutes)], ['Short', `${hhmm(t.short_minutes)} (${t.short_days} d)`],
    ['Late', `${t.late_days} day(s)`], ['Early leaving', `${t.early_days} day(s)`],
    ['OT worked', hhmm(t.ot_minutes)], ['OT approved', hhmm(t.ot_approved_minutes)], ['OT pending', hhmm(t.ot_pending_minutes)],
  ] : []

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Time evaluation &amp; overtime</h3>
          {data && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>
            Overtime = work beyond {hhmm(data.rules.ot_daily_threshold_minutes)} h a day or {hhmm(data.rules.ot_weekly_threshold_minutes)} h a week (Factories Act s.59), after a {data.rules.rest_interval_minutes}-minute rest interval. Claim it here; only approved hours go to payroll.
          </p>}
        </div>
        <MonthPicker year={ym.y} month={ym.m} onChange={(y, m) => setYm({ y, m })} />
      </div>
      {error.length > 0 && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error.join(' ')}</div>}
      {notice && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{notice}</div>}
      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
          {tiles.map(([k, v]) => (
            <div key={k} style={card}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted }}>{k}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {data && <TimeDaysTable days={data.days} onClaim={canClaim ? setClaim : undefined} />}
      {claim && (
        <FormSheet width={580} icon="clock" title={`Claim ${hhmm(claim.ot_minutes)} h overtime`}
          subtitle={`For ${claim.date.split('-').reverse().join('-')}. Your reporting manager approves it; only approved hours go to payroll.`}
          onClose={() => setClaim(null)} busy={false}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setClaim(null)}>Cancel</button>
            <button type="button" style={sheetBtn('primary', SHEET.BLUE, !otReason.trim())} disabled={!otReason.trim()} onClick={() => doClaim(otReason)}><SheetIcon name="send" size={16} />Send claim</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetSection icon="chat" title="What You Worked On">
              <label style={sheetLabel}>Reason <Req /></label>
              <textarea autoFocus style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={otReason} onChange={(e) => setOtReason(e.target.value)} placeholder="e.g. Finishing the RDSO inspection lot before dispatch" />
              <p style={sheetHint}>Say what the overtime was for (at least a few words) so your manager can approve it.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
