'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hrApi } from '@/lib/api'
import { HrLeaveBalance, HrLeaveRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#64748B' }
const SESSION_SHORT: Record<string, string> = { full: '', first_half: ' (1st half)', second_half: ' (2nd half)' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }

function num(v: string | number | null | undefined) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

// Leave balances and recent requests for one employee (HR employee detail).
export default function EmployeeLeaveTab({ userId }: { userId: number }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [balances, setBalances] = useState<HrLeaveBalance[]>([])
  const [requests, setRequests] = useState<HrLeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      hrApi.listLeaveBalances({ year, user_id: userId }),
      hrApi.listLeaveRequests({ user_id: userId, date_from: `${year}-01-01`, date_to: `${year}-12-31` }),
    ])
      .then(([b, r]) => { setBalances(b); setRequests(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Could not load this employee's leave.")))
      .finally(() => setLoading(false))
  }, [userId, year])

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Leave</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ padding: '7px 10px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13 }}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Link href="/dashboard/hr/leave" style={{ fontSize: 12.5, fontWeight: 600, color: '#E85A1F', textDecoration: 'none' }}>Manage leave →</Link>
        </div>
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : (
        <>
          {balances.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 16px' }}>No leave balances for {year}. Use “Allot year” on the Leave page, or adjust a balance for this employee.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {balances.map((b) => (
                <div key={b.id} style={{ flex: '0 1 170px', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.55)', border: `1px solid ${BORDER.light}` }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.secondary }}>{b.leave_type_name}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: TEXT.heading }}>{b.is_paid === false ? num(b.used) : num(b.available)}</div>
                  <div style={{ fontSize: 11, color: TEXT.muted }}>
                    {b.is_paid === false ? 'days taken (unpaid)' : `available · ${num(b.used)} used${Number(b.pending) > 0 ? ` · ${num(b.pending)} pending` : ''}`}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${BORDER.light}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead><tr>{['Request', 'Type', 'Dates', 'Days', 'Status', 'Decided by'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: TEXT.muted, padding: 16 }}>No leave requests in {year}.</td></tr>
                ) : requests.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.request_no}</td>
                    <td style={td}>{r.leave_type_name}</td>
                    <td style={td}>{dmy(r.from_date)}{SESSION_SHORT[r.from_session]}{r.to_date !== r.from_date && <> → {dmy(r.to_date)}{SESSION_SHORT[r.to_session]}</>}</td>
                    <td style={td}>{num(r.days)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td style={{ ...td, fontSize: 12.5 }}>{r.status === 'pending' ? `Waiting: ${r.approver_name || 'HR'}` : r.decided_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
