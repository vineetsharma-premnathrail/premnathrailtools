'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrTravelRequest, HrExpenseClaim } from '@/types'
import HrNav from '@/components/hr/HrNav'
import DateField from '@/components/erp/DateField'
import PromptDialog from '@/components/erp/PromptDialog'
import { TRAVEL_MODE_LABELS, TRAVEL_STATUS_LABELS, TRAVEL_STATUS_HEX } from '@/components/hr/admin/TravelDialogs'
import { CLAIM_STATUS_LABELS, CLAIM_STATUS_HEX } from '@/components/hr/admin/ClaimDetail'
import {
  PageHeader, ErrorBanner, SuccessBanner, Pill, EmptyRow, StatCard, filterInputStyle,
  tableWrapStyle, thStyle, tdStyle, linkActionStyle, fmtDate, fmtINR,
} from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

type Tab = 'travel' | 'claims'
type TravelAction = { kind: 'approve' | 'reject' | 'complete'; t: HrTravelRequest }

export default function HrTravelPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('travel')
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [travelStatus, setTravelStatus] = useState('')
  const [travel, setTravel] = useState<HrTravelRequest[]>([])
  const [travelLoading, setTravelLoading] = useState(true)
  const [action, setAction] = useState<TravelAction | null>(null)

  const [claimStatus, setClaimStatus] = useState('')
  const [claims, setClaims] = useState<HrExpenseClaim[]>([])
  const [claimsLoading, setClaimsLoading] = useState(true)

  useEffect(() => {
    // Deep link: /dashboard/hr/travel?tab=claims
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'claims') setTab('claims')
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const common = useMemo(() => {
    const p: Record<string, unknown> = {}
    if (debounced.trim()) p.search = debounced.trim()
    if (dateFrom) p.date_from = dateFrom
    if (dateTo) p.date_to = dateTo
    return p
  }, [debounced, dateFrom, dateTo])

  const loadTravel = useCallback(() => {
    setTravelLoading(true)
    hrApi.listTravel({ ...common, ...(travelStatus ? { status: travelStatus } : {}) })
      .then((r) => { setTravel(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Travel requests could not be loaded.')))
      .finally(() => setTravelLoading(false))
  }, [common, travelStatus])

  const loadClaims = useCallback(() => {
    setClaimsLoading(true)
    hrApi.listClaims({ ...common, ...(claimStatus ? { status: claimStatus } : {}) })
      .then((r) => { setClaims(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Expense claims could not be loaded.')))
      .finally(() => setClaimsLoading(false))
  }, [common, claimStatus])

  useEffect(() => { if (isAuthorized && tab === 'travel') loadTravel() }, [isAuthorized, tab, loadTravel])
  useEffect(() => { if (isAuthorized && tab === 'claims') loadClaims() }, [isAuthorized, tab, loadClaims])

  const runAction = async (remarks: string) => {
    if (!action) return
    const { kind, t } = action
    setAction(null)
    try {
      if (kind === 'approve') await hrApi.approveTravel(t.id, remarks)
      if (kind === 'reject') await hrApi.rejectTravel(t.id, remarks)
      if (kind === 'complete') await hrApi.completeTravel(t.id, remarks)
      setNotice(`${t.request_no} ${kind === 'complete' ? 'marked completed' : kind === 'approve' ? 'approved' : 'rejected'}.`)
      loadTravel()
    } catch (err) {
      setError(extractErrorMessages(err, 'The travel request could not be updated.'))
    }
  }

  const claimTotals = useMemo(() => {
    const sum = (s: string) => claims.filter((c) => c.status === s).reduce((a, c) => a + Number(c.total_amount || 0), 0)
    return { submitted: sum('submitted'), approved: sum('approved'), paid: sum('paid') }
  }, [claims])

  if (isLoading || !isAuthorized) return null

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => { setTab(key); setNotice('') }}
      style={{
        fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer',
        border: tab === key ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)',
        background: tab === key ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)', color: tab === key ? '#e0521a' : '#57534e',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <HrNav />

      <PageHeader
        title="Travel & Claims"
        subtitle="Every employee's travel requests and expense claims. Approvals for your own reports also appear under Approvals."
      />

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>{tabBtn('travel', 'Travel requests')}{tabBtn('claims', 'Expense claims')}</div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...filterInputStyle, flex: '1 1 220px', maxWidth: 320 }}
          placeholder={tab === 'travel' ? 'Search no., employee, city, purpose…' : 'Search no., employee, title, payment ref…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab === 'travel' ? (
          <select style={{ ...filterInputStyle, flex: '0 1 160px' }} value={travelStatus} onChange={(e) => setTravelStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(TRAVEL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        ) : (
          <select style={{ ...filterInputStyle, flex: '0 1 180px' }} value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)}>
            <option value="">All submitted claims</option>
            {Object.entries(CLAIM_STATUS_LABELS).filter(([k]) => k !== 'draft').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <span style={{ fontSize: 12, color: TEXT.muted }}>{tab === 'travel' ? 'Departing' : 'Claim date'}</span>
        <div style={{ flex: '0 1 150px' }}><DateField value={dateFrom} onChange={setDateFrom} /></div>
        <span style={{ fontSize: 12, color: TEXT.muted }}>to</span>
        <div style={{ flex: '0 1 150px' }}><DateField value={dateTo} onChange={setDateTo} /></div>
        {(search || dateFrom || dateTo || travelStatus || claimStatus) && (
          <button type="button" style={linkActionStyle} onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setTravelStatus(''); setClaimStatus('') }}>Clear filters</button>
        )}
      </div>

      {tab === 'travel' ? (
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
            <thead>
              <tr>{['Request', 'Employee', 'Trip', 'Dates', 'Mode', 'Est. / Advance', 'Approver', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {travelLoading ? <EmptyRow colSpan={9} text="Loading…" /> : travel.length === 0 ? <EmptyRow colSpan={9} text="No travel requests match these filters." /> : travel.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{t.request_no}</td>
                  <td style={tdStyle}>
                    <div>{t.user_name}</div>
                    {t.user_department && <div style={{ fontSize: 12, color: TEXT.muted }}>{t.user_department}</div>}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{t.from_city} → {t.to_city}</div>
                    <div style={{ fontSize: 12, color: TEXT.muted, maxWidth: 260 }}>{t.purpose}</div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(t.depart_date)}{t.return_date ? ` – ${fmtDate(t.return_date)}` : ''}</td>
                  <td style={tdStyle}>{TRAVEL_MODE_LABELS[t.travel_mode] || t.travel_mode}{t.accommodation_required ? <div style={{ fontSize: 12, color: TEXT.muted }}>+ stay</div> : null}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtINR(t.estimated_cost)}{Number(t.advance_required) > 0 && <div style={{ fontSize: 12, color: TEXT.muted }}>Adv. {fmtINR(t.advance_required)}</div>}</td>
                  <td style={tdStyle}>
                    {t.decided_by_name || t.approver_name || 'HR (no manager)'}
                    {t.decision_remarks && <div style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'pre-wrap', maxWidth: 220 }}>“{t.decision_remarks}”</div>}
                  </td>
                  <td style={tdStyle}><Pill hex={TRAVEL_STATUS_HEX[t.status] || '#64748B'} label={TRAVEL_STATUS_LABELS[t.status] || t.status} /></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {t.can_decide && <button type="button" style={linkActionStyle} onClick={() => setAction({ kind: 'approve', t })}>Approve</button>}
                      {t.can_decide && <button type="button" style={{ ...linkActionStyle, color: '#DC2626' }} onClick={() => setAction({ kind: 'reject', t })}>Reject</button>}
                      {t.status === 'approved' && <button type="button" style={linkActionStyle} onClick={() => setAction({ kind: 'complete', t })}>Mark completed</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Awaiting approval" value={fmtINR(claimTotals.submitted)} hex="#F59E0B" />
            <StatCard label="Approved — to pay" value={fmtINR(claimTotals.approved)} hex="#16A34A" />
            <StatCard label="Paid" value={fmtINR(claimTotals.paid)} hex="#2563EB" />
          </div>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr>{['Claim', 'Employee', 'Title', 'Date', 'Trip', 'Amount', 'Approver', 'Status', ''].map((h) => <th key={h} style={{ ...thStyle, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {claimsLoading ? <EmptyRow colSpan={9} text="Loading…" /> : claims.length === 0 ? <EmptyRow colSpan={9} text="No claims match these filters. Drafts stay private until the employee submits them." /> : claims.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/dashboard/hr/travel/claims/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.claim_no}</td>
                    <td style={tdStyle}>
                      <div>{c.user_name}</div>
                      {c.user_department && <div style={{ fontSize: 12, color: TEXT.muted }}>{c.user_department}</div>}
                    </td>
                    <td style={tdStyle}>{c.title}<div style={{ fontSize: 12, color: TEXT.muted }}>{c.item_count} line{c.item_count === 1 ? '' : 's'}</div></td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(c.claim_date)}</td>
                    <td style={tdStyle}>{c.travel_request_no || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtINR(c.total_amount)}</td>
                    <td style={tdStyle}>{c.decided_by_name || c.approver_name || 'HR (no manager)'}</td>
                    <td style={tdStyle}>
                      <Pill hex={CLAIM_STATUS_HEX[c.status] || '#64748B'} label={CLAIM_STATUS_LABELS[c.status] || c.status} />
                      {c.status === 'paid' && c.payment_reference && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>{c.payment_reference}</div>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <span onClick={() => router.push(`/dashboard/hr/travel/claims/${c.id}`)} style={linkActionStyle}>
                        {c.can_mark_paid ? 'Record payment' : c.can_decide ? 'Review' : 'View'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PromptDialog
        open={!!action}
        title={action ? `${action.kind === 'approve' ? 'Approve' : action.kind === 'reject' ? 'Reject' : 'Mark completed —'} ${action.t.request_no}?` : ''}
        message={action ? (action.kind === 'reject'
          ? `${action.t.user_name}'s trip ${action.t.from_city} → ${action.t.to_city}. Say why (required) so they can re-plan.`
          : action.kind === 'approve'
            ? `${action.t.user_name}'s trip ${action.t.from_city} → ${action.t.to_city} on ${fmtDate(action.t.depart_date)}.`
            : 'Closes the trip. The employee can still link it to an expense claim.') : undefined}
        placeholder={action?.kind === 'reject' ? 'Reason for rejection…' : 'Remarks (optional)…'}
        confirmLabel={action?.kind === 'approve' ? 'Approve' : action?.kind === 'reject' ? 'Reject' : 'Mark completed'}
        cancelLabel="Back"
        danger={action?.kind === 'reject'}
        onConfirm={runAction}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
