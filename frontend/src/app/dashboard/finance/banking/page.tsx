'use client'

/** Bank & Cash — account balances from the GL, bank/cash book, bank
 *  reconciliation statement (BRS) and the liquidity forecast. */
import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi } from '@/lib/api'
import { BankAccount, BankReconciliation, GLLedger, UnreconciledPayment } from '@/types'
import BankStatementPanel from '@/components/finance/BankStatementPanel'
import CashPositionTab from '@/components/finance/CashPositionTab'
import GuaranteesTab from '@/components/finance/GuaranteesTab'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SRow, SheetBody, SheetFooter, sw } from '@/components/finance/financeSheet'
import {
  sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso,
  Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { RowCount } from '@/components/shared/ui'

const PAY_MODE_LABELS: Record<string, string> = { cheque: 'Cheque', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', upi: 'UPI', cash: 'Cash', dd: 'Demand Draft' }
const TABS = ['Accounts', 'Bank / Cash Book', 'Reconciliation (BRS)', 'Liquidity Forecast', 'Guarantees & EMD'] as const
type Tab = (typeof TABS)[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. The
 *  Accounts overview shows ledger (book) balances, so it rides on the bank book. */
const TAB_KEYS: Record<Tab, string> = {
  Accounts: 'bank_book', 'Bank / Cash Book': 'bank_book', 'Reconciliation (BRS)': 'reconciliation', 'Liquidity Forecast': 'liquidity',
  'Guarantees & EMD': 'guarantees',
}
/** ?tab=… deep links (the guarantee expiry reminder opens ?tab=guarantees). */
const TAB_PARAM: Record<string, Tab> = { guarantees: 'Guarantees & EMD', liquidity: 'Liquidity Forecast', reconciliation: 'Reconciliation (BRS)' }

const KIND_HEX: Record<string, string> = { bank: '#2563eb', cash: '#16a34a' }
const KIND_LABELS: Record<string, string> = { bank: 'Bank', cash: 'Cash' }
const RECON_LABELS: Record<string, string> = { in_progress: 'In Progress', completed: 'Completed' }
const RECON_HEX: Record<string, string> = { in_progress: '#f59e0b', completed: '#16a34a' }
const DIR_LABELS: Record<string, string> = { in: 'Deposit', out: 'Withdrawal' }
const DIR_HEX: Record<string, string> = { in: '#16a34a', out: '#dc2626' }
const VOUCHER_LABELS: Record<string, string> = {
  journal: 'Journal', payment: 'Payment', receipt: 'Receipt', contra: 'Contra', purchase: 'Purchase',
  sales: 'Sales', debit_note: 'Debit Note', credit_note: 'Credit Note', opening: 'Opening',
}

/** + = Dr (money in hand / at bank), − = Cr (overdraft). */
function drcr(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) < 0.005) return '0.00'
  return `${inr(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`
}

function accountLabel(b: BankAccount): string {
  return b.account_kind === 'cash' ? b.bank_name : `${b.bank_name}${b.account_no ? ` — ${b.account_no}` : ''}`
}

export default function FinanceBankingPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { tabs: visibleTabs, tab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [bookAccountId, setBookAccountId] = useState('')

  const loadAccounts = () => {
    setLoadingAccounts(true)
    accountsApi.listBankAccounts({ status: 'active' })
      .then((rows: BankAccount[]) => { setAccounts(rows); setError(null) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load bank and cash accounts.')))
      .finally(() => setLoadingAccounts(false))
  }

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(loadAccounts, 0)
    return () => clearTimeout(t)
  }, [isAuthorized]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const want = TAB_PARAM[new URLSearchParams(window.location.search).get('tab') || '']
    if (!want) return
    const t = setTimeout(() => setTab(want), 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Bank & Cash" subtitle="Bank and cash balances straight from the ledger, the bank/cash book, bank reconciliation and the cash forecast." />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      <ErrorBanner error={error} />
      {tab === 'Accounts' && (
        <AccountsTab accounts={accounts} loading={loadingAccounts} onOpenBook={(id) => { setBookAccountId(String(id)); setTab('Bank / Cash Book') }} />
      )}
      {tab === 'Bank / Cash Book' && <BookTab accounts={accounts} accountId={bookAccountId} setAccountId={setBookAccountId} />}
      {tab === 'Reconciliation (BRS)' && <ReconciliationTab accounts={accounts} />}
      {tab === 'Liquidity Forecast' && <CashPositionTab />}
      {tab === 'Guarantees & EMD' && <GuaranteesTab />}
    </div>
  )
}

// ─── Accounts ─────────────────────────────────────────────────────────

function AccountsTab({ accounts, loading, onOpenBook }: { accounts: BankAccount[]; loading: boolean; onOpenBook: (id: number) => void }) {
  const total = (kind: string) => accounts.filter((a) => a.account_kind === kind).reduce((s, a) => s + (a.book_balance || 0), 0)
  return (
    <>
      <InfoBanner>
        Balances are the <strong>book balance</strong> — each account&apos;s GL ledger, i.e. what our books say. The bank&apos;s own figure can
        differ until cheques clear; the Reconciliation (BRS) tab explains that difference. Accounts are added under Finance → Masters.
      </InfoBanner>
      {!loading && accounts.length > 0 && (
        <div data-tour="fin-bk-stats" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <StatCard label="Total at Bank" value={`₹ ${inr(total('bank'))}`} />
          <StatCard label="Total Cash in Hand" value={`₹ ${inr(total('cash'))}`} />
          <StatCard label="Total Liquid Funds" value={`₹ ${inr(total('bank') + total('cash'))}`} />
        </div>
      )}
      {loading && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      {!loading && accounts.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted }}>No active bank or cash accounts. Add one under Finance → Masters → Bank & Cash.</p>}
      <div data-tour="fin-bk-accounts" style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {accounts.map((a) => (
          <div key={a.id} style={{ ...sectionStyle, marginBottom: 0, flex: '1 1 260px', maxWidth: 340, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading }}>{a.bank_name}</div>
                {a.account_kind === 'bank' && (
                  <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 2 }}>
                    {a.account_no || 'No account number'}{a.ifsc_code ? ` · ${a.ifsc_code}` : ''}{a.branch_name ? ` · ${a.branch_name}` : ''}
                  </div>
                )}
              </div>
              <StatusPill status={a.account_kind} labels={KIND_LABELS} colors={KIND_HEX} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 14 }}>Book balance</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: a.book_balance < 0 ? '#dc2626' : TEXT.heading }}>
              {drcr(a.book_balance)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 11.5, color: TEXT.muted }}>{a.gl_account_code ? `Ledger ${a.gl_account_code}` : 'No GL ledger linked'}</span>
              {a.gl_account_id && <button type="button" style={linkBtnStyle} onClick={() => onOpenBook(a.id)}>Open {a.account_kind === 'cash' ? 'cash' : 'bank'} book →</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Bank / cash book ─────────────────────────────────────────────────

function BookTab({ accounts, accountId, setAccountId }: { accounts: BankAccount[]; accountId: string; setAccountId: (v: string) => void }) {
  const [from, setFrom] = useState(`${todayIso().slice(0, 7)}-01`)
  const [to, setTo] = useState(todayIso())
  const [data, setData] = useState<GLLedger | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const account = accounts.find((a) => String(a.id) === accountId)

  const load = (acct = account) => {
    if (!acct) return
    if (!acct.gl_account_id) {
      setData(null)
      setError([`${acct.bank_name} has no GL ledger linked, so it has no book. Link one under Finance → Masters → Bank Accounts.`])
      return
    }
    setLoading(true)
    setError(null)
    accountsApi.getGLLedger(acct.gl_account_id, from, to)
      .then(setData)
      .catch((err) => { setData(null); setError(extractErrorMessages(err, `Could not load the book for ${acct.bank_name}.`)) })
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!account) return
    const t = setTimeout(() => load(account), 0)
    return () => clearTimeout(t)
  }, [accountId, accounts.length])

  const opts = accounts.map((a) => ({ value: String(a.id), label: `${KIND_LABELS[a.account_kind]} · ${accountLabel(a)}` }))

  return (
    <>
      <InfoBanner>
        The bank/cash book is the account&apos;s ledger: receipts on the Dr side, payments on the Cr side, with a running balance.
        {account?.account_kind === 'cash' && <> <strong>Cash can never go negative</strong> — you cannot pay out cash you don&apos;t hold, so a payment that would take the cash balance below zero is refused; record the receipt or withdrawal first.</>}
      </InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Bank / Cash Account" style={{ flex: '1 1 280px', maxWidth: 400 }} tour="fin-bk-book-account">
          <SearchableSelect value={accountId} onChange={setAccountId} options={opts} placeholder="Select account…" />
        </Field>
        <Field label="From" style={{ flex: '0 1 150px' }} tour="fin-bk-book-from"><DateField value={from} onChange={setFrom} /></Field>
        <Field label="To" style={{ flex: '0 1 150px' }} tour="fin-bk-book-to"><DateField value={to} onChange={setTo} /></Field>
        <button type="button" data-tour="fin-bk-book-show" style={{ ...primaryBtnStyle }} onClick={() => load()} disabled={!account || loading}>{loading ? 'Loading…' : 'Show'}</button>
      </div>

      {data && (
        <div data-tour="fin-bk-book-stats" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatCard label="Opening" value={`₹ ${drcr(data.opening_balance)}`} />
          <StatCard label="Receipts (Dr)" value={`₹ ${inr(data.total_debit)}`} tone="#16a34a" />
          <StatCard label="Payments (Cr)" value={`₹ ${inr(data.total_credit)}`} tone="#dc2626" />
          <StatCard label="Closing" value={`₹ ${drcr(data.closing_balance)}`} />
        </div>
      )}

      <TableWrap minWidth={900} tour="fin-bk-book-table">
        <thead>
          <tr>
            <th style={thStyle}>Date <RowCount count={data?.rows.length ?? 0} /></th>
            <th style={thStyle}>Voucher No.</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Particulars</th>
            <th style={numTh}>Receipts (₹)</th>
            <th style={numTh}>Payments (₹)</th>
            <th style={numTh}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {loading && <EmptyRow colSpan={7} text="Loading…" />}
          {!loading && !data && <EmptyRow colSpan={7} text="Pick an account to see its book." />}
          {!loading && data && (
            <>
              <tr>
                <td style={tdStyle}>{dmy(data.from_date)}</td>
                <td colSpan={5} style={{ ...tdStyle, fontWeight: 700 }}>Opening balance</td>
                <td style={{ ...numTd, fontWeight: 700 }}>{drcr(data.opening_balance)}</td>
              </tr>
              {data.rows.length === 0 && <EmptyRow colSpan={7} text="No receipts or payments in this range." />}
              {data.rows.map((r, i) => (
                <tr key={`${r.journal_entry_id}-${i}`}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(r.posting_date)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.entry_number}</td>
                  <td style={tdStyle}>{VOUCHER_LABELS[r.voucher_type] || r.voucher_type}</td>
                  <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.description || '—'}</td>
                  <td style={{ ...numTd, color: '#15803d' }}>{inr(r.debit_amount, { blankZero: true })}</td>
                  <td style={{ ...numTd, color: '#b91c1c' }}>{inr(r.credit_amount, { blankZero: true })}</td>
                  <td style={{ ...numTd, color: r.running_balance < 0 ? '#dc2626' : undefined }}>{drcr(r.running_balance)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} style={{ ...tdStyle, fontWeight: 800 }}>Totals / closing balance on {dmy(data.to_date)}</td>
                <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_debit)}</td>
                <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_credit)}</td>
                <td style={{ ...numTd, fontWeight: 800 }}>{drcr(data.closing_balance)}</td>
              </tr>
            </>
          )}
        </tbody>
      </TableWrap>
    </>
  )
}

// ─── Reconciliation (BRS) ─────────────────────────────────────────────

function ReconciliationTab({ accounts }: { accounts: BankAccount[] }) {
  const banks = accounts.filter((a) => a.account_kind === 'bank')
  const { can, canFeature } = useCan()
  const canCreate = can('accounts', 'reconciliation', 'create')
  const canEdit = can('accounts', 'reconciliation', 'edit')
  const seeStatements = canFeature('accounts', 'reconciliation', 'bank_statements', 'view')
  const canComplete = canFeature('accounts', 'reconciliation', 'completion', 'approve')
  const [recons, setRecons] = useState<BankReconciliation[]>([])
  const [active, setActive] = useState<BankReconciliation | null>(null)
  const [unreconciled, setUnreconciled] = useState<UnreconciledPayment[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [clearedDate, setClearedDate] = useState('')
  const [bankId, setBankId] = useState('')
  const [statementDate, setStatementDate] = useState(todayIso())
  const [statementBalance, setStatementBalance] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [showStart, setShowStart] = useState(false)
  const [startError, setStartError] = useState<string[] | null>(null)

  const loadRecons = () => {
    accountsApi.listBankReconciliations()
      .then(setRecons)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load bank reconciliations.')))
  }
  useEffect(loadRecons, [])

  const loadItems = (recon: BankReconciliation) => {
    setLoadingItems(true)
    accountsApi.listUnreconciledPayments(recon.id)
      .then(setUnreconciled)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the uncleared vouchers.')))
      .finally(() => setLoadingItems(false))
  }

  const openRecon = (recon: BankReconciliation) => {
    setActive(recon)
    setSelected([])
    setClearedDate('')
    setUnreconciled([])
    if (recon.status !== 'completed') loadItems(recon)
  }

  const replace = (updated: BankReconciliation) => {
    setActive(updated)
    setRecons((prev) => (prev.some((r) => r.id === updated.id) ? prev.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...prev]))
  }

  const start = async () => {
    setStartError(null)
    if (!bankId) { setStartError(['Pick the bank account whose statement you are reconciling.']); return }
    if (statementBalance === '') { setStartError(['Enter the closing balance shown on the bank statement for the statement date.']); return }
    setBusy(true)
    try {
      const recon = await accountsApi.createBankReconciliation({
        bank_account_id: Number(bankId), statement_date: statementDate, statement_balance: Number(statementBalance),
      })
      setBankId(''); setStatementBalance('')
      setShowStart(false)
      replace(recon)
      openRecon(recon)
    } catch (err) {
      setStartError(extractErrorMessages(err, 'Could not start the reconciliation.'))
    } finally {
      setBusy(false)
    }
  }

  const matchSelected = async () => {
    if (!active || selected.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const updated = await accountsApi.reconcilePayments(active.id, selected, clearedDate || undefined)
      replace(updated)
      setSelected([])
      loadItems(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not mark the selected vouchers as cleared.'))
    } finally {
      setBusy(false)
    }
  }

  const complete = async () => {
    if (!active) return
    setConfirmComplete(false)
    setBusy(true)
    setError(null)
    try {
      replace(await accountsApi.completeBankReconciliation(active.id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not complete the reconciliation.'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  const allSelected = unreconciled.length > 0 && selected.length === unreconciled.length
  const balanced = active ? Math.abs(active.difference) < 0.01 : false
  const selectedTotal = unreconciled.filter((u) => selected.includes(u.id)).reduce((s, u) => s + (u.direction === 'out' ? -u.amount : u.amount), 0)

  return (
    <>
      <InfoBanner>
        A <strong>Bank Reconciliation Statement</strong> explains why our book balance differs from the bank statement: cheques we issued
        that the bank hasn&apos;t paid yet (outstanding cheques) and deposits the bank hasn&apos;t credited yet (deposits in transit). Tick each
        voucher that appears on the statement with its bank date. Bank charges, interest or direct credits seen on the statement but missing
        from the books must first be entered as payment/receipt vouchers — then the difference becomes zero and the BRS can be completed.
      </InfoBanner>
      <ErrorBanner error={error} />

      {canCreate && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" data-tour="fin-bk-brs-new-btn" style={primaryBtnStyle} onClick={() => { setStartError(null); setShowStart(true) }}>+ Start reconciliation</button>
        </div>
      )}

      {canCreate && showStart && (
        <FormSheet width={580} tour="fin-bk-brs-start" icon="building" title="Start a reconciliation" subtitle="Reconcile our bank book with the bank's statement for one date."
          onClose={() => setShowStart(false)} busy={busy}
          footer={<SheetFooter onCancel={() => setShowStart(false)} onSubmit={start} busy={busy} busyLabel="Starting…" label="Start reconciliation" icon="check" submitTour="fin-bk-brs-start-btn" />}>
          <SheetBody>
            <SheetError error={startError} />
            <SheetSection icon="building" title="Statement">
              <SField label="Bank account" req style={{ maxWidth: 400, marginBottom: 14 }} tour="fin-bk-brs-bank"
                hint="Only bank accounts are reconciled. Cash is verified by counting it and comparing with the cash book.">
                <SearchableSelect value={bankId} onChange={setBankId} options={banks.map((b) => ({ value: String(b.id), label: accountLabel(b) }))} placeholder="Select bank account…" />
              </SField>
              <SRow mb={0}>
                <SField label="Statement date" req style={sw(170)} tour="fin-bk-brs-date"><DateField value={statementDate} onChange={setStatementDate} /></SField>
                <SField label="Statement closing balance (₹)" req style={sw(220)} tour="fin-bk-brs-balance">
                  <input type="number" step="any" style={{ ...sheetInput, textAlign: 'right' }} value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="As per bank" />
                </SField>
              </SRow>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}

      {active && (
        <div style={sectionStyle} data-tour="fin-bk-brs-active">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{active.bank_account_label} — statement as on {dmy(active.statement_date)}</h2>
              {active.status === 'completed' && active.completed_by_name && (
                <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 3 }}>Completed by {active.completed_by_name} on {dmy(active.completed_at)}</div>
              )}
            </div>
            <div data-tour="fin-bk-brs-status" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <StatusPill status={active.status} labels={RECON_LABELS} colors={RECON_HEX} />
              <button type="button" data-tour="fin-bk-brs-close" style={secondaryBtnStyle} onClick={() => setActive(null)}>Close</button>
            </div>
          </div>

          <div data-tour="fin-bk-brs-summary" style={{ maxWidth: 520, fontSize: 13, marginBottom: 18, border: `1px solid ${BORDER.normal}`, borderRadius: 12, padding: '10px 14px', background: 'rgba(255,255,255,.5)' }}>
            <BrsRow label="Balance as per books" value={active.book_balance} />
            <BrsRow label="Add: cheques issued, not yet paid by bank" value={active.outstanding_cheques} sign="+" />
            <BrsRow label="Less: deposits not yet credited by bank" value={active.deposits_in_transit} sign="−" />
            <BrsRow label="Expected balance as per bank" value={active.reconciled_balance} bold />
            <BrsRow label="Balance as per bank statement" value={active.statement_balance} />
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 6, borderTop: `1px solid ${BORDER.normal}`, fontWeight: 800, color: balanced ? '#15803d' : '#b91c1c' }}>
              <span>Difference {balanced ? '(reconciled)' : '(must be 0 to complete)'}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{inr(active.difference)}</span>
            </div>
          </div>

          {seeStatements && <BankStatementPanel recon={active} canCreate={canFeature('accounts', 'reconciliation', 'bank_statements', 'create')} canEdit={canEdit}
            canBook={canFeature('accounts', 'reconciliation', 'book_statement_lines', 'create')}
            canDelete={canFeature('accounts', 'reconciliation', 'bank_statements', 'delete')}
            onChanged={() => {
              accountsApi.getBankReconciliation(active.id).then((r: BankReconciliation) => { replace(r); if (r.status !== 'completed') loadItems(r) })
                .catch((err) => setError(extractErrorMessages(err, 'Could not refresh the reconciliation.')))
            }} />}

          {active.status !== 'completed' && (
            <>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.secondary, margin: '0 0 8px' }}>
                Uncleared vouchers up to {dmy(active.statement_date)} — tick the ones that appear on the bank statement
              </p>
              <TableWrap minWidth={950} maxHeight="420px" tour="fin-bk-brs-uncleared">
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 36 }}>
                      <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : unreconciled.map((u) => u.id))} />
                    </th>
                    <th style={thStyle}>Date <RowCount count={unreconciled.length} /></th>
                    <th style={thStyle}>Voucher No.</th>
                    <th style={thStyle}>Direction</th>
                    <th style={thStyle}>Party / Narration</th>
                    <th style={thStyle}>Mode</th>
                    <th style={thStyle}>Cheque / Ref No.</th>
                    <th style={numTh}>Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingItems && <EmptyRow colSpan={8} text="Loading…" />}
                  {!loadingItems && unreconciled.length === 0 && <EmptyRow colSpan={8} text="Every voucher up to the statement date has been cleared." />}
                  {!loadingItems && unreconciled.map((p) => (
                    <tr key={`${p.id}-${p.direction}`} style={{ cursor: 'pointer' }} onClick={() => toggle(p.id)}>
                      <td style={tdStyle}><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} /></td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(p.payment_date)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>{p.payment_number}</td>
                      <td style={tdStyle}>{p.direction ? <StatusPill status={p.direction} labels={DIR_LABELS} colors={DIR_HEX} /> : '—'}</td>
                      <td style={tdStyle}>{p.party_name || p.vendor_name || p.customer_name || '—'}</td>
                      <td style={tdStyle}>{p.payment_mode ? (PAY_MODE_LABELS[p.payment_mode] || p.payment_mode.replace(/_/g, ' ')) : '—'}</td>
                      <td style={tdStyle}>{p.cheque_number || p.reference_no || '—'}</td>
                      <td style={{ ...numTd, color: p.direction === 'out' ? '#b91c1c' : '#15803d' }}>{inr(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field label="Bank (clearing) date — blank = statement date" style={{ flex: '0 1 260px', minWidth: 240 }} tour="fin-bk-brs-cleared-date">
                    <DateField value={clearedDate} onChange={setClearedDate} />
                  </Field>
                  {canEdit && <button type="button" data-tour="fin-bk-brs-match-btn" disabled={busy || selected.length === 0} onClick={matchSelected}
                    style={{ ...primaryBtnStyle, opacity: busy || selected.length === 0 ? 0.5 : 1 }}>
                    Mark {selected.length || ''} as Cleared
                  </button>}
                  {selected.length > 0 && <span style={{ fontSize: 12, color: TEXT.secondary, paddingBottom: 9 }}>Net of selected: {inr(selectedTotal)}</span>}
                </div>
                {canComplete && <button type="button" data-tour="fin-bk-brs-complete-btn" disabled={busy || !balanced} onClick={() => setConfirmComplete(true)}
                  title={balanced ? '' : 'The difference must be zero before the reconciliation can be completed.'}
                  style={{ ...primaryBtnStyle, background: '#16a34a', opacity: busy || !balanced ? 0.5 : 1, cursor: busy || !balanced ? 'not-allowed' : 'pointer' }}>
                  Complete Reconciliation
                </button>}
              </div>
            </>
          )}
        </div>
      )}

      <TableWrap minWidth={900} tour="fin-bk-brs-history">
        <thead>
          <tr>
            <th style={thStyle}>Bank Account <RowCount count={recons.length} /></th>
            <th style={thStyle}>Statement Date</th>
            <th style={numTh}>Book (₹)</th>
            <th style={numTh}>Statement (₹)</th>
            <th style={numTh}>Difference (₹)</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {recons.length === 0 && <EmptyRow colSpan={7} text="No reconciliations started yet — use + Start reconciliation." />}
          {recons.map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRecon(r)}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.bank_account_label || '—'}</td>
              <td style={tdStyle}>{dmy(r.statement_date)}</td>
              <td style={numTd}>{inr(r.book_balance)}</td>
              <td style={numTd}>{inr(r.statement_balance)}</td>
              <td style={{ ...numTd, color: Math.abs(r.difference) < 0.01 ? '#15803d' : '#b91c1c' }}>{inr(r.difference)}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={RECON_LABELS} colors={RECON_HEX} /></td>
              <td style={tdStyle} onClick={(e) => e.stopPropagation()}><button type="button" style={linkBtnStyle} onClick={() => openRecon(r)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <ConfirmDialog
        open={confirmComplete}
        title="Complete this reconciliation?"
        message="The BRS is locked as a record of this statement date. Vouchers ticked as cleared stay cleared."
        confirmLabel="Complete"
        danger={false}
        onConfirm={complete}
        onCancel={() => setConfirmComplete(false)}
      />
    </>
  )
}

function BrsRow({ label, value, sign, bold }: { label: string; value: number; sign?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, padding: '3px 0', fontWeight: bold ? 800 : 500, color: TEXT.body }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{sign ? `${sign} ` : ''}{inr(value)}</span>
    </div>
  )
}
