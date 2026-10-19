'use client'

/** Credit Management (SAP FD32 / UKM): every customer's credit exposure vs
 *  limit and overdues, credit blocks, and release requests decided through
 *  the central approval engine. */
import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { CreditPosition, CreditRelease } from '@/types'
import { TEXT, BRAND } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import FinanceNav from '@/components/finance/FinanceNav'
import OutstandingSubNav from '@/components/finance/OutstandingSubNav'
import CreditReleaseDialog from '@/components/finance/CreditReleaseDialog'
import {
  sectionStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh, inr, dmy,
  ErrorBanner, InfoBanner, StatusPill, PageHeader, TableWrap, EmptyRow, StatCard, ApprovalBadge,
} from '@/components/finance/financeUi'

const REL_LABELS: Record<string, string> = { pending_approval: 'Waiting approval', released: 'Released', rejected: 'Rejected', withdrawn: 'Withdrawn' }
const REL_HEX: Record<string, string> = { pending_approval: '#f59e0b', released: '#16a34a', rejected: '#dc2626', withdrawn: '#78716c' }
const CP_LABELS: Record<string, string> = { so_confirmation: 'SO confirmation', dispatch: 'Dispatch' }

export default function CreditPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { can } = useCan()
  const [rows, setRows] = useState<CreditPosition[]>([])
  const [releases, setReleases] = useState<CreditRelease[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [requestFor, setRequestFor] = useState<CreditPosition | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    Promise.all([accountsApi.creditOverview(), accountsApi.creditReleases()])
      .then(([o, r]: [{ rows: CreditPosition[] }, CreditRelease[]]) => { setRows(o.rows || []); setReleases(r || []); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load credit management.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, reload])

  if (isLoading || !isAuthorized) return null
  const blocked = rows.filter((r) => r.would_block).length
  const pending = releases.filter((r) => r.status === 'pending_approval').length

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Credit Management"
        subtitle="Credit exposure = open invoices + delivered-not-billed + open order value − unapplied receipts, against the CRM credit limit. Over the limit, or an invoice overdue beyond its credit days, puts SO confirmation and dispatch on hold." />
      <OutstandingSubNav />
      <InfoBanner>
        A hold is lifted only by a <b>credit release</b> approved by a Finance approver (Approvals inbox; a Partner too for a large excess).
        Disputed amounts never count as overdue. Sales order confirmation blocks only when Sales › Settings › Credit check is &lsquo;Block&rsquo;;
        dispatch follows Finance › Settings › Credit check at dispatch.
      </InfoBanner>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Customers on hold" value={String(blocked)} tone={blocked ? '#b91c1c' : undefined} />
        <StatCard label="Releases waiting" value={String(pending)} tone={pending ? '#b45309' : undefined} />
        <StatCard label="Total exposure" value={inr(rows.reduce((s, r) => s + r.exposure, 0))} />
      </div>

      <TableWrap minWidth={1250} tour="fin-credit-table">
        <thead>
          <tr>
            <th style={thStyle}>Customer</th><th style={numTh}>Limit (₹)</th><th style={numTh}>Open invoices (₹)</th>
            <th style={numTh}>Delivered, not billed (₹)</th><th style={numTh}>Open orders (₹)</th><th style={numTh}>Unapplied (₹)</th>
            <th style={numTh}>Exposure (₹)</th><th style={numTh}>Available (₹)</th><th style={numTh}>Overdue (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={11} text="Loading…" />
            : rows.length === 0 ? <EmptyRow colSpan={11} text="No customer has a credit limit, open invoices or open orders." />
            : rows.map((r) => (
              <tr key={r.customer_id} style={{ background: r.would_block ? 'rgba(220,38,38,0.04)' : undefined }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.customer_name}</td>
                <td style={numTd}>{r.credit_limit != null ? inr(r.credit_limit) : '—'}</td>
                <td style={numTd}>{inr(r.open_ar, { blankZero: true })}</td>
                <td style={numTd}>{inr(r.unbilled_delivered, { blankZero: true })}</td>
                <td style={numTd}>{inr(r.open_order_value, { blankZero: true })}</td>
                <td style={{ ...numTd, color: '#b45309' }}>{inr(r.unapplied_credits, { blankZero: true })}</td>
                <td style={{ ...numTd, fontWeight: 700 }}>{inr(r.exposure)}</td>
                <td style={{ ...numTd, color: (r.available ?? 0) < 0 ? '#b91c1c' : TEXT.body }}>{r.available != null ? inr(r.available) : '—'}</td>
                <td style={{ ...numTd, color: r.overdue_amount > 0 ? '#b91c1c' : TEXT.muted }}>
                  {inr(r.overdue_amount, { blankZero: true })}{r.max_days_overdue > 0 && <div style={{ fontSize: 11 }}>{r.max_days_overdue} d</div>}
                </td>
                <td style={tdStyle} title={r.block_reasons.join('; ')}>
                  <StatusPill status={r.would_block ? 'hold' : 'ok'} labels={{ hold: 'On hold', ok: 'Within credit' }} colors={{ hold: '#dc2626', ok: '#16a34a' }} />
                </td>
                <td style={tdStyle}>
                  {r.would_block && <button style={linkBtnStyle} onClick={() => setRequestFor(r)}>Request release</button>}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      <div style={sectionStyle} data-tour="fin-credit-releases">
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 10px' }}>Credit releases</h2>
        <TableWrap minWidth={1100} maxHeight="420px">
          <thead>
            <tr>
              <th style={thStyle}>Release</th><th style={thStyle}>Customer</th><th style={thStyle}>For</th><th style={thStyle}>Order</th>
              <th style={thStyle}>Why blocked</th><th style={thStyle}>Reason given</th><th style={thStyle}>Status</th><th style={thStyle}>Valid until</th><th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {releases.length === 0 ? <EmptyRow colSpan={9} text="No credit release requested yet." />
              : releases.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.release_number}<div style={{ fontSize: 11, color: TEXT.muted }}>{r.requested_by_name}</div></td>
                  <td style={tdStyle}>{r.customer_name}</td>
                  <td style={tdStyle}>{CP_LABELS[r.checkpoint]}</td>
                  <td style={tdStyle}>{r.so_number || 'Any order'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, maxWidth: 280 }}>{r.block_reasons}</td>
                  <td style={{ ...tdStyle, fontSize: 12, maxWidth: 240 }}>{r.request_reason}{r.decision_comment && <div style={{ color: TEXT.muted }}>Decision: {r.decision_comment}</div>}</td>
                  <td style={tdStyle}>
                    <StatusPill status={r.status} labels={REL_LABELS} colors={REL_HEX} />
                    {r.status === 'pending_approval' && <div style={{ marginTop: 4 }}><ApprovalBadge status={r.approval_status} stage={r.approval_stage} /></div>}
                  </td>
                  <td style={tdStyle}>{r.valid_until ? dmy(r.valid_until) : '—'}</td>
                  <td style={tdStyle}>
                    {r.status === 'pending_approval' && r.requested_by_id === user?.id && (
                      <button style={{ ...linkBtnStyle, color: BRAND.primaryActive }} onClick={() => accountsApi.withdrawCreditRelease(r.id)
                        .then(() => setReload((k) => k + 1)).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not withdraw the release.')))}>Withdraw</button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </TableWrap>
        {can('accounts', 'credit_management', 'approve') && (
          <div style={{ fontSize: 12, color: TEXT.secondary }}>Approve or reject pending releases from your Approvals inbox (Organization › Approvals).</div>
        )}
      </div>

      {requestFor && (
        <CreditReleaseDialog position={requestFor} onClose={() => setRequestFor(null)}
          onDone={() => { setRequestFor(null); setReload((k) => k + 1) }} />
      )}
    </div>
  )
}
