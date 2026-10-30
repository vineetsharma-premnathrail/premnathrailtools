'use client'

/** Payments & Receipts — one voucher model for vendor payments, customer
 *  receipts, expense payments, other receipts and contra, with bill-wise
 *  allocation of party money and later allocation of advances. */
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import Link from 'next/link'
import { accountsApi, crmApi, costCentersApi, purchaseOrdersApi } from '@/lib/api'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import DraftBanner from '@/components/shared/DraftBanner'
import { useFormDraft } from '@/lib/formDraft'
import {
  BankAccount, CostCenter, GLAccount, OpenCredit, OpenDocument, Organization, PaymentTransaction, PaymentType, Vendor,
} from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import { useDocCurrency } from '@/components/finance/DocCurrencyFields'
import FinanceAttachments, { ProofPicker, ProofClip, stagePickedProof, useProofCounts, useProofRules, paymentProofRequired, type PickedProof } from '@/components/finance/FinanceAttachments'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField } from '@/components/finance/financeSheet'
import { FormSheet, FormPage, SheetColumns, SheetSection, SheetIcon, Optional, SHEET, sheetBtn, sheetInput, sheetHint } from '@/components/shared/FormSheet'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import {
  inputStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, fyStartIso, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, PageHeader, TableWrap, EmptyRow, ledgerOptions,
  RecordFacts,
} from '@/components/finance/financeUi'
import { RowCount, DetailGroup, DetailRow } from '@/components/shared/ui'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import Select from '@/components/shared/Select'

const TABS = ['All', 'Vendor Payments', 'Customer Receipts', 'Expense Payments', 'Other Receipts', 'Contra'] as const
type Tab = typeof TABS[number]
const TAB_TYPE: Record<Tab, PaymentType | undefined> = {
  'All': undefined, 'Vendor Payments': 'vendor', 'Customer Receipts': 'customer', 'Expense Payments': 'expense',
  'Other Receipts': 'other_receipt', 'Contra': 'contra',
}

const TYPE_LABELS: Record<string, string> = {
  vendor: 'Vendor payment', customer: 'Customer receipt', expense: 'Expense payment', other_receipt: 'Other receipt',
  contra: 'Contra', employee: 'Employee payment',
}
const TYPE_HEX: Record<string, string> = {
  vendor: '#b45309', customer: '#15803d', expense: '#9333ea', other_receipt: '#0369a1', contra: '#64748b', employee: '#64748b',
}
const STATUS_LABELS: Record<string, string> = { posted: 'Posted', cancelled: 'Cancelled', pending_approval: 'Waiting approval', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { posted: '#22c55e', cancelled: '#78716c', pending_approval: '#f59e0b', rejected: '#dc2626' }
// Deduction reasons (backend models/settlement_adjustment.py ADJUSTMENT_REASONS).
const DEDUCTION_REASONS: { value: string; label: string }[] = [
  { value: 'ld_deduction', label: 'Liquidated damages (LD)' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'bank_charges', label: 'Bank charges' },
  { value: 'short_payment', label: 'Short payment written off' },
  { value: 'rounding', label: 'Rounding / small difference' },
  { value: 'cash_discount', label: 'Cash (early-payment) discount' },
  { value: 'other', label: 'Other (pick the ledger)' },
]
type DeductionLine = { key: string; target_id: string; reason: string; amount: string; gl_account_id: string; remarks: string }
const newDeduction = (): DeductionLine => ({ key: Math.random().toString(36).slice(2), target_id: '', reason: 'ld_deduction', amount: '', gl_account_id: '', remarks: '' })
const RECON_LABELS: Record<string, string> = { pending: 'Unreconciled', reconciled: 'Reconciled', cleared: 'Cleared' }
const RECON_HEX: Record<string, string> = { pending: '#94a3b8', reconciled: '#22c55e', cleared: '#22c55e' }

const MODES = ['cheque', 'neft', 'rtgs', 'imps', 'upi', 'cash', 'dd'] as const
const MODE_LABELS: Record<string, string> = { cheque: 'Cheque', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', upi: 'UPI', cash: 'Cash', dd: 'Demand Draft' }

const CREATE_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'vendor', label: 'Vendor payment (PV)' },
  { value: 'customer', label: 'Customer receipt (RV)' },
  { value: 'expense', label: 'Expense payment (PV)' },
  { value: 'other_receipt', label: 'Other receipt (RV)' },
  { value: 'contra', label: 'Contra — bank/cash transfer (CV)' },
]

type SplitLine = { key: string; gl_account_id: string; amount: string; cost_center_id: string; internal_order_id: string; remarks: string }
const newSplitLine = (): SplitLine => ({ key: Math.random().toString(36).slice(2), gl_account_id: '', amount: '', cost_center_id: '', internal_order_id: '', remarks: '' })

const r2 = (n: number) => Math.round(n * 100) / 100
const bankLabel = (b: BankAccount) => `${b.bank_name}${b.account_no ? ` — ${b.account_no}` : ''}${b.account_kind === 'cash' ? ' (cash)' : ''}`

export default function PaymentsPageWrapper() {
  return (
    <Suspense fallback={null}>
      <PaymentsPage />
    </Suspense>
  )
}

function PaymentsPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { can, canFeature } = useCan()
  const searchParams = useSearchParams()

  // ── masters ──
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Organization[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  // Released internal orders (Open / In progress) — only these take postings.
  const [internalOrders, setInternalOrders] = useState<{ id: number; code: string; name: string; status: string }[]>([])

  // ── list ──
  const [tab, setTab] = useState<Tab>('All')
  const [fromDate, setFromDate] = useState(fyStartIso())
  const [toDate, setToDate] = useState(todayIso())
  const [statusFilter, setStatusFilter] = useState('')
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  // Filters whose result is on screen; differs from listKey while loading.
  const [loadedKey, setLoadedKey] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [error, setError] = useState<string[] | null>(null)

  // ── dialogs ──
  const [cancelTarget, setCancelTarget] = useState<PaymentTransaction | null>(null)
  const [removeAllocId, setRemoveAllocId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ title: string; message: string } | null>(null)
  const [allocTarget, setAllocTarget] = useState<PaymentTransaction | null>(null)

  // ── create form ──
  // ?vendor_id= / ?customer_id= carry a signed record ref (lib/recordRef.ts).
  const presetVendor = searchParams.get('vendor_id') || ''
  const presetCustomer = searchParams.get('customer_id') || ''
  const presetType: PaymentType = presetCustomer && !presetVendor ? 'customer' : 'vendor'
  const presetRef = presetVendor || presetCustomer
  const { id: presetPartyId, error: partyLinkError } = useRecordId(presetRef || null)
  const presetParty = presetPartyId ? String(presetPartyId) : ''
  const [showForm, setShowForm] = useState(!!presetRef)
  const [ptype, setPtype] = useState<PaymentType>(presetType)
  const [partyId, setPartyId] = useState('')
  const [openDocs, setOpenDocs] = useState<OpenDocument[]>([])
  const [openCredits, setOpenCredits] = useState<OpenCredit[]>([])
  const [openLoading, setOpenLoading] = useState(!!presetRef)
  const [settle, setSettle] = useState<Record<number, string>>({})
  const [amount, setAmount] = useState('')
  const [lines, setLines] = useState<SplitLine[]>([newSplitLine()])
  const [bankId, setBankId] = useState('')
  const [counterBankId, setCounterBankId] = useState('')
  const [mode, setMode] = useState<string>('neft')
  const [payDate, setPayDate] = useState(todayIso())
  const docCur = useDocCurrency(payDate, { withAmount: true })
  // Foreign-currency voucher: the ₹ amount follows FC amount x rate.
  useEffect(() => { if (docCur.inrAmount != null) setAmount(String(docCur.inrAmount)) }, [docCur.inrAmount])
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [narration, setNarration] = useState('')
  const [proof, setProof] = useState<PickedProof[]>([])
  const proofRules = useProofRules()
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string[] | null>(null)
  // Payment differences (F-28) and down payments (F-29 / F-48).
  const [deductions, setDeductions] = useState<DeductionLine[]>([])
  const [isAdvance, setIsAdvance] = useState(false)
  const [orderId, setOrderId] = useState('')
  const [advanceReason, setAdvanceReason] = useState('')
  const [orderOptions, setOrderOptions] = useState<{ value: string; label: string }[]>([])
  const [orderNote, setOrderNote] = useState('')
  // A new voucher's typed data survives a refresh / network failure (lib/formDraft.ts).
  // Off when the form was opened with a preset party from Outstanding.
  const draft = useFormDraft(showForm && !presetRef ? 'finance-voucher-new' : null,
    { ptype, partyId, settle, amount, lines, bankId, counterBankId, mode, payDate, chequeNo, chequeDate, referenceNo, narration, deductions, isAdvance, orderId, advanceReason,
      cur: { currency: docCur.currency, rate: docCur.rate, amountFc: docCur.amountFc } },
    (d) => {
      const t: PaymentType = d.ptype || 'vendor'
      setPtype(t); setPartyId(d.partyId || ''); setSettle(d.settle || {}); setAmount(d.amount || ''); setLines(d.lines?.length ? d.lines : [newSplitLine()])
      setBankId(d.bankId || ''); setCounterBankId(d.counterBankId || ''); setMode(d.mode || 'neft'); setPayDate(d.payDate || todayIso())
      setChequeNo(d.chequeNo || ''); setChequeDate(d.chequeDate || ''); setReferenceNo(d.referenceNo || ''); setNarration(d.narration || '')
      setDeductions(d.deductions || []); setIsAdvance(!!d.isAdvance); setOrderId(d.orderId || ''); setAdvanceReason(d.advanceReason || ''); docCur.restore(d.cur)
      setOpenDocs([]); setOpenCredits([])
      if (d.partyId && (t === 'vendor' || t === 'customer')) {
        setOpenLoading(true); fetchOpenItems(t, d.partyId)
        if (d.isAdvance) loadOrders(t, d.partyId)
      }
    })

  const listKey = `${tab}|${fromDate}|${toDate}|${statusFilter}`
  const loading = loadedKey !== listKey
  const loadPayments = () => {
    const key = listKey
    accountsApi.listPayments({
      payment_type: TAB_TYPE[tab], status: statusFilter || undefined,
      from_date: fromDate || undefined, to_date: toDate || undefined,
    })
      .then((rows: PaymentTransaction[]) => { setPayments(rows); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load payment and receipt vouchers.')))
      .finally(() => setLoadedKey(key))
  }

  function fetchOpenItems(t: PaymentType, id: string) {
    if (t !== 'vendor' && t !== 'customer') return
    accountsApi.openItems(t, Number(id))
      .then((d: { documents: OpenDocument[]; credits: OpenCredit[] }) => { setOpenDocs(d.documents || []); setOpenCredits(d.credits || []) })
      .catch((err: unknown) => setFormError(extractErrorMessages(err, 'Could not load the party\'s open bills.')))
      .finally(() => setOpenLoading(false))
  }

  const loadBanks = () => accountsApi.listBankAccounts({ status: 'active' }).then(setBanks)

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([
      accountsApi.listVendors().then(setVendors),
      crmApi.listOrganizations({ picker: true }).then(setCustomers),
      loadBanks(),
      accountsApi.listGLAccounts({ status: 'active' }).then(setLedgers),
      costCentersApi.listCostCenters().then(setCostCenters),
      accountsApi.listInternalOrders().then((all: { id: number; code: string; name: string; status: string }[]) =>
        setInternalOrders(all.filter((o) => o.status === 'open' || o.status === 'in_progress'))),
    ]).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load vendors, customers, bank accounts or ledgers.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  // Opened from Outstanding ("Record payment / receipt") — preset the form's
  // party from the query string once its ref resolves; load its open bills.
  useEffect(() => {
    if (!isAuthorized || !presetParty) return
    setPartyId(presetParty)
    fetchOpenItems(presetType, presetParty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, presetParty])

  useEffect(() => {
    if (!isAuthorized) return
    loadPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, tab, fromDate, toDate, statusFilter])

  // ── derived ──
  const bank = banks.find((b) => String(b.id) === bankId)
  const isParty = ptype === 'vendor' || ptype === 'customer'
  const isSplit = ptype === 'expense' || ptype === 'other_receipt'
  const amountNum = r2(Number(amount || 0))
  const proofRequired = paymentProofRequired(proofRules, ptype, amountNum)
  const proofCounts = useProofCounts('payment', useMemo(() => payments.map((p) => p.id), [payments]), 'payments')
  const allocated = r2(Object.values(settle).reduce((s, v) => s + Number(v || 0), 0))
  const onAccount = r2(amountNum - allocated)
  const deductionTotal = r2(deductions.reduce((s, d) => s + Number(d.amount || 0), 0))
  const linesTotal = r2(lines.reduce((s, l) => s + Number(l.amount || 0), 0))
  const bankGlIds = useMemo(() => new Set(banks.map((b) => b.gl_account_id).filter(Boolean) as number[]), [banks])
  const splitLedgerOptions = useMemo(
    () => ledgerOptions(ledgers, (a) => !a.is_control_account && !bankGlIds.has(a.id)),
    [ledgers, bankGlIds],
  )
  const bankOptions = banks.map((b) => ({ value: String(b.id), label: `${bankLabel(b)} · bal ${inr(b.book_balance)}` }))
  const modeOptions = bank ? (bank.account_kind === 'cash' ? ['cash'] : MODES.filter((m) => m !== 'cash')) : MODES.filter((m) => m !== 'cash')
  const partyOptions = ptype === 'vendor'
    ? vendors.filter((v) => v.status !== 'blocked').map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}` }))
    : customers.map((c) => ({ value: String(c.id), label: c.org_code ? `${c.org_code} — ${c.name}` : c.name }))

  function loadOrders(t: PaymentType, id: string) {
    setOrderOptions([])
    setOrderNote('')
    if (!id) return
    // Customer advances are held on account with a reason — Sales Orders no longer exist to link to.
    if (t === 'vendor') {
      purchaseOrdersApi.list({ limit: 500 })
        .then((rows: { id: number; po_number: string; status: string; vendor_id?: number | null }[]) =>
          setOrderOptions(rows.filter((o) => (!o.vendor_id || o.vendor_id === Number(id)) && !['cancelled', 'rejected', 'draft'].includes(o.status))
            .map((o) => ({ value: String(o.id), label: `${o.po_number} (${o.status})` }))))
        .catch(() => setOrderNote('Purchase orders could not be loaded (you may not have Purchase access) — give the reason instead.'))
    }
  }

  function pickParty(t: PaymentType, id: string) {
    setPartyId(id)
    setOrderId('')
    setDeductions([])
    if (isAdvance) loadOrders(t, id)
    setSettle({})
    setOpenDocs([])
    setOpenCredits([])
    if (!id || (t !== 'vendor' && t !== 'customer')) return
    setOpenLoading(true)
    fetchOpenItems(t, id)
  }


  function pickBank(id: string) {
    setBankId(id)
    const b = banks.find((x) => String(x.id) === id)
    if (!b) return
    if (b.account_kind === 'cash') setMode('cash')
    else if (mode === 'cash') setMode('neft')
  }

  function changeType(t: PaymentType) {
    setPtype(t)
    setPartyId('')
    setOpenDocs([])
    setOpenCredits([])
    setSettle({})
    setLines([newSplitLine()])
    setCounterBankId('')
    setFormError(null)
    setDeductions([])
    setIsAdvance(false)
    setOrderId('')
    setAdvanceReason('')
  }

  function resetForm() {
    changeType(ptype)
    setAmount('')
    setChequeNo('')
    setChequeDate('')
    setReferenceNo('')
    setNarration('')
    setProof([])
  }

  function payInFull(d: OpenDocument) {
    setSettle((s) => ({ ...s, [d.id]: String(d.amount_due) }))
  }

  function settleAllToAmount() {
    // Fill oldest-due first until the voucher amount is used up (FIFO).
    let left = amountNum
    const next: Record<number, string> = {}
    for (const d of openDocs) {
      if (left <= 0) break
      const take = r2(Math.min(left, d.amount_due))
      next[d.id] = String(take)
      left = r2(left - take)
    }
    setSettle(next)
  }

  async function submit() {
    setFormError(null)
    const errs: string[] = []
    if (!bankId) errs.push(`Pick the ${ptype === 'customer' || ptype === 'other_receipt' ? 'receiving' : 'paying'} bank/cash account.`)
    if (amountNum <= 0) errs.push('Enter an amount greater than zero.')
    if (isParty && !partyId) errs.push(ptype === 'vendor' ? 'Pick the vendor being paid.' : 'Pick the customer the money is received from.')
    if (isParty && isAdvance && !orderId && !advanceReason.trim()) errs.push(ptype === 'customer' ? 'Give the reason this advance is held on account (for example the tender, LOA or project it is for).' : 'Link the advance to the purchase order it is for, or give the reason it is on account.')
    if (isParty && !isAdvance) {
      for (const d of deductions) {
        const doc = openDocs.find((x) => String(x.id) === d.target_id)
        if (!doc) errs.push('Pick the bill each deduction was made against.')
        else {
          const v = Number(d.amount || 0)
          if (v <= 0) errs.push(`${doc.doc_number}: deduction amount must be greater than zero.`)
          const onBill = r2(Number(settle[doc.id] || 0) + deductions.filter((x) => x.target_id === d.target_id).reduce((s, x) => s + Number(x.amount || 0), 0))
          if (onBill > doc.amount_due + 0.001) errs.push(`${doc.doc_number} has ${inr(doc.amount_due)} due but cash + deductions come to ${inr(onBill)}.`)
        }
        if (d.reason === 'other' && !d.gl_account_id) errs.push('Pick the ledger for an "Other" deduction.')
      }
    }
    if (isParty && allocated > amountNum + 0.001) errs.push(`Settled amounts add up to ${inr(allocated)} but the voucher is only ${inr(amountNum)} — reduce the settlements or raise the amount.`)
    if (isParty) {
      for (const d of openDocs) {
        const v = Number(settle[d.id] || 0)
        if (v < 0) errs.push(`${d.doc_number}: settle amount can't be negative.`)
        if (v > d.amount_due + 0.001) errs.push(`${d.doc_number} has only ${inr(d.amount_due)} due — can't settle ${inr(v)}.`)
      }
    }
    if (isSplit) {
      if (lines.some((l) => !l.gl_account_id)) errs.push('Pick a ledger on every line (or remove the empty line).')
      if (linesTotal !== amountNum) errs.push(`The ledger lines add up to ${inr(linesTotal)} but the voucher amount is ${inr(amountNum)} — they must match.`)
    }
    if (ptype === 'contra') {
      if (!counterBankId) errs.push('Pick the receiving bank/cash account.')
      else if (counterBankId === bankId) errs.push('A contra moves money between two different accounts — pick a different receiving account.')
    }
    if (mode === 'cheque' && !chequeNo.trim()) errs.push('Enter the cheque number for a cheque payment.')
    if (proofRequired && proof.length === 0) errs.push(`Attach a supporting document (bill, bank advice or UTR screenshot) — Finance › Settings makes it compulsory ${proofRules.paymentAbove > 0 ? `for vouchers above ${inr(proofRules.paymentAbove)}` : 'for every voucher'}.`)
    if (errs.length) { setFormError(errs); return }

    const payload: Record<string, unknown> = {
      payment_type: ptype, bank_account_id: Number(bankId), amount: amountNum, payment_mode: mode, payment_date: payDate,
      cheque_number: mode === 'cheque' ? chequeNo.trim() : null, cheque_date: mode === 'cheque' && chequeDate ? chequeDate : null,
      reference_no: referenceNo.trim() || null, narration: narration.trim() || null,
      ...((ptype === 'vendor' || ptype === 'customer') ? docCur.payload() : {}),
    }
    if (ptype === 'vendor') payload.vendor_id = Number(partyId)
    if (ptype === 'customer') payload.customer_id = Number(partyId)
    if (isParty && isAdvance) {
      payload.is_advance = true
      if (orderId && ptype === 'vendor') payload.purchase_order_id = Number(orderId)
      payload.advance_reason = advanceReason.trim() || null
    }
    if (isParty && !isAdvance && deductions.length) {
      payload.deductions = deductions.map((d) => ({
        target_id: Number(d.target_id), reason: d.reason, amount: r2(Number(d.amount || 0)),
        gl_account_id: d.gl_account_id ? Number(d.gl_account_id) : null, remarks: d.remarks.trim() || null,
      }))
    }
    if (isParty && !isAdvance) {
      payload.allocations = openDocs
        .filter((d) => Number(settle[d.id] || 0) > 0)
        .map((d) => ({ target_type: d.target_type, target_id: d.id, amount: r2(Number(settle[d.id])) }))
    }
    if (isSplit) {
      payload.lines = lines.map((l) => ({
        gl_account_id: Number(l.gl_account_id), amount: r2(Number(l.amount || 0)),
        cost_center_id: l.cost_center_id ? Number(l.cost_center_id) : null,
        internal_order_id: l.internal_order_id ? Number(l.internal_order_id) : null, remarks: l.remarks.trim() || null,
      }))
    }
    if (ptype === 'contra') payload.counter_bank_account_id = Number(counterBankId)

    setSaving(true)
    if (ptype !== 'contra' && proof.length) {
      try {
        payload.attachment_ids = await stagePickedProof(proof)
      } catch (err: unknown) {
        setFormError(extractErrorMessages(err, 'Could not upload the supporting documents, so the voucher was not saved.'))
        setSaving(false)
        return
      }
    }
    try {
      const created: PaymentTransaction = await accountsApi.createVoucher(payload)
      const adv = created.unallocated_amount > 0.005
        ? (created.is_advance ? ` It is held on the ${created.payment_type === 'customer' ? 'Advances from Customers' : 'Advances to Suppliers'} ledger until you adjust it against the invoice.` : ` ${inr(created.unallocated_amount)} stays on account as an advance.`)
        : ''
      if (created.status === 'pending_approval') {
        setMessage({ title: 'Sent for approval', message: `${TYPE_LABELS[created.payment_type]} for ${inr(created.amount)} has been recorded and is waiting for approval${created.approval_stage ? ` (${created.approval_stage})` : ''}. It is posted — and the bills settled — only once the Finance approver and then a Partner approve it.` })
      } else {
        setMessage({ title: 'Voucher posted', message: `${TYPE_LABELS[created.payment_type]} ${created.payment_number} for ${inr(created.amount)} has been posted.${adv}` })
      }
      draft.clear()
      resetForm()
      setShowForm(false)
      loadPayments()
      loadBanks()
    } catch (err: unknown) {
      setFormError(extractErrorMessages(err, 'Could not post the voucher.'))
    } finally {
      setSaving(false)
    }
  }

  async function doCancel(reason: string) {
    const p = cancelTarget
    setCancelTarget(null)
    if (!p) return
    try {
      await accountsApi.cancelVoucher(p.id, reason)
      setMessage({ title: 'Voucher cancelled', message: `${p.payment_number} was cancelled; its journal has been reversed and its allocations released.` })
      loadPayments()
      loadBanks()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not cancel voucher ${p.payment_number}.`))
    }
  }

  async function doRemoveAllocation() {
    const id = removeAllocId
    setRemoveAllocId(null)
    if (id == null) return
    try {
      await accountsApi.removeAllocation(id)
      loadPayments()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not remove the allocation.'))
    }
  }

  function partyCell(p: PaymentTransaction) {
    if (p.vendor_name || p.customer_name) return p.vendor_name || p.customer_name
    if (p.lines?.length) return p.lines.map((l) => `${l.gl_account_code || ''} ${l.gl_account_name || ''}`.trim()).join(', ')
    if (p.payment_type === 'contra') return 'Bank/cash transfer'
    return p.narration || '—'
  }

  if (isLoading || !isAuthorized) return null
  if (partyLinkError) return (<div><FinanceNav /><InvalidRecordLink message={partyLinkError} listHref="/dashboard/finance/payments" listLabel="Back to payments" /></div>)

  // Recording a voucher replaces the list with the voucher form ("← Back" returns to the list).
  if (showForm) {
    const closeForm = () => { setShowForm(false); setFormError(null); setProof([]) }
    const tcell: React.CSSProperties = { padding: '6px', borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
    return (
      <div>
        <FormPage nav={<FinanceNav />} tour="fin-pay-form" icon="rupee" title="New voucher"
          subtitle="Vendor payment, customer receipt, expense payment, other receipt or contra — settled bill-wise against open invoices."
          onBack={closeForm} backTour="fin-pay-back"
          footer={<>
            <button type="button" data-tour="fin-pay-clear" style={sheetBtn('ghost', SHEET.MUTED)} onClick={resetForm}>Clear</button>
            <button type="button" data-tour="fin-pay-close" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={closeForm}>Cancel</button>
            <button type="button" data-tour="fin-pay-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={submit}>
              <SheetIcon name={ptype === 'vendor' ? 'send' : 'check'} size={16} />{saving ? 'Saving…' : ptype === 'vendor' ? 'Record & send for approval' : 'Post voucher'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px 0' }}>
            <DraftBanner draft={draft} />
            <ErrorBanner error={formError} />
            <InfoBanner>
              Payment vouchers settle bills bill-wise: tick the invoices this money clears. Anything not allocated stays as an advance on the
              party and shows in Outstanding, where it can be set off against a later bill. A posted voucher is never edited — cancel it
              (which reverses the journal) and record it again.
            </InfoBanner>
            {ptype === 'expense' && (
              <InfoBanner tone="warning">
                Bills that carry GST should be booked as a direct purchase invoice (Finance &gt; Purchase) and then paid as a vendor payment —
                an expense payment posts the gross amount to the expense ledger, so the GST input credit would be lost.
              </InfoBanner>
            )}
            {ptype === 'contra' && (
              <InfoBanner>A contra moves money between your own bank and cash accounts (cash deposit, withdrawal, inter-bank transfer). It has no party and no income or expense.</InfoBanner>
            )}
            {ptype === 'vendor' && (
              <InfoBanner tone="warning">
                A vendor payment is recorded now but posted only after a Finance approver and then a Partner approve it (maker-checker) —
                until then nothing leaves the books and the bills stay due. Paying many bills at once? Use a Payment run.
              </InfoBanner>
            )}
          </div>

          <SheetColumns
            left={<>
              <SheetSection icon="doc" title="Voucher">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                  <SField label="Voucher type" req style={{ flex: '0 1 260px', minWidth: 220 }} tour="fin-pay-type">
                    <Select style={sheetInput} value={ptype} onChange={(e) => changeType(e.target.value as PaymentType)}>
                      {CREATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </SField>
                  {isParty && (
                    <SField label={ptype === 'vendor' ? 'Vendor' : 'Customer'} req style={{ flex: '1 1 260px', maxWidth: 380 }} tour="fin-pay-party">
                      <SearchableSelect value={partyId} onChange={(v: string) => pickParty(ptype, v)} options={partyOptions}
                        placeholder={ptype === 'vendor' ? 'Search vendor…' : 'Search customer…'} />
                    </SField>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <SField label="Date" req style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-pay-date">
                    <DateField value={payDate} onChange={setPayDate} />
                  </SField>
                  <SField label="Amount (₹)" req style={{ flex: '0 1 160px', minWidth: 140 }} tour="fin-pay-amount">
                    <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={docCur.foreign} />
                  </SField>
                  {(ptype === 'vendor' || ptype === 'customer') && docCur.fields}
                </div>
              </SheetSection>

              <SheetSection icon="building" title="Bank & mode">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                  <SField label={ptype === 'contra' ? 'From (paying) account' : ptype === 'customer' || ptype === 'other_receipt' ? 'Received into (bank/cash)' : 'Paid from (bank/cash)'} req
                    style={{ flex: '1 1 280px', maxWidth: 400 }} tour="fin-pay-bank">
                    <SearchableSelect value={bankId} onChange={pickBank} options={bankOptions} placeholder="Pick bank / cash account" />
                  </SField>
                  {ptype === 'contra' && (
                    <SField label="To (receiving) account" req style={{ flex: '1 1 280px', maxWidth: 400 }} tour="fin-pay-counter-bank">
                      <SearchableSelect value={counterBankId} onChange={setCounterBankId}
                        options={bankOptions.filter((o) => o.value !== bankId)} placeholder="Pick bank / cash account" />
                    </SField>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <SField label="Mode" style={{ flex: '0 1 150px', minWidth: 130 }} tour="fin-pay-mode">
                    <Select style={sheetInput} value={mode} onChange={(e) => setMode(e.target.value)}>
                      {modeOptions.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                    </Select>
                  </SField>
                  {mode === 'cheque' && (
                    <>
                      <SField label="Cheque no." req style={{ flex: '0 1 140px', minWidth: 120 }} tour="fin-pay-cheque-no">
                        <input style={sheetInput} value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
                      </SField>
                      <SField label="Cheque date" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-pay-cheque-date">
                        <DateField value={chequeDate} onChange={setChequeDate} />
                      </SField>
                    </>
                  )}
                  {mode !== 'cash' && (
                    <SField label={mode === 'cheque' ? 'Reference' : 'UTR / reference'} style={{ flex: '0 1 200px', minWidth: 160 }} tour="fin-pay-reference">
                      <input style={sheetInput} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
                    </SField>
                  )}
                </div>
                {bank && (
                  <p style={sheetHint}>
                    Book balance of {bank.bank_name}: <b>{inr(bank.book_balance)}</b>
                    {bank.account_kind === 'cash' && ' — cash can\'t go below zero; record a withdrawal (contra) first if it would.'}
                  </p>
                )}
              </SheetSection>

              {isParty && (
                <SheetSection icon="flag" title="Advance (down payment)" extra={<Optional />}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                    <input type="checkbox" checked={isAdvance} onChange={(e) => {
                      setIsAdvance(e.target.checked); setSettle({}); setDeductions([]); setOrderId('')
                      if (e.target.checked && partyId) loadOrders(ptype, partyId)
                    }} />
                    This is an advance (down payment) {ptype === 'customer' ? 'received from the customer' : 'paid against a purchase order'}
                  </label>
                  {isAdvance && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                      {ptype === 'vendor' && (
                        <SField label="Purchase order" style={{ flex: '1 1 240px', maxWidth: 360 }}>
                          <SearchableSelect value={orderId} onChange={setOrderId} options={[{ value: '', label: '— on account (no order) —' }, ...orderOptions]}
                            placeholder="Pick purchase order" />
                        </SField>
                      )}
                      <SField label={ptype === 'customer' ? 'Reason (what the advance is for)' : 'Reason (if on account)'} style={{ flex: '1 1 240px', maxWidth: 420 }}>
                        <input style={sheetInput} value={advanceReason} onChange={(e) => setAdvanceReason(e.target.value)} placeholder="e.g. tender EMD, advance against LOA" />
                      </SField>
                      <p style={{ ...sheetHint, flexBasis: '100%', margin: 0 }}>
                        {orderNote || `The advance is held on the ${ptype === 'customer' ? 'Advances from Customers (Other Current Liabilities)' : 'Advances to Suppliers (Short-term Loans & Advances)'} ledger — not netted in ${ptype === 'customer' ? 'Trade Receivables' : 'Trade Payables'} — and is adjusted against the invoice later with Allocate.`}
                      </p>
                    </div>
                  )}
                </SheetSection>
              )}
            </>}
            right={<>
              <SheetSection icon="doc" title="Narration">
                <SField label="Narration" optional tour="fin-pay-narration">
                  <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What this money is for" />
                </SField>
              </SheetSection>
              {ptype !== 'contra' && (
                <SheetSection icon="doc" title="Supporting documents" extra={proofRequired ? undefined : <Optional />}>
                  <ProofPicker entityType="payment" value={proof} onChange={setProof} required={proofRequired} hint="Bill, bank advice or UTR screenshot." />
                </SheetSection>
              )}
              <SheetSection icon="rupee" title="Summary">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 6, fontSize: 13, color: SHEET.BODY, fontVariantNumeric: 'tabular-nums' }}>
                  <span>Voucher amount</span><b style={{ textAlign: 'right' }}>{inr(amountNum)}</b>
                  {isParty && !isAdvance && <>
                    <span>Allocated to bills</span><b style={{ textAlign: 'right' }}>{inr(allocated)}</b>
                    {deductions.length > 0 && <><span>Deductions</span><b style={{ textAlign: 'right' }}>{inr(deductionTotal)}</b></>}
                    <span style={{ color: onAccount < 0 ? '#b91c1c' : SHEET.BODY }}>On account (advance)</span>
                    <b style={{ textAlign: 'right', color: onAccount < 0 ? '#b91c1c' : SHEET.INK }}>{inr(onAccount)}</b>
                  </>}
                  {isSplit && <>
                    <span style={{ color: linesTotal === amountNum ? SHEET.BODY : '#b91c1c' }}>Ledger lines total</span>
                    <b style={{ textAlign: 'right', color: linesTotal === amountNum ? SHEET.INK : '#b91c1c' }}>{inr(linesTotal)}</b>
                  </>}
                </div>
                {isParty && !isAdvance && onAccount < 0 && <p style={{ ...sheetHint, color: '#b91c1c' }}>Allocations exceed the amount.</p>}
              </SheetSection>
            </>}
          />

          {/* Party: bill-wise settlement */}
          {isParty && partyId && !isAdvance && (
            <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }} data-tour="fin-pay-open-bills">
              <SheetSection icon="list" title="Open bills" extra={openDocs.length > 0 && amountNum > 0
                ? <button type="button" style={{ ...linkBtnStyle, marginLeft: 'auto' }} onClick={settleAllToAmount}>Auto-settle oldest first</button> : undefined}>
                <TableWrap minWidth={760} maxHeight="360px">
                  <thead>
                    <tr>
                      <th style={thStyle}>Bill no. <RowCount count={openLoading ? 0 : openDocs.length} /></th><th style={thStyle}>Date</th><th style={thStyle}>Due</th>
                      <th style={numTh}>Overdue days</th><th style={numTh}>Bill total</th><th style={numTh}>Due amount</th>
                      <th style={numTh}>Settle amount</th><th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openLoading ? <EmptyRow colSpan={8} text="Loading open bills…" />
                      : openDocs.length === 0 ? <EmptyRow colSpan={8} text="No open bills — the whole amount will be recorded as an advance." />
                      : openDocs.map((d) => (
                        <tr key={d.id}>
                          <td style={tdStyle}>{d.doc_number}</td>
                          <td style={tdStyle}>{dmy(d.doc_date)}</td>
                          <td style={tdStyle}>{dmy(d.due_date)}</td>
                          <td style={{ ...numTd, color: d.days_overdue > 0 ? '#b91c1c' : TEXT.body }}>{d.days_overdue || '—'}</td>
                          <td style={numTd}>{inr(d.total)}</td>
                          <td style={numTd}>{inr(d.amount_due)}</td>
                          <td style={{ ...numTd, width: 140 }}>
                            <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right', padding: '6px 8px' }}
                              value={settle[d.id] ?? ''} onChange={(e) => setSettle((s) => ({ ...s, [d.id]: e.target.value }))} />
                          </td>
                          <td style={tdStyle}><button type="button" style={linkBtnStyle} onClick={() => payInFull(d)}>{ptype === 'vendor' ? 'Pay in full' : 'Receive in full'}</button></td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
                {openCredits.length > 0 && (
                  <p style={sheetHint}>
                    Existing unadjusted credits on this party (allocate them from the voucher list or Outstanding rather than paying again):{' '}
                    {openCredits.map((c) => `${c.doc_number} (${dmy(c.doc_date)}) ${inr(c.available)}`).join('; ')}
                  </p>
                )}
              </SheetSection>
              {openDocs.length > 0 && (
                <div data-tour="fin-pay-deductions">
                  <SheetSection icon="tag" title={`Deductions ${ptype === 'customer' ? 'made by the customer' : 'made from the vendor'}`} extra={<>
                    <Optional />
                    <button type="button" style={{ ...linkBtnStyle, marginLeft: 'auto' }} onClick={() => setDeductions((ds) => [...ds, newDeduction()])}>+ Add deduction</button>
                  </>}>
                    {deductions.length === 0 ? (
                      <p style={{ ...sheetHint, margin: 0 }}>
                        {ptype === 'customer' ? 'Customer paid less than the bill because of LD, a penalty, bank charges or a short payment? ' : 'Deducting LD / penalty from the vendor? '}
                        Add it here so the bill closes without cash and the difference goes to its own ledger. A rate difference or return needs a {ptype === 'customer' ? 'credit' : 'debit'} note instead (GST must be reversed).
                      </p>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                          <thead>
                            <tr>{['Bill', 'Reason', 'Amount (₹)', 'Ledger (optional)', 'Remarks', ''].map((h, i) => (
                              <th key={h} style={{ ...thStyle, position: 'static', background: 'transparent', padding: '6px 6px' }}>{h}{i === 0 && <> <RowCount count={deductions.length} /></>}</th>))}</tr>
                          </thead>
                          <tbody>
                            {deductions.map((d) => {
                              const set = (patch: Partial<DeductionLine>) => setDeductions((ds) => ds.map((x) => (x.key === d.key ? { ...x, ...patch } : x)))
                              return (
                                <tr key={d.key}>
                                  <td style={{ ...tcell, width: 200 }}>
                                    <Select style={sheetInput} value={d.target_id} onChange={(e) => set({ target_id: e.target.value })}>
                                      <option value="">Pick bill</option>
                                      {openDocs.map((o) => <option key={o.id} value={String(o.id)}>{o.doc_number}</option>)}
                                    </Select>
                                  </td>
                                  <td style={{ ...tcell, width: 230 }}>
                                    <Select style={sheetInput} value={d.reason} onChange={(e) => set({ reason: e.target.value })}>
                                      {DEDUCTION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                    </Select>
                                  </td>
                                  <td style={{ ...tcell, width: 130 }}>
                                    <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={d.amount} onChange={(e) => set({ amount: e.target.value })} />
                                  </td>
                                  <td style={{ ...tcell, minWidth: 220 }}>
                                    <SearchableSelect value={d.gl_account_id} onChange={(v: string) => set({ gl_account_id: v })}
                                      options={[{ value: '', label: '— default for the reason —' }, ...splitLedgerOptions]} placeholder="Default ledger" />
                                  </td>
                                  <td style={tcell}><input style={sheetInput} value={d.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="e.g. LD 0.5%/week, 3 weeks late" /></td>
                                  <td style={{ ...tcell, width: 30, paddingTop: 12 }}>
                                    <button type="button" style={dangerLinkStyle} onClick={() => setDeductions((ds) => ds.filter((x) => x.key !== d.key))}>✕</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {deductions.length > 0 && (
                      <p style={sheetHint}>
                        Deductions <b>{inr(deductionTotal)}</b> + cash settled <b>{inr(allocated)}</b> = bills cleared <b>{inr(r2(deductionTotal + allocated))}</b>.
                        {ptype === 'customer' && ' Receipts whose write-offs (other than bank charges) exceed the Finance Settings limit wait for approval.'}
                      </p>
                    )}
                  </SheetSection>
                </div>
              )}
            </div>
          )}

          {/* Expense / other receipt: ledger split */}
          {isSplit && (
            <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }} data-tour="fin-pay-split-lines">
              <SheetSection icon="list" title={ptype === 'expense' ? 'Expense ledgers (debit)' : 'Income / other ledgers (credit)'}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
                    <thead>
                      <tr>
                        {['Ledger', 'Amount (₹)', 'Cost centre', 'Internal order', 'Remarks', ''].map((h, i) => (
                          <th key={h} style={{ ...thStyle, position: 'static', background: 'transparent', padding: '6px 6px' }}>{h}{i === 0 && <> <RowCount count={lines.length} /></>}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const set = (patch: Partial<SplitLine>) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))
                        return (
                          <tr key={l.key}>
                            <td style={{ ...tcell, minWidth: 280 }}>
                              <SearchableSelect value={l.gl_account_id} onChange={(v: string) => set({ gl_account_id: v })} options={splitLedgerOptions} placeholder="Pick ledger" />
                            </td>
                            <td style={{ ...tcell, width: 140 }}>
                              <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={l.amount} onChange={(e) => set({ amount: e.target.value })} />
                            </td>
                            <td style={{ ...tcell, width: 220 }}>
                              <SearchableSelect value={l.cost_center_id} onChange={(v: string) => set({ cost_center_id: v })}
                                options={[{ value: '', label: '— none —' }, ...costCenters.filter((c) => c.status === 'active').map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))]}
                                placeholder={ledgers.find((a) => String(a.id) === l.gl_account_id)?.cost_object_required && !l.internal_order_id ? 'Required' : 'Optional'} />
                            </td>
                            <td style={{ ...tcell, width: 220 }}>
                              <SearchableSelect value={l.internal_order_id} onChange={(v: string) => set({ internal_order_id: v })}
                                options={[{ value: '', label: '— none —' }, ...internalOrders.map((o) => ({ value: String(o.id), label: `${o.code} — ${o.name}` }))]}
                                placeholder="Optional" />
                            </td>
                            <td style={tcell}><input style={sheetInput} value={l.remarks} onChange={(e) => set({ remarks: e.target.value })} /></td>
                            <td style={{ ...tcell, width: 30, paddingTop: 12 }}>
                              {lines.length > 1 && <button type="button" style={dangerLinkStyle} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={sheetBtn('secondary')} onClick={() => setLines((ls) => [...ls, newSplitLine()])}><SheetIcon name="plus" size={14} />Add line</button>
                    {lines.length === 1 && amountNum > 0 && !lines[0].amount && (
                      <button type="button" style={sheetBtn('secondary')} onClick={() => setLines((ls) => [{ ...ls[0], amount: String(amountNum) }])}>Use full amount</button>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: linesTotal === amountNum ? SHEET.BODY : '#b91c1c' }}>
                    Lines total <b>{inr(linesTotal)}</b> of <b>{inr(amountNum)}</b>
                    {linesTotal !== amountNum && ` — difference ${inr(r2(amountNum - linesTotal))}`}
                  </div>
                </div>
              </SheetSection>
            </div>
          )}
        </FormPage>
      </div>
    )
  }

  const COLS = 12

  return (
    <div>
      <FinanceNav />
      <PageHeader
        title="Payments & Receipts"
        subtitle="Vendor payments, customer receipts, expense payments, other receipts and contra transfers — settled bill-wise against open invoices."
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('accounts', 'payment_runs', 'view') && <Link href="/dashboard/finance/payments/runs" style={{ ...secondaryBtnStyle, textDecoration: 'none' }}>Payment runs</Link>}
          {can('accounts', 'payments', 'view') && <Link href="/dashboard/finance/payments/advances" style={{ ...secondaryBtnStyle, textDecoration: 'none' }}>Advances & write-offs</Link>}
          {!showForm && can('accounts', 'payments', 'create') && <button data-tour="fin-pay-new-btn" style={primaryBtnStyle} onClick={() => { setShowForm(true); setFormError(null) }}>+ New voucher</button>}
        </div>}
      />

      <ErrorBanner error={error} />

      <SubTabs tabs={TABS} value={tab} onChange={(t) => { setTab(t); setExpanded(null) }} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="From" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-pay-from"><DateField value={fromDate} onChange={setFromDate} /></Field>
        <Field label="To" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-pay-to"><DateField value={toDate} onChange={setToDate} /></Field>
        <Field label="Status" style={{ flex: '0 1 140px', minWidth: 130 }} tour="fin-pay-status">
          <Select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="posted">Posted</option>
            <option value="pending_approval">Waiting approval</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
      </div>

      <TableWrap minWidth={1350} tour="fin-pay-table">
        <thead>
          <tr>
            <th style={thStyle}></th>
            <th style={thStyle}>Number <RowCount count={loading ? 0 : payments.length} /></th>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Party / ledgers</th>
            <th style={thStyle}>Bank / cash</th>
            <th style={thStyle}>Mode / ref</th>
            <th style={numTh}>Amount (₹)</th>
            <th style={numTh}>Unallocated (₹)</th>
            <th style={thStyle}>Bank reco</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading vouchers…" />
            : payments.length === 0 ? <EmptyRow colSpan={COLS} text="No vouchers in this period." />
            : payments.map((p) => {
              const isOpen = expanded === p.id
              const reconciled = p.reconciliation_status !== 'pending' || (p.counter_reconciliation_status ?? 'pending') !== 'pending'
              const canAllocate = p.status === 'posted' && (p.payment_type === 'vendor' || p.payment_type === 'customer') && p.unallocated_amount > 0.005
              return (
                <Fragment key={p.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : p.id)}>
                    <td style={{ ...tdStyle, width: 24, color: TEXT.muted }}>{isOpen ? '▾' : '▸'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.payment_number}<ProofClip count={proofCounts[p.id]} /></td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(p.payment_date)}</td>
                    <td style={tdStyle}><StatusPill status={p.payment_type} labels={TYPE_LABELS} colors={TYPE_HEX} /></td>
                    <td style={{ ...tdStyle, maxWidth: 260 }}>{partyCell(p)}</td>
                    <td style={{ ...tdStyle, maxWidth: 260 }}>
                      {p.bank_account_label || '—'}
                      {p.payment_type === 'contra' && p.counter_bank_account_label && <> → {p.counter_bank_account_label}</>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {MODE_LABELS[p.payment_mode] || p.payment_mode}
                      {(p.cheque_number || p.reference_no) && <div style={{ fontSize: 11, color: TEXT.muted }}>{p.cheque_number ? `Chq ${p.cheque_number}` : p.reference_no}</div>}
                    </td>
                    <td style={numTd}>{inr(p.amount)}</td>
                    <td style={{ ...numTd, color: p.unallocated_amount > 0.005 ? '#b45309' : TEXT.muted }}>{inr(p.unallocated_amount, { blankZero: true })}</td>
                    <td style={tdStyle}><StatusPill status={p.reconciliation_status} labels={RECON_LABELS} colors={RECON_HEX} /></td>
                    <td style={tdStyle}>
                      <StatusPill status={p.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                      {p.is_advance && <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 2 }}>Advance{p.sales_order_number ? ` · ${p.sales_order_number}` : p.purchase_order_number ? ` · ${p.purchase_order_number}` : ''}</div>}
                      {p.status === 'pending_approval' && p.approval_stage && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 2 }}>{p.approval_stage}</div>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 12 }}>
                        {canAllocate && canFeature('accounts', 'payments', 'allocation', 'edit') && <button style={linkBtnStyle} onClick={() => setAllocTarget(p)}>Allocate</button>}
                        {p.status === 'posted' && (
                          reconciled
                            ? <span style={{ fontSize: 11, color: TEXT.muted }} title="This voucher has been matched to the bank statement, so it really went through the bank — record a reverse voucher instead of cancelling.">Reconciled</span>
                            : canFeature('accounts', 'payments', 'cancellation', 'cancel') && <button style={dangerLinkStyle} onClick={() => setCancelTarget(p)}>Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={COLS} style={{ ...tdStyle, background: 'rgba(253,241,230,.35)', padding: '12px 20px' }}>
                        <VoucherDetail p={p} onRemoveAllocation={(id) => setRemoveAllocId(id)} />
                        {(p.status === 'pending_approval' || p.approval_request_id) && (
                          <div style={{ marginTop: 12 }}>
                            <ApprovalPanel entityType="accounts_payment" entityId={p.id} onChanged={() => { loadPayments(); loadBanks() }} />
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
        open={!!cancelTarget}
        tour="fin-pay-cancel-dialog"
        icon="x"
        title={`Cancel ${cancelTarget?.payment_number || 'voucher'}?`}
        subtitle="Reverses the voucher's journal entry and releases every bill it settled."
        message="Those bills become due again. A voucher already reconciled with the bank statement can't be cancelled. The reason is kept on the voucher and in the audit log."
        label="Reason for cancelling"
        placeholder="e.g. Paid twice — duplicate of PV/2026-27/0042"
        confirmLabel="Cancel voucher"
        requireValue
        onConfirm={doCancel}
        onCancel={() => setCancelTarget(null)}
      />
      <ConfirmDialog
        open={removeAllocId != null}
        title="Remove this allocation?"
        message="The bill becomes due again by this amount, and the amount goes back to the voucher as an unallocated advance. No journal entry changes."
        confirmLabel="Remove"
        onConfirm={doRemoveAllocation}
        onCancel={() => setRemoveAllocId(null)}
      />
      <MessageDialog
        open={!!message}
        variant="success"
        title={message?.title || ''}
        message={message?.message || ''}
        onClose={() => setMessage(null)}
      />
      {allocTarget && (
        <AllocateDialog
          voucher={allocTarget}
          onClose={() => setAllocTarget(null)}
          onDone={(total) => {
            const p = allocTarget
            setAllocTarget(null)
            setMessage({ title: 'Allocated', message: `${inr(total)} of ${p.payment_number} has been set off against the selected bills.` })
            loadPayments()
          }}
        />
      )}
    </div>
  )
}

function VoucherDetail({ p, onRemoveAllocation }: { p: PaymentTransaction; onRemoveAllocation: (id: number) => void }) {
  const { canFeature } = useCan()
  const sub: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.04em' }
  const cell: React.CSSProperties = { padding: '5px 10px', fontSize: 12.5, borderTop: `1px solid ${BORDER.normal}` }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <RecordFacts>
        <DetailGroup title="Payment" last>
          <DetailRow label="Narration">{p.narration || null}</DetailRow>
          {p.cheque_number && <DetailRow label="Cheque">{`No. ${p.cheque_number}${p.cheque_date ? ` dated ${dmy(p.cheque_date)}` : ''}`}</DetailRow>}
          {!p.cheque_number && p.cheque_date && <DetailRow label="Cheque date">{dmy(p.cheque_date)}</DetailRow>}
          {p.reference_no && <DetailRow label="Reference">{p.reference_no}</DetailRow>}
          {p.cleared_date && <DetailRow label="Cleared in bank on">{dmy(p.cleared_date)}</DetailRow>}
          {p.is_advance && <DetailRow label="Advance against">{p.sales_order_number || p.purchase_order_number || `On account${p.advance_reason ? ` — ${p.advance_reason}` : ''}`}</DetailRow>}
        </DetailGroup>
        <DetailGroup title="Record" last>
          <DetailRow label="Recorded by">{p.created_by_name || null}</DetailRow>
          {p.approved_by_name && <DetailRow label="Approved by">{p.approved_by_name}</DetailRow>}
          {p.rejection_reason && <DetailRow label="Rejected because"><span style={{ color: '#b91c1c' }}>{p.rejection_reason}</span></DetailRow>}
        </DetailGroup>
      </RecordFacts>
      {p.lines.length > 0 && (
        <div>
          <div style={sub}>Ledger lines</div>
          <table style={{ borderCollapse: 'collapse', minWidth: 520 }}>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id}>
                  <td style={cell}>{l.gl_account_code} — {l.gl_account_name}</td>
                  <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(l.amount)}</td>
                  <td style={{ ...cell, color: TEXT.muted }}>{l.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(p.deductions?.length ?? 0) > 0 && (
        <div>
          <div style={sub}>Deductions (settled without cash)</div>
          <table style={{ borderCollapse: 'collapse', minWidth: 520 }}>
            <tbody>
              {(p.deductions || []).map((d) => (
                <tr key={d.id}>
                  <td style={cell}>{d.target_number || `#${d.target_id}`}</td>
                  <td style={cell}>{d.reason_label || d.reason}</td>
                  <td style={cell}>{d.gl_account_code} — {d.gl_account_name}</td>
                  <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(d.amount)}</td>
                  <td style={{ ...cell, color: TEXT.muted }}>{d.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(p.payment_type === 'vendor' || p.payment_type === 'customer') && p.status === 'pending_approval' && (
        <div style={{ fontSize: 12.5, color: TEXT.muted }}>Bills are settled when the payment is approved and posted.</div>
      )}
      {(p.payment_type === 'vendor' || p.payment_type === 'customer') && p.status !== 'pending_approval' && (
        <div>
          <div style={sub}>{p.is_advance ? 'Invoices this advance was adjusted against' : 'Bills settled'}</div>
          {p.allocations.length === 0 ? (
            <div style={{ fontSize: 12.5, color: TEXT.muted }}>Nothing allocated yet — the full amount is an advance on the party.</div>
          ) : (
            <table style={{ borderCollapse: 'collapse', minWidth: 520 }}>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.id}>
                    <td style={cell}>{a.target_number || `#${a.target_id}`}</td>
                    <td style={cell}>{dmy(a.allocation_date)}</td>
                    <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(a.amount)}</td>
                    <td style={cell}>
                      {p.status === 'posted' && canFeature('accounts', 'payments', 'allocation', 'edit') && <button style={dangerLinkStyle} onClick={() => onRemoveAllocation(a.id)}>Remove</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div>
        <FinanceAttachments label={<div style={sub}>Supporting documents</div>} entityType="payment" entityId={p.id} tabKey="payments"
          locked={p.status !== 'pending_approval'} closed={p.status === 'cancelled' || p.status === 'rejected'} />
      </div>
    </div>
  )
}

function AllocateDialog({ voucher, onClose, onDone }: { voucher: PaymentTransaction; onClose: () => void; onDone: (total: number) => void }) {
  const partyType: 'vendor' | 'customer' = voucher.payment_type === 'vendor' ? 'vendor' : 'customer'
  const partyId = (partyType === 'vendor' ? voucher.vendor_id : voucher.customer_id) as number
  const [docs, setDocs] = useState<OpenDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    accountsApi.openItems(partyType, partyId)
      .then((d: { documents: OpenDocument[] }) => setDocs(d.documents || []))
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the party\'s open bills.')))
      .finally(() => setLoading(false))
  }, [partyType, partyId])

  const total = r2(Object.values(amounts).reduce((s, v) => s + Number(v || 0), 0))
  const available = voucher.unallocated_amount

  async function save() {
    setError(null)
    const allocations = docs.filter((d) => Number(amounts[d.id] || 0) > 0)
      .map((d) => ({ target_type: d.target_type, target_id: d.id, amount: r2(Number(amounts[d.id])) }))
    if (!allocations.length) { setError(['Enter an amount against at least one bill.']); return }
    if (total > available + 0.001) { setError([`You are allocating ${inr(total)} but ${voucher.payment_number} has only ${inr(available)} unallocated.`]); return }
    setSaving(true)
    try {
      await accountsApi.allocate({ source_type: 'payment', source_id: voucher.id, allocations, allocation_date: todayIso() })
      onDone(total)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not allocate ${voucher.payment_number}.`))
    } finally {
      setSaving(false)
    }
  }

  function fillOldest() {
    let left = available
    const next: Record<number, string> = {}
    for (const d of docs) {
      if (left <= 0) break
      const take = r2(Math.min(left, d.amount_due))
      next[d.id] = String(take)
      left = r2(left - take)
    }
    setAmounts(next)
  }

  return (
    <FormSheet tour="fin-pay-alloc-dialog" width={860} icon="link" title={`Allocate ${voucher.payment_number}`}
      subtitle={`${voucher.vendor_name || voucher.customer_name} — ${inr(available)} unallocated`} onClose={onClose} busy={saving}
      footer={<>
        <button type="button" data-tour="fin-pay-alloc-close" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={onClose}>Close</button>
        <button type="button" data-tour="fin-pay-alloc-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={save}><SheetIcon name="link" size={16} />{saving ? 'Saving…' : 'Allocate'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="list" title="Open bills" extra={docs.length > 0 ? <button type="button" style={{ ...linkBtnStyle, marginLeft: 'auto' }} onClick={fillOldest}>Fill oldest first</button> : undefined}>
          <p style={{ ...sheetHint, margin: '0 0 10px' }}>Set this advance off against the bills it pays; only the bill-wise status changes, the journal entry stays as it is.</p>
          <TableWrap minWidth={640} maxHeight="50vh" tour="fin-pay-alloc-table">
            <thead>
              <tr>
                <th style={thStyle}>Bill no. <RowCount count={loading ? 0 : docs.length} /></th><th style={thStyle}>Date</th><th style={thStyle}>Due</th>
                <th style={numTh}>Overdue days</th><th style={numTh}>Due amount</th><th style={numTh}>Allocate</th><th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={7} text="Loading open bills…" />
                : docs.length === 0 ? <EmptyRow colSpan={7} text="This party has no open bills to allocate against." />
                : docs.map((d) => (
                  <tr key={d.id}>
                    <td style={tdStyle}>{d.doc_number}</td>
                    <td style={tdStyle}>{dmy(d.doc_date)}</td>
                    <td style={tdStyle}>{dmy(d.due_date)}</td>
                    <td style={numTd}>{d.days_overdue || '—'}</td>
                    <td style={numTd}>{inr(d.amount_due)}</td>
                    <td style={{ ...numTd, width: 140 }}>
                      <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right', padding: '6px 8px' }}
                        value={amounts[d.id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [d.id]: e.target.value }))} />
                    </td>
                    <td style={tdStyle}>
                      <button type="button" style={linkBtnStyle} onClick={() => setAmounts((a) => ({ ...a, [d.id]: String(r2(Math.min(d.amount_due, available))) }))}>Max</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
          <div data-tour="fin-pay-alloc-total" style={{ fontSize: 13, color: total > available + 0.001 ? '#b91c1c' : SHEET.BODY }}>
            Allocating <b>{inr(total)}</b> of <b>{inr(available)}</b>
          </div>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
