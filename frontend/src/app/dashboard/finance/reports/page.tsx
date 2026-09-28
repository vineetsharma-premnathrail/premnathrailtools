'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { TrialBalance, ProfitAndLoss, BalanceSheet, AgingReport, VarianceAnalysis, MonthlyReportPack } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import FinanceNav from '@/components/finance/FinanceNav'

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', borderRadius: 9, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff',
}

const SUB_TABS = ['Trial Balance', 'P&L Statement', 'Balance Sheet', 'AR / AP Aging', 'Variance Analysis'] as const
type SubTab = typeof SUB_TABS[number]

const BUCKET_LABELS: Record<string, string> = { current: 'Current', '1_30': '1–30 Days', '31_60': '31–60 Days', '61_90': '61–90 Days', over_90: '90+ Days' }
const BUCKET_HEX: Record<string, string> = { current: '#22c55e', '1_30': '#f59e0b', '31_60': '#f97316', '61_90': '#dc2626', over_90: '#991b1b' }

function currentPeriod() {
  return new Date().toISOString().slice(0, 7)
}

export default function FinanceReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const [tab, setTab] = useState<SubTab>('Trial Balance')
  const [period, setPeriod] = useState(currentPeriod())

  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null)
  const [profitAndLoss, setProfitAndLoss] = useState<ProfitAndLoss | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null)
  const [apAging, setApAging] = useState<AgingReport | null>(null)
  const [arAging, setArAging] = useState<AgingReport | null>(null)
  const [aarpApTab, setAarpApTab] = useState<'AP' | 'AR'>('AP')
  const [variance, setVariance] = useState<VarianceAnalysis | null>(null)
  const [monthlyPack, setMonthlyPack] = useState<MonthlyReportPack | null>(null)
  const [showPack, setShowPack] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    if (tab === 'Trial Balance') accountsApi.getTrialBalance(period).then(setTrialBalance)
    if (tab === 'P&L Statement') accountsApi.getProfitAndLoss(period).then(setProfitAndLoss)
    if (tab === 'Balance Sheet') accountsApi.getBalanceSheet(period).then(setBalanceSheet)
    if (tab === 'AR / AP Aging') { accountsApi.getApAging().then(setApAging); accountsApi.getArAging().then(setArAging) }
    if (tab === 'Variance Analysis') accountsApi.getVarianceAnalysis(period, period).then(setVariance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, tab, period])

  if (isLoading || !isAuthorized) return null

  const loadPack = () => {
    accountsApi.getMonthlyReportPack(period).then((pack) => { setMonthlyPack(pack); setShowPack(true) })
  }

  return (
    <div>
      <FinanceNav />

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUB_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', borderRadius: 9999, border: `1px solid ${tab === t ? BRAND.primary : BORDER.normal}`,
                background: tab === t ? `${BRAND.primary}1a` : '#fff', color: tab === t ? BRAND.primaryActive : TEXT.secondary,
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {(tab === 'Trial Balance' || tab === 'P&L Statement' || tab === 'Balance Sheet' || tab === 'Variance Analysis') && (
          <input type="month" style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value)} />
        )}
      </div>

      {tab === 'Trial Balance' && trialBalance && (
        <div style={{ ...sectionStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Trial Balance — {trialBalance.period}</h2>
            <button type="button" style={primaryBtnStyle} onClick={loadPack}>View Monthly Close Pack</button>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: `${BRAND.primary}0d` }}>
                  {['Code', 'Name', 'Type', 'Opening', 'Debits', 'Credits', 'Closing'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trialBalance.rows.map((r) => (
                  <tr key={r.gl_account_id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>{r.code}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{r.name}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: TEXT.secondary, textTransform: 'capitalize' }}>{r.account_type}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{r.opening_balance.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{r.total_debits.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{r.total_credits.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>{r.closing_balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${BORDER.normal}`, fontWeight: 700 }}>
                  <td colSpan={4} style={{ padding: '10px 12px', fontSize: 13 }}>Total</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: trialBalance.total_debits === trialBalance.total_credits ? '#16a34a' : '#dc2626' }}>{trialBalance.total_debits.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: trialBalance.total_debits === trialBalance.total_credits ? '#16a34a' : '#dc2626' }}>{trialBalance.total_credits.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'P&L Statement' && profitAndLoss && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Profit &amp; Loss — {profitAndLoss.period}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', margin: '0 0 8px' }}>Revenue</p>
              {profitAndLoss.revenue_rows.map((r) => (
                <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{r.code} — {r.name}</span><span style={{ fontWeight: 600 }}>{r.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: `1px solid ${BORDER.normal}`, marginTop: 6, paddingTop: 6 }}>
                <span>Total Revenue</span><span>{profitAndLoss.total_revenue.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', margin: '0 0 8px' }}>Expense</p>
              {profitAndLoss.expense_rows.map((r) => (
                <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{r.code} — {r.name}</span><span style={{ fontWeight: 600 }}>{r.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: `1px solid ${BORDER.normal}`, marginTop: 6, paddingTop: 6 }}>
                <span>Total Expense</span><span>{profitAndLoss.total_expense.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div style={{ padding: '14px 18px', borderRadius: 12, background: profitAndLoss.net_profit >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading }}>Net {profitAndLoss.net_profit >= 0 ? 'Profit' : 'Loss'}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: profitAndLoss.net_profit >= 0 ? '#16a34a' : '#dc2626' }}>{profitAndLoss.net_profit.toFixed(2)}</span>
          </div>
        </div>
      )}

      {tab === 'Balance Sheet' && balanceSheet && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Balance Sheet — {balanceSheet.period}</h2>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: balanceSheet.is_balanced ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.1)', color: balanceSheet.is_balanced ? '#16a34a' : '#dc2626' }}>
              {balanceSheet.is_balanced ? 'Balanced' : 'Out of Balance'}
            </span>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 16px' }}>Assets = Liabilities + Equity (current-period earnings folded into Equity since no year-end closing entry has been run).</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', margin: '0 0 8px' }}>Assets</p>
              {balanceSheet.asset_rows.map((r) => (
                <div key={r.gl_account_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{r.code} — {r.name}</span><span style={{ fontWeight: 600 }}>{r.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: `1px solid ${BORDER.normal}`, marginTop: 6, paddingTop: 6 }}>
                <span>Total Assets</span><span>{balanceSheet.total_assets.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', margin: '0 0 8px' }}>Liabilities</p>
              {balanceSheet.liability_rows.map((r) => (
                <div key={r.gl_account_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{r.code} — {r.name}</span><span style={{ fontWeight: 600 }}>{r.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: `1px solid ${BORDER.normal}`, marginTop: 6, paddingTop: 6 }}>
                <span>Total Liabilities</span><span>{balanceSheet.total_liabilities.toFixed(2)}</span>
              </div>

              <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', margin: '16px 0 8px' }}>Equity</p>
              {balanceSheet.equity_rows.map((r) => (
                <div key={r.gl_account_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{r.code} — {r.name}</span><span style={{ fontWeight: 600 }}>{r.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span>Current Period Earnings</span><span style={{ fontWeight: 600 }}>{balanceSheet.current_period_earnings.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: `1px solid ${BORDER.normal}`, marginTop: 6, paddingTop: 6 }}>
                <span>Total Equity</span><span>{balanceSheet.total_equity_and_earnings.toFixed(2)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, borderTop: `2px solid ${BORDER.normal}`, marginTop: 12, paddingTop: 8 }}>
                <span>Total Liabilities + Equity</span>
                <span style={{ color: balanceSheet.is_balanced ? '#16a34a' : '#dc2626' }}>{balanceSheet.total_liabilities_and_equity.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'AR / AP Aging' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button type="button" onClick={() => setAarpApTab('AP')} style={{ padding: '6px 14px', borderRadius: 9999, border: `1px solid ${aarpApTab === 'AP' ? BRAND.primary : BORDER.normal}`, background: aarpApTab === 'AP' ? `${BRAND.primary}1a` : '#fff', color: aarpApTab === 'AP' ? BRAND.primaryActive : TEXT.secondary, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>AP Aging (Payable)</button>
            <button type="button" onClick={() => setAarpApTab('AR')} style={{ padding: '6px 14px', borderRadius: 9999, border: `1px solid ${aarpApTab === 'AR' ? BRAND.primary : BORDER.normal}`, background: aarpApTab === 'AR' ? `${BRAND.primary}1a` : '#fff', color: aarpApTab === 'AR' ? BRAND.primaryActive : TEXT.secondary, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>AR Aging (Receivable)</button>
          </div>
          {(() => {
            const report = aarpApTab === 'AP' ? apAging : arAging
            if (!report) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
            if (report.rows.length === 0) return <p style={{ fontSize: 13, color: TEXT.muted }}>Nothing outstanding.</p>
            return (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr>
                      {['Invoice', aarpApTab === 'AP' ? 'Vendor' : 'Customer', 'Due Date', 'Amount Due', 'Bucket'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                        <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>{r.invoice_number}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.party_name}</td>
                        <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary }}>{formatDate(r.due_date)}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>{r.amount_due.toFixed(2)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 9999, background: `${BUCKET_HEX[r.bucket]}1a`, color: BUCKET_HEX[r.bucket] }}>{BUCKET_LABELS[r.bucket] || r.bucket}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 13, fontWeight: 700, marginTop: 12 }}>Total Outstanding: {report.total_due.toFixed(2)}</p>
              </div>
            )
          })()}
        </div>
      )}

      {tab === 'Variance Analysis' && variance && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Variance Analysis — {variance.from_period} to {variance.to_period}</h2>
          {variance.note && <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>{variance.note}</p>}
          {variance.rows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  {['Type', 'Code', 'Name', 'Budgeted', 'Actual', 'Variance', 'Variance %'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variance.rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary, textTransform: 'capitalize' }}>{r.type.replace('_', ' ')}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>{r.code}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.name}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.budgeted_amount.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.actual_amount.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: r.variance > 0 ? '#dc2626' : '#16a34a' }}>{r.variance.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: r.variance > 0 ? '#dc2626' : '#16a34a' }}>{r.variance_pct != null ? `${r.variance_pct.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showPack && monthlyPack && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Monthly Close Pack — {monthlyPack.period}</h2>
            <button type="button" onClick={() => setShowPack(false)} style={{ ...primaryBtnStyle, background: '#94a3b8' }}>Close</button>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 16px', fontStyle: 'italic' }}>{monthlyPack.aging_note}</p>

          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Trial Balance Summary</h3>
          <p style={{ fontSize: 13, marginBottom: 16 }}>Total Debits: {monthlyPack.trial_balance.total_debits.toFixed(2)} · Total Credits: {monthlyPack.trial_balance.total_credits.toFixed(2)}</p>

          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>P&amp;L Summary</h3>
          <p style={{ fontSize: 13, marginBottom: 16 }}>Revenue: {monthlyPack.profit_and_loss.total_revenue.toFixed(2)} · Expense: {monthlyPack.profit_and_loss.total_expense.toFixed(2)} · Net: <strong style={{ color: monthlyPack.profit_and_loss.net_profit >= 0 ? '#16a34a' : '#dc2626' }}>{monthlyPack.profit_and_loss.net_profit.toFixed(2)}</strong></p>

          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Balance Sheet Summary</h3>
          <p style={{ fontSize: 13, marginBottom: 16 }}>Total Assets: {monthlyPack.balance_sheet.total_assets.toFixed(2)} · Total Liabilities + Equity: <strong style={{ color: monthlyPack.balance_sheet.is_balanced ? '#16a34a' : '#dc2626' }}>{monthlyPack.balance_sheet.total_liabilities_and_equity.toFixed(2)}</strong></p>

          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>AP Aging</h3>
          <p style={{ fontSize: 13, marginBottom: 16 }}>Total Outstanding: {monthlyPack.ap_aging.total_due.toFixed(2)} ({monthlyPack.ap_aging.rows.length} invoice(s))</p>

          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>AR Aging</h3>
          <p style={{ fontSize: 13, margin: 0 }}>Total Outstanding: {monthlyPack.ar_aging.total_due.toFixed(2)} ({monthlyPack.ar_aging.rows.length} invoice(s))</p>
        </div>
      )}
    </div>
  )
}
