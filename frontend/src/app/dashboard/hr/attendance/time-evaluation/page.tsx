'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrApi, hrTimeApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import HrNav from '@/components/hr/HrNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { MonthPicker } from '@/components/hr/attendance/AttendanceCalendar'
import { primaryBtnStyle, secondaryBtnStyle, chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import TimeDaysTable from '@/components/hr/time/TimeDaysTable'
import { OvertimeRequest, TimeEmployeeMonth, TimeMonthItem, TimeRulesInfo, downloadBlob, hhmm } from '@/components/hr/safety/types'

const OT_STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const OT_STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#78716C' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)',
  fontSize: 13, outline: 'none', color: TEXT.body,
}
const wrap: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export default function TimeEvaluationPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const { can } = useCan()
  const router = useRouter()
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [tab, setTab] = useState<'month' | 'overtime'>('month')
  const [branchId, setBranchId] = useState('')
  const [search, setSearch] = useState('')
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [items, setItems] = useState<TimeMonthItem[]>([])
  const [rules, setRules] = useState<TimeRulesInfo | null>(null)
  const [ots, setOts] = useState<OvertimeRequest[]>([])
  const [otStatus, setOtStatus] = useState('pending')
  const [detail, setDetail] = useState<TimeEmployeeMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [confirmGen, setConfirmGen] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    hrApi.getAttendanceLookups().then((d: { branches: { id: number; name: string }[] }) => setBranches(d.branches || [])).catch(() => setBranches([]))
  }, [isAuthorized])

  const params = useCallback(() => {
    const p: Record<string, unknown> = { year: ym.y, month: ym.m }
    if (branchId) p.branch_id = Number(branchId)
    if (search.trim()) p.search = search.trim()
    return p
  }, [ym, branchId, search])

  const load = useCallback(() => {
    setLoading(true)
    setError([])
    if (tab === 'month') {
      hrTimeApi.month(params()).then((d) => { setItems(d.items || []); setRules(d.rules) })
        .catch((err) => setError(extractErrorMessages(err, 'Could not load the time evaluation.'))).finally(() => setLoading(false))
    } else {
      hrTimeApi.listOvertime({ year: ym.y, month: ym.m, ...(otStatus ? { status: otStatus } : {}) }).then(setOts)
        .catch((err) => setError(extractErrorMessages(err, 'Could not load overtime requests.'))).finally(() => setLoading(false))
    }
  }, [tab, params, ym, otStatus])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, load])

  const openDetail = async (it: TimeMonthItem) => {
    setError([])
    try { setDetail(await hrTimeApi.employee(it.user_id, { year: ym.y, month: ym.m })) } catch (err) { setError(extractErrorMessages(err, 'Could not load the employee’s days.')) }
  }

  const exportCsv = async () => {
    try { downloadBlob(await hrTimeApi.exportMonth(params()), `time_evaluation_${ym.y}_${String(ym.m).padStart(2, '0')}.csv`) } catch (err) { setError(extractErrorMessages(err, 'The export could not be downloaded.')) }
  }

  const generate = async () => {
    setConfirmGen(false)
    setError([])
    try {
      const r = await hrTimeApi.generateOvertime({ year: ym.y, month: ym.m, ...(branchId ? { branch_id: Number(branchId) } : {}) })
      setNotice(`${r.raised} overtime request(s) sent to reporting managers${r.skipped_existing ? `; ${r.skipped_existing} day(s) already had a request` : ''}.`)
      if (r.errors?.length) setError(r.errors)
      load()
    } catch (err) { setError(extractErrorMessages(err, 'Overtime requests could not be raised.')) }
  }

  const cancelOt = async (o: OvertimeRequest) => {
    try { await hrTimeApi.cancelOvertime(o.id); setNotice(`${o.request_no} cancelled.`); load() } catch (err) { setError(extractErrorMessages(err, `${o.request_no} could not be cancelled.`)) }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>HR &amp; Administration · Attendance</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Time evaluation &amp; overtime</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0, maxWidth: 760 }}>
            Worked, short, late and early hours from check-in / check-out against each employee&apos;s shift, and overtime under the Factories Act s.59
            {rules ? ` (beyond ${hhmm(rules.ot_daily_threshold_minutes)} h a day or ${hhmm(rules.ot_weekly_threshold_minutes)} h a week, after a ${rules.rest_interval_minutes}-minute rest interval)` : ''}.
            Only approved overtime goes into the ADP export; ADP pays it at double rate.
          </p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/hr/attendance')}>← Back</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['month', 'overtime'] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setDetail(null); setNotice('') }} style={chipBtnStyle(tab === t)}>
            {t === 'month' ? 'Monthly evaluation' : 'Overtime requests'}
          </button>
        ))}
        <MonthPicker year={ym.y} month={ym.m} onChange={(y, m) => { setYm({ y, m }); setDetail(null) }} />
        {tab === 'month' && (
          <>
            <Select style={{ ...inputStyle, flex: '0 1 200px' }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All plants</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <input style={{ ...inputStyle, flex: '1 1 200px', maxWidth: 280 }} placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {can('hr', 'attendance', 'export') && <button type="button" style={secondaryBtnStyle} onClick={exportCsv}>Export for ADP (CSV)</button>}
            {can('hr', 'attendance', 'edit') && <button type="button" style={primaryBtnStyle} onClick={() => setConfirmGen(true)}>Raise OT for approval</button>}
          </>
        )}
        {tab === 'overtime' && (
          <Select style={{ ...inputStyle, flex: '0 1 170px' }} value={otStatus} onChange={(e) => setOtStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(OT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}
      </div>

      {error.length > 0 && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error.join(' ')}</div>}
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{notice}</div>}

      {tab === 'month' && detail && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
              {detail.employee.user_name}{detail.employee.employee_code ? ` · ${detail.employee.employee_code}` : ''}{detail.employee.shift_name ? ` · ${detail.employee.shift_name}` : ' · no shift (standard day used)'}
            </h3>
            <button type="button" style={secondaryBtnStyle} onClick={() => setDetail(null)}>Close</button>
          </div>
          <TimeDaysTable days={detail.days} />
        </div>
      )}

      {tab === 'month' ? (
        <div style={wrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
            <thead><tr>{['Employee', 'Plant', 'Present', 'Absent', 'Worked', 'Planned', 'Short', 'Late', 'Early', 'OT worked', 'OT approved', 'OT pending', 'Not claimed', ''].map((h, i) => <th key={h} style={th}>{h}{i === 0 && <RowCount count={items.length} />}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={14} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
                : items.length === 0 ? <tr><td colSpan={14} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No employees match.</td></tr>
                  : items.map((it) => (
                    <tr key={it.user_id} onClick={() => openDetail(it)} style={{ cursor: 'pointer' }}>
                      <td style={td}><div style={{ fontWeight: 600, color: TEXT.heading }}>{it.user_name}</div><div style={{ fontSize: 11.5, color: TEXT.muted }}>{[it.employee_code, it.department_name].filter(Boolean).join(' · ')}</div></td>
                      <td style={td}>{it.branch_name || '—'}</td>
                      <td style={td}>{it.present_equivalent ?? '—'}</td>
                      <td style={td}>{it.absent ?? 0}{it.missing_check_out_days ? <div style={{ fontSize: 11, color: '#b91c1c' }}>{it.missing_check_out_days} no check-out</div> : null}</td>
                      <td style={td}>{hhmm(it.worked_minutes)}</td>
                      <td style={td}>{hhmm(it.planned_minutes)}</td>
                      <td style={{ ...td, color: it.short_minutes ? '#b91c1c' : TEXT.muted }}>{it.short_minutes ? `${hhmm(it.short_minutes)} (${it.short_days} d)` : '—'}</td>
                      <td style={{ ...td, color: it.late_days ? '#B45309' : TEXT.muted }}>{it.late_days ? `${it.late_days} d · ${it.late_minutes} min` : '—'}</td>
                      <td style={{ ...td, color: it.early_days ? '#B45309' : TEXT.muted }}>{it.early_days ? `${it.early_days} d` : '—'}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{it.ot_minutes ? hhmm(it.ot_minutes) : '—'}</td>
                      <td style={{ ...td, color: '#15803d', fontWeight: 700 }}>{it.ot_approved_minutes ? hhmm(it.ot_approved_minutes) : '—'}</td>
                      <td style={td}>{it.ot_pending_minutes ? hhmm(it.ot_pending_minutes) : '—'}</td>
                      <td style={td}>{it.ot_unclaimed_minutes ? hhmm(it.ot_unclaimed_minutes) : '—'}</td>
                      <td style={td} onClick={(e) => e.stopPropagation()}><span onClick={() => openDetail(it)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Days</span></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={wrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead><tr>{['Request', 'Employee', 'Date', 'Claimed', 'Approved', 'Now computed', 'Approver', 'Status', ''].map((h, i) => <th key={h} style={th}>{h}{i === 0 && <RowCount count={ots.length} />}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
                : ots.length === 0 ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No overtime requests for this month.</td></tr>
                  : ots.map((o) => (
                    <tr key={o.id}>
                      <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>{o.request_no}<div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{o.source === 'evaluation' ? 'Raised by HR' : 'Claimed by employee'}</div></td>
                      <td style={td}>{o.user_name}{o.employee_code ? ` · ${o.employee_code}` : ''}</td>
                      <td style={td}>{dmy(o.work_date)}</td>
                      <td style={td}>{hhmm(o.claimed_minutes)}</td>
                      <td style={td}>{o.approved_minutes != null && o.status === 'approved' ? hhmm(o.approved_minutes) : '—'}</td>
                      <td style={{ ...td, color: o.current_ot_minutes !== o.claimed_minutes ? '#B45309' : TEXT.body }}>{o.current_ot_minutes != null ? hhmm(o.current_ot_minutes) : '—'}</td>
                      <td style={td}>{o.decided_by_name || o.approver_name || '—'}</td>
                      <td style={td}><span style={pillStyle(OT_STATUS_HEX[o.status])}>{OT_STATUS_LABELS[o.status] || o.status}</span>{o.decision_remarks && <div style={{ fontSize: 11, color: TEXT.muted, whiteSpace: 'normal', maxWidth: 200 }}>{o.decision_remarks}</div>}</td>
                      <td style={td}>{o.can_cancel && <span onClick={() => cancelOt(o)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Cancel</span>}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmGen}
        title="Raise overtime for approval?"
        message="Every day this month with computed overtime and no request yet is sent to the employee's reporting manager for approval. Days already requested or rejected are skipped."
        confirmLabel="Raise requests"
        cancelLabel="Back"
        danger={false}
        onConfirm={generate}
        onCancel={() => setConfirmGen(false)}
      />
    </div>
  )
}
