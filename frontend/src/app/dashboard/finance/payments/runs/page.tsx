'use client'

/** Payment runs (SAP F110): build a proposal of the vendor bills due by a
 *  date, review / exclude bills, send it for approval (Finance approver ->
 *  Partner), execute it into one payment voucher per vendor, then download
 *  the bank bulk-upload file. */
import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi } from '@/lib/api'
import { financePaymentsApi } from '@/lib/financePaymentsApi'
import { BankAccount, PaymentProposal, PaymentProposalLine, Vendor } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SheetFooter, SField, SRow, sw, sg } from '@/components/finance/financeSheet'
import { FormSheet, SheetColumns, SheetSection, SHEET, sheetInput, sheetHint } from '@/components/shared/FormSheet'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import {
  inputStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, Field, ErrorBanner, StatusPill, PageHeader, TableWrap, EmptyRow,
} from '@/components/finance/financeUi'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Waiting approval', approved: 'Approved — ready to pay', executed: 'Paid', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#64748b', submitted: '#f59e0b', approved: '#0369a1', executed: '#22c55e', rejected: '#dc2626', cancelled: '#78716c',
}
const MODES = [{ value: 'neft', label: 'NEFT' }, { value: 'rtgs', label: 'RTGS' }, { value: 'imps', label: 'IMPS' }, { value: 'cheque', label: 'Cheque' }]

function plusDays(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  // Local date, not toISOString() — that is UTC and gives yesterday before 05:30 IST.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PaymentRunsPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { can, canFeature } = useCan()
  // Payment Runs features: Execute payment runs ("Pay now"), Download bank payment file.
  const canExecute = canFeature('accounts', 'payment_runs', 'execution', 'create')
  const canBankFile = canFeature('accounts', 'payment_runs', 'bank_file', 'export')
  const router = useRouter()

  const [runs, setRuns] = useState<PaymentProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [message, setMessage] = useState<{ title: string; message: string } | null>(null)

  const [banks, setBanks] = useState<BankAccount[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [showForm, setShowForm] = useState(false)
  const [payBy, setPayBy] = useState(plusDays(7))
  const [bankId, setBankId] = useState('')
  const [mode, setMode] = useState('neft')
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string[] | null>(null)

  const [excludeLine, setExcludeLine] = useState<{ run: PaymentProposal; line: PaymentProposalLine } | null>(null)
  const [cancelRun, setCancelRun] = useState<PaymentProposal | null>(null)
  const [executeRun, setExecuteRun] = useState<PaymentProposal | null>(null)
  const [executeDate, setExecuteDate] = useState(todayIso())

  const load = () => {
    setLoading(true)
    financePaymentsApi.listProposals({ status: statusFilter || undefined })
      .then((rows) => { setRuns(rows); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the payment runs.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([
      accountsApi.listBankAccounts({ status: 'active' }).then((b: BankAccount[]) => setBanks(b.filter((x) => x.account_kind !== 'cash'))),
      accountsApi.listVendors().then(setVendors),
    ]).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load bank accounts or vendors.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter])

  const replace = (pp: PaymentProposal) => setRuns((rs) => rs.map((r) => (r.id === pp.id ? pp : r)))

  async function create() {
    setFormError(null)
    const errs: string[] = []
    if (!bankId) errs.push('Pick the bank account the run pays from.')
    if (!payBy) errs.push('Pick the "pay bills due by" date.')
    if (errs.length) { setFormError(errs); return }
    setSaving(true)
    try {
      const pp = await financePaymentsApi.createProposal({
        pay_by_date: payBy, bank_account_id: Number(bankId), payment_mode: mode,
        vendor_ids: vendorId ? [Number(vendorId)] : [], notes: notes.trim() || null,
      })
      setShowForm(false)
      setNotes('')
      setRuns((rs) => [pp, ...rs])
      setExpanded(pp.id)
      setMessage({ title: 'Payment run built', message: `${pp.proposal_number} lists ${pp.lines.length} bill(s) for ${inr(pp.total_amount)}. Review it, leave out anything that shouldn't be paid, then send it for approval.` })
    } catch (err: unknown) {
      setFormError(extractErrorMessages(err, 'Could not build the payment run.'))
    } finally {
      setSaving(false)
    }
  }

  async function act(run: PaymentProposal, fn: () => Promise<PaymentProposal & { message?: string }>, what: string, done?: string) {
    setError(null)
    try {
      const pp = await fn()
      replace(pp)
      if (pp.message || done) setMessage({ title: what, message: pp.message || done || '' })
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not ${what.toLowerCase()} ${run.proposal_number}.`))
    }
  }

  async function setLineAmount(run: PaymentProposal, line: PaymentProposalLine, value: string) {
    const amount = Math.round(Number(value || 0) * 100) / 100
    if (amount === line.amount) return
    await act(run, () => financePaymentsApi.updateProposalLine(run.id, line.id, { amount }), 'Change the amount')
  }

  async function downloadFile(run: PaymentProposal) {
    try {
      await financePaymentsApi.downloadBankFile(run.id, `${run.proposal_number.replace(/\//g, '-')}-bank-upload.csv`)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not download the bank file of ${run.proposal_number}.`))
    }
  }

  if (isLoading || !isAuthorized) return null

  const COLS = 9
  return (
    <div>
      <FinanceNav />
      <PageHeader
        title="Payment runs"
        subtitle="Pick the vendor bills due by a date, get the run approved (Finance approver, then a Partner) and pay them in one go — one voucher per vendor plus a bank upload file."
        actions={<div style={{ display: 'flex', gap: 8 }}>
          {!showForm && can('accounts', 'payment_runs', 'create') && <button style={primaryBtnStyle} onClick={() => { setShowForm(true); setFormError(null) }}>+ New payment run</button>}
          <button style={secondaryBtnStyle} onClick={() => router.push('/dashboard/finance/payments')}>← Back</button>
        </div>}
      />
      <ErrorBanner error={error} />

      {showForm && can('accounts', 'payment_runs', 'create') && (
        <FormSheet tour="fin-run-form" icon="rupee" title="New payment run" subtitle="Builds a proposal of the posted vendor bills due by a date — nothing is paid until it is approved."
          onClose={() => setShowForm(false)} busy={saving}
          footer={<SheetFooter onCancel={() => setShowForm(false)} onSubmit={create} busy={saving} busyLabel="Building…" label="Build proposal" icon="list" />}>
          <SheetColumns
            left={<>
              <ErrorBanner error={formError} />
              <SheetSection icon="calendar" title="Run">
                <SRow>
                  <SField label="Pay bills due by" req style={sw(180)}><DateField value={payBy} onChange={setPayBy} /></SField>
                  <SField label="Vendor" optional style={sg(240, 360)}>
                    <SearchableSelect value={vendorId} onChange={setVendorId} placeholder="All vendors"
                      options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}` }))]} />
                  </SField>
                </SRow>
                <SField label="Notes" optional>
                  <input style={sheetInput} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Weekly run — week 42" />
                </SField>
              </SheetSection>
              <SheetSection icon="building" title="Pay from">
                <SRow mb={0}>
                  <SField label="Bank account" req style={sg(260, 380)}>
                    <SearchableSelect value={bankId} onChange={setBankId} placeholder="Pick bank account"
                      options={banks.map((b) => ({ value: String(b.id), label: `${b.bank_name}${b.account_no ? ` — ${b.account_no}` : ''} · bal ${inr(b.book_balance)}` }))} />
                  </SField>
                  <SField label="Mode" style={sw(140)}>
                    <select style={sheetInput} value={mode} onChange={(e) => setMode(e.target.value)}>
                      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </SField>
                </SRow>
              </SheetSection>
            </>}
            right={
              <SheetSection icon="list" title="What the run picks">
                <p style={{ fontSize: 13, color: SHEET.BODY, lineHeight: 1.55, margin: 0 }}>
                  Every posted vendor bill due on or before the date that isn&apos;t already paid, in another run or waiting in a held
                  payment. Open debit notes and supplier advances are set off first; an early-payment discount is taken when the vendor offers one.
                  Bills blocked for payment, blocked vendors and vendors without bank details are listed but left out.
                </p>
              </SheetSection>
            }
          />
        </FormSheet>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <Field label="Status" style={{ flex: '0 1 200px', minWidth: 180 }}>
          <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>

      <TableWrap minWidth={1100}>
        <thead>
          <tr>
            <th style={thStyle}></th><th style={thStyle}>Run no.</th><th style={thStyle}>Run date</th><th style={thStyle}>Due by</th>
            <th style={thStyle}>Bank / mode</th><th style={numTh}>Vendors</th><th style={numTh}>To pay (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading payment runs…" />
            : runs.length === 0 ? <EmptyRow colSpan={COLS} text="No payment runs yet." />
            : runs.map((r) => {
              const open = expanded === r.id
              const editable = r.status === 'draft' || r.status === 'rejected'
              return (
                <Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : r.id)}>
                    <td style={{ ...tdStyle, width: 24, color: TEXT.muted }}>{open ? '▾' : '▸'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{r.proposal_number}</td>
                    <td style={tdStyle}>{dmy(r.run_date)}</td>
                    <td style={tdStyle}>{dmy(r.pay_by_date)}</td>
                    <td style={tdStyle}>{r.bank_account_label} · {r.payment_mode.toUpperCase()}</td>
                    <td style={numTd}>{r.vendor_count}</td>
                    <td style={numTd}>{inr(r.total_amount)}</td>
                    <td style={tdStyle}>
                      <StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                      {r.status === 'submitted' && r.approval_stage && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 2 }}>{r.approval_stage}</div>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 12 }}>
                        {editable && can('accounts', 'payment_runs', 'submit') && (
                          <button style={linkBtnStyle} onClick={() => act(r, () => financePaymentsApi.submitProposal(r.id), 'Sent for approval')}>Send for approval</button>
                        )}
                        {r.status === 'approved' && canExecute && (
                          <button style={linkBtnStyle} onClick={() => { setExecuteDate(todayIso()); setExecuteRun(r) }}>Pay now</button>
                        )}
                        {r.status === 'executed' && canBankFile && (
                          <button style={linkBtnStyle} onClick={() => downloadFile(r)}>Bank file</button>
                        )}
                        {!['executed', 'cancelled'].includes(r.status) && can('accounts', 'payment_runs', 'cancel') && (
                          <button style={dangerLinkStyle} onClick={() => setCancelRun(r)}>Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={COLS} style={{ ...tdStyle, background: 'rgba(253,241,230,.35)', padding: '12px 20px' }}>
                        <div style={{ fontSize: 12.5, color: TEXT.body, display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 10 }}>
                          {r.created_by_name && <span><b>Built by:</b> {r.created_by_name}</span>}
                          {r.approved_by_name && <span><b>Approved by:</b> {r.approved_by_name}</span>}
                          {r.executed_by_name && <span><b>Paid by:</b> {r.executed_by_name}</span>}
                          {r.notes && <span><b>Notes:</b> {r.notes}</span>}
                          {r.rejection_reason && <span style={{ color: '#b91c1c' }}><b>Reason:</b> {r.rejection_reason}</span>}
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                          <thead>
                            <tr>
                              {['Vendor', 'Bill', 'Due', 'Due amount', 'Notes/advances set off', 'Discount', 'Pay (₹)', 'Status', ''].map((h) => (
                                <th key={h} style={{ ...thStyle, position: 'static', background: 'transparent' }}>{h}</th>))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.lines.map((l) => (
                              <tr key={l.id} style={{ opacity: l.excluded ? 0.55 : 1 }}>
                                <td style={tdStyle}>{l.vendor_name}</td>
                                <td style={tdStyle}>{l.invoice_number}</td>
                                <td style={tdStyle}>{dmy(l.due_date)}</td>
                                <td style={numTd}>{inr(l.amount_due)}</td>
                                <td style={numTd}>{inr(l.credit_amount, { blankZero: true })}</td>
                                <td style={numTd}>{inr(l.discount_amount, { blankZero: true })}</td>
                                <td style={{ ...numTd, width: 140 }}>
                                  {editable && !l.excluded && can('accounts', 'payment_runs', 'edit') ? (
                                    <input key={`${l.id}-${l.amount}`} type="number" min={0} step="0.01" defaultValue={l.amount} style={{ ...inputStyle, textAlign: 'right', padding: '5px 8px' }}
                                      onBlur={(e) => setLineAmount(r, l, e.target.value)} />
                                  ) : inr(l.amount)}
                                </td>
                                <td style={tdStyle}>
                                  {l.payment_number ? `Paid — ${l.payment_number}` : l.excluded ? <span style={{ color: '#b45309' }}>Left out: {l.exclusion_reason}</span> : 'To pay'}
                                </td>
                                <td style={tdStyle}>
                                  {editable && can('accounts', 'payment_runs', 'edit') && (
                                    l.excluded
                                      ? <button style={linkBtnStyle} onClick={() => act(r, () => financePaymentsApi.updateProposalLine(r.id, l.id, { excluded: false }), 'Include the bill')}>Include</button>
                                      : <button style={dangerLinkStyle} onClick={() => setExcludeLine({ run: r, line: l })}>Leave out</button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {r.status === 'approved' && canExecute && (
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 12 }}>
                            <button style={primaryBtnStyle} onClick={() => { setExecuteDate(todayIso()); setExecuteRun(r) }}>Pay now</button>
                          </div>
                        )}
                        {(r.status === 'submitted' || r.approval_request_id) && (
                          <div style={{ marginTop: 12 }}>
                            <ApprovalPanel entityType="accounts_payment_proposal" entityId={r.id} onChanged={() => load()} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
        </tbody>
      </TableWrap>

      <ReasonSheet
        open={!!excludeLine}
        tour="fin-run-exclude-dialog"
        icon="x"
        danger={false}
        title={`Leave ${excludeLine?.line.invoice_number || 'the bill'} out of the run?`}
        subtitle={excludeLine ? `${excludeLine.line.vendor_name} · ${inr(excludeLine.line.amount)}` : ''}
        message="The bill stays due and can be paid in a later run. The reason is kept on the run for the approver."
        placeholder="e.g. quality complaint open, hold per Partner"
        confirmLabel="Leave out"
        requireValue
        onConfirm={(reason: string) => {
          const x = excludeLine
          setExcludeLine(null)
          if (x) act(x.run, () => financePaymentsApi.updateProposalLine(x.run.id, x.line.id, { excluded: true, exclusion_reason: reason }), 'Leave out the bill')
        }}
        onCancel={() => setExcludeLine(null)}
      />
      <ReasonSheet
        open={!!cancelRun}
        tour="fin-run-cancel-dialog"
        icon="x"
        title={`Cancel ${cancelRun?.proposal_number || 'the run'}?`}
        subtitle="Nothing has been paid yet; the bills become free for another run."
        label="Reason for cancelling"
        placeholder="e.g. Bills move to next week's run"
        confirmLabel="Cancel run"
        requireValue
        onConfirm={(reason: string) => {
          const r = cancelRun
          setCancelRun(null)
          if (r) act(r, () => financePaymentsApi.cancelProposal(r.id, reason), 'Cancelled', `${r.proposal_number} was cancelled.`)
        }}
        onCancel={() => setCancelRun(null)}
      />
      {executeRun && (
        <FormSheet tour="fin-run-execute-dialog" width={580} icon="send" title={`Pay ${executeRun.proposal_number} now?`}
          subtitle={`${inr(executeRun.total_amount)} to ${executeRun.vendor_count} vendor(s) from ${executeRun.bank_account_label}`}
          onClose={() => setExecuteRun(null)} busy={false}
          footer={<SheetFooter onCancel={() => setExecuteRun(null)} busy={false} label="Post payments" icon="send" disabled={!executeDate}
            onSubmit={() => {
              const r = executeRun
              setExecuteRun(null)
              act(r, () => financePaymentsApi.executeProposal(r.id, executeDate), 'Payments posted',
                `${r.proposal_number} has been paid: one payment voucher per vendor is posted. Download the bank file to upload the transfers.`)
            }} />}>
          <div style={{ padding: '20px 24px' }}>
            <SField label="Payment date" req style={{ maxWidth: 200 }}><DateField value={executeDate} onChange={setExecuteDate} /></SField>
            <p style={sheetHint}>
              This posts one payment voucher per vendor, dated {dmy(executeDate)}, sets off the debit notes / advances and books the discounts —
              all together or not at all. Then download the bank file and upload it to the bank.
            </p>
          </div>
        </FormSheet>
      )}
      <MessageDialog open={!!message} variant="success" title={message?.title || ''} message={message?.message || ''} onClose={() => setMessage(null)} />
    </div>
  )
}
