'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrLeaveBalance, HrLeaveRequest, HrLeaveType } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import LeaveApplyForm from '@/components/hr/leave/LeaveApplyForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#64748B' }
const SESSION_SHORT: Record<string, string> = { full: '', first_half: ' (1st half)', second_half: ' (2nd half)' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cardStyle: React.CSSProperties = {
  borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 16,
}
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function num(v: string | number | null | undefined) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

export default function MyLeavePage() {
  // Self-service: any logged-in user.
  const { user, isLoading } = useAuth()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [types, setTypes] = useState<HrLeaveType[]>([])
  const [balances, setBalances] = useState<HrLeaveBalance[]>([])
  const [requests, setRequests] = useState<HrLeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [cancelTarget, setCancelTarget] = useState<HrLeaveRequest | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([hrApi.listLeaveTypes(), hrApi.getMyLeaveBalances(year), hrApi.listMyLeaveRequests({ year, status: statusFilter || undefined })])
      .then(([t, b, r]) => { setTypes(t); setBalances(b); setRequests(r) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load your leave.')))
      .finally(() => setLoading(false))
  }, [year, statusFilter])

  useEffect(() => { if (user) load() }, [user, load])

  const doCancel = async () => {
    if (!cancelTarget) return
    const target = cancelTarget
    setCancelTarget(null)
    setError([])
    try {
      await hrApi.cancelLeaveRequest(target.id)
      setNotice(`${target.request_no} was cancelled${target.status === 'approved' ? ' and the days were returned to your balance' : ''}.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'The leave could not be cancelled.'))
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

  if (isLoading || !user) return null

  const shownBalances = types
    .map((t) => ({ type: t, bal: balances.find((b) => b.leave_type_id === t.id) }))
    .filter((x) => x.bal || !x.type.is_paid)

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>My Leave</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Apply for leave, see your balances and track your requests.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select style={inputStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {!showForm && (
            <button
              type="button"
              onClick={() => { setShowForm(true); setNotice('') }}
              style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
            >
              + Apply Leave
            </button>
          )}
        </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
        {loading && balances.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 13, color: TEXT.muted }}>Loading balances…</div>
        ) : shownBalances.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 13, color: TEXT.muted, gridColumn: '1 / -1' }}>
            No leave has been allotted to you for {year} yet. HR allots the year&apos;s leave — ask HR if you expected a balance.
          </div>
        ) : (
          shownBalances.map(({ type, bal }) => (
            <div key={type.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary }}>{type.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted }}>{type.code}</span>
              </div>
              {type.is_paid ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: TEXT.heading, margin: '6px 0 2px' }}>{num(bal?.available)}</div>
                  <div style={{ fontSize: 11.5, color: TEXT.muted }}>
                    available · {num(bal?.used)} used{Number(bal?.pending) > 0 ? ` · ${num(bal?.pending)} pending` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 4 }}>
                    {Number(bal?.opening) > 0 ? `${num(bal?.opening)} carried + ` : ''}{num(bal?.allotted)} allotted{Number(bal?.adjusted) !== 0 ? ` ${Number(bal?.adjusted) > 0 ? '+' : ''}${num(bal?.adjusted)} adjusted` : ''}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: TEXT.heading, margin: '6px 0 2px' }}>{num(bal?.used)}</div>
                  <div style={{ fontSize: 11.5, color: TEXT.muted }}>days taken · unpaid, no balance needed</div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {showForm && (
        <LeaveApplyForm
          types={types}
          onCancel={() => setShowForm(false)}
          onSubmitted={(no) => { setShowForm(false); setNotice(`${no} was submitted and sent to your approver.`); load() }}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My requests</h3>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr>
              {['Request', 'Type', 'Dates', 'Days', 'Status', 'Approver / decision', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No leave requests in {year}.</td></tr>
            ) : requests.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>
                  {r.request_no}
                  {r.reason && <div style={{ fontSize: 12, fontWeight: 400, color: TEXT.muted, marginTop: 2, maxWidth: 240 }}>{r.reason}</div>}
                </td>
                <td style={td}>{r.leave_type_name}</td>
                <td style={td}>
                  {dmy(r.from_date)}{SESSION_SHORT[r.from_session]}
                  {r.to_date !== r.from_date && <> → {dmy(r.to_date)}{SESSION_SHORT[r.to_session]}</>}
                </td>
                <td style={td}>{num(r.days)}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                </td>
                <td style={{ ...td, fontSize: 12.5 }}>
                  {r.status === 'pending' ? (r.approver_name || 'HR') : (r.decided_by_name || '—')}
                  {r.decision_remarks && <div style={{ color: TEXT.muted, marginTop: 2 }}>“{r.decision_remarks}”</div>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {r.attachment_path && (
                    <span onClick={() => openAttachment(r)} style={{ fontSize: 12, fontWeight: 600, color: '#2563EB', cursor: 'pointer', marginRight: 12 }}>Attachment</span>
                  )}
                  {r.can_cancel && (
                    <span onClick={() => setCancelTarget(r)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Cancel</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this leave?"
        message={cancelTarget ? `${cancelTarget.request_no} (${dmy(cancelTarget.from_date)} to ${dmy(cancelTarget.to_date)}, ${num(cancelTarget.days)} days) will be cancelled.${cancelTarget.status === 'approved' ? ' The days go back to your balance and your approver is told.' : ''}` : ''}
        confirmLabel="Cancel leave"
        cancelLabel="Keep it"
        danger
        onConfirm={doCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
