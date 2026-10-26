'use client'

/** Financial reports — Trial Balance, Schedule III P&L and Balance Sheet,
 *  Cash Flow (AS-3 indirect), AR/AP aging, budget variance, the monthly
 *  close pack and the year-end close. Every figure comes straight from posted
 *  journal lines for the dates asked (backend: accounts/reports.py). */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import {
  TrialBalance, TrialBalanceRow, GLLedger, ProfitAndLoss, BalanceSheet, CashFlow, CashFlowLine, AgingReport,
  VarianceAnalysis, MonthlyReportPack, YearEndPreview, AccountsSetup, StatementHead,
} from '@/types'
import { TEXT, BORDER, BRAND } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import MessageDialog from '@/components/erp/MessageDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import {
  inr, dmy, todayIso, currentPeriod, fyStartIso, inputStyle, labelStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle,
  linkBtnStyle, thStyle, tdStyle, numTd, numTh, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader, TableWrap,
  EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { RowCount, pillStyle } from '@/components/shared/ui'
import { VOUCHER_LABELS } from '@/components/finance/voucherLabels'
import { CostCenterReport, InternalOrdersReport } from '@/components/finance/ControllingReports'
import Select from '@/components/shared/Select'

const TABS = ['Trial Balance', 'Profit & Loss', 'Balance Sheet', 'Cash Flow', 'Aging', 'Budget Variance', 'Cost Centres', 'Internal Orders', 'Monthly Pack', 'Year-end Close'] as const
type Tab = typeof TABS[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. */
const TAB_KEYS: Record<Tab, string> = {
  'Trial Balance': 'financial_reports', 'Profit & Loss': 'financial_reports', 'Balance Sheet': 'financial_reports', 'Cash Flow': 'financial_reports',
  Aging: 'financial_reports', 'Budget Variance': 'financial_reports', 'Cost Centres': 'financial_reports', 'Internal Orders': 'financial_reports', 'Monthly Pack': 'financial_reports', 'Year-end Close': 'year_end_close',
}
const RANGE_TABS: Tab[] = ['Trial Balance', 'Profit & Loss', 'Balance Sheet', 'Cash Flow', 'Budget Variance', 'Cost Centres', 'Internal Orders']
/** Position-on-a-date tabs: only the "to" date applies. */
const AS_AT_TABS: Tab[] = ['Balance Sheet', 'Internal Orders']

const GREEN = '#16a34a'
const RED = '#dc2626'
const FY_STATUS_HEX: Record<string, string> = { open: GREEN, closed: '#64748b', locked: '#b45309' }
const BUCKETS = [
  { key: 'not_due', label: 'Not due' }, { key: '1_30', label: '1–30' }, { key: '31_60', label: '31–60' },
  { key: '61_90', label: '61–90' }, { key: 'over_90', label: '> 90' },
] as const
const BUCKET_HEX: Record<string, string> = { not_due: GREEN, '1_30': '#f59e0b', '31_60': '#b45309', '61_90': RED, over_90: '#991b1b' }
const BUCKET_LABELS: Record<string, string> = { not_due: 'Not due', '1_30': '1–30 days', '31_60': '31–60 days', '61_90': '61–90 days', over_90: '90+ days' }
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
const letter = (i: number) => String.fromCharCode(97 + i)

// ─── date helpers ────────────────────────────────────────────────────────
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function quickRange(kind: 'this_month' | 'last_month' | 'this_fy' | 'last_fy'): [string, string] {
  const now = new Date()
  if (kind === 'this_month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), todayIso()]
  if (kind === 'last_month') return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))]
  const fyYear = Number(fyStartIso().slice(0, 4))
  if (kind === 'this_fy') return [fyStartIso(), todayIso()]
  return [`${fyYear - 1}-04-01`, `${fyYear}-03-31`]
}
/** Running balance stored as debit-minus-credit → "1,200.00 Dr". */
function drcr(n: number): string {
  if (Math.abs(n) < 0.005) return '0.00'
  return `${inr(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`
}
const signColor = (n: number) => (n < 0 ? RED : undefined)

// ─── small presentational pieces ─────────────────────────────────────────
function BalancedPill({ ok, okText = 'Balanced', badText = 'Out of balance' }: { ok: boolean; okText?: string; badText?: string }) {
  const c = ok ? GREEN : RED
  return <span style={pillStyle(c)}>{ok ? `✓ ${okText}` : badText}</span>
}

function ReportTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{title}</h2>
        {sub && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

const caret = (open: boolean) => <span style={{ display: 'inline-block', width: 14, color: TEXT.muted, fontSize: 10 }}>{open ? '▼' : '▶'}</span>

/** One line of a vertical statement (P&L / BS / Cash Flow). */
function StmtLine({ label, amount, level = 0, bold, heading, total, onToggle, open, tone, muted }: {
  label: React.ReactNode; amount?: number | null; level?: number; bold?: boolean; heading?: boolean; total?: boolean
  onToggle?: () => void; open?: boolean; tone?: string; muted?: boolean
}) {
  const base: React.CSSProperties = {
    ...tdStyle, paddingLeft: 12 + level * 20, fontWeight: heading || bold || total ? 700 : 500,
    color: muted ? TEXT.secondary : TEXT.body, fontSize: muted ? 12 : 12.5,
    ...(heading ? { textTransform: 'uppercase', letterSpacing: '.03em', background: `${BRAND.primary}0a` } : {}),
    ...(total ? { borderTop: `2px solid ${BORDER.normal}` } : {}),
  }
  return (
    <tr>
      <td style={{ ...base, cursor: onToggle ? 'pointer' : undefined }} onClick={onToggle}>
        {onToggle && caret(!!open)}{label}
      </td>
      <td style={{ ...numTd, fontWeight: base.fontWeight, fontSize: base.fontSize, color: tone || signColor(amount ?? 0) || base.color,
        ...(heading ? { background: `${BRAND.primary}0a` } : {}), ...(total ? { borderTop: `2px solid ${BORDER.normal}` } : {}) }}>
        {amount == null ? '' : inr(amount)}
      </td>
    </tr>
  )
}

/** A Schedule III head with its ledgers folded underneath. */
function HeadLines({ head, prefix, level, openMap, toggle }: {
  head: StatementHead; prefix: string; level: number; openMap: Record<string, boolean>; toggle: (k: string) => void
}) {
  const key = `${prefix}:${head.head}`
  const open = !!openMap[key]
  const canOpen = head.ledgers.length > 0
  return (
    <>
      <StmtLine label={head.label} amount={head.amount} level={level} onToggle={canOpen ? () => toggle(key) : undefined} open={open} />
      {open && head.ledgers.map((l, i) => (
        <StmtLine key={`${key}:${l.gl_account_id ?? 'x'}:${i}`} level={level + 1} muted amount={l.amount}
          label={<>{l.code ? <span style={{ fontWeight: 600 }}>{l.code} — </span> : null}{l.name}</>} />
      ))}
    </>
  )
}

/** Statement header; `count` = data lines (heads / ledger lines), headings and totals excluded. */
const statementHead = (count: number) => (
  <thead>
    <tr><th style={thStyle}>Particulars <RowCount count={count} /></th><th style={{ ...numTh, width: 180 }}>Amount (₹)</th></tr>
  </thead>
)

// ─────────────────────────────────────────────────────────────────────────

export default function FinanceReportsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs: visibleTabs, tab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const { can } = useCan()
  const [fromDate, setFromDate] = useState(fyStartIso())
  const [toDate, setToDate] = useState(todayIso())
  const [error, setError] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setOpenMap((m) => ({ ...m, [k]: !m[k] }))

  const [tb, setTb] = useState<TrialBalance | null>(null)
  const [pl, setPl] = useState<ProfitAndLoss | null>(null)
  const [bs, setBs] = useState<BalanceSheet | null>(null)
  const [cf, setCf] = useState<CashFlow | null>(null)
  const [agingSide, setAgingSide] = useState<'Receivables (AR)' | 'Payables (AP)'>('Receivables (AR)')
  const [arAging, setArAging] = useState<AgingReport | null>(null)
  const [apAging, setApAging] = useState<AgingReport | null>(null)
  const [variance, setVariance] = useState<VarianceAnalysis | null>(null)
  // Budget Variance → Internal Orders drill (KOB1)
  const [ioFocus, setIoFocus] = useState<number | null>(null)
  const [packPeriod, setPackPeriod] = useState(currentPeriod())
  const [pack, setPack] = useState<MonthlyReportPack | null>(null)

  // Ledger drill-down (Trial Balance)
  const [ledgerRow, setLedgerRow] = useState<TrialBalanceRow | null>(null)
  const [ledger, setLedger] = useState<GLLedger | null>(null)
  const [ledgerErr, setLedgerErr] = useState<{ id: number; msgs: string[] } | null>(null)

  // Year-end
  const [setup, setSetup] = useState<AccountsSetup | null>(null)
  const [fyCode, setFyCode] = useState('')
  const [preview, setPreview] = useState<YearEndPreview | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [promptReopen, setPromptReopen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null)

  const isAdmin = user?.role === 'admin'
  // Anyone with Approve may request the close; a Finance Manager's (or admin's) click closes at once (approval engine).
  const closesDirectly = !!user?.is_finance_manager || isAdmin
  const canClose = can('accounts', 'year_end_close', 'approve')

  useEffect(() => {
    if (!isAuthorized) return
    accountsApi.getSetup().then((s: AccountsSetup) => {
      setSetup(s)
      setFyCode((cur) => cur || s.current_financial_year?.code || s.financial_years?.[0]?.code || '')
    }).catch((err: unknown) => setError(extractErrorMessages(err, "Couldn't load the financial-year setup (Finance > Setup)")))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    if (RANGE_TABS.includes(tab) && (!fromDate || !toDate)) return
    let cancelled = false
    const range = { from_date: fromDate, to_date: toDate }
    const run = async () => {
      setError(null)
      setLoading(true)
      try {
        if (tab === 'Trial Balance') { const d = await accountsApi.getTrialBalance(range); if (!cancelled) setTb(d) }
        else if (tab === 'Profit & Loss') { const d = await accountsApi.getProfitAndLoss(range); if (!cancelled) setPl(d) }
        else if (tab === 'Balance Sheet') { const d = await accountsApi.getBalanceSheet({ as_of: toDate }); if (!cancelled) setBs(d) }
        else if (tab === 'Cash Flow') { const d = await accountsApi.getCashFlow(range); if (!cancelled) setCf(d) }
        else if (tab === 'Aging') {
          const [ar, ap] = await Promise.all([accountsApi.getARAging(), accountsApi.getAPAging()])
          if (!cancelled) { setArAging(ar); setApAging(ap) }
        }
        else if (tab === 'Budget Variance') { const d = await accountsApi.getVarianceAnalysis(range); if (!cancelled) setVariance(d) }
        else if (tab === 'Monthly Pack') { if (packPeriod) { const d = await accountsApi.getMonthlyReportPack(packPeriod); if (!cancelled) setPack(d) } }
        else if (tab === 'Year-end Close') { if (fyCode) { const d = await accountsApi.yearEndPreview(fyCode); if (!cancelled) setPreview(d) } }
      } catch (err: unknown) {
        if (!cancelled) setError(extractErrorMessages(err, `Couldn't load the ${tab} report`))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [isAuthorized, tab, fromDate, toDate, packPeriod, fyCode, reloadKey])

  /** Trial Balance drill-down: the ledger's statement for the same range. */
  const openLedger = (row: TrialBalanceRow) => {
    setLedgerRow(row)
    setLedger(null)
    setLedgerErr(null)
    accountsApi.getGLLedger(row.gl_account_id, fromDate, toDate)
      .then((d: GLLedger) => setLedger(d))
      .catch((err: unknown) => setLedgerErr({ id: row.gl_account_id, msgs: extractErrorMessages(err, `Couldn't load the ledger statement for ${row.code}`) }))
  }

  const tbGroups = useMemo(() => {
    if (!tb) return []
    const out: { name: string; rows: TrialBalanceRow[]; sub: Record<string, number> }[] = []
    for (const r of tb.rows) {
      const name = r.primary_group || 'Ungrouped ledgers'
      let g = out.find((x) => x.name === name)
      if (!g) { g = { name, rows: [], sub: { opening_debit: 0, opening_credit: 0, debit: 0, credit: 0, closing_debit: 0, closing_credit: 0 } }; out.push(g) }
      g.rows.push(r)
      for (const k of Object.keys(g.sub)) g.sub[k] = Math.round((g.sub[k] + Number(r[k as keyof TrialBalanceRow] || 0)) * 100) / 100
    }
    return out
  }, [tb])

  const doClose = async () => {
    setConfirmClose(false)
    setBusy(true)
    setError(null)
    try {
      const res: { entry_number?: string; approval_status?: string; message?: string } = await accountsApi.closeFinancialYear(fyCode)
      if (res.approval_status === 'pending') setMessage({ title: `Close of ${fyCode} submitted for approval`, text: res.message || 'A Finance Manager must approve it.' })
      else setMessage({ title: `Financial year ${fyCode} closed`, text: `Closing voucher ${res.entry_number} posted on ${dmy(preview?.end_date)}. Income and expense ledgers are now zero for ${fyCode}; the result sits in Retained Earnings.` })
      const s = await accountsApi.getSetup(); setSetup(s)
      setReloadKey((k) => k + 1)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Couldn't close financial year ${fyCode}`))
    } finally { setBusy(false) }
  }

  const doReopen = async (reason: string) => {
    setPromptReopen(false)
    setBusy(true)
    setError(null)
    try {
      const res = await accountsApi.reopenFinancialYear(fyCode, reason.trim())
      setMessage({ title: `Financial year ${fyCode} reopened`, text: `The closing voucher was reversed by ${res.entry_number}. Postings into ${fyCode} are allowed again — close the year again once the corrections are done.` })
      const s = await accountsApi.getSetup(); setSetup(s)
      setReloadKey((k) => k + 1)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Couldn't reopen financial year ${fyCode}`))
    } finally { setBusy(false) }
  }

  if (isLoading || !isAuthorized) return null

  // A late response for a ledger that's no longer open is ignored.
  const ledgerShown = ledger && ledgerRow && ledger.gl_account_id === ledgerRow.gl_account_id ? ledger : null
  const ledgerError = ledgerErr && ledgerRow && ledgerErr.id === ledgerRow.gl_account_id ? ledgerErr.msgs : null
  const rangeLabel = `${dmy(fromDate)} to ${dmy(toDate)}`
  const setRange = (k: Parameters<typeof quickRange>[0]) => { const [f, t] = quickRange(k); setFromDate(f); setToDate(t) }
  const quickActive = (k: Parameters<typeof quickRange>[0]) => { const [f, t] = quickRange(k); return f === fromDate && t === toDate }

  // ─── Trial Balance ──────────────────────────────────────────────────────
  const renderTrialBalance = () => (
    <>
      <ReportTitle title="Trial Balance" sub={tb ? `${dmy(tb.from_date)} to ${dmy(tb.to_date)} · click a ledger to see its statement` : undefined}
        right={tb && <BalancedPill ok={tb.is_balanced} />} />
      <TableWrap minWidth={1050} maxHeight="none" tour="fin-rep-tb-table">
        <thead>
          <tr>
            <th style={thStyle}>Code <RowCount count={tb ? tb.rows.length : 0} /></th><th style={thStyle}>Ledger</th><th style={thStyle}>Group</th>
            <th style={numTh}>Opening Dr</th><th style={numTh}>Opening Cr</th><th style={numTh}>Debit</th>
            <th style={numTh}>Credit</th><th style={numTh}>Closing Dr</th><th style={numTh}>Closing Cr</th>
          </tr>
        </thead>
        <tbody>
          {!tb ? <EmptyRow colSpan={9} text={loading ? 'Loading…' : 'No data.'} />
            : tb.rows.length === 0 ? <EmptyRow colSpan={9} text="No ledger has a balance or movement in this range." />
            : tbGroups.map((g) => (
              <React.Fragment key={g.name}>
                <tr>
                  <td colSpan={3} style={{ ...tdStyle, fontWeight: 800, background: `${BRAND.primary}0a`, textTransform: 'uppercase', letterSpacing: '.03em', fontSize: 12 }}>{g.name}</td>
                  {(['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'] as const).map((k) => (
                    <td key={k} style={{ ...numTd, fontWeight: 700, background: `${BRAND.primary}0a` }}>{inr(g.sub[k], { blankZero: true })}</td>
                  ))}
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.gl_account_id} onClick={() => openLedger(r)} style={{ cursor: 'pointer' }} title="Open ledger statement">
                    <td style={{ ...tdStyle, fontWeight: 600, paddingLeft: 24 }}>{r.code}</td>
                    <td style={{ ...tdStyle, color: BRAND.primaryActive }}>{r.name}</td>
                    <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.group_name || '—'}</td>
                    <td style={numTd}>{inr(r.opening_debit, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.opening_credit, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.debit, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.credit, { blankZero: true })}</td>
                    <td style={{ ...numTd, fontWeight: 600 }}>{inr(r.closing_debit, { blankZero: true })}</td>
                    <td style={{ ...numTd, fontWeight: 600 }}>{inr(r.closing_credit, { blankZero: true })}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
        </tbody>
        {tb && tb.rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={3} style={{ ...tdStyle, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>Grand total</td>
              {(['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'] as const).map((k) => (
                <td key={k} style={{ ...numTd, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}`, color: tb.is_balanced ? GREEN : RED }}>{inr(tb.totals[k])}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </TableWrap>
      <InfoBanner>
        Every double entry has equal debits and credits, so the Debit and Credit columns — and the closing Dr and Cr columns — must
        total the same. If they don&apos;t, something was posted outside the ledger engine and should be investigated before reports are relied on.
      </InfoBanner>
    </>
  )

  // ─── P&L ────────────────────────────────────────────────────────────────
  const renderPL = () => {
    if (!pl) return <p style={{ fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading…' : 'No data.'}</p>
    const rev = pl.income.find((h) => h.head === 'revenue_from_operations')
    const other = pl.income.find((h) => h.head === 'other_income')
    const profitTone = pl.profit_for_period >= 0 ? GREEN : RED
    return (
      <>
        <div data-tour="fin-rep-pl-stats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatCard label="Total income" value={`₹ ${inr(pl.total_income)}`} />
          <StatCard label="Total expenses" value={`₹ ${inr(pl.total_expenses)}`} />
          <StatCard label="Gross profit (trading)" value={`₹ ${inr(pl.gross_profit)}`} tone={pl.gross_profit >= 0 ? GREEN : RED} />
          <StatCard label={pl.profit_for_period >= 0 ? 'Profit for the period' : 'Loss for the period'} value={`₹ ${inr(pl.profit_for_period)}`} tone={profitTone} />
        </div>
        <ReportTitle title="Statement of Profit and Loss" sub={`For the period ${dmy(pl.from_date)} to ${dmy(pl.to_date)} · Schedule III, Division I · click a head to see its ledgers`} />
        <TableWrap minWidth={560} maxHeight="none" tour="fin-rep-pl-table">
          {statementHead((rev ? 1 : 0) + (other ? 1 : 0) + pl.expenses.length + 1)}
          <tbody>
            {rev && <HeadLines head={{ ...rev, label: `I. ${rev.label}` }} prefix="pl" level={0} openMap={openMap} toggle={toggle} />}
            {other && <HeadLines head={{ ...other, label: `II. ${other.label}` }} prefix="pl" level={0} openMap={openMap} toggle={toggle} />}
            <StmtLine label="III. Total income (I + II)" amount={pl.total_income} total />
            <StmtLine label="IV. Expenses" heading />
            {pl.expenses.map((h) => <HeadLines key={h.head} head={h} prefix="pl" level={1} openMap={openMap} toggle={toggle} />)}
            <StmtLine label="Total expenses (IV)" amount={pl.total_expenses} total />
            <StmtLine label="V. Profit before tax (III − IV)" amount={pl.profit_before_tax} bold tone={pl.profit_before_tax >= 0 ? GREEN : RED} />
            <HeadLines head={{ ...pl.tax_expense, label: `VI. ${pl.tax_expense.label}` }} prefix="pl" level={0} openMap={openMap} toggle={toggle} />
            <StmtLine label={`VII. ${pl.profit_for_period >= 0 ? 'Profit' : 'Loss'} for the period (V − VI)`} amount={pl.profit_for_period} total tone={profitTone} />
          </tbody>
        </TableWrap>
        <InfoBanner>
          Gross profit is the trading view: sales less direct costs (ledgers in groups marked &quot;affects gross profit&quot; — purchases,
          direct expenses, stock change). The Schedule III statement above is the statutory format; cost of materials consumed there is
          opening stock + purchases − closing stock, so post the closing-stock voucher before reading month-end profit.
        </InfoBanner>
      </>
    )
  }

  // ─── Balance Sheet ──────────────────────────────────────────────────────
  const renderBS = () => {
    if (!bs) return <p style={{ fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading…' : 'No data.'}</p>
    return (
      <>
        <ReportTitle title="Balance Sheet" sub={`As at ${dmy(bs.as_of)} · Schedule III, Division I · click a head to see its ledgers`}
          right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!bs.is_balanced && <span style={{ fontSize: 12, color: RED, fontWeight: 700 }}>Difference {inr(bs.difference)}</span>}
            <BalancedPill ok={bs.is_balanced} />
          </div>} />
        <TableWrap minWidth={560} maxHeight="none" tour="fin-rep-bs-table">
          {statementHead(bs.sections.reduce((n, s) => n + s.subsections.reduce((m, sub) => m + Math.max(1, sub.heads.filter((h) => h.ledgers.length > 0 || Math.abs(h.amount) >= 0.005).length), 0), 0))}
          <tbody>
            {bs.sections.map((s, si) => (
              <React.Fragment key={s.key}>
                <StmtLine label={`${ROMAN[si]}. ${s.label}`} heading />
                {s.subsections.map((sub, ui) => {
                  const heads = sub.heads.filter((h) => h.ledgers.length > 0 || Math.abs(h.amount) >= 0.005)
                  return (
                    <React.Fragment key={sub.label}>
                      <StmtLine label={`(${ui + 1}) ${sub.label}`} level={1} bold />
                      {heads.length === 0
                        ? <StmtLine label="—" level={2} muted amount={0} />
                        : heads.map((h, hi) => (
                          <HeadLines key={h.head} head={{ ...h, label: `(${letter(hi)}) ${h.label}` }} prefix={`bs:${s.key}`} level={2} openMap={openMap} toggle={toggle} />
                        ))}
                      <StmtLine label={`Total ${sub.label.toLowerCase()}`} amount={sub.amount} level={1} bold muted />
                    </React.Fragment>
                  )
                })}
                <StmtLine label={`Total ${s.label.toLowerCase()}`} amount={s.amount} total tone={bs.is_balanced ? GREEN : RED} />
              </React.Fragment>
            ))}
          </tbody>
        </TableWrap>
        {Math.abs(bs.profit_and_loss_surplus) >= 0.005 && (
          <InfoBanner>
            <strong>Surplus in the Statement of Profit &amp; Loss (not yet closed) — {inr(bs.profit_and_loss_surplus)}</strong> is the
            cumulative income minus expenses that hasn&apos;t yet been transferred to Retained Earnings by a year-end close. It is shown
            inside Reserves and Surplus so the sheet balances; running Year-end Close moves it into Retained Earnings permanently.
          </InfoBanner>
        )}
        {!bs.is_balanced && (
          <InfoBanner tone="warning">
            Assets differ from Equity &amp; Liabilities by {inr(bs.difference)}. Check the Trial Balance for the same range — if it is
            balanced, a ledger is probably mapped to the wrong account group (Finance &gt; Masters &gt; Account Groups).
          </InfoBanner>
        )}
      </>
    )
  }

  // ─── Cash Flow ──────────────────────────────────────────────────────────
  const renderCF = () => {
    if (!cf) return <p style={{ fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading…' : 'No data.'}</p>
    const block = (title: string, lines: CashFlowLine[], net: number, netLabel: string) => (
      <>
        <StmtLine label={title} heading />
        {lines.map((l) => <StmtLine key={l.label} label={l.label} amount={l.amount} level={1} muted={Math.abs(l.amount) < 0.005} />)}
        <StmtLine label={netLabel} amount={net} total />
      </>
    )
    const ok = Math.abs(cf.difference) < 0.005
    return (
      <>
        <ReportTitle title="Cash Flow Statement (indirect method, AS-3)" sub={`For the period ${dmy(cf.from_date)} to ${dmy(cf.to_date)}`}
          right={<BalancedPill ok={ok} okText="Reconciles to cash" badText={`Doesn't reconcile — difference ${inr(cf.difference)}`} />} />
        <TableWrap minWidth={560} maxHeight="none" tour="fin-rep-cf-table">
          {statementHead(cf.operating.length + cf.investing.length + cf.financing.length)}
          <tbody>
            {block('A. Cash flow from operating activities', cf.operating, cf.net_operating, 'Net cash from operating activities (A)')}
            {block('B. Cash flow from investing activities', cf.investing, cf.net_investing, 'Net cash from investing activities (B)')}
            {block('C. Cash flow from financing activities', cf.financing, cf.net_financing, 'Net cash from financing activities (C)')}
            <StmtLine label="Net increase/(decrease) in cash and cash equivalents (A + B + C)" amount={cf.net_change} bold />
            <StmtLine label="Cash and cash equivalents at the beginning of the period" amount={cf.opening_cash} />
            <StmtLine label="Cash and cash equivalents at the end of the period" amount={cf.closing_cash} total />
            <StmtLine label={ok ? '✓ Check: opening cash + net change = closing cash' : '✗ Check: opening cash + net change ≠ closing cash'}
              amount={cf.difference} tone={ok ? GREEN : RED} bold />
          </tbody>
        </TableWrap>
        <InfoBanner>
          The indirect method starts from profit before tax, adds back non-cash charges (depreciation) and adjusts for changes in
          working capital — an increase in receivables or stock uses cash, an increase in payables provides it. Because every line is
          derived from Balance Sheet movements, the statement must reconcile exactly to the change in cash and bank balances.
        </InfoBanner>
      </>
    )
  }

  // ─── Aging ──────────────────────────────────────────────────────────────
  const renderAging = () => {
    const isAR = agingSide === 'Receivables (AR)'
    const rep = isAR ? arAging : apAging
    const partyWord = isAR ? 'Customer' : 'Vendor'
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <SubTabs tabs={['Receivables (AR)', 'Payables (AP)'] as const} value={agingSide} onChange={setAgingSide} />
          <Link href="/dashboard/finance/outstanding" data-tour="fin-rep-aging-outstanding-link" style={{ ...linkBtnStyle, fontSize: 12.5, marginBottom: 20 }}>Open outstanding &amp; party statements →</Link>
        </div>
        <InfoBanner>
          Aging is a point-in-time view as of today: each unpaid posted invoice is placed in a bucket by days past its due date.
          Advances (unallocated payments and {isAR ? 'credit' : 'debit'} notes) are shown separately — allocate them against bills in
          Payments so the outstanding is net.
        </InfoBanner>
        <ReportTitle title={`${isAR ? 'Accounts receivable' : 'Accounts payable'} — party-wise aging`} sub={`Amount (₹) as of ${dmy(todayIso())}`} />
        <TableWrap minWidth={1000} maxHeight="none" tour="fin-rep-aging-table">
          <thead>
            <tr>
              <th style={thStyle}>{partyWord} <RowCount count={rep ? rep.parties.length : 0} /></th><th style={numTh}>Bills</th>
              {BUCKETS.map((b) => <th key={b.key} style={numTh}>{b.label}</th>)}
              <th style={numTh}>Outstanding</th><th style={numTh}>Advances</th><th style={numTh}>Net</th>
            </tr>
          </thead>
          <tbody>
            {!rep ? <EmptyRow colSpan={10} text={loading ? 'Loading…' : 'No data.'} />
              : rep.parties.length === 0 ? <EmptyRow colSpan={10} text={`No ${partyWord.toLowerCase()} has anything outstanding.`} />
              : rep.parties.map((p) => (
                <tr key={p.party_id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{p.party_name}</td>
                  <td style={numTd}>{p.open_bills}</td>
                  {BUCKETS.map((b) => <td key={b.key} style={{ ...numTd, color: b.key !== 'not_due' && p[b.key] > 0 ? BUCKET_HEX[b.key] : undefined }}>{inr(p[b.key], { blankZero: true })}</td>)}
                  <td style={{ ...numTd, fontWeight: 700 }}>{inr(p.outstanding)}</td>
                  <td style={numTd}>{inr(p.advances, { blankZero: true })}</td>
                  <td style={{ ...numTd, fontWeight: 700 }}>{inr(p.net)}</td>
                </tr>
              ))}
          </tbody>
          {rep && rep.parties.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} style={{ ...tdStyle, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>Total</td>
                {[...BUCKETS.map((b) => b.key), 'outstanding', 'advances', 'net'].map((k) => (
                  <td key={k} style={{ ...numTd, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>{inr(rep.totals[k] ?? 0)}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </TableWrap>
        <ReportTitle title="Bill-wise detail" sub="Oldest due first" />
        <TableWrap minWidth={760} maxHeight="none" tour="fin-rep-aging-bills">
          <thead>
            <tr>
              <th style={thStyle}>Bill no. <RowCount count={rep ? rep.rows.length : 0} /></th><th style={thStyle}>{partyWord}</th><th style={thStyle}>Due date</th>
              <th style={numTh}>Days overdue</th><th style={numTh}>Amount due (₹)</th><th style={thStyle}>Bucket</th>
            </tr>
          </thead>
          <tbody>
            {!rep ? <EmptyRow colSpan={6} text={loading ? 'Loading…' : 'No data.'} />
              : rep.rows.length === 0 ? <EmptyRow colSpan={6} text="No open bills." />
              : rep.rows.map((r, i) => (
                <tr key={`${r.invoice_number}-${i}`}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.invoice_number}</td>
                  <td style={tdStyle}>{r.party_name}</td>
                  <td style={tdStyle}>{dmy(r.due_date)}</td>
                  <td style={numTd}>{r.days_overdue || ''}</td>
                  <td style={{ ...numTd, fontWeight: 600 }}>{inr(r.amount_due)}</td>
                  <td style={tdStyle}><StatusPill status={r.bucket} labels={BUCKET_LABELS} colors={BUCKET_HEX} /></td>
                </tr>
              ))}
          </tbody>
          {rep && rep.rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} style={{ ...tdStyle, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>Total due</td>
                <td style={{ ...numTd, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>{inr(rep.total_due)}</td>
                <td style={{ ...tdStyle, borderTop: `2px solid ${BORDER.normal}` }} />
              </tr>
            </tfoot>
          )}
        </TableWrap>
      </>
    )
  }

  // ─── Budget variance ────────────────────────────────────────────────────
  const renderVariance = () => (
    <>
      <InfoBanner>
        Budget vs actual for the selected range. A cost centre&apos;s <strong>annual</strong> budget is pro-rated to the number of months
        in the range (3 months = 3/12 of the budget; the full FY = the full budget). An internal order&apos;s budget covers its whole
        life, so it&apos;s compared life to date. Positive variance = spent more than budgeted (red). Click an internal order to see its line items and open POs.
      </InfoBanner>
      <ReportTitle title="Budget variance" sub={variance ? `${dmy(variance.from_date)} to ${dmy(variance.to_date)}` : undefined} />
      <TableWrap minWidth={860} maxHeight="none" tour="fin-rep-variance-table">
        <thead>
          <tr>
            <th style={thStyle}>Type <RowCount count={variance ? variance.rows.length : 0} /></th><th style={thStyle}>Code</th><th style={thStyle}>Name</th>
            <th style={numTh}>Budget (₹)</th><th style={numTh}>Actual (₹)</th><th style={numTh}>Variance (₹)</th><th style={numTh}>Variance %</th>
          </tr>
        </thead>
        <tbody>
          {!variance ? <EmptyRow colSpan={7} text={loading ? 'Loading…' : 'No data.'} />
            : variance.rows.length === 0 ? <EmptyRow colSpan={7} text={variance.note || 'Nothing to compare.'} />
            : variance.rows.map((r, i) => {
              const c = r.variance > 0.005 ? RED : GREEN
              return (
                <tr key={`${r.type}-${r.code}-${i}`}
                  onClick={r.type === 'internal_order' && r.id ? () => { setIoFocus(r.id!); setTab('Internal Orders') } : undefined}
                  style={r.type === 'internal_order' && r.id ? { cursor: 'pointer' } : undefined}
                  title={r.type === 'internal_order' ? 'Open the order’s line items, commitments and available budget' : undefined}>
                  <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.type === 'cost_center' ? 'Cost centre' : 'Internal order'}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.code}</td>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={numTd}>{inr(r.budgeted_amount)}</td>
                  <td style={numTd}>{inr(r.actual_amount)}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: c }}>{inr(r.variance)}</td>
                  <td style={{ ...numTd, color: c }}>{r.variance_pct != null ? `${r.variance_pct.toFixed(1)}%` : '—'}</td>
                </tr>
              )
            })}
        </tbody>
      </TableWrap>
    </>
  )

  // ─── Monthly pack ───────────────────────────────────────────────────────
  const renderPack = () => {
    const kv = (label: string, value: React.ReactNode, tone?: string) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '4px 0', fontSize: 12.5, borderTop: `1px solid ${BORDER.light}` }}>
        <span style={{ color: TEXT.secondary }}>{label}</span>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone }}>{value}</span>
      </div>
    )
    const card = (title: string, children: React.ReactNode, right?: React.ReactNode) => (
      <div style={{ ...sectionStyle, flex: '1 1 300px', maxWidth: 520, marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{title}</h3>{right}
        </div>
        {children}
      </div>
    )
    return (
      <>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div data-tour="fin-rep-pack-month" style={{ flex: '0 1 170px' }}>
            <label style={labelStyle}>Month</label>
            <input type="month" style={inputStyle} value={packPeriod} onChange={(e) => setPackPeriod(e.target.value)} />
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>The one-page summary to review at month-end close.</p>
        </div>
        {!pack ? <p style={{ fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading…' : 'Pick a month.'}</p> : (
          <>
            <div data-tour="fin-rep-pack-cards" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              {card('Trial balance', <>
                {kv('Total debit', inr(pack.trial_balance.totals.debit))}
                {kv('Total credit', inr(pack.trial_balance.totals.credit))}
                {kv('Closing Dr', inr(pack.trial_balance.totals.closing_debit))}
                {kv('Closing Cr', inr(pack.trial_balance.totals.closing_credit))}
              </>, <BalancedPill ok={pack.trial_balance.is_balanced} />)}
              {card('Profit & loss', <>
                {kv('Total income', inr(pack.profit_and_loss.total_income))}
                {kv('Total expenses', inr(pack.profit_and_loss.total_expenses))}
                {kv('Gross profit', inr(pack.profit_and_loss.gross_profit))}
                {kv('Profit before tax', inr(pack.profit_and_loss.profit_before_tax))}
                {kv('Profit for the period', inr(pack.profit_and_loss.profit_for_period), pack.profit_and_loss.profit_for_period >= 0 ? GREEN : RED)}
              </>)}
              {card(`Balance sheet as at ${dmy(pack.balance_sheet.as_of)}`, <>
                {kv('Total assets', inr(pack.balance_sheet.total_assets))}
                {kv('Total equity & liabilities', inr(pack.balance_sheet.total_equity_and_liabilities))}
                {kv('P&L surplus not yet closed', inr(pack.balance_sheet.profit_and_loss_surplus))}
                {!pack.balance_sheet.is_balanced && kv('Difference', inr(pack.balance_sheet.difference), RED)}
              </>, <BalancedPill ok={pack.balance_sheet.is_balanced} />)}
              {card('Receivables / payables aging', <>
                {(['ar', 'ap'] as const).map((side) => {
                  const a = side === 'ar' ? pack.ar_aging : pack.ap_aging
                  return (
                    <div key={side} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', margin: '6px 0 2px' }}>{side === 'ar' ? 'Receivables (AR)' : 'Payables (AP)'}</div>
                      {kv(`Outstanding (${a.rows.length} bill${a.rows.length === 1 ? '' : 's'})`, inr(a.total_due))}
                      {kv('Overdue', inr(a.totals.overdue ?? 0), (a.totals.overdue ?? 0) > 0 ? RED : undefined)}
                      {kv('Over 90 days', inr(a.totals.over_90 ?? 0))}
                    </div>
                  )
                })}
              </>)}
            </div>
            <InfoBanner tone="warning">{pack.aging_note}</InfoBanner>
          </>
        )}
      </>
    )
  }

  // ─── Year-end close ─────────────────────────────────────────────────────
  const renderYearEnd = () => {
    const fys = setup?.financial_years || []
    const fy = fys.find((f) => f.code === fyCode)
    const closed = !!preview?.closing_entry
    return (
      <>
        <InfoBanner tone="warning">
          <strong>Before closing a year:</strong> (1) post or cancel every pending purchase/sales invoice, debit/credit note and draft
          journal dated in the year; (2) post the closing-stock valuation; (3) run depreciation up to the last month; (4) post the GST
          set-off for March. Closing posts one voucher on the FY end date that zeroes every income and expense ledger into Retained
          Earnings and marks the year closed — no further postings can be dated in it.
        </InfoBanner>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div data-tour="fin-rep-ye-fy" style={{ flex: '0 1 200px' }}>
            <label style={labelStyle}>Financial year</label>
            <Select style={inputStyle} value={fyCode} onChange={(e) => setFyCode(e.target.value)}>
              {fys.length === 0 && fyCode && <option value={fyCode}>{fyCode}</option>}
              {fys.map((f) => <option key={f.code} value={f.code}>{f.code}{f.status !== 'open' ? ` (${f.status})` : ''}</option>)}
            </Select>
          </div>
          {fy && <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>{dmy(fy.start_date)} to {dmy(fy.end_date)}{fy.lock_date ? ` · locked up to ${dmy(fy.lock_date)}` : ''}</p>}
        </div>
        {!preview ? <p style={{ fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading…' : fys.length === 0 ? 'No financial years are set up — add one in Company Info > Financial Years.' : 'Pick a financial year.'}</p> : (
          <div data-tour="fin-rep-ye-panel" style={{ ...sectionStyle, maxWidth: 720 }}>
            <ReportTitle title={`Year-end close — ${preview.fy_code}`} sub={`Closing date ${dmy(preview.end_date)}`}
              right={<StatusPill status={preview.status} colors={FY_STATUS_HEX} />} />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <StatCard label={preview.net_profit >= 0 ? 'Net profit for the year' : 'Net loss for the year'} value={`₹ ${inr(preview.net_profit)}`} tone={preview.net_profit >= 0 ? GREEN : RED} />
              <StatCard label="Closing voucher" value={preview.closing_entry || 'Not closed'} tone={preview.closing_entry ? TEXT.heading : TEXT.muted} />
            </div>
            <p style={{ fontSize: 12.5, color: TEXT.secondary, lineHeight: 1.6, margin: '0 0 14px' }}>
              {closed
                ? `This year was closed by ${preview.closing_entry}. Its income and expense ledgers are zero and the result is in Retained Earnings. To correct something in ${preview.fy_code}, an admin must reopen it — the closing voucher is reversed, not deleted.`
                : `Closing will transfer the ${preview.net_profit >= 0 ? 'profit' : 'loss'} of ${inr(Math.abs(preview.net_profit))} to Retained Earnings on ${dmy(preview.end_date)}. The ${preview.fy_code} Statement of Profit & Loss stays readable afterwards (the closing voucher is excluded from it).`}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {!closed && (canClose
                ? <button type="button" data-tour="fin-rep-ye-close-btn" style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => setConfirmClose(true)}>{closesDirectly ? 'Close financial year' : 'Request year-end close'}</button>
                : <span style={{ fontSize: 12, color: TEXT.muted }}>You need the Approve permission on Year-end Close to close a financial year.</span>)}
              {closed && (isAdmin
                ? <button type="button" data-tour="fin-rep-ye-reopen-btn" style={{ ...secondaryBtnStyle, color: RED, borderColor: `${RED}55`, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => setPromptReopen(true)}>Reopen year</button>
                : <span style={{ fontSize: 12, color: TEXT.muted }}>Only an admin can reopen a closed year.</span>)}
            </div>
            <div style={{ marginTop: 14 }}>
              <ApprovalPanel key={`${preview.fy_code}-${reloadKey}`} entityType="accounts_year_end_close" entityId={Number(preview.fy_code.split('-')[0])}
                title={`Approval — close ${preview.fy_code}`} onChanged={() => setReloadKey((k) => k + 1)} />
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div>
      <FinanceNav />
      <style>{`@media print { .fin-no-print { display: none !important; } }`}</style>
      <PageHeader
        title="Financial Reports"
        subtitle="Trial Balance, Schedule III statements, cash flow, aging, budgets and the year-end close — computed live from posted vouchers."
        actions={can('accounts', TAB_KEYS[tab], 'print') && <button type="button" data-tour="fin-rep-print" className="fin-no-print" style={secondaryBtnStyle} onClick={() => window.print()}>Print</button>}
      />

      <div className="fin-no-print">
        <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
        {RANGE_TABS.includes(tab) && (
          <div data-tour="fin-rep-range" style={{ ...sectionStyle, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {!AS_AT_TABS.includes(tab) && (
              <div data-tour="fin-rep-from" style={{ flex: '0 1 160px' }}>
                <label style={labelStyle}>From</label>
                <DateField value={fromDate} onChange={setFromDate} />
              </div>
            )}
            <div data-tour="fin-rep-to" style={{ flex: '0 1 160px' }}>
              <label style={labelStyle}>{tab === 'Balance Sheet' ? 'As at' : 'To'}</label>
              <DateField value={toDate} onChange={setToDate} />
            </div>
            <div data-tour="fin-rep-quick" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 2 }}>
              {([['this_month', 'This month'], ['last_month', 'Last month'], ['this_fy', 'This FY'], ['last_fy', 'Last FY']] as const).map(([k, l]) => {
                const on = quickActive(k)
                return (
                  <button key={k} type="button" onClick={() => setRange(k)} style={{
                    ...secondaryBtnStyle,
                    ...(on ? { borderColor: BRAND.primary, background: `${BRAND.primary}1a`, color: BRAND.primaryActive } : {}),
                  }}>{l}</button>
                )
              })}
            </div>
            {tab === 'Balance Sheet' && <span style={{ fontSize: 12, color: TEXT.muted, paddingBottom: 8 }}>A balance sheet is a position on one date — only the &quot;to&quot; date applies.</span>}
            {tab === 'Internal Orders' && <span style={{ fontSize: 12, color: TEXT.muted, paddingBottom: 8 }}>Internal orders are shown life to date — only the &quot;to&quot; date applies.</span>}
          </div>
        )}
      </div>

      <ErrorBanner error={error} />

      {tab === 'Trial Balance' && renderTrialBalance()}
      {tab === 'Profit & Loss' && renderPL()}
      {tab === 'Balance Sheet' && renderBS()}
      {tab === 'Cash Flow' && renderCF()}
      {tab === 'Aging' && renderAging()}
      {tab === 'Budget Variance' && renderVariance()}
      {tab === 'Cost Centres' && <CostCenterReport fromDate={fromDate} toDate={toDate} />}
      {tab === 'Internal Orders' && <InternalOrdersReport toDate={toDate} initialOrderId={ioFocus} />}
      {tab === 'Monthly Pack' && renderPack()}
      {tab === 'Year-end Close' && renderYearEnd()}

      {/* Ledger statement drawer (Trial Balance drill-down) */}
      {ledgerRow && createPortal(
        <div className="fin-no-print" onClick={() => setLedgerRow(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.3)', zIndex: 150, display: 'flex', justifyContent: 'flex-end' }}>
          <div data-tour="fin-rep-ledger-drawer" onClick={(e) => e.stopPropagation()} style={{ width: 'min(860px, 100vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,.18)', padding: 20, overflowY: 'auto', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{ledgerRow.code} — {ledgerRow.name}</h2>
                <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>Ledger statement · {rangeLabel}{ledgerRow.group_name ? ` · ${ledgerRow.group_name}` : ''}</div>
              </div>
              <button type="button" data-tour="fin-rep-ledger-close" style={secondaryBtnStyle} onClick={() => setLedgerRow(null)}>Close</button>
            </div>
            <ErrorBanner error={ledgerError} />
            {!ledgerShown && !ledgerError && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
            {ledgerShown && (
              <>
                <div data-tour="fin-rep-ledger-stats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                  <StatCard label="Opening" value={`₹ ${drcr(ledgerShown.opening_balance)}`} />
                  <StatCard label="Debits" value={`₹ ${inr(ledgerShown.total_debit)}`} />
                  <StatCard label="Credits" value={`₹ ${inr(ledgerShown.total_credit)}`} />
                  <StatCard label="Closing" value={`₹ ${drcr(ledgerShown.closing_balance)}`} />
                </div>
                <TableWrap minWidth={720} maxHeight="none" tour="fin-rep-ledger-table">
                  <thead>
                    <tr>
                      <th style={thStyle}>Date <RowCount count={ledgerShown.rows.length} /></th><th style={thStyle}>Voucher</th><th style={thStyle}>Narration</th>
                      <th style={numTh}>Debit</th><th style={numTh}>Credit</th><th style={numTh}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={tdStyle}>{dmy(ledgerShown.from_date)}</td>
                      <td colSpan={4} style={{ ...tdStyle, fontStyle: 'italic', color: TEXT.secondary }}>Opening balance</td>
                      <td style={{ ...numTd, fontWeight: 600 }}>{drcr(ledgerShown.opening_balance)}</td>
                    </tr>
                    {ledgerShown.rows.length === 0 ? <EmptyRow colSpan={6} text="No postings in this range." /> : ledgerShown.rows.map((r, i) => (
                      <tr key={`${r.journal_entry_id}-${i}`}>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(r.posting_date)}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600 }}>{r.entry_number}</div>
                          <div style={{ fontSize: 11, color: TEXT.muted }}>{r.voucher_type ? (VOUCHER_LABELS[r.voucher_type] || r.voucher_type.replace(/_/g, ' ')) : ''}</div>
                        </td>
                        <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.description || '—'}</td>
                        <td style={numTd}>{inr(r.debit_amount, { blankZero: true })}</td>
                        <td style={numTd}>{inr(r.credit_amount, { blankZero: true })}</td>
                        <td style={{ ...numTd, fontWeight: 600 }}>{drcr(r.running_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ ...tdStyle, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>Closing balance</td>
                      <td style={{ ...numTd, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>{inr(ledgerShown.total_debit)}</td>
                      <td style={{ ...numTd, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>{inr(ledgerShown.total_credit)}</td>
                      <td style={{ ...numTd, fontWeight: 800, borderTop: `2px solid ${BORDER.normal}` }}>{drcr(ledgerShown.closing_balance)}</td>
                    </tr>
                  </tfoot>
                </TableWrap>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={confirmClose}
        title={`Close financial year ${fyCode}?`}
        message={`A year-end voucher dated ${dmy(preview?.end_date)} will bring every income and expense ledger to zero and transfer the net ${(preview?.net_profit ?? 0) >= 0 ? 'profit' : 'loss'} of ${inr(Math.abs(preview?.net_profit ?? 0))} to Retained Earnings. ${fyCode} will be marked closed and no further postings can be dated in it. Only an admin can reopen it.`}
        confirmLabel="Close financial year"
        danger
        onConfirm={doClose}
        onCancel={() => setConfirmClose(false)}
      />
      <ReasonSheet
        icon="undo"
        tour="fin-rep-ye-reopen-dialog"
        open={promptReopen}
        title={`Reopen financial year ${fyCode}?`}
        message={`The closing voucher ${preview?.closing_entry || ''} will be reversed and ${fyCode} opened for postings again. Give the reason — it is written to the audit log.`}
        placeholder="e.g. Auditor adjustment for closing stock valuation"
        confirmLabel="Reopen year"
        danger
        requireValue
        onConfirm={doReopen}
        onCancel={() => setPromptReopen(false)}
      />
      <MessageDialog
        open={!!message}
        variant="success"
        title={message?.title || ''}
        message={message?.text || ''}
        onClose={() => setMessage(null)}
      />
    </div>
  )
}
