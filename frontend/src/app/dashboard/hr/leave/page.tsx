'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrAttendanceLookups, HrLeaveAllotSummary, HrLeaveBalance, HrLeaveRequest, HrLeaveType } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import LeaveApplyForm from '@/components/hr/leave/LeaveApplyForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#64748B' }
const SESSION_SHORT: Record<string, string> = { full: '', first_half: ' (1st half)', second_half: ' (2nd half)' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tableWrap: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }
const linkBtn = (color: string): React.CSSProperties => ({ background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color, cursor: 'pointer', marginRight: 12 })

function num(v: string | number | null | undefined) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

function Banner({ errors, ok }: { errors?: string[]; ok?: string }) {
  if (errors && errors.length) {
    return <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{errors.join(' ')}</div>
  }
  if (ok) {
    return <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{ok}</div>
  }
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

const TABS = [{ key: 'requests', label: 'Requests' }, { key: 'balances', label: 'Balances' }] as const

export default function HrLeavePage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const thisYear = new Date().getFullYear()
  const [tab, setTab] = useState<'requests' | 'balances'>('requests')
  const [types, setTypes] = useState<HrLeaveType[]>([])
  const [lookups, setLookups] = useState<HrAttendanceLookups | null>(null)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  // requests
  const [requests, setRequests] = useState<HrLeaveRequest[]>([])
  const [reqLoading, setReqLoading] = useState(true)
  const [status, setStatus] = useState('pending')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [decision, setDecision] = useState<{ kind: 'approve' | 'reject' | 'cancel'; req: HrLeaveRequest } | null>(null)
  const [applyFor, setApplyFor] = useState<string>('')
  const [showApply, setShowApply] = useState(false)

  // balances
  const [year, setYear] = useState(thisYear)
  const [balances, setBalances] = useState<HrLeaveBalance[]>([])
  const [balLoading, setBalLoading] = useState(false)
  const [balType, setBalType] = useState('')
  const [balSearch, setBalSearch] = useState('')
  const [allotOpen, setAllotOpen] = useState(false)
  const [allotYear, setAllotYear] = useState(thisYear)
  const [allotTypes, setAllotTypes] = useState<number[]>([])
  const [prorate, setProrate] = useState(true)
  const [allotConfirm, setAllotConfirm] = useState(false)
  const [allotResult, setAllotResult] = useState<HrLeaveAllotSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [modalErrors, setModalErrors] = useState<string[]>([])
  const [adjust, setAdjust] = useState<{ user_id: string; leave_type_id: string; year: number; delta: string; reason: string; label?: string } | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([hrApi.listLeaveTypes({ include_inactive: true }), hrApi.getAttendanceLookups()])
      .then(([t, l]) => { setTypes(t); setLookups(l) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load leave setup.')))
  }, [isAuthorized])

  const loadRequests = useCallback(() => {
    setReqLoading(true)
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (typeFilter) params.leave_type_id = Number(typeFilter)
    if (search.trim()) params.search = search.trim()
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    hrApi.listLeaveRequests(params)
      .then((d) => setRequests(d))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load leave requests.')))
      .finally(() => setReqLoading(false))
  }, [status, typeFilter, search, dateFrom, dateTo])

  const loadBalances = useCallback(() => {
    setBalLoading(true)
    const params: Record<string, unknown> = { year }
    if (balType) params.leave_type_id = Number(balType)
    if (balSearch.trim()) params.search = balSearch.trim()
    hrApi.listLeaveBalances(params)
      .then((d) => setBalances(d))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load leave balances.')))
      .finally(() => setBalLoading(false))
  }, [year, balType, balSearch])

  useEffect(() => {
    if (!isAuthorized || tab !== 'requests') return
    const h = setTimeout(loadRequests, 250)
    return () => clearTimeout(h)
  }, [isAuthorized, tab, loadRequests])

  useEffect(() => {
    if (!isAuthorized || tab !== 'balances') return
    const h = setTimeout(loadBalances, 250)
    return () => clearTimeout(h)
  }, [isAuthorized, tab, loadBalances])

  const activeTypes = useMemo(() => types.filter((t) => t.is_active), [types])
  const employeeOptions = useMemo(
    () => (lookups?.employees || []).map((e) => ({ value: String(e.user_id), label: `${e.user_name}${e.employee_code ? ` (${e.employee_code})` : ''} — ${e.user_email}` })),
    [lookups],
  )

  const decide = async (value: string) => {
    if (!decision) return
    const { kind, req } = decision
    setDecision(null)
    setError([]); setNotice('')
    if (kind === 'reject' && !value.trim()) {
      setError([`Give a reason for rejecting ${req.request_no} so ${req.user_name} knows what to change.`])
      return
    }
    try {
      if (kind === 'approve') await hrApi.approveLeaveRequest(req.id, value)
      else if (kind === 'reject') await hrApi.rejectLeaveRequest(req.id, value)
      else await hrApi.cancelLeaveRequest(req.id, value)
      setNotice(`${req.request_no} ${kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'cancelled'}. ${req.user_name} has been notified.`)
      loadRequests()
    } catch (err) {
      setError(extractErrorMessages(err, `${req.request_no} could not be updated.`))
    }
  }

  const openAttachment = async (r: HrLeaveRequest) => {
    try {
      const blob = await hrApi.getLeaveAttachmentBlob(r.id)
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch (err) {
      setError(extractErrorMessages(err, 'The attachment could not be opened.'))
    }
  }

  const runAllot = async () => {
    setAllotConfirm(false)
    setBusy(true); setModalErrors([])
    try {
      const res: HrLeaveAllotSummary = await hrApi.allotLeaveBalances({ year: allotYear, leave_type_ids: allotTypes.length ? allotTypes : null, prorate_joiners: prorate })
      setAllotResult(res)
      if (allotYear === year) loadBalances()
      else setYear(allotYear)
    } catch (err) {
      setModalErrors(extractErrorMessages(err, 'The leave could not be allotted.'))
    } finally {
      setBusy(false)
    }
  }

  const saveAdjust = async () => {
    if (!adjust) return
    const problems: string[] = []
    if (!adjust.user_id) problems.push('Pick the employee.')
    if (!adjust.leave_type_id) problems.push('Pick the leave type.')
    const delta = Number(adjust.delta)
    if (!adjust.delta || Number.isNaN(delta) || delta === 0) problems.push('Enter the days to add (e.g. 2) or deduct (e.g. -1.5).')
    else if ((delta * 2) % 1 !== 0) problems.push('Adjust in steps of 0.5 day.')
    if (adjust.reason.trim().length < 3) problems.push('Give a reason — it is kept in the audit log and shown to the employee.')
    if (problems.length) { setModalErrors(problems); return }
    setBusy(true); setModalErrors([])
    try {
      const res: HrLeaveBalance = await hrApi.adjustLeaveBalance({
        user_id: Number(adjust.user_id), leave_type_id: Number(adjust.leave_type_id), year: adjust.year, delta, reason: adjust.reason.trim(),
      })
      setAdjust(null)
      setNotice(`${res.user_name}'s ${res.leave_type_name} for ${res.year} is now ${num(res.available)} days.`)
      loadBalances()
    } catch (err) {
      setModalErrors(extractErrorMessages(err, 'The balance could not be adjusted.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Leave</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>All leave requests and employee leave balances.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {tab === 'requests' ? (
            <button type="button" onClick={() => { setShowApply(true); setNotice('') }} style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}>
              + Apply on behalf
            </button>
          ) : (
            <>
              <button type="button" style={secondaryBtnStyle} onClick={() => { setModalErrors([]); setAdjust({ user_id: '', leave_type_id: activeTypes[0] ? String(activeTypes[0].id) : '', year, delta: '', reason: '' }) }}>Adjust balance</button>
              <button type="button" onClick={() => { setModalErrors([]); setAllotResult(null); setAllotYear(year); setAllotTypes([]); setAllotOpen(true) }} style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}>
                Allot year
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer', border: active ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)', background: active ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)', color: active ? '#e0521a' : '#57534e' }}>
              {t.label}
            </button>
          )
        })}
      </div>

      <Banner errors={error} ok={notice} />

      {tab === 'requests' && (
        <>
          {showApply && (
            <div>
              <div style={{ maxWidth: 520, marginBottom: 12 }}>
                <label style={labelStyle}>Employee *</label>
                <SearchableSelect value={applyFor} onChange={setApplyFor} options={employeeOptions} placeholder="Search employee…" />
              </div>
              {applyFor ? (
                <LeaveApplyForm
                  key={applyFor}
                  types={activeTypes}
                  userId={Number(applyFor)}
                  onCancel={() => { setShowApply(false); setApplyFor('') }}
                  onSubmitted={(no) => { setShowApply(false); setApplyFor(''); setNotice(`${no} was submitted and sent to the employee's approver.`); loadRequests() }}
                />
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <span style={{ fontSize: 13, color: TEXT.muted }}>Pick the employee to apply leave for. It still goes to their reporting manager for approval.</span>
                  <button type="button" style={secondaryBtnStyle} onClick={() => setShowApply(false)}>Cancel</button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 300 }} placeholder="Search employee or request no…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select style={{ ...inputStyle, flex: '0 1 160px', width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select style={{ ...inputStyle, flex: '0 1 180px', width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All leave types</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}><DateField value={dateFrom} onChange={setDateFrom} /></div>
            <span style={{ fontSize: 12, color: TEXT.muted }}>to</span>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}><DateField value={dateTo} onChange={setDateTo} /></div>
            {(dateFrom || dateTo) && <button type="button" style={linkBtn(TEXT.secondary)} onClick={() => { setDateFrom(''); setDateTo('') }}>Clear dates</button>}
          </div>

          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
              <thead>
                <tr>{['Request', 'Employee', 'Leave', 'Dates', 'Days', 'Status', 'Approver / decision', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {reqLoading ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : requests.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No leave requests match these filters.</td></tr>
                ) : requests.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>
                      {r.request_no}
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: TEXT.muted }}>{r.created_at ? dmy(r.created_at.slice(0, 10)) : ''}</div>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.user_name}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[r.employee_code, r.department_name].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={td}>
                      {r.leave_type_name}
                      {r.reason && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2, maxWidth: 220 }}>{r.reason}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {dmy(r.from_date)}{SESSION_SHORT[r.from_session]}
                      {r.to_date !== r.from_date && <div>→ {dmy(r.to_date)}{SESSION_SHORT[r.to_session]}</div>}
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}>{num(r.days)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>{STATUS_LABELS[r.status] || r.status}</span>
                    </td>
                    <td style={{ ...td, fontSize: 12.5 }}>
                      {r.status === 'pending' ? (r.approver_name || <span style={{ color: '#B45309' }}>HR (no manager)</span>) : (r.decided_by_name || '—')}
                      {r.decision_remarks && <div style={{ color: TEXT.muted, marginTop: 2 }}>“{r.decision_remarks}”</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {r.attachment_path && <button type="button" style={linkBtn('#2563EB')} onClick={() => openAttachment(r)}>File</button>}
                      {r.can_decide && <button type="button" style={linkBtn('#16A34A')} onClick={() => setDecision({ kind: 'approve', req: r })}>Approve</button>}
                      {r.can_decide && <button type="button" style={linkBtn('#DC2626')} onClick={() => setDecision({ kind: 'reject', req: r })}>Reject</button>}
                      {r.can_cancel && <button type="button" style={linkBtn(TEXT.secondary)} onClick={() => setDecision({ kind: 'cancel', req: r })}>Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'balances' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <select style={{ ...inputStyle, flex: '0 1 110px', width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select style={{ ...inputStyle, flex: '0 1 180px', width: 'auto' }} value={balType} onChange={(e) => setBalType(e.target.value)}>
              <option value="">All leave types</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 300 }} placeholder="Search employee…" value={balSearch} onChange={(e) => setBalSearch(e.target.value)} />
            <span style={{ fontSize: 12, color: TEXT.muted }}>{balances.length} balance row(s)</span>
          </div>
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>{['Employee', 'Leave type', 'Carried', 'Allotted', 'Adjusted', 'Used', 'Pending', 'Available', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {balLoading ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : balances.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                    No balances for {year}{balSearch || balType ? ' match these filters' : ' yet. Use “Allot year” to give every active employee their annual quota'}.
                  </td></tr>
                ) : balances.map((b) => (
                  <tr key={b.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{b.user_name}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[b.employee_code, b.department_name].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={td}>{b.leave_type_name} <span style={{ fontSize: 11, color: TEXT.muted }}>{b.leave_type_code}</span></td>
                    <td style={td}>{num(b.opening)}</td>
                    <td style={td}>{num(b.allotted)}</td>
                    <td style={{ ...td, color: Number(b.adjusted) < 0 ? '#DC2626' : Number(b.adjusted) > 0 ? '#16A34A' : TEXT.body }}>{Number(b.adjusted) > 0 ? '+' : ''}{num(b.adjusted)}</td>
                    <td style={td}>{num(b.used)}</td>
                    <td style={{ ...td, color: Number(b.pending) > 0 ? '#B45309' : TEXT.muted }}>{num(b.pending)}</td>
                    <td style={{ ...td, fontWeight: 800, color: TEXT.heading }}>{b.is_paid === false ? '—' : num(b.available)}</td>
                    <td style={td}>
                      <button type="button" style={linkBtn('#E85A1F')} onClick={() => { setModalErrors([]); setAdjust({ user_id: String(b.user_id), leave_type_id: String(b.leave_type_id), year: b.year, delta: '', reason: '', label: `${b.user_name} · ${b.leave_type_name} · ${b.year} (available ${num(b.available)})` }) }}>Adjust</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PromptDialog
        open={!!decision}
        title={decision ? `${decision.kind === 'approve' ? 'Approve' : decision.kind === 'reject' ? 'Reject' : 'Cancel'} ${decision.req.request_no}?` : ''}
        message={decision ? `${decision.req.user_name} · ${decision.req.leave_type_name} · ${num(decision.req.days)} day(s) from ${dmy(decision.req.from_date)}.${decision.kind === 'reject' ? ' A reason is required.' : decision.kind === 'cancel' && decision.req.status === 'approved' ? ' The days go back to their balance.' : ''}` : ''}
        placeholder={decision?.kind === 'reject' ? 'Reason for rejecting (required)…' : 'Optional remarks…'}
        confirmLabel={decision?.kind === 'approve' ? 'Approve' : decision?.kind === 'reject' ? 'Reject' : 'Cancel leave'}
        cancelLabel="Back"
        danger={decision?.kind !== 'approve'}
        onConfirm={decide}
        onCancel={() => setDecision(null)}
      />

      <Modal open={allotOpen} title="Allot annual leave" onClose={() => !busy && setAllotOpen(false)} width={560}>
        {allotResult ? (
          <>
            <p style={{ fontSize: 13.5, color: TEXT.body, margin: '0 0 10px' }}>
              {allotResult.year} leave ({allotResult.leave_types.join(', ')}) for {allotResult.employees} active employees:
            </p>
            <ul style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 16px', paddingLeft: 18 }}>
              <li>{allotResult.created} new balance rows</li>
              <li>{allotResult.updated} updated (quota or carry-forward changed)</li>
              <li>{allotResult.unchanged} already up to date</li>
              {allotResult.skipped_gender > 0 && <li>{allotResult.skipped_gender} skipped — gender-restricted type and the employee&apos;s gender doesn&apos;t match or isn&apos;t recorded</li>}
              {allotResult.skipped_not_joined > 0 && <li>{allotResult.skipped_not_joined} skipped — joining date is after {allotResult.year}</li>}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtnStyle} onClick={() => setAllotOpen(false)}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '0 1 120px' }}>
                <label style={labelStyle}>Year</label>
                <select style={inputStyle} value={allotYear} onChange={(e) => setAllotYear(Number(e.target.value))}>
                  {[thisYear + 1, thisYear, thisYear - 1].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, cursor: 'pointer', paddingBottom: 8 }}>
                <input type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} /> Pro-rate for employees who join during the year
              </label>
            </div>
            <label style={labelStyle}>Leave types (none ticked = all active)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {activeTypes.map((t) => {
                const on = allotTypes.includes(t.id)
                return (
                  <button key={t.id} type="button" onClick={() => setAllotTypes(on ? allotTypes.filter((x) => x !== t.id) : [...allotTypes, t.id])} style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, cursor: 'pointer', border: on ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)', background: on ? 'rgba(255,106,42,0.1)' : '#fff', color: on ? '#e0521a' : '#57534e' }}>
                    {t.code} · {t.is_paid ? `${num(t.annual_quota)}/yr` : 'unpaid'}{t.carry_forward ? ` · carry ≤ ${num(t.max_carry_forward)}` : ''}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
              Sets each active employee&apos;s allotted days to the type&apos;s annual quota and, for carry-forward types, brings forward last year&apos;s unused balance up to the cap. Safe to run again — manual adjustments and days already used are never touched. Types with a quota of 0 and nothing to carry are skipped.
            </p>
            <Banner errors={modalErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={() => setAllotOpen(false)}>Cancel</button>
              <button type="button" style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => setAllotConfirm(true)}>{busy ? 'Allotting…' : `Allot ${allotYear}`}</button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={allotConfirm}
        title={`Allot ${allotYear} leave?`}
        message={`This updates the ${allotYear} balances of all ${lookups?.employees.length ?? ''} active employees${allotTypes.length ? ` for ${activeTypes.filter((t) => allotTypes.includes(t.id)).map((t) => t.code).join(', ')}` : ''}. Employees see the new balances straight away.`}
        confirmLabel="Allot"
        danger={false}
        onConfirm={runAllot}
        onCancel={() => setAllotConfirm(false)}
      />

      <Modal open={!!adjust} title="Adjust leave balance" onClose={() => !busy && setAdjust(null)} width={560}>
        {adjust && (
          <>
            {adjust.label ? (
              <p style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading, margin: '0 0 14px' }}>{adjust.label}</p>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Employee *</label>
                  <SearchableSelect value={adjust.user_id} onChange={(v) => setAdjust({ ...adjust, user_id: v })} options={employeeOptions} placeholder="Search employee…" />
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={labelStyle}>Leave type *</label>
                    <select style={inputStyle} value={adjust.leave_type_id} onChange={(e) => setAdjust({ ...adjust, leave_type_id: e.target.value })}>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '0 1 110px' }}>
                    <label style={labelStyle}>Year</label>
                    <select style={inputStyle} value={adjust.year} onChange={(e) => setAdjust({ ...adjust, year: Number(e.target.value) })}>
                      {[thisYear + 1, thisYear, thisYear - 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 1 130px' }}>
                <label style={labelStyle}>Days (+/-) *</label>
                <input style={inputStyle} inputMode="decimal" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value.replace(/[^0-9.-]/g, '') })} placeholder="e.g. 1 or -0.5" />
              </div>
              <div style={{ flex: '1 1 260px' }}>
                <label style={labelStyle}>Reason *</label>
                <input style={inputStyle} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="e.g. Comp-off for Sunday dispatch work" />
              </div>
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>The reason is recorded in the audit log and sent to the employee.</p>
            <Banner errors={modalErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={() => setAdjust(null)}>Cancel</button>
              <button type="button" style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={saveAdjust}>{busy ? 'Saving…' : 'Save adjustment'}</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
