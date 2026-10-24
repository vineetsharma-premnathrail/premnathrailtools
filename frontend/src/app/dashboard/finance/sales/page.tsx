'use client'

/** Finance > Sales — GST sales (tax) invoices with e-invoice / e-way bill
 *  fields, and credit notes (sales returns) against posted invoices. */
import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, crmApi } from '@/lib/api'
import { AccountsSetup, ARTransaction, GLAccount, GSTRate, Organization, PartyNote, TaxLine } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SheetFooter, SField, SRow, sw, sg } from '@/components/finance/financeSheet'
import { FormSheet, FormPage, SheetColumns, SheetSection, SheetIcon, Optional, SHEET, sheetBtn, sheetInput, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import SalesBillingDueTab from '@/components/finance/SalesBillingDue'
import FinanceAttachments, { ProofPicker, PickedProof, uploadPickedProof, useProofCounts, ProofClip } from '@/components/finance/FinanceAttachments'
import {
  inputStyle, labelStyle, primaryBtnStyle, linkBtnStyle, dangerLinkStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader,
  TableWrap, EmptyRow, TaxLinesEditor, EditableTaxLine, newTaxLine, toLinePayload, previewTax, ApprovalBadge, submitAfterSave,
} from '@/components/finance/financeUi'
import { recordHref } from '@/lib/recordRef'
import { useDocCurrency } from '@/components/finance/DocCurrencyFields'
import Select from '@/components/shared/Select'

type Errors = string | string[]

interface Settlement {
  id: number
  source_type: 'payment' | 'party_note'
  source_id: number
  source_number: string
  amount: number
  allocation_date: string
}

const STATUS_LABELS: Record<string, string> = { pending: 'Draft', posted: 'Issued', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#94a3b8', posted: '#22c55e', cancelled: '#78716c' }
const NOTE_STATUS_LABELS: Record<string, string> = { pending: 'Draft', posted: 'Posted', cancelled: 'Cancelled' }
const COLLECTION_LABELS: Record<string, string> = { pending: 'Uncollected', partial: 'Part received', collected: 'Received', overdue: 'Overdue' }
const COLLECTION_HEX: Record<string, string> = { pending: '#94a3b8', partial: '#f59e0b', collected: '#22c55e', overdue: '#dc2626' }
const REASON_LABELS: Record<string, string> = { return: 'Goods returned', rate_difference: 'Rate difference', discount: 'Discount', deficiency: 'Deficiency / shortage', other: 'Other' }

const TABS = ['Sales Invoices', 'Billing Due', 'Credit Notes'] as const
type Tab = (typeof TABS)[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. */
const TAB_KEYS: Record<Tab, string> = { 'Sales Invoices': 'sales_invoices', 'Billing Due': 'sales_invoices', 'Credit Notes': 'credit_notes' }

/** A party's GST state code — from its GSTIN (authoritative), else its state name. Mirrors services/gst.py. */
function partyStateCode(gstin: string | null | undefined, state: string | null | undefined, codes: Record<string, string>): string | null {
  const g = (gstin || '').trim()
  if (g.length >= 2 && codes[g.slice(0, 2)]) return g.slice(0, 2)
  const s = (state || '').trim()
  if (!s) return null
  if (/^\d{1,2}$/.test(s) && codes[s.padStart(2, '0')]) return s.padStart(2, '0')
  const low = s.toLowerCase().replace('&', 'and')
  for (const [code, name] of Object.entries(codes)) if (name.toLowerCase() === low) return code
  return null
}

function isDraftNumber(n: string) { return n.startsWith('DRAFT-') }

/** CGST Act s.34(2): GST on a credit note can be reduced only up to 30 Nov after the invoice's FY ends. */
function creditNoteDeadline(invoiceDate: string): string {
  const [y, m] = invoiceDate.split('-').map(Number)
  return `${m >= 4 ? y + 1 : y}-11-30`
}

function customerAddress(c: Organization | undefined): string {
  if (!c) return ''
  const tail = [c.city, c.state, c.pin_code].filter(Boolean).join(', ')
  return [c.address, tail].filter(Boolean).join('\n')
}

function toEditableLines(lines: TaxLine[]): EditableTaxLine[] {
  return lines.map((l) => ({
    key: Math.random().toString(36).slice(2), description: l.description, hsn_sac_code: l.hsn_sac_code || '', quantity: l.quantity,
    uom: l.uom || '', rate: l.rate, discount_amount: l.discount_amount, gst_rate: l.gst_rate, gl_account_id: l.gl_account_id,
  }))
}

function Badge({ label, hex }: { label: string; hex: string }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

function LinesTable({ lines, interstate }: { lines: TaxLine[]; interstate: boolean }) {
  const cell: React.CSSProperties = { ...tdStyle, padding: '6px 10px', fontSize: 12 }
  const num: React.CSSProperties = { ...numTd, padding: '6px 10px', fontSize: 12 }
  const th: React.CSSProperties = { ...thStyle, position: 'static', background: 'transparent', padding: '6px 10px' }
  return (
    <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>#</th><th style={th}>Description</th><th style={th}>HSN/SAC</th>
          <th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Rate</th>
          <th style={{ ...th, textAlign: 'right' }}>Discount</th><th style={{ ...th, textAlign: 'right' }}>Taxable</th>
          <th style={{ ...th, textAlign: 'right' }}>GST %</th>
          <th style={{ ...th, textAlign: 'right' }}>{interstate ? 'IGST' : 'CGST + SGST'}</th><th style={th}>Ledger</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td style={cell}>{l.line_number}</td>
            <td style={cell}>{l.description}</td>
            <td style={cell}>{l.hsn_sac_code || '—'}</td>
            <td style={num}>{l.quantity}{l.uom ? ` ${l.uom}` : ''}</td>
            <td style={num}>{inr(l.rate)}</td>
            <td style={num}>{inr(l.discount_amount, { blankZero: true })}</td>
            <td style={num}>{inr(l.taxable_amount)}</td>
            <td style={num}>{l.gst_rate}%</td>
            <td style={num}>{inr(interstate ? l.igst_amount : l.cgst_amount + l.sgst_amount)}</td>
            <td style={cell}>{l.gl_account_code ? `${l.gl_account_code} — ${l.gl_account_name || ''}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

function SettlementList({ rows }: { rows: Settlement[] | undefined }) {
  if (!rows) return <div style={{ fontSize: 12, color: TEXT.muted }}>Loading settlements…</div>
  if (rows.length === 0) return <div style={{ fontSize: 12, color: TEXT.muted }}>Nothing received against this invoice yet.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
    <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td style={{ ...tdStyle, padding: '5px 10px', fontSize: 12 }}>{dmy(s.allocation_date)}</td>
            <td style={{ ...tdStyle, padding: '5px 10px', fontSize: 12 }}>{s.source_type === 'payment' ? 'Receipt' : 'Credit note'} {s.source_number}</td>
            <td style={{ ...numTd, padding: '5px 10px', fontSize: 12 }}>{inr(s.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

export default function FinanceSalesPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs: tabTabs, tab: tabTab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const { canFeature } = useCan()
  // Billing Due lists sales orders to bill — Sales Invoices › Bill from sales order (feature).
  const visibleTabs = tabTabs.filter((t) => t !== 'Billing Due' || canFeature('accounts', 'sales_invoices', 'bill_from_so', 'create'))
  const tab = visibleTabs.includes(tabTab) ? tabTab : (visibleTabs[0] ?? tabTab)
  const [setup, setSetup] = useState<AccountsSetup | null>(null)
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [rates, setRates] = useState<GSTRate[]>([])
  const [customers, setCustomers] = useState<Organization[]>([])
  const [error, setError] = useState<Errors>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([accountsApi.getSetup(), accountsApi.listGLAccounts(), accountsApi.listGstRates(), crmApi.listOrganizations({ picker: true })])
      .then(([s, l, r, c]) => { setSetup(s); setLedgers(l); setRates(r); setCustomers(c) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the sales set-up (company GST state, ledgers, GST rates, customers).')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const ctx: Ctx = { userId: user?.id, setup, ledgers, rates, customers }
  return (
    <div>
      <FinanceNav />
      <PageHeader title="Sales" subtitle="Raise GST tax invoices to customers (CRM organizations), record e-invoice / e-way bill details, and issue credit notes for returns and rate differences." />
      <ErrorBanner error={error} />
      {setup && setup.warnings.length > 0 && <InfoBanner tone="warning">{setup.warnings.map((w) => <div key={w}>{w}</div>)}</InfoBanner>}
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      {tab === 'Sales Invoices' ? <InvoicesTab {...ctx} /> : tab === 'Billing Due' ? (visibleTabs.includes('Billing Due') && <SalesBillingDueTab />) : <CreditNotesTab {...ctx} />}
    </div>
  )
}

interface Ctx {
  userId?: number
  setup: AccountsSetup | null
  ledgers: GLAccount[]
  rates: GSTRate[]
  customers: Organization[]
}

// ─── Sales invoices ──────────────────────────────────────────────────────

function InvoicesTab(ctx: Ctx) {
  const { userId, customers } = ctx
  const { can, canDelete, canFeature } = useCan()
  // Sales Invoices features: Receipts against the invoice, E-invoice details.
  const seeSettlements = canFeature('accounts', 'sales_invoices', 'settlements', 'view')
  const canEInvoice = canFeature('accounts', 'sales_invoices', 'e_invoice', 'edit')
  const [fStatus, setFStatus] = useState('')
  const [fCollection, setFCollection] = useState('')
  const [fCustomer, setFCustomer] = useState('')
  const [rows, setRows] = useState<ARTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Errors>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [settlements, setSettlements] = useState<Record<number, Settlement[]>>({})
  const [showForm, setShowForm] = useState(false)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [eInvoiceFor, setEInvoiceFor] = useState<ARTransaction | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    accountsApi.listARTransactions({
      status: fStatus || undefined, collection_status: fCollection || undefined, customer_id: fCustomer ? Number(fCustomer) : undefined,
    }).then(setRows)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load sales invoices.')))
      .finally(() => setLoading(false))
  }, [fStatus, fCollection, fCustomer])
  useEffect(() => { load() }, [load])

  const toggle = (id: number) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setSettlements((p) => { const n = { ...p }; delete n[id]; return n })
    if (!seeSettlements) return
    accountsApi.arSettlements(id)
      .then((s: Settlement[]) => setSettlements((p) => ({ ...p, [id]: s })))
      .catch((err: unknown) => { setSettlements((p) => ({ ...p, [id]: [] })); setError(extractErrorMessages(err, 'Could not load the receipt history.')) })
  }

  const act = async (fn: () => Promise<unknown>, context: string) => {
    setBusy(true); setError('')
    try { await fn(); load() } catch (err: unknown) { setError(extractErrorMessages(err, context)) } finally { setBusy(false) }
  }

  const proofCounts = useProofCounts('ar_transaction', rows.map((t) => t.id), 'sales_invoices')
  const customerOptions = [{ value: '', label: 'All customers' }, ...customers.map((c) => ({ value: String(c.id), label: c.name }))]
  const COLS = 14

  // Drafting an invoice replaces the list with the invoice form ("← Back" returns to the list).
  if (showForm) {
    return <SalesInvoiceForm {...ctx} onCancel={() => setShowForm(false)} onSaved={(warning) => { setShowForm(false); load(); if (warning) setError(warning) }} />
  }

  return (
    <div>
      <ReasonSheet open={cancelId != null} tour="fin-sinv-cancel-dialog" icon="x" title="Cancel this draft invoice?" requireValue confirmLabel="Cancel invoice"
        subtitle="Only a draft can be cancelled — it never received a tax-invoice number."
        message="No gap is left in the series. An issued tax invoice is corrected with a credit note."
        label="Reason for cancelling" placeholder="e.g. Raised for the wrong customer"
        onConfirm={(reason) => { const id = cancelId!; setCancelId(null); act(() => accountsApi.cancelARTransaction(id, reason), 'Could not cancel the invoice.') }}
        onCancel={() => (busy ? null : setCancelId(null))} />
      {eInvoiceFor && (
        <EInvoiceDialog invoice={eInvoiceFor} onClose={() => setEInvoiceFor(null)} onSaved={() => { setEInvoiceFor(null); load() }} />
      )}

      <ErrorBanner error={error} />

      {can('accounts', 'sales_invoices', 'create') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" data-tour="fin-sinv-new-btn" style={primaryBtnStyle} onClick={() => setShowForm(true)}>+ New sales invoice</button>
        </div>
      )}

      <div data-tour="fin-sinv-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Status" style={{ flex: '0 1 150px' }} tour="fin-sinv-status">
          <Select style={inputStyle} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Draft</option><option value="posted">Issued</option><option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Collection" style={{ flex: '0 1 160px' }} tour="fin-sinv-collection">
          <Select style={inputStyle} value={fCollection} onChange={(e) => setFCollection(e.target.value)}>
            <option value="">All</option><option value="pending">Uncollected</option><option value="partial">Part received</option>
            <option value="overdue">Overdue</option><option value="collected">Received</option>
          </Select>
        </Field>
        <Field label="Customer" style={{ flex: '1 1 260px', maxWidth: 360 }} tour="fin-sinv-customer-filter">
          <SearchableSelect value={fCustomer} onChange={setFCustomer} options={customerOptions} placeholder="All customers" />
        </Field>
      </div>

      <TableWrap minWidth={1450} tour="fin-sinv-table">
        <thead>
          <tr>
            <th style={thStyle}>Invoice no.</th><th style={thStyle}>Date</th><th style={thStyle}>Due</th><th style={thStyle}>Customer</th>
            <th style={thStyle}>GSTIN</th><th style={thStyle}>POS</th><th style={numTh}>Taxable (₹)</th><th style={numTh}>Tax (₹)</th>
            <th style={numTh}>Total (₹)</th><th style={numTh}>Due (₹)</th><th style={numTh}>Overdue</th><th style={thStyle}>E-docs</th>
            <th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={COLS} text="No sales invoices match these filters." /> : rows.map((t) => {
            const isMaker = userId != null && t.created_by_id === userId
            return (
              <Fragment key={t.id}>
                <tr>
                  <td style={tdStyle}>
                    <button type="button" style={{ ...linkBtnStyle, fontSize: 12.5 }} onClick={() => toggle(t.id)}>
                      {expanded === t.id ? '▾' : '▸'} {isDraftNumber(t.invoice_number) ? 'Draft' : t.invoice_number}
                    </button>
                    <ProofClip count={proofCounts[t.id]} />
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(t.invoice_date)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(t.due_date)}</td>
                  <td style={tdStyle}>{t.customer_name || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 11.5 }}>{t.customer_gstin || 'Unregistered'}</td>
                  <td style={tdStyle}>{t.place_of_supply_state_code || '—'}</td>
                  <td style={numTd}>{inr(t.invoice_amount)}</td>
                  <td style={numTd}>
                    {inr(t.gst_amount)}
                    <div style={{ fontSize: 10.5, color: TEXT.muted }}>{t.is_interstate ? 'IGST' : 'CGST + SGST'}</div>
                  </td>
                  <td style={{ ...numTd, fontWeight: 700 }}>{inr(t.total_amount)}</td>
                  <td style={numTd}>{t.status === 'posted' ? inr(t.amount_due) : '—'}</td>
                  <td style={{ ...numTd, color: (t.days_overdue || 0) > 0 ? '#b91c1c' : TEXT.muted }}>{t.days_overdue ? `${t.days_overdue} d` : '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {t.irn && <Badge label="IRN" hex="#0369a1" />}
                      {t.eway_bill_no && <Badge label="EWB" hex="#7c3aed" />}
                      {!t.irn && !t.eway_bill_no && <span style={{ color: TEXT.muted }}>—</span>}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <StatusPill status={t.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                      {t.status === 'pending' && <ApprovalBadge status={t.approval_status} stage={t.approval_stage} />}
                      {t.status === 'posted' && <StatusPill status={t.collection_status} labels={COLLECTION_LABELS} colors={COLLECTION_HEX} />}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {t.status === 'pending' && t.approval_status !== 'pending' && can('accounts', 'sales_invoices', 'submit') && (
                        <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.submitARTransaction(t.id), 'Could not submit the invoice for approval.')}>Submit for approval</button>
                      )}
                      {t.status === 'pending' && (isMaker
                        ? <span style={{ fontSize: 11, color: TEXT.muted }} title="You drafted this invoice, so a different finance user must issue it.">Posted by another finance user (maker-checker)</span>
                        : can('accounts', 'sales_invoices', 'approve') && <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.postARTransaction(t.id), 'Could not issue the invoice.')}>Issue / Post</button>)}
                      {t.status === 'pending' && canDelete('accounts', 'sales_invoices', t.created_by_id ?? null) && (
                        <button type="button" disabled={busy} style={dangerLinkStyle} onClick={() => setCancelId(t.id)}>Cancel</button>
                      )}
                      {t.status !== 'cancelled' && canEInvoice && (
                        <button type="button" style={linkBtnStyle} onClick={() => setEInvoiceFor(t)}>E-invoice / e-way bill</button>
                      )}
                      {t.status === 'posted' && t.amount_due > 0.005 && can('accounts', 'payments', 'create') && (
                        <Link href={recordHref('/dashboard/finance/payments', t, 'customer_id', undefined, 'customer_id')} style={{ ...linkBtnStyle, textDecoration: 'none' }}>Receive</Link>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === t.id && (
                  <tr>
                    <td colSpan={COLS} style={{ padding: '12px 18px', background: 'rgba(148,163,184,0.06)', borderTop: `1px solid ${BORDER.normal}` }}>
                      <ApprovalPanel entityType="accounts_ar_transaction" entityId={t.id} onChanged={() => load()} />
                      <LinesTable lines={t.lines} interstate={t.is_interstate} />
                      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 12, fontSize: 12, color: TEXT.secondary }}>
                        <div style={{ lineHeight: 1.7, maxWidth: 520 }}>
                          {t.is_interstate
                            ? <div>IGST {inr(t.igst_amount)}</div>
                            : <div>CGST {inr(t.cgst_amount)} · SGST {inr(t.sgst_amount)}</div>}
                          {t.round_off !== 0 && <div>Round-off: {inr(t.round_off)}</div>}
                          {t.customer_po_number && <div>Customer PO: {t.customer_po_number}{t.customer_po_date ? ` dt. ${dmy(t.customer_po_date)}` : ''}</div>}
                          {t.billing_address && <div style={{ whiteSpace: 'pre-line' }}><b>Bill to:</b> {t.billing_address}</div>}
                          {t.shipping_address && <div style={{ whiteSpace: 'pre-line' }}><b>Ship to:</b> {t.shipping_address}</div>}
                          {t.narration && <div>Narration: {t.narration}</div>}
                          {t.cancelled_reason && <div style={{ color: '#b91c1c' }}>Cancelled: {t.cancelled_reason}</div>}
                          <div>Drafted by {t.created_by_name || '—'}</div>
                        </div>
                        <div style={{ lineHeight: 1.7 }}>
                          <div style={{ ...labelStyle, marginBottom: 4 }}>E-invoice / e-way bill</div>
                          <div>IRN: {t.irn ? <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{t.irn}</span> : '—'}</div>
                          <div>Ack no.: {t.ack_no || '—'} · Ack date: {dmy(t.ack_date)}</div>
                          <div>E-way bill: {t.eway_bill_no || '—'} · Date: {dmy(t.eway_bill_date)} · Vehicle: {t.vehicle_no || '—'}</div>
                        </div>
                        {t.status === 'posted' && seeSettlements && (
                          <div>
                            <div style={{ ...labelStyle, marginBottom: 4 }}>Receipt history</div>
                            <SettlementList rows={settlements[t.id]} />
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <FinanceAttachments label={<div style={{ ...labelStyle, marginBottom: 4 }}>Supporting documents</div>} entityType="ar_transaction" entityId={t.id} tabKey="sales_invoices"
                          locked={t.status !== 'pending'} closed={t.status === 'cancelled'} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </TableWrap>
    </div>
  )
}

function EInvoiceDialog({ invoice, onClose, onSaved }: { invoice: ARTransaction; onClose: () => void; onSaved: () => void }) {
  const [irn, setIrn] = useState(invoice.irn || '')
  const [ackNo, setAckNo] = useState(invoice.ack_no || '')
  const [ackDate, setAckDate] = useState(invoice.ack_date || '')
  const [ewb, setEwb] = useState(invoice.eway_bill_no || '')
  const [ewbDate, setEwbDate] = useState(invoice.eway_bill_date || '')
  const [vehicle, setVehicle] = useState(invoice.vehicle_no || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Errors>('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const save = async () => {
    setError('')
    if (irn.trim() && irn.trim().length !== 64) { setError(`An IRN is exactly 64 characters (this one is ${irn.trim().length}) — copy it in full from the e-invoice portal.`); return }
    if (ewb.trim() && !/^\d{12}$/.test(ewb.trim())) { setError('An e-way bill number is 12 digits.'); return }
    setSaving(true)
    try {
      await accountsApi.updateEInvoice(invoice.id, {
        irn: irn.trim() || null, ack_no: ackNo.trim() || null, ack_date: ackDate || null,
        eway_bill_no: ewb.trim() || null, eway_bill_date: ewbDate || null, vehicle_no: vehicle.trim().toUpperCase() || null,
      })
      onSaved()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the e-invoice / e-way bill details.'))
    } finally { setSaving(false) }
  }

  return (
    <FormSheet tour="fin-einv-dialog" width={640} icon="doc" title="E-invoice / e-way bill"
      subtitle={`${isDraftNumber(invoice.invoice_number) ? 'Draft invoice' : invoice.invoice_number}${invoice.customer_name ? ` · ${invoice.customer_name}` : ''}`}
      onClose={onClose} busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Save details" cancelLabel="Close" cancelTour="fin-einv-close" submitTour="fin-einv-save" />}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 16px', lineHeight: 1.5 }}>
          Generate the IRN on the IRP (e-invoice) portal and the e-way bill on the EWB portal, then record them here. They don&apos;t change any amount.
        </p>
        <EInvoiceFields irn={irn} setIrn={setIrn} ackNo={ackNo} setAckNo={setAckNo} ackDate={ackDate} setAckDate={setAckDate}
          ewb={ewb} setEwb={setEwb} ewbDate={ewbDate} setEwbDate={setEwbDate} vehicle={vehicle} setVehicle={setVehicle} />
      </div>
    </FormSheet>
  )
}

function EInvoiceFields(p: {
  irn: string; setIrn: (v: string) => void; ackNo: string; setAckNo: (v: string) => void; ackDate: string; setAckDate: (v: string) => void
  ewb: string; setEwb: (v: string) => void; ewbDate: string; setEwbDate: (v: string) => void; vehicle: string; setVehicle: (v: string) => void
}) {
  return (
    <div>
      <SheetSection icon="shield" title="E-invoice (IRN)">
        <SField label={`IRN (64 characters)${p.irn.trim() ? ` — ${p.irn.trim().length}/64` : ''}`} optional style={{ marginBottom: 12 }} tour="fin-einv-irn">
          <input style={{ ...sheetInput, fontFamily: 'monospace', fontSize: 12 }} value={p.irn} onChange={(e) => p.setIrn(e.target.value)} maxLength={64} />
        </SField>
        <SRow mb={0}>
          <SField label="Ack no." style={sw(210)} tour="fin-einv-ack-no">
            <input style={sheetInput} value={p.ackNo} onChange={(e) => p.setAckNo(e.target.value)} />
          </SField>
          <SField label="Ack date" style={sw(170)} tour="fin-einv-ack-date">
            <DateField value={p.ackDate} onChange={p.setAckDate} />
          </SField>
        </SRow>
      </SheetSection>
      <SheetSection icon="truck" title="E-way bill">
        <SRow mb={0}>
          <SField label="E-way bill no. (12 digits)" style={sw(200)} tour="fin-einv-ewb">
            <input style={sheetInput} value={p.ewb} inputMode="numeric" maxLength={12} onChange={(e) => p.setEwb(e.target.value.replace(/\D/g, ''))} />
          </SField>
          <SField label="E-way bill date" style={sw(170)} tour="fin-einv-ewb-date">
            <DateField value={p.ewbDate} onChange={p.setEwbDate} />
          </SField>
          <SField label="Vehicle no." style={sw(160)} tour="fin-einv-vehicle">
            <input style={sheetInput} value={p.vehicle} onChange={(e) => p.setVehicle(e.target.value)} placeholder="e.g. HR55AB1234" />
          </SField>
        </SRow>
      </SheetSection>
    </div>
  )
}

function SalesInvoiceForm({ setup, ledgers, rates, customers, onSaved, onCancel }: Ctx & { onSaved: (warning?: string) => void; onCancel: () => void }) {
  const { can } = useCan()
  const codes = setup?.state_codes || {}
  const companyState = setup?.company_gst.state_code || ''
  const [customerId, setCustomerId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const docCur = useDocCurrency(invoiceDate)
  const [posChoice, setPlaceOfSupply] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState('')
  const [billing, setBilling] = useState('')
  const [shipping, setShipping] = useState('')
  const [narration, setNarration] = useState('')
  const [roundOff, setRoundOff] = useState('0')
  const [lines, setLines] = useState<EditableTaxLine[]>([newTaxLine()])
  const [showE, setShowE] = useState(false)
  const [irn, setIrn] = useState('')
  const [ackNo, setAckNo] = useState('')
  const [ackDate, setAckDate] = useState('')
  const [ewb, setEwb] = useState('')
  const [ewbDate, setEwbDate] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [proof, setProof] = useState<PickedProof[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Errors>('')

  const customer = customers.find((c) => String(c.id) === customerId)
  const placeOfSupply = posChoice || companyState
  const interstate = customer && placeOfSupply && companyState ? placeOfSupply !== companyState : null
  const totals = previewTax(lines, !!interstate)
  const ro = Number(roundOff || 0)

  const pickCustomer = (v: string) => {
    setCustomerId(v)
    const c = customers.find((x) => String(x.id) === v)
    if (!c) return
    // Place of supply = customer's GSTIN state, else its state, else ours.
    setPlaceOfSupply(partyStateCode(c.gst_number, c.state, codes) || companyState)
    const addr = customerAddress(c)
    if (addr) setBilling(addr)
  }

  const submit = async () => {
    setError('')
    if (!customerId) { setError('Pick the customer (CRM organization) this invoice is for.'); return }
    if (Math.abs(ro) >= 1) { setError('Round-off only absorbs paise — it must be less than ₹1 either way.'); return }
    if (irn.trim() && irn.trim().length !== 64) { setError(`An IRN is exactly 64 characters (this one is ${irn.trim().length}) — copy it in full from the e-invoice portal.`); return }
    if (ewb.trim() && !/^\d{12}$/.test(ewb.trim())) { setError('An e-way bill number is 12 digits.'); return }
    setSaving(true)
    try {
      const created: ARTransaction = await accountsApi.createARTransaction({
        customer_id: Number(customerId), invoice_date: invoiceDate, place_of_supply_state_code: placeOfSupply || null, round_off: ro, ...docCur.payload(),
        billing_address: billing.trim() || null, shipping_address: shipping.trim() || null,
        customer_po_number: poNumber.trim() || null, customer_po_date: poDate || null, narration: narration.trim() || null,
        irn: irn.trim() || null, ack_no: ackNo.trim() || null, ack_date: ackDate || null,
        eway_bill_no: ewb.trim() || null, eway_bill_date: ewbDate || null, vehicle_no: vehicle.trim().toUpperCase() || null,
        lines: toLinePayload(lines),
      })
      // Supporting documents go up before the draft reaches its approvers.
      const proofWarning = proof.length ? await uploadPickedProof('ar_transaction', created.id, proof, 'The sales invoice') : ''
      // A drafted invoice goes straight to its approvers (Organization › Approval Workflows).
      const submitWarning = can('accounts', 'sales_invoices', 'submit')
        ? await submitAfterSave(() => accountsApi.submitARTransaction(created.id), 'The sales invoice') : ''
      setProof([])
      onSaved([proofWarning, submitWarning].filter(Boolean).join(' '))
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the sales invoice.'))
    } finally { setSaving(false) }
  }

  const stateEntries = Object.entries(codes).sort((a, b) => a[0].localeCompare(b[0]))
  const customerOptions = customers.map((c) => ({ value: String(c.id), label: `${c.name}${c.gst_number ? ` · ${c.gst_number}` : ''}` }))

  return (
    <FormPage tour="fin-sinv-form" icon="doc" title="New sales invoice" subtitle="Saved as a draft — the tax-invoice number is issued when another finance user posts it." onBack={onCancel} backTour="fin-sinv-back"
      footer={<>
        <button type="button" data-tour="fin-sinv-close" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" data-tour="fin-sinv-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={submit}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save draft'}</button>
      </>}>
      <div style={{ padding: '20px 24px 0' }}>
        <ErrorBanner error={error} />
        <InfoBanner>
          The tax-invoice number (SI/FY/NNNN) is issued only when another finance user posts it, so the series stays consecutive with no gaps
          (GST Rule 46). If turnover is above ₹5 crore an e-invoice is mandatory — generate the IRN on the IRP portal and record it here.
        </InfoBanner>
      </div>

      <SheetColumns
        left={<>
          <SheetSection icon="users" title="Customer">
            <SField label="Customer" req style={{ marginBottom: 12 }} tour="fin-sinv-customer">
              <SearchableSelect value={customerId} onChange={pickCustomer} options={customerOptions} placeholder="Select a customer…" />
              {customer && (
                <p style={sheetHint}>
                  GSTIN {customer.gst_number || 'not registered (B2C)'}{customer.credit_days != null ? ` · ${customer.credit_days} credit days` : ' · 30 credit days (default)'}
                </p>
              )}
            </SField>
            <SRow mb={0}>
              <SField label="Invoice date" req style={sw(170)} tour="fin-sinv-date">
                <DateField value={invoiceDate} onChange={setInvoiceDate} />
              </SField>
              <SField label="Place of supply" req style={sw(240)} tour="fin-sinv-pos" hint="Where the goods are delivered; decides CGST+SGST vs IGST.">
                <Select style={sheetInput} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
                  {!placeOfSupply && <option value="">— select —</option>}
                  {stateEntries.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
                </Select>
              </SField>
            </SRow>
          </SheetSection>
          <SheetSection icon="doc" title="Customer PO" extra={<Optional />}>
            <SRow mb={0}>
              <SField label="Customer PO no." style={sw(200)} tour="fin-sinv-po-no">
                <input style={sheetInput} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </SField>
              <SField label="Customer PO date" style={sw(170)} tour="fin-sinv-po-date">
                <DateField value={poDate} onChange={setPoDate} />
              </SField>
            </SRow>
          </SheetSection>
          <SheetSection icon="building" title="Addresses">
            <SRow mb={0}>
              <SField label="Billing address" style={sg(240, 420)} tour="fin-sinv-billing">
                <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={billing} onChange={(e) => setBilling(e.target.value)} />
              </SField>
              <SField label="Shipping address" style={sg(240, 420)} tour="fin-sinv-shipping">
                <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="Blank = same as billing" />
                {billing && !shipping && <button type="button" style={{ ...linkBtnStyle, marginTop: 4 }} onClick={() => setShipping(billing)}>Copy billing address</button>}
              </SField>
            </SRow>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="doc" title="Narration">
            <SField label="Narration" optional tour="fin-sinv-narration">
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={narration} onChange={(e) => setNarration(e.target.value)} />
            </SField>
          </SheetSection>
          <SheetSection icon="clip" title="Supporting documents" extra={<Optional />}>
            <ProofPicker entityType="ar_transaction" value={proof} onChange={setProof} hint="Customer PO, signed delivery challan / LR copy." />
          </SheetSection>
          <SheetSection icon="rupee" title="Totals">
            <SRow>
              {docCur.fields}
              <SField label="Round-off (₹)" style={sw(130)} tour="fin-sinv-round-off">
                <input type="number" step="0.01" style={sheetInput} value={roundOff} onChange={(e) => setRoundOff(e.target.value)} />
              </SField>
            </SRow>
            <div style={{ fontSize: 13, color: SHEET.BODY, fontVariantNumeric: 'tabular-nums' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Taxable value</span><span>{inr(totals.taxable)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GST</span><span>{inr(totals.tax)}</span></div>
              {ro !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Round-off</span><span>{inr(ro)}</span></div>}
              <div data-tour="fin-sinv-total" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: SHEET.INK, marginTop: 4 }}>
                <span>Invoice total</span><span>{inr(Math.round((totals.total + ro) * 100) / 100)}</span>
              </div>
            </div>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="list" title="Lines">
          <TaxLinesEditor lines={lines} onChange={setLines} ledgers={ledgers} rates={rates} interstate={interstate} ledgerHint="default: Sales" />
        </SheetSection>
        <div style={{ marginBottom: 20 }}>
          <button type="button" data-tour="fin-sinv-einv-toggle" style={linkBtnStyle} onClick={() => setShowE(!showE)}>{showE ? '▾' : '▸'} E-invoice / e-way bill (optional — can be added after issuing)</button>
          {showE && (
            <div style={{ marginTop: 12, padding: '16px 16px 0', borderRadius: 12, border: `1px solid ${SHEET.LINE}` }}>
              <EInvoiceFields irn={irn} setIrn={setIrn} ackNo={ackNo} setAckNo={setAckNo} ackDate={ackDate} setAckDate={setAckDate}
                ewb={ewb} setEwb={setEwb} ewbDate={ewbDate} setEwbDate={setEwbDate} vehicle={vehicle} setVehicle={setVehicle} />
            </div>
          )}
        </div>
      </div>
    </FormPage>
  )
}

// ─── Credit notes ────────────────────────────────────────────────────────

function CreditNotesTab(ctx: Ctx) {
  const { userId } = ctx
  const { can, canDelete } = useCan()
  const [rows, setRows] = useState<PartyNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Errors>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    accountsApi.listNotes({ note_type: 'credit_note' }).then(setRows)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load credit notes.')))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<unknown>, context: string) => {
    setBusy(true); setError('')
    try { await fn(); load() } catch (err: unknown) { setError(extractErrorMessages(err, context)) } finally { setBusy(false) }
  }
  const proofCounts = useProofCounts('party_note', rows.map((n) => n.id), 'credit_notes')
  const COLS = 11

  // Issuing a note replaces the list with the note form ("← Back" returns to the list).
  if (showForm) {
    return <CreditNoteForm {...ctx} onCancel={() => setShowForm(false)} onSaved={(warning) => { setShowForm(false); load(); if (warning) setError(warning) }} />
  }

  return (
    <div>
      <ReasonSheet open={cancelId != null} tour="fin-cn-cancel-dialog" icon="x" title="Cancel this credit note?" requireValue confirmLabel="Cancel note"
        subtitle="Only an unposted note can be cancelled."
        message="A posted note is undone with a fresh opposite document."
        label="Reason for cancelling" placeholder="e.g. Raised against the wrong invoice"
        onConfirm={(reason) => { const id = cancelId!; setCancelId(null); act(() => accountsApi.cancelNote(id, reason), 'Could not cancel the credit note.') }}
        onCancel={() => (busy ? null : setCancelId(null))} />
      <ErrorBanner error={error} />

      {can('accounts', 'credit_notes', 'create') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" data-tour="fin-cn-new-btn" style={primaryBtnStyle} onClick={() => setShowForm(true)}>+ Issue credit note</button>
        </div>
      )}

      <TableWrap minWidth={1150} tour="fin-cn-table">
        <thead>
          <tr>
            <th style={thStyle}>Note no.</th><th style={thStyle}>Date</th><th style={thStyle}>Customer</th><th style={thStyle}>Against invoice</th>
            <th style={thStyle}>Reason</th><th style={numTh}>Taxable (₹)</th><th style={numTh}>GST (₹)</th><th style={numTh}>Total (₹)</th>
            <th style={numTh}>Unadjusted (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={COLS} text="No credit notes yet." /> : rows.map((n) => {
            const isMaker = userId != null && n.created_by_id === userId
            return (
              <Fragment key={n.id}>
                <tr>
                  <td style={tdStyle}>
                    <button type="button" style={{ ...linkBtnStyle, fontSize: 12.5 }} onClick={() => setExpanded(expanded === n.id ? null : n.id)}>
                      {expanded === n.id ? '▾' : '▸'} {isDraftNumber(n.note_number) ? 'Draft' : n.note_number}
                    </button>
                    <ProofClip count={proofCounts[n.id]} />
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(n.note_date)}</td>
                  <td style={tdStyle}>{n.party_name || '—'}</td>
                  <td style={tdStyle}>{n.original_invoice_number || '—'}</td>
                  <td style={tdStyle}>{REASON_LABELS[n.reason] || n.reason}</td>
                  <td style={numTd}>{inr(n.taxable_amount)}</td>
                  <td style={numTd}>{inr(n.gst_amount)}</td>
                  <td style={{ ...numTd, fontWeight: 700 }}>{inr(n.total_amount)}</td>
                  <td style={numTd}>{n.status === 'posted' ? inr(n.unadjusted_amount) : '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <StatusPill status={n.status} labels={NOTE_STATUS_LABELS} colors={STATUS_HEX} />
                      {n.status === 'pending' && <ApprovalBadge status={n.approval_status} stage={n.approval_stage} />}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {n.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {n.approval_status !== 'pending' && can('accounts', 'credit_notes', 'submit') && (
                          <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.submitNote(n.id), 'Could not submit the credit note for approval.')}>Submit for approval</button>
                        )}
                        {isMaker
                          ? <span style={{ fontSize: 11, color: TEXT.muted }}>Posted by another finance user (maker-checker)</span>
                          : can('accounts', 'credit_notes', 'approve') && <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.postNote(n.id), 'Could not post the credit note.')}>Post</button>}
                        {canDelete('accounts', 'credit_notes', n.created_by_id ?? null) && <button type="button" disabled={busy} style={dangerLinkStyle} onClick={() => setCancelId(n.id)}>Cancel</button>}
                      </div>
                    )}
                  </td>
                </tr>
                {expanded === n.id && (
                  <tr>
                    <td colSpan={COLS} style={{ padding: '12px 18px', background: 'rgba(148,163,184,0.06)', borderTop: `1px solid ${BORDER.normal}` }}>
                      <ApprovalPanel entityType="accounts_party_note" entityId={n.id} onChanged={() => load()} />
                      <LinesTable lines={n.lines} interstate={n.is_interstate} />
                      <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 10, lineHeight: 1.7 }}>
                        <div>Customer GSTIN: <b>{n.party_gstin || '—'}</b> · Place of supply: <b>{n.place_of_supply_state_code || '—'}</b>{n.round_off !== 0 && ` · Round-off ${inr(n.round_off)}`}</div>
                        {n.narration && <div>Narration: {n.narration}</div>}
                        <div>Raised by {n.created_by_name || '—'}</div>
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <FinanceAttachments label={<div style={{ ...labelStyle, marginBottom: 4 }}>Supporting documents</div>} entityType="party_note" entityId={n.id} tabKey="credit_notes"
                          locked={n.status !== 'pending'} closed={n.status === 'cancelled'} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </TableWrap>
    </div>
  )
}

function CreditNoteForm({ ledgers, rates, onSaved, onCancel }: Ctx & { onSaved: (warning?: string) => void; onCancel: () => void }) {
  const { can } = useCan()
  const [postedInvoices, setPostedInvoices] = useState<ARTransaction[]>([])
  const [invoiceId, setInvoiceId] = useState('')
  const [noteDate, setNoteDate] = useState(todayIso())
  const [reason, setReason] = useState('return')
  const [roundOff, setRoundOff] = useState('0')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<EditableTaxLine[]>([newTaxLine()])
  const [proof, setProof] = useState<PickedProof[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Errors>('')

  useEffect(() => {
    accountsApi.listARTransactions({ status: 'posted' }).then(setPostedInvoices)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load issued sales invoices.')))
  }, [])

  const inv = postedInvoices.find((i) => String(i.id) === invoiceId)
  const deadline = inv ? creditNoteDeadline(inv.invoice_date) : null
  const pastDeadline = !!deadline && noteDate > deadline
  const invoiceOptions = postedInvoices.map((i) => ({
    value: String(i.id), label: `${i.invoice_number} — ${i.customer_name || ''} · ${dmy(i.invoice_date)} · ${inr(i.total_amount)}`,
  }))
  const ro = Number(roundOff || 0)

  const submit = async () => {
    setError('')
    if (!invoiceId) { setError('Pick the issued sales invoice this credit note corrects — GSTR-1 reports a credit note against its original invoice.'); return }
    if (Math.abs(ro) >= 1) { setError('Round-off only absorbs paise — it must be less than ₹1 either way.'); return }
    setSaving(true)
    try {
      const created: PartyNote = await accountsApi.createNote({
        note_type: 'credit_note', note_date: noteDate, reason, ar_transaction_id: Number(invoiceId),
        round_off: ro, narration: narration.trim() || null, lines: toLinePayload(lines),
      })
      const proofWarning = proof.length ? await uploadPickedProof('party_note', created.id, proof, 'The credit note') : ''
      const submitWarning = can('accounts', 'credit_notes', 'submit')
        ? await submitAfterSave(() => accountsApi.submitNote(created.id), 'The credit note') : ''
      setProof([])
      onSaved([proofWarning, submitWarning].filter(Boolean).join(' '))
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not issue the credit note.'))
    } finally { setSaving(false) }
  }

  return (
    <FormPage tour="fin-cn-form" icon="undo" title="Issue credit note" subtitle="A sales return or a reduction of an issued tax invoice — it reduces the output GST on it." onBack={onCancel} backTour="fin-cn-back"
      footer={<>
        <button type="button" data-tour="fin-cn-close" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" data-tour="fin-cn-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={submit}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save credit note'}</button>
      </>}>
      <div style={{ padding: '20px 24px 0' }}>
        <ErrorBanner error={error} />
        <InfoBanner>
          A credit note must name the original invoice. GST can be reduced only if the note is issued by 30 November after the end of the
          invoice&apos;s financial year (CGST Act s.34) — after that, issue it at 0% GST.
        </InfoBanner>
        {pastDeadline && (
          <InfoBanner tone="warning">This note is dated after {dmy(deadline)}, so GST on invoice {inv?.invoice_number} can no longer be reduced — set the GST rate to 0% on every line (a financial credit note).</InfoBanner>
        )}
      </div>

      <SheetColumns
        left={<>
          <SheetSection icon="doc" title="Against">
            <SField label="Against sales invoice" req tour="fin-cn-invoice">
              <SearchableSelect value={invoiceId} onChange={setInvoiceId} options={invoiceOptions} placeholder="Select an issued invoice…" />
              {inv && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                  <button type="button" style={linkBtnStyle} onClick={() => setLines(toEditableLines(inv.lines))}>Copy lines from invoice {inv.invoice_number}</button>
                  <span style={{ fontSize: 11.5, color: SHEET.MUTED }}>GST reducible until {dmy(deadline)}</span>
                </div>
              )}
            </SField>
          </SheetSection>
          <SheetSection icon="calendar" title="Note">
            <SRow mb={0}>
              <SField label="Note date" req style={sw(170)} tour="fin-cn-date">
                <DateField value={noteDate} onChange={setNoteDate} />
              </SField>
              <SField label="Reason" req style={sw(220)} tour="fin-cn-reason">
                <Select style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </SField>
            </SRow>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="doc" title="Narration">
            <SField label="Narration" optional tour="fin-cn-narration">
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. 5 pcs returned vide customer's challan no. …" />
            </SField>
          </SheetSection>
          <SheetSection icon="clip" title="Supporting documents" extra={<Optional />}>
            <ProofPicker entityType="party_note" value={proof} onChange={setProof} hint="Customer's debit note or return / rejection proof." />
          </SheetSection>
          <SheetSection icon="rupee" title="Totals">
            <SField label="Round-off (₹)" style={sw(130)} tour="fin-cn-round-off">
              <input type="number" step="0.01" style={sheetInput} value={roundOff} onChange={(e) => setRoundOff(e.target.value)} />
            </SField>
            <p style={sheetHint}>Taxable value, GST and note value are shown under the lines.</p>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="list" title="Lines">
          <TaxLinesEditor lines={lines} onChange={setLines} ledgers={ledgers} rates={rates} interstate={inv ? inv.is_interstate : null} ledgerHint="default: Sales" />
        </SheetSection>
      </div>
    </FormPage>
  )
}
