'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { BankAccount, BankReconciliation, UnreconciledPayment, LiquidityForecast } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 5, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff',
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }

const BUCKET_LABELS: Record<string, string> = { overdue: 'Overdue', due_0_30: '0–30 Days', due_31_60: '31–60 Days', due_61_plus: '61+ Days' }

export default function FinanceBankingPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [reconciliations, setReconciliations] = useState<BankReconciliation[]>([])
  const [activeRecon, setActiveRecon] = useState<BankReconciliation | null>(null)
  const [unreconciled, setUnreconciled] = useState<UnreconciledPayment[]>([])
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<number[]>([])
  const [forecast, setForecast] = useState<LiquidityForecast | null>(null)

  const [bankAccountId, setBankAccountId] = useState('')
  const [statementDate, setStatementDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [statementBalance, setStatementBalance] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const load = () => {
    accountsApi.listBankAccounts({ status: 'active' }).then(setBankAccounts)
    accountsApi.listBankReconciliations().then(setReconciliations)
    accountsApi.getLiquidityForecast().then(setForecast)
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const bankOptions = bankAccounts.map((b) => ({ value: String(b.id), label: `${b.bank_name} — ${b.account_no}` }))

  const openRecon = (recon: BankReconciliation) => {
    setActiveRecon(recon)
    setSelectedPaymentIds([])
    accountsApi.listUnreconciledPayments(recon.id).then(setUnreconciled)
  }

  const startReconciliation = async () => {
    if (!bankAccountId || !statementBalance) { setError('Bank account and statement balance are required.'); return }
    setSaving(true)
    setError('')
    try {
      const recon = await accountsApi.createBankReconciliation({
        bank_account_id: Number(bankAccountId), statement_date: statementDate, statement_balance: Number(statementBalance),
      })
      setBankAccountId(''); setStatementBalance('')
      setReconciliations((prev) => [recon, ...prev])
      openRecon(recon)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to start reconciliation.'))
    } finally {
      setSaving(false)
    }
  }

  const togglePayment = (id: number) => setSelectedPaymentIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))

  const matchSelected = async () => {
    if (!activeRecon || selectedPaymentIds.length === 0) return
    setBusy(true)
    setError('')
    try {
      const updated = await accountsApi.reconcilePayments(activeRecon.id, selectedPaymentIds)
      setActiveRecon(updated)
      setReconciliations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setSelectedPaymentIds([])
      accountsApi.listUnreconciledPayments(activeRecon.id).then(setUnreconciled)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to match payments.'))
    } finally {
      setBusy(false)
    }
  }

  const completeRecon = async () => {
    if (!activeRecon) return
    setBusy(true)
    setError('')
    try {
      const updated = await accountsApi.completeBankReconciliation(activeRecon.id)
      setActiveRecon(updated)
      setReconciliations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to complete reconciliation.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <FinanceNav />

      <MessageDialog open={!!error} variant="error" title="Cannot Complete Action" message={error} onClose={() => setError('')} />

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Start Bank Reconciliation</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Bank Account</label>
            <SearchableSelect value={bankAccountId} onChange={setBankAccountId} options={bankOptions} placeholder="Select bank account…" />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Statement Date</label>
            <input type="date" style={inputStyle} value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Statement Balance</label>
            <input type="number" style={inputStyle} value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={saving} onClick={startReconciliation} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Starting…' : 'Start Reconciliation'}</button>
        </div>
      </div>

      {activeRecon && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{activeRecon.bank_account_label} — Statement {formatDate(activeRecon.statement_date)}</h2>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>Status: {activeRecon.status === 'completed' ? 'Completed' : 'In Progress'}</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 16, fontSize: 13 }}>
            <span>Book Balance: <strong style={{ color: TEXT.heading }}>{activeRecon.book_balance.toFixed(2)}</strong></span>
            <span>Statement Balance: <strong style={{ color: TEXT.heading }}>{activeRecon.statement_balance.toFixed(2)}</strong></span>
            <span>Outstanding Cheques: <strong style={{ color: TEXT.heading }}>{activeRecon.outstanding_cheques.toFixed(2)}</strong></span>
            <span>Deposits in Transit: <strong style={{ color: TEXT.heading }}>{activeRecon.deposits_in_transit.toFixed(2)}</strong></span>
            <span
              style={{
                fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                background: Math.abs(activeRecon.difference) < 0.01 ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.1)',
                color: Math.abs(activeRecon.difference) < 0.01 ? '#16a34a' : '#dc2626',
              }}
            >
              Difference: {activeRecon.difference.toFixed(2)}
            </span>
          </div>

          {activeRecon.status !== 'completed' && (
            <>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.secondary, margin: '0 0 8px' }}>Unreconciled Payments — check items that have cleared the bank per the statement</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {unreconciled.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted }}>No unreconciled payments for this account up to the statement date.</p>}
                {unreconciled.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selectedPaymentIds.includes(p.id)} onChange={() => togglePayment(p.id)} />
                    <span style={{ fontWeight: 600 }}>{p.payment_number}</span>
                    <span style={{ color: TEXT.muted, textTransform: 'capitalize' }}>({p.payment_type})</span>
                    <span>{p.vendor_name || p.customer_name || '—'}</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{p.amount.toFixed(2)}</span>
                    <span style={{ color: TEXT.muted, fontSize: 12 }}>{formatDate(p.payment_date)}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" disabled={busy || selectedPaymentIds.length === 0} onClick={matchSelected} style={{ ...primaryBtnStyle, opacity: busy || selectedPaymentIds.length === 0 ? 0.5 : 1 }}>Mark Selected as Reconciled</button>
                <button type="button" disabled={busy || Math.abs(activeRecon.difference) >= 0.01} onClick={completeRecon} style={{ ...primaryBtnStyle, background: '#16a34a', opacity: busy || Math.abs(activeRecon.difference) >= 0.01 ? 0.5 : 1 }}>Complete Reconciliation</button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ ...sectionStyle, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Reconciliation History</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reconciliations.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted }}>No reconciliations started yet.</p>}
          {reconciliations.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}` }}>
              <span style={{ fontSize: 13 }}>{r.bank_account_label} — {formatDate(r.statement_date)}</span>
              <span style={{ fontSize: 12, color: TEXT.muted }}>{r.status === 'completed' ? 'Completed' : 'In Progress'}</span>
              <button type="button" style={linkBtnStyle} onClick={() => openRecon(r)}>Open</button>
            </div>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Liquidity Forecast</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>Projected cash position from current bank balances plus open AR/AP due dates — a read-only projection, not a posted figure.</p>
        {forecast && (
          <>
            <p style={{ fontSize: 13, marginBottom: 12 }}>Current Cash: <strong style={{ color: TEXT.heading, fontSize: 15 }}>{forecast.current_cash.toFixed(2)}</strong></p>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  {['Period', 'Inflows (AR)', 'Outflows (AP)', 'Net', 'Projected Balance'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecast.buckets.map((b) => (
                  <tr key={b.bucket} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: b.bucket === 'overdue' ? '#dc2626' : TEXT.heading }}>{BUCKET_LABELS[b.bucket] || b.bucket}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: '#16a34a' }}>{b.inflows.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: '#dc2626' }}>{b.outflows.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13 }}>{b.net.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>{b.projected_balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
