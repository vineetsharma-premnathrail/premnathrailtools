'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi, purchaseOrdersApi, crmApi } from '@/lib/api'
import { GLAccount, VendorInvoice, MatchPreview, P2PPurchaseOrder, BankAccount, ARTransaction, Organization } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import MessageDialog from '@/components/erp/MessageDialog'
import PromptDialog from '@/components/erp/PromptDialog'
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
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }

const MATCH_LABELS: Record<string, string> = { matched: 'Matched', variance: 'Variance', approved_variance: 'Variance Approved' }
const MATCH_HEX: Record<string, string> = { matched: '#22c55e', variance: '#dc2626', approved_variance: '#f59e0b' }
const STATUS_LABELS: Record<string, string> = { pending: 'Pending', posted: 'Posted', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#94a3b8', posted: '#22c55e', cancelled: '#dc2626' }
const PAY_LABELS: Record<string, string> = { pending: 'Unpaid', partial: 'Partially Paid', paid: 'Paid' }
const PAY_HEX: Record<string, string> = { pending: '#94a3b8', partial: '#f59e0b', paid: '#22c55e' }

const AR_STATUS_LABELS: Record<string, string> = { pending: 'Pending', posted: 'Posted', cancelled: 'Cancelled' }
const AR_STATUS_HEX: Record<string, string> = { pending: '#94a3b8', posted: '#22c55e', cancelled: '#dc2626' }
const COLLECTION_LABELS: Record<string, string> = { pending: 'Uncollected', partial: 'Partially Collected', collected: 'Collected', overdue: 'Overdue' }
const COLLECTION_HEX: Record<string, string> = { pending: '#94a3b8', partial: '#f59e0b', collected: '#22c55e', overdue: '#dc2626' }

function Badge({ label, hex }: { label: string; hex: string }) {
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

export default function FinanceArApPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const canApproveVariance = !!user?.is_finance_manager || user?.role === 'admin'

  const [purchaseOrders, setPurchaseOrders] = useState<P2PPurchaseOrder[]>([])
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [invoices, setInvoices] = useState<VendorInvoice[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(true)

  const [poId, setPoId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceGst, setInvoiceGst] = useState('0')
  const [invoiceQty, setInvoiceQty] = useState('')
  const [expenseGlId, setExpenseGlId] = useState('')
  const [preview, setPreview] = useState<MatchPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [variancePromptId, setVariancePromptId] = useState<number | null>(null)
  const [paymentPanelId, setPaymentPanelId] = useState<number | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payBankId, setPayBankId] = useState('')
  const [payMode, setPayMode] = useState('neft')
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  const [customers, setCustomers] = useState<Organization[]>([])
  const [arTransactions, setArTransactions] = useState<ARTransaction[]>([])
  const [loadingAr, setLoadingAr] = useState(true)
  const [customerId, setCustomerId] = useState('')
  const [arAmount, setArAmount] = useState('')
  const [arGst, setArGst] = useState('0')
  const [arDiscount, setArDiscount] = useState('0')
  const [arRevenueGlId, setArRevenueGlId] = useState('')
  const [arSaving, setArSaving] = useState(false)
  const [collectPanelId, setCollectPanelId] = useState<number | null>(null)
  const [collectAmount, setCollectAmount] = useState('')
  const [collectBankId, setCollectBankId] = useState('')
  const [collectMode, setCollectMode] = useState('neft')
  const [collectDate, setCollectDate] = useState(() => new Date().toISOString().slice(0, 10))

  const loadAr = () => { setLoadingAr(true); accountsApi.listArTransactions().then(setArTransactions).finally(() => setLoadingAr(false)) }

  const loadInvoices = () => { setLoadingInvoices(true); accountsApi.listVendorInvoices().then(setInvoices).finally(() => setLoadingInvoices(false)) }

  useEffect(() => {
    if (!isAuthorized) return
    purchaseOrdersApi.list({}).then(setPurchaseOrders)
    accountsApi.listGLAccounts({ status: 'active' }).then((accs: GLAccount[]) => setGlAccounts(accs.filter((a) => a.is_posting_account)))
    accountsApi.listBankAccounts({ status: 'active' }).then(setBankAccounts)
    crmApi.listOrganizations({}).then(setCustomers)
    loadInvoices()
    loadAr()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!poId || !invoiceAmount || !invoiceQty) { setPreview(null); return }
    const handle = setTimeout(() => {
      setPreviewLoading(true)
      accountsApi.matchPreview(Number(poId), Number(invoiceQty), Number(invoiceAmount))
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false))
    }, 400)
    return () => clearTimeout(handle)
  }, [poId, invoiceAmount, invoiceQty])

  if (isLoading || !isAuthorized) return null

  const poOptions = purchaseOrders
    .filter((po) => ['issued', 'acknowledged', 'partially_fulfilled'].includes(po.status))
    .map((po) => ({ value: String(po.id), label: `${po.po_number}${po.vendor_name ? ` — ${po.vendor_name}` : ''}` }))
  const glOptions = glAccounts.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` }))
  const bankOptions = bankAccounts.map((b) => ({ value: String(b.id), label: `${b.bank_name} — ${b.account_no}` }))
  const customerOptions = customers.map((c) => ({ value: String(c.id), label: c.name }))

  const resetForm = () => {
    setPoId(''); setInvoiceNumber(''); setInvoiceAmount(''); setInvoiceGst('0'); setInvoiceQty(''); setExpenseGlId(''); setPreview(null)
  }

  const submitInvoice = async () => {
    if (!poId || !invoiceNumber.trim() || !invoiceAmount || !invoiceQty || !expenseGlId) {
      setError('Purchase order, invoice number, amount, quantity, and expense GL account are all required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await accountsApi.createVendorInvoice({
        purchase_order_id: Number(poId), invoice_number: invoiceNumber, invoice_date: invoiceDate,
        invoice_amount: Number(invoiceAmount), invoice_gst: Number(invoiceGst) || 0, invoice_qty: Number(invoiceQty),
        expense_gl_account_id: Number(expenseGlId),
      })
      resetForm()
      loadInvoices()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to record vendor invoice.'))
    } finally {
      setSaving(false)
    }
  }

  const postInvoice = async (id: number) => {
    setError('')
    try {
      await accountsApi.postVendorInvoice(id)
      loadInvoices()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to post vendor invoice.'))
    }
  }

  const doApproveVariance = async (note: string) => {
    if (!variancePromptId) return
    setBusy(true)
    try {
      await accountsApi.approveVendorInvoiceVariance(variancePromptId, note || undefined)
      setVariancePromptId(null)
      loadInvoices()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to approve variance.'))
      setVariancePromptId(null)
    } finally {
      setBusy(false)
    }
  }

  const openPaymentPanel = (inv: VendorInvoice) => {
    setPaymentPanelId(paymentPanelId === inv.id ? null : inv.id)
    setPayAmount(String(inv.amount_due))
    setPayBankId('')
    setPayMode('neft')
  }

  const submitPayment = async (invoiceId: number) => {
    if (!payBankId || !payAmount) { setError('Bank account and amount are required.'); return }
    setBusy(true)
    setError('')
    try {
      await accountsApi.createPayment({
        vendor_invoice_id: invoiceId, bank_account_id: Number(payBankId), amount: Number(payAmount),
        payment_mode: payMode, payment_date: payDate,
      })
      setPaymentPanelId(null)
      loadInvoices()
      accountsApi.listBankAccounts({ status: 'active' }).then(setBankAccounts)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to record payment.'))
    } finally {
      setBusy(false)
    }
  }

  const resetArForm = () => {
    setCustomerId(''); setArAmount(''); setArGst('0'); setArDiscount('0'); setArRevenueGlId('')
  }

  const submitArInvoice = async () => {
    if (!customerId || !arAmount || !arRevenueGlId) {
      setError('Customer, invoice amount, and revenue GL account are all required.')
      return
    }
    setArSaving(true)
    setError('')
    try {
      await accountsApi.createArTransaction({
        customer_id: Number(customerId), invoice_date: new Date().toISOString().slice(0, 10),
        invoice_amount: Number(arAmount), gst_amount: Number(arGst) || 0, discount_amount: Number(arDiscount) || 0,
        revenue_gl_account_id: Number(arRevenueGlId),
      })
      resetArForm()
      loadAr()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to record customer invoice.'))
    } finally {
      setArSaving(false)
    }
  }

  const postArInvoice = async (id: number) => {
    setError('')
    try {
      await accountsApi.postArTransaction(id)
      loadAr()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to post customer invoice.'))
    }
  }

  const openCollectPanel = (txn: ARTransaction) => {
    setCollectPanelId(collectPanelId === txn.id ? null : txn.id)
    setCollectAmount(String(txn.amount_due))
    setCollectBankId('')
    setCollectMode('neft')
  }

  const submitCollection = async (id: number) => {
    if (!collectBankId || !collectAmount) { setError('Bank account and amount are required.'); return }
    setBusy(true)
    setError('')
    try {
      await accountsApi.collectArTransaction(id, {
        bank_account_id: Number(collectBankId), amount: Number(collectAmount), payment_mode: collectMode, payment_date: collectDate,
      })
      setCollectPanelId(null)
      loadAr()
      accountsApi.listBankAccounts({ status: 'active' }).then(setBankAccounts)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to record collection.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <FinanceNav />

      <MessageDialog open={!!error} variant="error" title="Cannot Complete Action" message={error} onClose={() => setError('')} />
      <PromptDialog
        open={variancePromptId != null}
        title="Approve 3-way-match variance?"
        placeholder="Note (optional) — why is this variance acceptable?"
        confirmLabel="Approve Variance"
        danger={false}
        onConfirm={doApproveVariance}
        onCancel={() => (busy ? null : setVariancePromptId(null))}
      />

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Record Vendor Invoice</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>Accounts Receivable (customer invoices/collections) is a later phase — this page currently covers Accounts Payable only.</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <label style={labelStyle}>Purchase Order</label>
            <SearchableSelect value={poId} onChange={setPoId} options={poOptions} placeholder="Select a PO…" />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Invoice Number</label>
            <input style={inputStyle} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Vendor's own invoice no." />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Invoice Date</label>
            <input type="date" style={inputStyle} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={labelStyle}>Quantity</label>
            <input type="number" style={inputStyle} value={invoiceQty} onChange={(e) => setInvoiceQty(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>Amount</label>
            <input type="number" style={inputStyle} value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 100 }}>
            <label style={labelStyle}>GST</label>
            <input type="number" style={inputStyle} value={invoiceGst} onChange={(e) => setInvoiceGst(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Expense / Inventory GL Account</label>
            <SearchableSelect value={expenseGlId} onChange={setExpenseGlId} options={glOptions} placeholder="Select GL account…" />
          </div>
        </div>

        {previewLoading && <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>Checking 3-way match…</p>}
        {preview && !previewLoading && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: preview.matching_status === 'matched' ? 'rgba(34,197,94,0.08)' : 'rgba(220,38,38,0.08)' }}>
            <Badge label={preview.matching_status === 'matched' ? 'Within Tolerance' : 'Variance — will need approval'} hex={preview.matching_status === 'matched' ? '#16a34a' : '#dc2626'} />
            <span style={{ fontSize: 12, color: TEXT.secondary }}>PO qty {preview.qty_po} · GRN accepted {preview.qty_gr} · Qty variance {preview.qty_variance_pct}% · Amount variance {preview.amount_variance_pct}%</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={saving} onClick={submitInvoice} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Record Invoice'}</button>
        </div>
      </div>

      <div style={{ ...sectionStyle, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Invoices</h2>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 460px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: `${BRAND.primary}0d` }}>
                {['Invoice', 'PO', 'Vendor', 'Total', 'Due', 'Match', 'Status', 'Payment', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingInvoices && <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
              {!loadingInvoices && invoices.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No vendor invoices recorded yet.</td></tr>
              )}
              {invoices.map((inv) => (
                <Fragment key={inv.id}>
                  <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{inv.invoice_number}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12.5, color: TEXT.secondary }}>{inv.po_number || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{inv.vendor_name || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>{inv.invoice_total.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>{inv.amount_due.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px' }}><Badge label={MATCH_LABELS[inv.matching_status]} hex={MATCH_HEX[inv.matching_status]} /></td>
                    <td style={{ padding: '10px 12px' }}><Badge label={STATUS_LABELS[inv.status]} hex={STATUS_HEX[inv.status]} /></td>
                    <td style={{ padding: '10px 12px' }}><Badge label={PAY_LABELS[inv.payment_status]} hex={PAY_HEX[inv.payment_status]} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {inv.status === 'pending' && inv.matching_status === 'variance' && canApproveVariance && (
                          <button type="button" style={linkBtnStyle} onClick={() => setVariancePromptId(inv.id)}>Approve Variance</button>
                        )}
                        {inv.status === 'pending' && inv.matching_status !== 'variance' && (
                          <button type="button" style={linkBtnStyle} onClick={() => postInvoice(inv.id)}>Post</button>
                        )}
                        {inv.status === 'posted' && inv.payment_status !== 'paid' && (
                          <button type="button" style={dangerLinkStyle} onClick={() => openPaymentPanel(inv)}>Record Payment</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {paymentPanelId === inv.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: '12px 16px', background: 'rgba(148,163,184,0.06)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                            <label style={labelStyle}>Bank Account</label>
                            <SearchableSelect value={payBankId} onChange={setPayBankId} options={bankOptions} placeholder="Select bank account…" />
                          </div>
                          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                            <label style={labelStyle}>Amount</label>
                            <input type="number" style={inputStyle} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                          </div>
                          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                            <label style={labelStyle}>Mode</label>
                            <select style={inputStyle} value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                              <option value="neft">NEFT</option>
                              <option value="rtgs">RTGS</option>
                              <option value="cheque">Cheque</option>
                              <option value="cash">Cash</option>
                            </select>
                          </div>
                          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                            <label style={labelStyle}>Payment Date</label>
                            <input type="date" style={inputStyle} value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                          </div>
                          <button type="button" disabled={busy} onClick={() => submitPayment(inv.id)} style={{ ...primaryBtnStyle, padding: '9px 16px' }}>Pay</button>
                          <button type="button" style={linkBtnStyle} onClick={() => setPaymentPanelId(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Record Customer Invoice</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>No 3-way match here — enter the amount and revenue account directly (no CRM entity carries a structured billable amount to match against).</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <label style={labelStyle}>Customer</label>
            <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Select a customer…" />
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>Amount</label>
            <input type="number" style={inputStyle} value={arAmount} onChange={(e) => setArAmount(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 100 }}>
            <label style={labelStyle}>GST</label>
            <input type="number" style={inputStyle} value={arGst} onChange={(e) => setArGst(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 100 }}>
            <label style={labelStyle}>Discount</label>
            <input type="number" style={inputStyle} value={arDiscount} onChange={(e) => setArDiscount(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Revenue GL Account</label>
            <SearchableSelect value={arRevenueGlId} onChange={setArRevenueGlId} options={glOptions} placeholder="Select GL account…" />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={arSaving} onClick={submitArInvoice} style={{ ...primaryBtnStyle, opacity: arSaving ? 0.6 : 1 }}>{arSaving ? 'Saving…' : 'Record Invoice'}</button>
        </div>
      </div>

      <div style={{ ...sectionStyle, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Customer Invoices</h2>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 460px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: `${BRAND.primary}0d` }}>
                {['Invoice', 'Customer', 'Due Date', 'Total', 'Due', 'Status', 'Collection', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingAr && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
              {!loadingAr && arTransactions.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No customer invoices recorded yet.</td></tr>
              )}
              {arTransactions.map((txn) => (
                <Fragment key={txn.id}>
                  <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{txn.invoice_number}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{txn.customer_name || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(txn.due_date)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>{txn.total_amount.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>{txn.amount_due.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px' }}><Badge label={AR_STATUS_LABELS[txn.status]} hex={AR_STATUS_HEX[txn.status]} /></td>
                    <td style={{ padding: '10px 12px' }}><Badge label={COLLECTION_LABELS[txn.collection_status]} hex={COLLECTION_HEX[txn.collection_status]} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {txn.status === 'pending' && (
                          <button type="button" style={linkBtnStyle} onClick={() => postArInvoice(txn.id)}>Post</button>
                        )}
                        {txn.status === 'posted' && txn.collection_status !== 'collected' && (
                          <button type="button" style={dangerLinkStyle} onClick={() => openCollectPanel(txn)}>Record Collection</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {collectPanelId === txn.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: '12px 16px', background: 'rgba(148,163,184,0.06)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                            <label style={labelStyle}>Bank Account</label>
                            <SearchableSelect value={collectBankId} onChange={setCollectBankId} options={bankOptions} placeholder="Select bank account…" />
                          </div>
                          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                            <label style={labelStyle}>Amount</label>
                            <input type="number" style={inputStyle} value={collectAmount} onChange={(e) => setCollectAmount(e.target.value)} />
                          </div>
                          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                            <label style={labelStyle}>Mode</label>
                            <select style={inputStyle} value={collectMode} onChange={(e) => setCollectMode(e.target.value)}>
                              <option value="neft">NEFT</option>
                              <option value="rtgs">RTGS</option>
                              <option value="cheque">Cheque</option>
                              <option value="cash">Cash</option>
                            </select>
                          </div>
                          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                            <label style={labelStyle}>Collection Date</label>
                            <input type="date" style={inputStyle} value={collectDate} onChange={(e) => setCollectDate(e.target.value)} />
                          </div>
                          <button type="button" disabled={busy} onClick={() => submitCollection(txn.id)} style={{ ...primaryBtnStyle, padding: '9px 16px' }}>Collect</button>
                          <button type="button" style={linkBtnStyle} onClick={() => setCollectPanelId(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
