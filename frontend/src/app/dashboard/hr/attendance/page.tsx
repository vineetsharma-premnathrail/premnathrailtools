'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import {
  HrAttendanceImportResult, HrAttendanceLookups, HrAttendanceMonth, HrAttendanceRegister, HrAttendanceRegisterRow,
  HrAttendanceRegularization, HrAttendanceSummaryRow,
} from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import AttendanceCalendar, { AttendanceLegend, MonthPicker, MONTH_NAMES } from '@/components/hr/attendance/AttendanceCalendar'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'

const ATT_LABELS: Record<string, string> = {
  present: 'Present', absent: 'Absent', half_day: 'Half day', on_leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty', work_from_home: 'Work from home', unmarked: 'Not marked',
}
const ATT_HEX: Record<string, string> = {
  present: '#16A34A', absent: '#DC2626', half_day: '#F59E0B', on_leave: '#7C3AED', holiday: '#0EA5E9',
  weekly_off: '#64748B', on_duty: '#2563EB', work_from_home: '#0D9488', unmarked: '#94A3B8',
}
const SOURCE_LABELS: Record<string, string> = { manual: 'HR', self: 'Self', regularization: 'Correction', leave: 'Leave', import: 'Import' }
const REG_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const REG_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#64748B' }
const MARKABLE = ['present', 'absent', 'half_day', 'on_duty', 'work_from_home', 'holiday', 'weekly_off'] as const

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const td: React.CSSProperties = { padding: '9px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tableWrap: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }
const sectionStyle: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }
const linkBtn = (color: string): React.CSSProperties => ({ background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color, cursor: 'pointer', marginRight: 12 })

function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}
function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function Badge({ status, computed }: { status: string | null; computed?: boolean }) {
  if (!status) return <span style={{ fontSize: 12, color: TEXT.muted }}>—</span>
  const hex = ATT_HEX[status] || '#64748B'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap', fontStyle: computed ? 'italic' : 'normal', border: computed ? `1px dashed ${hex}66` : 'none' }}>
      {ATT_LABELS[status] || status}
    </span>
  )
}
function Banner({ errors, ok }: { errors?: string[]; ok?: string }) {
  if (errors && errors.length) return <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{errors.join(' ')}</div>
  if (ok) return <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{ok}</div>
  return null
}
function Modal({ open, title, onClose, children, width = 520 }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: width, width: '100%', padding: 24, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const TABS = [
  { key: 'register', label: 'Daily register' },
  { key: 'month', label: 'Employee month' },
  { key: 'summary', label: 'Monthly summary' },
  { key: 'import', label: 'Import' },
  { key: 'corrections', label: 'Corrections' },
] as const
type TabKey = (typeof TABS)[number]['key']

type EditState = { user_id: number; user_name: string; date: string; id: number | null; source: string | null; status: string; check_in: string; check_out: string; remarks: string }

export default function HrAttendancePage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const now = new Date()
  const [tab, setTab] = useState<TabKey>('register')
  const [lookups, setLookups] = useState<HrAttendanceLookups | null>(null)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [branchId, setBranchId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [search, setSearch] = useState('')

  // register
  const [regDate, setRegDate] = useState(localIso())
  const [register, setRegister] = useState<HrAttendanceRegister | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [bulkStatus, setBulkStatus] = useState('present')
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  // month
  const [monthUser, setMonthUser] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [monthData, setMonthData] = useState<HrAttendanceMonth | null>(null)

  // summary
  const [summary, setSummary] = useState<HrAttendanceSummaryRow[]>([])
  const [sumLoading, setSumLoading] = useState(false)

  // import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<HrAttendanceImportResult | null>(null)
  const [importing, setImporting] = useState(false)

  // corrections
  const [regs, setRegs] = useState<HrAttendanceRegularization[]>([])
  const [regsStatus, setRegsStatus] = useState('pending')
  const [regsLoading, setRegsLoading] = useState(false)
  const [regDecision, setRegDecision] = useState<{ kind: 'approve' | 'reject'; reg: HrAttendanceRegularization } | null>(null)

  // edit modal
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [editErrors, setEditErrors] = useState<string[]>([])
  const [clearConfirm, setClearConfirm] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    hrApi.getAttendanceLookups().then(setLookups).catch((err) => setError(extractErrorMessages(err, 'Could not load plants and employees.')))
  }, [isAuthorized])

  const filters = useMemo(() => {
    const p: Record<string, unknown> = {}
    if (branchId) p.branch_id = Number(branchId)
    if (deptId) p.department_id = Number(deptId)
    if (search.trim()) p.search = search.trim()
    return p
  }, [branchId, deptId, search])

  const loadRegister = useCallback(() => {
    setRegLoading(true)
    hrApi.getAttendanceRegister({ ...filters, date: regDate })
      .then((d) => { setRegister(d); setSelected([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the register.')))
      .finally(() => setRegLoading(false))
  }, [filters, regDate])

  const loadMonth = useCallback(() => {
    if (!monthUser) { setMonthData(null); return }
    hrApi.getEmployeeAttendanceMonth(Number(monthUser), year, month)
      .then(setMonthData)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the month.')))
  }, [monthUser, year, month])

  const loadSummary = useCallback(() => {
    setSumLoading(true)
    hrApi.getAttendanceSummary({ ...filters, year, month })
      .then((d) => setSummary(d.items))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the summary.')))
      .finally(() => setSumLoading(false))
  }, [filters, year, month])

  const loadRegs = useCallback(() => {
    setRegsLoading(true)
    hrApi.listRegularizations(regsStatus ? { status: regsStatus } : {})
      .then(setRegs)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load correction requests.')))
      .finally(() => setRegsLoading(false))
  }, [regsStatus])

  useEffect(() => {
    if (!isAuthorized) return
    const h = setTimeout(() => {
      if (tab === 'register') loadRegister()
      if (tab === 'month') loadMonth()
      if (tab === 'summary') loadSummary()
      if (tab === 'corrections') loadRegs()
    }, 250)
    return () => clearTimeout(h)
  }, [isAuthorized, tab, loadRegister, loadMonth, loadSummary, loadRegs])

  const employeeOptions = useMemo(
    () => (lookups?.employees || []).map((e) => ({ value: String(e.user_id), label: `${e.user_name}${e.employee_code ? ` (${e.employee_code})` : ''} — ${e.department_name || e.user_email}` })),
    [lookups],
  )
  const departments = useMemo(() => (lookups?.departments || []).filter((d) => !branchId || !d.branch_id || String(d.branch_id) === branchId), [lookups, branchId])
  const visibleRows = useMemo(() => (register?.items || []).filter((r) => !statusFilter || r.status === statusFilter), [register, statusFilter])

  const openEdit = (userId: number, userName: string, day: { date: string; id: number | null; source: string | null; status: string | null; computed: boolean; check_in_time: string | null; check_out_time: string | null; remarks: string | null }) => {
    setEditErrors([])
    setEdit({
      user_id: userId, user_name: userName, date: day.date, id: day.id, source: day.source,
      status: !day.computed && day.status ? day.status : 'present', check_in: day.check_in_time || '', check_out: day.check_out_time || '', remarks: day.remarks || '',
    })
  }

  const refreshCurrent = () => {
    if (tab === 'register') loadRegister()
    if (tab === 'month') loadMonth()
  }

  const saveEdit = async () => {
    if (!edit) return
    setSaving(true); setEditErrors([])
    try {
      await hrApi.markAttendance({
        user_id: edit.user_id, attendance_date: edit.date, status: edit.status,
        check_in: edit.check_in || null, check_out: edit.check_out || null, remarks: edit.remarks.trim() || null,
      })
      setNotice(`${edit.user_name}: ${dmy(edit.date)} marked ${ATT_LABELS[edit.status]}.`)
      setEdit(null)
      refreshCurrent()
    } catch (err) {
      setEditErrors(extractErrorMessages(err, 'The attendance could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const clearEntry = async () => {
    setClearConfirm(false)
    if (!edit?.id) return
    setSaving(true)
    try {
      await hrApi.deleteAttendance(edit.id)
      setNotice(`${edit.user_name}: ${dmy(edit.date)} cleared.`)
      setEdit(null)
      refreshCurrent()
    } catch (err) {
      setEditErrors(extractErrorMessages(err, 'The entry could not be cleared.'))
    } finally {
      setSaving(false)
    }
  }

  const runBulk = async () => {
    setBulkConfirm(false)
    setError([]); setNotice('')
    try {
      const res = await hrApi.bulkMarkAttendance({ attendance_date: regDate, user_ids: selected, status: bulkStatus })
      const skipped = (res.skipped || []) as { user_name: string | null; reason: string }[]
      setNotice(`${res.created + res.updated} marked ${ATT_LABELS[bulkStatus]} for ${dmy(regDate)}.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.map((s) => `${s.user_name} — ${s.reason}`).join('; ')}` : ''}`)
      loadRegister()
    } catch (err) {
      setError(extractErrorMessages(err, 'Bulk marking failed.'))
    }
  }

  const runImport = async (dryRun: boolean) => {
    if (!importFile) { setError(['Choose the CSV file to import first.']); return }
    setImporting(true); setError([]); setNotice('')
    try {
      const res: HrAttendanceImportResult = await hrApi.importAttendance(importFile, dryRun)
      setImportResult(res)
      if (!dryRun) setNotice(`Imported ${res.created} new and ${res.updated} updated attendance rows${res.errors.length ? `; ${res.errors.length} row(s) were skipped — see below` : ''}.`)
    } catch (err) {
      setError(extractErrorMessages(err, 'The import failed.'))
    } finally {
      setImporting(false)
    }
  }

  const decideReg = async (value: string) => {
    if (!regDecision) return
    const { kind, reg } = regDecision
    setRegDecision(null)
    if (kind === 'reject' && !value.trim()) { setError([`Give a reason for rejecting ${reg.request_no}.`]); return }
    try {
      if (kind === 'approve') await hrApi.approveRegularization(reg.id, value)
      else await hrApi.rejectRegularization(reg.id, value)
      setNotice(`${reg.request_no} ${kind === 'approve' ? 'approved' : 'rejected'}.`)
      loadRegs()
    } catch (err) {
      setError(extractErrorMessages(err, `${reg.request_no} could not be updated.`))
    }
  }

  if (isLoading || !isAuthorized) return null

  const filterBar = (
    <>
      <select style={{ ...inputStyle, width: 'auto', flex: '0 1 160px' }} value={branchId} onChange={(e) => { setBranchId(e.target.value); setDeptId('') }}>
        <option value="">All plants</option>
        {lookups?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select style={{ ...inputStyle, width: 'auto', flex: '0 1 190px' }} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <input style={{ ...inputStyle, flex: '1 1 200px', maxWidth: 260 }} placeholder="Search name, email, code…" value={search} onChange={(e) => setSearch(e.target.value)} />
    </>
  )

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.includes(r.user_id))

  return (
    <div>
      <HrNav />

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          HR &amp; Administration
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Attendance</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
          Mark and correct attendance, import biometric exports and pull the monthly summary. Dashed badges are worked out from the calendar — nothing is stored for those days.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button key={t.key} type="button" onClick={() => { setTab(t.key); setError([]); setNotice('') }} style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer', border: active ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)', background: active ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)', color: active ? '#e0521a' : '#57534e' }}>
              {t.label}
            </button>
          )
        })}
      </div>

      <Banner errors={error} ok={notice} />

      {tab === 'register' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}><DateField value={regDate} onChange={(v) => v && setRegDate(v)} /></div>
            {filterBar}
            <select style={{ ...inputStyle, width: 'auto', flex: '0 1 160px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(ATT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {register && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.secondary, padding: '4px 0' }}>{register.total} employees:</span>
              {Object.entries(register.counts).filter(([, n]) => n > 0).map(([k, n]) => (
                <button key={k} type="button" onClick={() => setStatusFilter(statusFilter === k ? '' : k)} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, border: statusFilter === k ? `1px solid ${ATT_HEX[k]}` : '1px solid transparent', background: `${ATT_HEX[k]}1a`, color: ATT_HEX[k], cursor: 'pointer' }}>
                  {ATT_LABELS[k]} · {n}
                </button>
              ))}
            </div>
          )}
          {selected.length > 0 && (
            <div style={{ ...sectionStyle, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{selected.length} selected</span>
              <span style={{ fontSize: 13, color: TEXT.muted }}>Mark as</span>
              <select style={{ ...inputStyle, width: 'auto' }} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                {MARKABLE.map((s) => <option key={s} value={s}>{ATT_LABELS[s]}</option>)}
              </select>
              <button type="button" style={primaryBtnStyle} onClick={() => setBulkConfirm(true)}>Apply to {selected.length}</button>
              <button type="button" style={secondaryBtnStyle} onClick={() => setSelected([])}>Clear selection</button>
            </div>
          )}
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? visibleRows.map((r) => r.user_id) : [])} aria-label="Select all" />
                  </th>
                  {['Employee', 'Department / plant', 'Shift', 'Status', 'In', 'Out', 'Source', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {regLoading ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : visibleRows.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No employees match these filters.</td></tr>
                ) : visibleRows.map((r: HrAttendanceRegisterRow) => (
                  <tr key={r.user_id}>
                    <td style={td}>
                      <input type="checkbox" checked={selected.includes(r.user_id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.user_id] : selected.filter((x) => x !== r.user_id))} aria-label={`Select ${r.user_name}`} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: TEXT.heading }}>{r.user_name}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.employee_code || r.user_email}</div>
                    </td>
                    <td style={{ ...td, fontSize: 12.5 }}>{r.department_name || '—'}<div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.branch_name || ''}</div></td>
                    <td style={{ ...td, fontSize: 12.5 }}>{r.shift_name || '—'}</td>
                    <td style={td}>
                      <Badge status={r.status} computed={r.computed} />
                      {r.holiday_name && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3 }}>{r.holiday_name}</div>}
                    </td>
                    <td style={td}>
                      {r.check_in_time || '—'}
                      {r.late_minutes != null && r.late_minutes > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>late {r.late_minutes}m</div>}
                    </td>
                    <td style={td}>{r.check_out_time || '—'}</td>
                    <td style={{ ...td, fontSize: 12 }}>{r.source ? SOURCE_LABELS[r.source] || r.source : '—'}</td>
                    <td style={td}>
                      {r.source !== 'leave' && <button type="button" style={linkBtn('#E85A1F')} onClick={() => openEdit(r.user_id, r.user_name, r)}>{r.id ? 'Edit' : 'Mark'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'month' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
              <SearchableSelect value={monthUser} onChange={setMonthUser} options={employeeOptions} placeholder="Pick an employee…" />
            </div>
            <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
          </div>
          {!monthUser ? (
            <div style={{ ...sectionStyle, fontSize: 13, color: TEXT.muted }}>Pick an employee to see their month. Click any day to mark or correct it.</div>
          ) : monthData ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>
                  {monthData.user_name}{monthData.employee_code ? ` (${monthData.employee_code})` : ''}
                  <span style={{ fontWeight: 400, color: TEXT.muted }}> · {monthData.department_name || '—'} · {monthData.shift_name || 'no shift'}</span>
                </span>
                <AttendanceLegend counts={monthData.counts} />
              </div>
              <AttendanceCalendar
                year={year}
                month={month}
                days={monthData.days}
                onDayClick={(d) => { if (d.source !== 'leave') openEdit(monthData.user_id, monthData.user_name, d) }}
              />
            </>
          ) : (
            <div style={{ ...sectionStyle, fontSize: 13, color: TEXT.muted }}>Loading…</div>
          )}
        </>
      )}

      {tab === 'summary' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
            {filterBar}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              style={secondaryBtnStyle}
              onClick={async () => {
                try {
                  const blob = await hrApi.exportAttendanceSummary({ ...filters, year, month })
                  downloadBlob(blob, `attendance_summary_${year}_${String(month).padStart(2, '0')}.csv`)
                } catch (err) {
                  setError(extractErrorMessages(err, 'The export failed.'))
                }
              }}
            >
              Export CSV
            </button>
          </div>
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead>
                <tr>{['Employee', 'Department', 'Present', 'Half day', 'Absent', 'Leave', 'On duty', 'WFH', 'Holiday', 'Weekly off', 'Not marked', 'Late', 'Present eq.'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {sumLoading ? (
                  <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : summary.length === 0 ? (
                  <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No employees match these filters.</td></tr>
                ) : summary.map((s) => (
                  <tr key={s.user_id} onClick={() => { setMonthUser(String(s.user_id)); setTab('month') }} style={{ cursor: 'pointer' }}>
                    <td style={td}><div style={{ fontWeight: 600, color: TEXT.heading }}>{s.user_name}</div><div style={{ fontSize: 11.5, color: TEXT.muted }}>{s.employee_code || s.user_email}</div></td>
                    <td style={{ ...td, fontSize: 12.5 }}>{s.department_name || '—'}</td>
                    <td style={{ ...td, color: '#16A34A', fontWeight: 700 }}>{s.present}</td>
                    <td style={td}>{s.half_day}</td>
                    <td style={{ ...td, color: s.absent ? '#DC2626' : TEXT.body, fontWeight: s.absent ? 700 : 400 }}>{s.absent}</td>
                    <td style={td}>{s.on_leave}</td>
                    <td style={td}>{s.on_duty}</td>
                    <td style={td}>{s.work_from_home}</td>
                    <td style={td}>{s.holiday}</td>
                    <td style={td}>{s.weekly_off}</td>
                    <td style={{ ...td, color: s.unmarked ? '#B45309' : TEXT.muted }}>{s.unmarked}</td>
                    <td style={{ ...td, color: s.late_days ? '#DC2626' : TEXT.muted }}>{s.late_days}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{s.present_equivalent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, marginTop: 8 }}>
            {MONTH_NAMES[month - 1]} {year}. “Present eq.” = present + on duty + WFH + half of half days — share it with ADP for payroll; salaries are not calculated here.
          </p>
        </>
      )}

      {tab === 'import' && (
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Import attendance from CSV</h3>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>
            Columns: <code>email</code> or <code>employee_code</code>, <code>date</code> (YYYY-MM-DD or DD-MM-YYYY), <code>status</code> (present / absent / half_day / on_duty / work_from_home / holiday / weekly_off, or P, A, HD, OD, WFH, H, WO), optional <code>check_in</code>, <code>check_out</code> (HH:MM) and <code>remarks</code>. Existing days are overwritten; days on approved leave are never changed. Validate first to see problems without saving anything.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <button
              type="button"
              style={secondaryBtnStyle}
              onClick={async () => {
                try { downloadBlob(await hrApi.getAttendanceImportTemplate(), 'attendance_import_template.csv') } catch (err) { setError(extractErrorMessages(err, 'The template could not be downloaded.')) }
              }}
            >
              Download template
            </button>
            <input type="file" accept=".csv,text/csv" onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null) }} style={{ ...inputStyle, width: 'auto', flex: '1 1 260px', maxWidth: 380 }} />
            <button type="button" style={secondaryBtnStyle} disabled={importing} onClick={() => runImport(true)}>{importing ? 'Checking…' : 'Validate'}</button>
            <button type="button" style={{ ...primaryBtnStyle, opacity: importing ? 0.7 : 1 }} disabled={importing} onClick={() => runImport(false)}>{importing ? 'Importing…' : 'Import'}</button>
          </div>
          {importResult && (
            <>
              <p style={{ fontSize: 13.5, color: TEXT.body, margin: '0 0 10px' }}>
                {importResult.dry_run ? 'Validation only — nothing saved. ' : ''}
                {importResult.total_rows} row(s) read: <strong>{importResult.created}</strong> {importResult.dry_run ? 'would be created' : 'created'}, <strong>{importResult.updated}</strong> {importResult.dry_run ? 'would be updated' : 'updated'}, <strong style={{ color: importResult.errors.length ? '#DC2626' : TEXT.body }}>{importResult.errors.length}</strong> with errors.
              </p>
              {importResult.errors.length > 0 && (
                <div style={{ ...tableWrap, maxHeight: 360 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead><tr>{['Row', 'Employee', 'Problem'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {importResult.errors.map((e) => (
                        <tr key={`${e.row}-${e.message}`}>
                          <td style={{ ...td, width: 60, fontWeight: 700 }}>{e.row}</td>
                          <td style={{ ...td, width: 220 }}>{e.identifier || '—'}</td>
                          <td style={{ ...td, color: '#b91c1c' }}>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'corrections' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <select style={{ ...inputStyle, width: 'auto' }} value={regsStatus} onChange={(e) => setRegsStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(REG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1020 }}>
              <thead><tr>{['Request', 'Employee', 'Date', 'Currently', 'Asked for', 'Times', 'Reason', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {regsLoading ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : regs.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No correction requests{regsStatus ? ` with status ${REG_LABELS[regsStatus].toLowerCase()}` : ''}.</td></tr>
                ) : regs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>{r.request_no}</td>
                    <td style={td}><div style={{ fontWeight: 600 }}>{r.user_name}</div><div style={{ fontSize: 11.5, color: TEXT.muted }}>Approver: {r.approver_name || 'HR'}</div></td>
                    <td style={td}>{dmy(r.attendance_date)}</td>
                    <td style={td}>{r.current_status ? ATT_LABELS[r.current_status] : 'Not marked'}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{ATT_LABELS[r.requested_status]}</td>
                    <td style={td}>{r.check_in_time || '--'} – {r.check_out_time || '--'}</td>
                    <td style={{ ...td, maxWidth: 240 }}>{r.reason}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${REG_HEX[r.status]}1a`, color: REG_HEX[r.status], whiteSpace: 'nowrap' }}>{REG_LABELS[r.status]}</span>
                      {r.decision_remarks && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 3 }}>“{r.decision_remarks}”</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {r.can_decide && <button type="button" style={linkBtn('#16A34A')} onClick={() => setRegDecision({ kind: 'approve', reg: r })}>Approve</button>}
                      {r.can_decide && <button type="button" style={linkBtn('#DC2626')} onClick={() => setRegDecision({ kind: 'reject', reg: r })}>Reject</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={!!edit} title={edit ? `${edit.user_name} · ${dmy(edit.date)}` : ''} onClose={() => !saving && setEdit(null)} width={560}>
        {edit && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 180px', maxWidth: 220 }}>
                <label style={labelStyle}>Status *</label>
                <select style={inputStyle} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {MARKABLE.map((s) => <option key={s} value={s}>{ATT_LABELS[s]}</option>)}
                </select>
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={labelStyle}>Check-in</label>
                <input type="time" style={inputStyle} value={edit.check_in} onChange={(e) => setEdit({ ...edit, check_in: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={labelStyle}>Check-out</label>
                <input type="time" style={inputStyle} value={edit.check_out} onChange={(e) => setEdit({ ...edit, check_out: e.target.value })} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Remarks</label>
              <input style={inputStyle} value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} placeholder="Optional" />
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
              {edit.id ? `Currently stored (${SOURCE_LABELS[edit.source || ''] || edit.source}).` : 'Nothing stored for this day yet.'} Leave days can only be changed by cancelling the leave request.
            </p>
            <Banner errors={editErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <div>{edit.id && <button type="button" style={{ ...secondaryBtnStyle, color: '#b91c1c' }} disabled={saving} onClick={() => setClearConfirm(true)}>Clear entry</button>}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" style={secondaryBtnStyle} disabled={saving} onClick={() => setEdit(null)}>Cancel</button>
                <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={saveEdit}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={clearConfirm}
        title="Clear this attendance entry?"
        message={edit ? `${edit.user_name}'s entry for ${dmy(edit.date)} will be removed; the day then shows as not marked (or holiday / weekly off from the calendar).` : ''}
        confirmLabel="Clear entry"
        danger
        onConfirm={clearEntry}
        onCancel={() => setClearConfirm(false)}
      />
      <ConfirmDialog
        open={bulkConfirm}
        title={`Mark ${selected.length} employee(s) ${ATT_LABELS[bulkStatus]}?`}
        message={`Their attendance for ${dmy(regDate)} will be set to ${ATT_LABELS[bulkStatus]}, replacing anything already marked. Employees on approved leave are skipped.`}
        confirmLabel="Mark"
        danger={false}
        onConfirm={runBulk}
        onCancel={() => setBulkConfirm(false)}
      />
      <PromptDialog
        open={!!regDecision}
        title={regDecision ? `${regDecision.kind === 'approve' ? 'Approve' : 'Reject'} ${regDecision.reg.request_no}?` : ''}
        message={regDecision ? `${regDecision.reg.user_name} · ${dmy(regDecision.reg.attendance_date)} → ${ATT_LABELS[regDecision.reg.requested_status]}.${regDecision.kind === 'reject' ? ' A reason is required.' : ''}` : ''}
        placeholder={regDecision?.kind === 'reject' ? 'Reason for rejecting (required)…' : 'Optional remarks…'}
        confirmLabel={regDecision?.kind === 'approve' ? 'Approve' : 'Reject'}
        danger={regDecision?.kind === 'reject'}
        onConfirm={decideReg}
        onCancel={() => setRegDecision(null)}
      />
    </div>
  )
}
