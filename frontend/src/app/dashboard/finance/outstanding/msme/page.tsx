'use client'

/** MSME supplier dues (MSMED Act sec. 15-16, Income-tax sec. 43B(h)): open
 *  bills of micro / small / medium suppliers against their statutory pay-by
 *  date, and the year-end 43B(h) statement of micro / small dues unpaid beyond
 *  the limit (disallowed this year, allowed when paid). */
import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { msmeApi, MsmeAlertRow, Msme43bhRow } from '@/lib/mmLogisticsApi'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import OutstandingSubNav from '@/components/finance/OutstandingSubNav'
import {
  sectionStyle, thStyle, tdStyle, numTd, numTh, inr, dmy, inputStyle,
  ErrorBanner, InfoBanner, StatusPill, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'

const STATUS_LABELS: Record<string, string> = { breached: 'Past 45-day limit', due_soon: 'Due soon', ok: 'Within limit' }
const STATUS_HEX: Record<string, string> = { breached: '#dc2626', due_soon: '#f59e0b', ok: '#16a34a' }

function currentFyStart(): number {
  const d = new Date()
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

export default function MsmeDuesPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const [alerts, setAlerts] = useState<{ rows: MsmeAlertRow[]; breached_count: number; breached_amount: number; due_soon_count: number } | null>(null)
  const [fy, setFy] = useState(currentFyStart() - 1)
  const [report, setReport] = useState<{ financial_year: string; year_end: string; rows: Msme43bhRow[]; total_disallowed: number; excluded: Msme43bhRow[]; note: string } | null>(null)
  // Separate errors: a successful 43B(h) reload must not wipe an alerts failure.
  const [alertsError, setAlertsError] = useState<string[] | null>(null)
  const [reportError, setReportError] = useState<string[] | null>(null)
  const allowed = useCan().canFeature('accounts', 'outstanding', 'msme_dues', 'view')

  useEffect(() => {
    if (!isAuthorized || !allowed) return
    msmeApi.alerts().then((a) => { setAlerts(a); setAlertsError(null) })
      .catch((e) => setAlertsError(extractErrorMessages(e, 'Could not load MSME dues.')))
  }, [isAuthorized, allowed])

  useEffect(() => {
    if (!isAuthorized || !allowed) return
    msmeApi.report43bh(fy).then((r) => { setReport(r); setReportError(null) })
      .catch((e) => { setReport(null); setReportError(extractErrorMessages(e, 'Could not load the 43B(h) statement.')) })
  }, [isAuthorized, allowed, fy])

  if (isLoading || !isAuthorized) return null
  const years = Array.from({ length: Math.max(currentFyStart() - 2023 + 1, 1) }, (_, i) => 2023 + i)

  return (
    <div>
      <FinanceNav />
      <PageHeader title="MSME Dues"
        subtitle="Micro, small and medium suppliers (Udyam) must be paid within the agreed days — at most 45 days from acceptance, 15 if nothing is agreed. Set the MSME category on the vendor in Procurement › Vendors." />
      <OutstandingSubNav />
      {!allowed && (
        <InfoBanner tone="warning">
          You don&apos;t have view permission on MSME dues (Finance &amp; Accounting › Receivables &amp; Payables › MSME dues).
          Ask an admin to grant it in Organization › Role &amp; Permissions.
        </InfoBanner>
      )}
      <ErrorBanner error={[...(alertsError || []), ...(reportError || [])]} />
      {allowed && alerts && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatCard label="Bills past the limit" value={String(alerts.breached_count)} tone="#dc2626" />
          <StatCard label="Amount past the limit" value={inr(alerts.breached_amount)} tone="#dc2626" />
          <StatCard label="Due within 7 days" value={String(alerts.due_soon_count)} tone="#f59e0b" />
        </div>
      )}
      {allowed && <>
      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 800 }}>Open MSME bills — 45-day limit</h3>
        <TableWrap minWidth={980}>
          <thead>
            <tr>
              <th style={thStyle}>Vendor</th><th style={thStyle}>Category</th><th style={thStyle}>Bill</th><th style={thStyle}>Bill date</th>
              <th style={thStyle}>Pay by</th><th style={numTh}>Days left</th><th style={numTh}>Amount due</th><th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {!alerts || alerts.rows.length === 0 ? <EmptyRow colSpan={8} text={alerts ? 'No open bills of MSME suppliers.' : alertsError ? 'MSME dues could not be loaded — see the message above.' : 'Loading…'} /> : alerts.rows.map((r) => (
              <tr key={r.invoice_id}>
                <td style={tdStyle}>{r.vendor_name} <span style={{ opacity: 0.6 }}>({r.vendor_code})</span></td>
                <td style={tdStyle}>{r.msme_category}</td>
                <td style={tdStyle}>{r.invoice_number}</td>
                <td style={tdStyle}>{dmy(r.invoice_date)}</td>
                <td style={tdStyle}>{dmy(r.pay_by)} <span style={{ opacity: 0.6 }}>({r.limit_days} d)</span></td>
                <td style={numTd}>{r.days_left}</td>
                <td style={numTd}>{inr(r.amount_due)}</td>
                <td style={tdStyle}><StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Sec. 43B(h) statement</h3>
          <select style={{ ...inputStyle, width: 140 }} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>FY {y}-{String((y + 1) % 100).padStart(2, '0')}</option>)}
          </select>
          {report && <span style={{ fontSize: 13, fontWeight: 700 }}>Disallowed: {inr(report.total_disallowed)}</span>}
        </div>
        {report && <InfoBanner>{report.note} Medium enterprises and traders are listed separately — outside 43B(h).</InfoBanner>}
        <TableWrap minWidth={900}>
          <thead>
            <tr>
              <th style={thStyle}>Vendor</th><th style={thStyle}>Udyam</th><th style={thStyle}>Bill</th><th style={thStyle}>Bill date</th>
              <th style={thStyle}>Pay by</th><th style={numTh}>Days beyond</th><th style={numTh}>Unpaid at 31 March</th>
            </tr>
          </thead>
          <tbody>
            {!report || report.rows.length === 0 ? <EmptyRow colSpan={7} text={report ? 'Nothing disallowed for this year.' : reportError ? 'The 43B(h) statement could not be loaded — see the message above.' : 'Loading…'} /> : report.rows.map((r) => (
              <tr key={`${r.vendor_code}-${r.invoice_number}`}>
                <td style={tdStyle}>{r.vendor_name} ({r.msme_category})</td>
                <td style={tdStyle}>{r.udyam_number || '—'}</td>
                <td style={tdStyle}>{r.invoice_number}</td>
                <td style={tdStyle}>{dmy(r.invoice_date)}</td>
                <td style={tdStyle}>{dmy(r.pay_by)}</td>
                <td style={numTd}>{r.days_beyond_limit}</td>
                <td style={numTd}>{inr(r.unpaid_at_year_end)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
      </>}
    </div>
  )
}
