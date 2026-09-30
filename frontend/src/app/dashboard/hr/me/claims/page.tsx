'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrExpenseClaim } from '@/types'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import { ClaimHeaderDialog, CLAIM_STATUS_LABELS, CLAIM_STATUS_HEX } from '@/components/hr/admin/ClaimDetail'
import {
  PageHeader, ErrorBanner, Pill, EmptyRow, StatCard, primaryActionStyle, filterInputStyle,
  tableWrapStyle, thStyle, tdStyle, linkActionStyle, fmtDate, fmtINR,
} from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

export default function MyClaimsPage() {
  // Self-service: any logged-in user.
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [rows, setRows] = useState<HrExpenseClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    hrApi.myClaims(status ? { status } : {})
      .then((r) => { setRows(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Your expense claims could not be loaded.')))
      .finally(() => setLoading(false))
  }, [status])

  useEffect(() => { if (user) load() }, [user, load])

  const totals = useMemo(() => {
    const sum = (st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((a, r) => a + Number(r.total_amount || 0), 0)
    return { pending: sum(['submitted']), approved: sum(['approved']), paid: sum(['paid']), drafts: rows.filter((r) => r.status === 'draft' || r.status === 'rejected').length }
  }, [rows])

  if (isLoading || !user) return null

  const open = (c: HrExpenseClaim) => router.push(`/dashboard/hr/me/claims/${c.id}`)

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <PageHeader
        title="My Expense Claims"
        subtitle="Claim reimbursement for business expenses. Attach receipts, submit to your manager, and track payment."
        actions={<button type="button" style={primaryActionStyle} onClick={() => setCreateOpen(true)}>+ New Claim</button>}
      />

      <ErrorBanner error={error} />

      {!status && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <StatCard label="Drafts / to fix" value={totals.drafts} hex="#64748B" />
          <StatCard label="Awaiting approval" value={fmtINR(totals.pending)} hex="#F59E0B" />
          <StatCard label="Approved, not paid" value={fmtINR(totals.approved)} hex="#16A34A" />
          <StatCard label="Paid" value={fmtINR(totals.paid)} hex="#2563EB" />
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select style={{ ...filterInputStyle, flex: '0 1 170px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(CLAIM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr>{['Claim', 'Title', 'Date', 'Trip', 'Lines', 'Amount', 'Status', ''].map((h) => <th key={h} style={{ ...thStyle, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? <EmptyRow colSpan={8} text="Loading…" /> : rows.length === 0 ? (
              <EmptyRow colSpan={8} text={status ? 'No claims with this status.' : 'No expense claims yet. Use “+ New Claim” to start one.'} />
            ) : rows.map((c) => (
              <tr key={c.id} onClick={() => open(c)} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.claim_no}</td>
                <td style={tdStyle}>
                  {c.title}
                  {c.status === 'rejected' && c.decision_remarks && <div style={{ fontSize: 12, color: '#DC2626' }}>“{c.decision_remarks}”</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(c.claim_date)}</td>
                <td style={tdStyle}>{c.travel_request_no ? <><div>{c.travel_request_no}</div><div style={{ fontSize: 12, color: TEXT.muted }}>{c.travel_route}</div></> : '—'}</td>
                <td style={tdStyle}>{c.item_count}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtINR(c.total_amount)}</td>
                <td style={tdStyle}>
                  <Pill hex={CLAIM_STATUS_HEX[c.status] || '#64748B'} label={CLAIM_STATUS_LABELS[c.status] || c.status} />
                  {c.status === 'paid' && c.paid_on && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>{fmtDate(c.paid_on)}</div>}
                </td>
                <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                  <span onClick={() => open(c)} style={linkActionStyle}>{c.can_edit ? 'Edit' : 'View'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ClaimHeaderDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(c) => { setCreateOpen(false); router.push(`/dashboard/hr/me/claims/${c.id}`) }}
      />
    </div>
  )
}
