'use client'

/** Finance > Purchase — purchase invoices (PO-linked with 3-way match, or
 *  direct for services/expenses) and debit notes (purchase returns). */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, purchaseOrdersApi } from '@/lib/api'
import { AccountsSetup, GLAccount, GSTRate, MatchPreview, P2PPurchaseOrder, PartyNote, TaxLine, Vendor, VendorInvoice } from '@/types'
import { TEXT, BORDER, BRAND } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SRow, sw } from '@/components/finance/financeSheet'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import {
  inputStyle, labelStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader,
  TableWrap, EmptyRow, TaxLinesEditor, EditableTaxLine, newTaxLine, toLinePayload, useCostObjectOptions, previewTax, ApprovalBadge, submitAfterSave, RecordFacts,
} from '@/components/finance/financeUi'
import { RowCount, pillStyle, DetailGroup, DetailRow } from '@/components/shared/ui'
import { recordHref } from '@/lib/recordRef'
import { useDocCurrency } from '@/components/finance/DocCurrencyFields'
import FinanceAttachments, { ProofPicker, PickedProof, uploadPickedProof, useProofCounts, ProofClip, useProofRules } from '@/components/finance/FinanceAttachments'
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

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', posted: 'Posted', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { pending: '#94a3b8', posted: '#22c55e', cancelled: '#78716c' }
const PAY_LABELS: Record<string, string> = { pending: 'Unpaid', partial: 'Part paid', paid: 'Paid' }
const PAY_HEX: Record<string, string> = { pending: '#94a3b8', partial: '#f59e0b', paid: '#22c55e' }
const MATCH_LABELS: Record<string, string> = { matched: 'Matched', variance: 'Variance', approved_variance: 'Variance approved', not_applicable: 'No PO' }
const MATCH_HEX: Record<string, string> = { matched: '#22c55e', variance: '#dc2626', approved_variance: '#f59e0b', not_applicable: '#94a3b8' }
const TYPE_LABELS: Record<string, string> = { po: 'Against PO', direct: 'Direct', opening: 'Opening' }
const REASON_LABELS: Record<string, string> = { return: 'Goods returned', rate_difference: 'Rate difference', discount: 'Discount', deficiency: 'Deficiency / shortage', other: 'Other' }

const TABS = ['Purchase Invoices', 'Debit Notes'] as const
type Tab = (typeof TABS)[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. */
const TAB_KEYS: Record<Tab, string> = { 'Purchase Invoices': 'purchase_invoices', 'Debit Notes': 'debit_notes' }

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

/** P2P's PO.vendor_id isn't a real FK — prefer it when it resolves, else match by name (same as the server). */
function vendorForPo(po: P2PPurchaseOrder | undefined, vendors: Vendor[]): Vendor | undefined {
  if (!po) return undefined
  const byId = po.vendor_id != null ? vendors.find((v) => v.id === po.vendor_id) : undefined
  if (byId) return byId
  const name = (po.vendor_name || '').trim().toLowerCase()
  return name ? vendors.find((v) => v.name.trim().toLowerCase() === name) : undefined
}

function isDraftNumber(n: string) { return n.startsWith('DRAFT-') }

function toEditableLines(lines: TaxLine[]): EditableTaxLine[] {
  return lines.map((l) => ({
    key: Math.random().toString(36).slice(2), description: l.description, hsn_sac_code: l.hsn_sac_code || '', quantity: l.quantity,
    uom: l.uom || '', rate: l.rate, discount_amount: l.discount_amount, gst_rate: l.gst_rate, gl_account_id: l.gl_account_id,
    cost_center_id: l.cost_center_id ?? null, internal_order_id: l.internal_order_id ?? null,
  }))
}

function Badge({ label, hex }: { label: string; hex: string }) {
  return <span style={pillStyle(hex)}>{label}</span>
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
          <th style={th}># <RowCount count={lines.length} /></th><th style={th}>Description</th><th style={th}>HSN/SAC</th>
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
  if (rows.length === 0) return <div style={{ fontSize: 12, color: TEXT.muted }}>Nothing settled against this bill yet.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
    <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td style={{ ...tdStyle, padding: '5px 10px', fontSize: 12 }}>{dmy(s.allocation_date)}</td>
            <td style={{ ...tdStyle, padding: '5px 10px', fontSize: 12 }}>{s.source_type === 'payment' ? 'Payment' : 'Debit note'} {s.source_number}</td>
            <td style={{ ...numTd, padding: '5px 10px', fontSize: 12 }}>{inr(s.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

export default function FinancePurchasePage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs: visibleTabs, tab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const { canFeature } = useCan()
  const [setup, setSetup] = useState<AccountsSetup | null>(null)
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [rates, setRates] = useState<GSTRate[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [pos, setPos] = useState<P2PPurchaseOrder[]>([])
  const [error, setError] = useState<Errors>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([
      accountsApi.getSetup(), accountsApi.listGLAccounts(), accountsApi.listGstRates(), accountsApi.listVendors(), purchaseOrdersApi.list({}),
    ]).then(([s, l, r, v, p]) => { setSetup(s); setLedgers(l); setRates(r); setVendors(v); setPos(p) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the purchase set-up (company GST state, ledgers, GST rates, vendors, purchase orders).')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const ctx = { userId: user?.id, canApproveVariance: (!!user?.is_finance_manager || user?.role === 'admin') && canFeature('accounts', 'purchase_invoices', 'variance_approval', 'approve'), setup, ledgers, rates, vendors, pos }
  return (
    <div>
      <FinanceNav />
      <PageHeader title="Purchase" subtitle="Book vendor bills (against a PO with 3-way match, or direct for services and expenses) and raise debit notes for returns and rate differences." />
      <ErrorBanner error={error} />
      {setup && setup.warnings.length > 0 && <InfoBanner tone="warning">{setup.warnings.map((w) => <div key={w}>{w}</div>)}</InfoBanner>}
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      {tab === 'Purchase Invoices' ? <InvoicesTab {...ctx} /> : <DebitNotesTab {...ctx} />}
    </div>
  )
}

interface Ctx {
  userId?: number
  canApproveVariance: boolean
  setup: AccountsSetup | null
  ledgers: GLAccount[]
  rates: GSTRate[]
  vendors: Vendor[]
  pos: P2PPurchaseOrder[]
}

// ─── Purchase invoices ───────────────────────────────────────────────────

function InvoicesTab(ctx: Ctx) {
  const { userId, canApproveVariance, vendors } = ctx
  const { can, canDelete, canFeature } = useCan()
  // Purchase Invoices › Payments against the invoice (feature): skip the call without it.
  const seeSettlements = canFeature('accounts', 'purchase_invoices', 'settlements', 'view')
  const [fStatus, setFStatus] = useState('')
  const [fPay, setFPay] = useState('')
  const [fType, setFType] = useState('')
  const [fVendor, setFVendor] = useState('')
  const [rows, setRows] = useState<VendorInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Errors>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [settlements, setSettlements] = useState<Record<number, Settlement[]>>({})
  const [showForm, setShowForm] = useState(false)
  const [varianceId, setVarianceId] = useState<number | null>(null)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const proofRules = useProofRules()
  const proofCounts = useProofCounts('vendor_invoice', rows.map((r) => r.id), 'purchase_invoices')

  const load = useCallback(() => {
    accountsApi.listVendorInvoices({
      status: fStatus || undefined, payment_status: fPay || undefined, invoice_type: fType || undefined, vendor_id: fVendor ? Number(fVendor) : undefined,
    }).then(setRows)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load purchase invoices.')))
      .finally(() => setLoading(false))
  }, [fStatus, fPay, fType, fVendor])

  useEffect(() => { load() }, [load])

  const toggle = (id: number) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setSettlements((p) => { const n = { ...p }; delete n[id]; return n })
    if (!seeSettlements) return
    accountsApi.vendorInvoiceSettlements(id)
      .then((s: Settlement[]) => setSettlements((p) => ({ ...p, [id]: s })))
      .catch((err: unknown) => { setSettlements((p) => ({ ...p, [id]: [] })); setError(extractErrorMessages(err, 'Could not load the settlement history.')) })
  }

  const act = async (fn: () => Promise<unknown>, context: string) => {
    setBusy(true); setError('')
    try { await fn(); load() } catch (err: unknown) { setError(extractErrorMessages(err, context)) } finally { setBusy(false) }
  }

  const vendorOptions = [{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: String(v.id), label: `${v.name} (${v.code})` }))]
  const COLS = 13

  // Recording a bill replaces the list with the invoice form ("← Back" returns to the list).
  if (showForm) {
    return <PurchaseInvoiceForm {...ctx} onCancel={() => setShowForm(false)} onSaved={(warning) => { setShowForm(false); load(); if (warning) setError(warning) }} />
  }

  return (
    <div>
      <ReasonSheet open={varianceId != null} tour="fin-pinv-variance-dialog" icon="shield" title="Approve the 3-way-match variance?" danger={false} confirmLabel="Approve variance"
        subtitle="The bill differs from the PO / goods received beyond tolerance."
        message="Approving lets it be posted — record why the difference is acceptable."
        label="Note" placeholder="e.g. freight agreed by email, price revised on PO amendment…"
        onConfirm={(note) => { const id = varianceId!; setVarianceId(null); act(() => accountsApi.approveVariance(id, note || undefined), 'Could not approve the variance.') }}
        onCancel={() => (busy ? null : setVarianceId(null))} />
      <ReasonSheet open={cancelId != null} tour="fin-pinv-cancel-dialog" icon="x" title="Cancel this purchase invoice?" requireValue confirmLabel="Cancel invoice"
        subtitle="Only an unposted bill can be cancelled."
        message="A posted bill is never edited or deleted — correct it with a debit note."
        label="Reason for cancelling" placeholder="e.g. booked twice, wrong vendor…"
        onConfirm={(reason) => { const id = cancelId!; setCancelId(null); act(() => accountsApi.cancelVendorInvoice(id, reason), 'Could not cancel the invoice.') }}
        onCancel={() => (busy ? null : setCancelId(null))} />

      <ErrorBanner error={error} />

      {can('accounts', 'purchase_invoices', 'create') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" data-tour="fin-pinv-new-btn" style={primaryBtnStyle} onClick={() => setShowForm(true)}>+ Record purchase invoice</button>
        </div>
      )}

      <div data-tour="fin-pinv-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Status" style={{ flex: '0 1 150px' }} tour="fin-pinv-status">
          <Select style={inputStyle} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Pending</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Payment" style={{ flex: '0 1 150px' }} tour="fin-pinv-payment">
          <Select style={inputStyle} value={fPay} onChange={(e) => setFPay(e.target.value)}>
            <option value="">All</option><option value="pending">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option>
          </Select>
        </Field>
        <Field label="Type" style={{ flex: '0 1 150px' }} tour="fin-pinv-type">
          <Select style={inputStyle} value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">All</option><option value="po">Against PO</option><option value="direct">Direct</option><option value="opening">Opening</option>
          </Select>
        </Field>
        <Field label="Vendor" style={{ flex: '1 1 260px', maxWidth: 360 }} tour="fin-pinv-vendor-filter">
          <SearchableSelect value={fVendor} onChange={setFVendor} options={vendorOptions} placeholder="All vendors" />
        </Field>
      </div>

      <TableWrap minWidth={1350} tour="fin-pinv-table">
        <thead>
          <tr>
            <th style={thStyle}>Bill no. <RowCount count={loading ? 0 : rows.length} /></th><th style={thStyle}>Date</th><th style={thStyle}>Due</th><th style={thStyle}>Vendor</th>
            <th style={thStyle}>Type</th><th style={numTh}>Taxable (₹)</th><th style={numTh}>GST (₹)</th><th style={numTh}>Total (₹)</th>
            <th style={numTh}>Due (₹)</th><th style={thStyle}>Match</th><th style={thStyle}>Status</th><th style={thStyle}>Journal</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={COLS} text="No purchase invoices match these filters." /> : rows.map((inv) => {
            const isMaker = userId != null && inv.created_by_id === userId
            return (
              <Fragment key={inv.id}>
                <tr>
                  <td style={tdStyle}>
                    <button type="button" style={{ ...linkBtnStyle, fontSize: 12.5 }} onClick={() => toggle(inv.id)}>{expanded === inv.id ? '▾' : '▸'} {inv.invoice_number}</button>
                    <ProofClip count={proofCounts[inv.id]} />
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(inv.invoice_date)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(inv.due_date)}</td>
                  <td style={tdStyle}>{inv.vendor_name || '—'}{inv.po_number && <div style={{ fontSize: 11, color: TEXT.muted }}>PO {inv.po_number}</div>}</td>
                  <td style={tdStyle}>{TYPE_LABELS[inv.invoice_type] || inv.invoice_type}</td>
                  <td style={numTd}>{inr(inv.invoice_amount)}</td>
                  <td style={numTd}>
                    {inr(inv.invoice_gst)}
                    <div style={{ fontSize: 10.5, color: TEXT.muted }}>
                      {inv.is_interstate ? `IGST ${inr(inv.igst_amount)}` : `C ${inr(inv.cgst_amount)} + S ${inr(inv.sgst_amount)}`}
                    </div>
                    {inv.is_reverse_charge && <Badge label="RCM" hex="#7c3aed" />}
                  </td>
                  <td style={{ ...numTd, fontWeight: 700 }}>{inr(inv.invoice_total)}</td>
                  <td style={numTd}>{inr(inv.amount_due)}</td>
                  <td style={tdStyle}><StatusPill status={inv.matching_status} labels={MATCH_LABELS} colors={MATCH_HEX} /></td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <StatusPill status={inv.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                      {inv.status === 'pending' && <ApprovalBadge status={inv.approval_status} stage={inv.approval_stage} />}
                      {inv.status === 'posted' && <StatusPill status={inv.payment_status} labels={PAY_LABELS} colors={PAY_HEX} />}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{inv.journal_entry_number || '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {inv.status === 'pending' && inv.matching_status === 'variance' && canApproveVariance && !isMaker && (
                        <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => setVarianceId(inv.id)}>Approve variance</button>
                      )}
                      {inv.status === 'pending' && inv.matching_status !== 'variance' && !isMaker && can('accounts', 'purchase_invoices', 'approve') && (
                        <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.postVendorInvoice(inv.id), 'Could not post the invoice.')}>Post</button>
                      )}
                      {inv.status === 'pending' && inv.approval_status !== 'pending' && can('accounts', 'purchase_invoices', 'submit') && (
                        <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.submitVendorInvoice(inv.id), 'Could not submit the invoice for approval.')}>Submit for approval</button>
                      )}
                      {inv.status === 'pending' && isMaker && (
                        <span style={{ fontSize: 11, color: TEXT.muted }} title="You recorded this bill, so a different finance user must approve/post it.">Posted by another finance user (maker-checker)</span>
                      )}
                      {inv.status === 'pending' && canDelete('accounts', 'purchase_invoices', inv.created_by_id ?? null) && (
                        <button type="button" disabled={busy} style={dangerLinkStyle} onClick={() => setCancelId(inv.id)}>Cancel</button>
                      )}
                      {inv.status === 'posted' && inv.amount_due > 0.005 && can('accounts', 'payments', 'create') && (
                        <Link href={recordHref('/dashboard/finance/payments', inv, 'vendor_id', undefined, 'vendor_id')} style={{ ...linkBtnStyle, textDecoration: 'none' }}>Pay</Link>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === inv.id && (
                  <tr>
                    <td colSpan={COLS} style={{ padding: '12px 18px', background: 'rgba(148,163,184,0.06)', borderTop: `1px solid ${BORDER.normal}` }}>
                      <ApprovalPanel entityType="accounts_vendor_invoice" entityId={inv.id} onChanged={() => load()} />
                      <LinesTable lines={inv.lines} interstate={inv.is_interstate} />
                      <RecordFacts>
                        <DetailGroup title="Tax & amounts" last>
                          <DetailRow label="Vendor GSTIN">{inv.vendor_gstin ? <span style={{ fontFamily: 'monospace' }}>{inv.vendor_gstin}</span> : null}</DetailRow>
                          <DetailRow label="Place of supply">{inv.place_of_supply_state_code || null}</DetailRow>
                          {inv.is_reverse_charge && <DetailRow label="Reverse charge">Yes — we pay the GST</DetailRow>}
                          <DetailRow label="Taxable value">₹ {inr(inv.invoice_amount)}</DetailRow>
                          <DetailRow label={inv.is_interstate ? 'IGST' : 'CGST + SGST'}>{inv.is_interstate ? `₹ ${inr(inv.igst_amount)}` : `₹ ${inr(inv.cgst_amount)} + ₹ ${inr(inv.sgst_amount)}`}</DetailRow>
                          {inv.round_off !== 0 && <DetailRow label="Round-off">₹ {inr(inv.round_off)}</DetailRow>}
                          <DetailRow label="Bill total"><strong>₹ {inr(inv.invoice_total)}</strong></DetailRow>
                        </DetailGroup>
                        <DetailGroup title="Matching & record" last>
                          {inv.qty_po != null && <DetailRow label="Quantities">{`PO ${inv.qty_po} · GRN accepted ${inv.qty_gr ?? '—'} · Invoiced ${inv.qty_invoice ?? '—'}`}</DetailRow>}
                          {inv.variance_approved_by_name && <DetailRow label="Variance approved by">{`${inv.variance_approved_by_name}${inv.variance_note ? ` — ${inv.variance_note}` : ''}`}</DetailRow>}
                          <DetailRow label="Narration">{inv.narration || null}</DetailRow>
                          {inv.cancelled_reason && <DetailRow label="Cancelled because"><span style={{ color: '#b91c1c' }}>{inv.cancelled_reason}</span></DetailRow>}
                          <DetailRow label="Recorded by">{inv.created_by_name || null}</DetailRow>
                          {inv.posted_by_name && <DetailRow label="Posted by">{inv.posted_by_name}</DetailRow>}
                        </DetailGroup>
                        {seeSettlements && (
                          <DetailGroup title="Settlement history" last>
                            <div style={{ padding: '6px 0' }}><SettlementList rows={settlements[inv.id]} /></div>
                          </DetailGroup>
                        )}
                      </RecordFacts>
                      <div style={{ marginTop: 14 }}>
                        <FinanceAttachments label={<div style={{ ...labelStyle, marginBottom: 6 }}>Supporting documents</div>} entityType="vendor_invoice" entityId={inv.id} tabKey="purchase_invoices"
                          locked={inv.status !== 'pending'} closed={inv.status === 'cancelled'}
                          required={proofRules.purchaseInvoice && inv.invoice_type !== 'opening' && inv.status === 'pending'} />
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

function PurchaseInvoiceForm({ setup, ledgers, rates, vendors, pos, onSaved, onCancel }: Ctx & { onSaved: (warning?: string) => void; onCancel: () => void }) {
  const { can } = useCan()
  const codes = useMemo(() => setup?.state_codes || {}, [setup])
  const companyState = setup?.company_gst.state_code || ''
  const [mode, setMode] = useState<'po' | 'direct'>('po')
  const [poId, setPoId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const docCur = useDocCurrency(invoiceDate)
  const [dueDate, setDueDate] = useState('')
  const [posChoice, setPlaceOfSupply] = useState('')
  const [rcm, setRcm] = useState(false)
  const [roundOff, setRoundOff] = useState('0')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<EditableTaxLine[]>([newTaxLine()])
  const costObjects = useCostObjectOptions()
  // Preview result tagged with the inputs it was computed for, so stale results are never shown.
  const [previewState, setPreviewState] = useState<{ key: string; preview: MatchPreview | null; error: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Errors>('')
  const proofRules = useProofRules()
  const [proof, setProof] = useState<PickedProof[]>([])

  // Inward supply is delivered to us, so place of supply defaults to the company's state.
  const placeOfSupply = posChoice || companyState

  const po = mode === 'po' ? pos.find((p) => String(p.id) === poId) : undefined
  const vendor = mode === 'po' ? vendorForPo(po, vendors) : vendors.find((v) => String(v.id) === vendorId)
  const vendorState = vendor ? partyStateCode(vendor.gstin, vendor.state, codes) : null
  const interstate = vendor && vendorState && placeOfSupply ? vendorState !== placeOfSupply : null
  const registration = (vendor?.gst_registration_type || 'regular').toLowerCase()

  const totals = previewTax(lines, !!interstate)
  const qtyTotal = Math.round(lines.reduce((s, l) => s + Number(l.quantity || 0), 0) * 10000) / 10000

  // Line-level 3-way match preview (each bill line against its PO line and
  // goods received, in the PO unit), debounced as the lines change.
  const matchLines = lines.filter((l) => Number(l.quantity || 0) > 0).map((l) => ({
    po_item_id: l.po_item_id || null, quantity: Number(l.quantity || 0), rate: Number(l.rate || 0),
    discount_amount: Number(l.discount_amount || 0), uom: (l.uom || '').trim() || null,
  }))
  const previewKey = mode === 'po' && poId && qtyTotal > 0 && totals.taxable > 0 ? `${poId}|${JSON.stringify(matchLines)}` : null
  useEffect(() => {
    if (!previewKey) return
    const sep = previewKey.indexOf('|')
    const id = Number(previewKey.slice(0, sep))
    const payload = JSON.parse(previewKey.slice(sep + 1))
    const h = setTimeout(() => {
      accountsApi.matchPreviewLines(id, payload)
        .then((p: MatchPreview) => setPreviewState({ key: previewKey, preview: p, error: '' }))
        // A blocked match (PO not approved, nothing received, over the PO value) comes back as an error with the real reason.
        .catch((err: unknown) => setPreviewState({ key: previewKey, preview: null, error: extractErrorMessages(err, 'Could not check the 3-way match.').join(' ') }))
    }, 450)
    return () => clearTimeout(h)
  }, [previewKey])
  const current = previewKey && previewState?.key === previewKey ? previewState : null
  const preview = current?.preview || null
  const previewError = current?.error || ''
  const previewLoading = !!previewKey && !current

  // Start the bill from the PO: one line per PO line, at the PO rate / unit / GST.
  const loadPoLines = () => {
    if (!po?.items?.length) return
    setLines(po.items.map((it) => ({
      ...newTaxLine(), description: it.item_name, quantity: Number(it.quantity || 0), uom: it.unit || '',
      rate: Number(it.unit_price || 0), gst_rate: it.tax_rate != null ? Number(it.tax_rate) : 18,
      store_item_id: it.store_item_id || null, po_item_id: it.id,
    })))
  }
  const setLinePoItem = (key: string, poItemId: string) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, po_item_id: poItemId ? Number(poItemId) : null } : l)))

  const poOptions = pos
    // Goods must be received before a bill is booked, so fully received POs are the normal case.
    .filter((p) => ['issued', 'acknowledged', 'partially_fulfilled', 'fulfilled'].includes(p.status))
    .map((p) => ({ value: String(p.id), label: `${p.po_number}${p.vendor_name ? ` — ${p.vendor_name}` : ''}` }))
  const vendorOptions = vendors.filter((v) => v.status !== 'blocked').map((v) => ({ value: String(v.id), label: `${v.name} (${v.code})${v.gstin ? ` · ${v.gstin}` : ''}` }))
  const stateEntries = Object.entries(codes).sort((a, b) => a[0].localeCompare(b[0]))
  const defaultDue = vendor && invoiceDate ? (() => {
    const d = new Date(invoiceDate + 'T00:00:00'); d.setDate(d.getDate() + (vendor.payment_days || 0))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })() : null
  const ro = Number(roundOff || 0)
  const payable = Math.round((totals.taxable + (rcm ? 0 : totals.tax) + ro) * 100) / 100

  const submit = async () => {
    setError('')
    if (mode === 'po' && !poId) { setError('Pick the purchase order this bill is against — or switch to "Direct (no PO)" for a service/expense bill.'); return }
    if (mode === 'direct' && !vendorId) { setError('Pick the vendor who issued this bill.'); return }
    if (!invoiceNumber.trim()) { setError("Enter the vendor's bill number exactly as printed on their invoice."); return }
    if (Math.abs(ro) >= 1) { setError('Round-off only absorbs paise — it must be less than ₹1 either way.'); return }
    if (proofRules.purchaseInvoice && proof.length === 0) { setError("Attach the vendor's bill under Supporting documents — the invoice can't go for approval without it."); return }
    setSaving(true)
    try {
      const created: VendorInvoice = await accountsApi.createVendorInvoice({
        ...(mode === 'po' ? { purchase_order_id: Number(poId) } : { vendor_id: Number(vendorId) }),
        invoice_number: invoiceNumber.trim(), invoice_date: invoiceDate, due_date: dueDate || null,
        place_of_supply_state_code: placeOfSupply || null, is_reverse_charge: rcm, round_off: ro,
        narration: narration.trim() || null, lines: toLinePayload(lines), ...docCur.payload(),
      })
      // Upload the picked files first — the invoice can't go for approval without them.
      const proofError = proof.length ? await uploadPickedProof('vendor_invoice', created.id, proof, `Invoice ${created.invoice_number}`) : ''
      setProof([])
      if (proofError) { onSaved(`${proofError} It stays pending until then — submit it for approval after.`); return }
      // Recording a bill sends it straight to its approvers (Organization › Approval Workflows).
      onSaved(can('accounts', 'purchase_invoices', 'submit')
        ? await submitAfterSave(() => accountsApi.submitVendorInvoice(created.id), `Invoice ${created.invoice_number}`) : '')
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not record the purchase invoice.'))
    } finally { setSaving(false) }
  }

  const toggleBtn = (m: 'po' | 'direct', label: string) => (
    <button type="button" onClick={() => setMode(m)}
      style={{ ...secondaryBtnStyle, ...(mode === m ? { borderColor: BRAND.primary, color: BRAND.primaryActive, background: `${BRAND.primary}1a` } : {}) }}>{label}</button>
  )

  return (
    <FormPage tour="fin-pinv-form" icon="doc" title="Record purchase invoice" subtitle="Book the vendor's bill exactly as printed — it goes to its approvers when saved." onBack={onCancel} backTour="fin-pinv-back"
      footer={<>
        <button type="button" data-tour="fin-pinv-close" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" data-tour="fin-pinv-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={submit}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Record invoice'}</button>
      </>}>
      <div style={{ padding: '20px 24px 0' }}>
        <ErrorBanner error={error} />
        <InfoBanner>
          A bill against a PO is checked against the PO and goods received (3-way match); a difference beyond tolerance needs a Finance
          Manager&apos;s approval. Once posted the bill can&apos;t be edited — correct it with a debit note.
        </InfoBanner>
        {vendor && (registration === 'composition' || registration === 'unregistered') && (
          <InfoBanner tone="warning">
            {vendor.name} is <b>{registration}</b> under GST, so its bill carries no input tax credit. Keep the GST rate at 0% on every line — unless
            this supply falls under reverse charge, in which case tick RCM.
          </InfoBanner>
        )}
        {vendor && !vendorState && (
          <InfoBanner tone="warning">{vendor.name} has no GSTIN or state, so CGST/SGST vs IGST can&apos;t be decided — complete it under Finance &gt; Masters &gt; Vendors.</InfoBanner>
        )}
      </div>

      <SheetColumns
        left={<>
          <SheetSection icon="building" title="Vendor">
            <div data-tour="fin-pinv-mode" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {toggleBtn('po', 'Against PO')}
              {toggleBtn('direct', 'Direct (no PO)')}
            </div>
            {mode === 'po' ? (
              <SField label="Purchase order" req tour="fin-pinv-po">
                <SearchableSelect value={poId} onChange={setPoId} options={poOptions} placeholder="Select a PO…" />
                {po && (
                  <p style={{ ...sheetHint, color: vendor ? SHEET.MUTED : '#b91c1c' }}>
                    {vendor ? `Vendor: ${vendor.name}${vendor.gstin ? ` · ${vendor.gstin}` : ''}` : `No vendor master matches '${po.vendor_name || '?'}' — add it under Finance > Masters > Vendors.`}
                  </p>
                )}
              </SField>
            ) : (
              <SField label="Vendor" req tour="fin-pinv-vendor">
                <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Select a vendor…" />
              </SField>
            )}
          </SheetSection>
          <SheetSection icon="doc" title="Bill">
            <SRow>
              <SField label="Vendor bill no." req style={sw(210)} tour="fin-pinv-bill-no">
                <input style={sheetInput} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="As printed on the bill" />
              </SField>
              <SField label="Bill date" req style={sw(170)} tour="fin-pinv-date">
                <DateField value={invoiceDate} onChange={setInvoiceDate} />
              </SField>
              <SField label="Due date" optional style={sw(170)} tour="fin-pinv-due"
                hint={defaultDue ? `Blank = ${dmy(defaultDue)} (${vendor?.payment_days || 0} payment days)` : 'Blank = vendor payment days'}>
                <DateField value={dueDate} onChange={setDueDate} />
              </SField>
            </SRow>
            <SRow mb={0}>
              <SField label="Place of supply" req style={sw(240)} tour="fin-pinv-pos">
                <Select style={sheetInput} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
                  {!placeOfSupply && <option value="">— select —</option>}
                  {stateEntries.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
                </Select>
              </SField>
              {docCur.fields}
            </SRow>
          </SheetSection>
          <SheetSection icon="shield" title="GST">
            <label data-tour="fin-pinv-rcm" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: SHEET.BODY, cursor: 'pointer' }}>
              <input type="checkbox" checked={rcm} onChange={(e) => setRcm(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <b>Reverse charge (RCM)</b> — tick for supplies where <i>we</i> pay the GST to the government instead of the vendor (e.g. GTA freight,
                legal services, notified goods from unregistered suppliers). The vendor is paid only the taxable value; the GST goes to RCM payable and
                is claimed back as input credit.
              </span>
            </label>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="doc" title="Narration">
            <SField label="Narration" optional tour="fin-pinv-narration">
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What this bill is for" />
            </SField>
          </SheetSection>
          <SheetSection icon="doc" title="Supporting documents">
            <ProofPicker entityType="vendor_invoice" value={proof} onChange={setProof} required={proofRules.purchaseInvoice}
              hint="Attach the vendor's bill (PDF or photo) — it is needed before the invoice can go for approval, and it backs the GST input credit." />
          </SheetSection>
          <SheetSection icon="rupee" title="Totals">
            <SField label="Round-off (₹)" style={{ ...sw(130), marginBottom: 12 }} tour="fin-pinv-round-off">
              <input type="number" step="0.01" style={sheetInput} value={roundOff} onChange={(e) => setRoundOff(e.target.value)} />
            </SField>
            <div data-tour="fin-pinv-payable" style={{ fontSize: 13, color: SHEET.BODY, fontVariantNumeric: 'tabular-nums' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Taxable value</span><span>{inr(totals.taxable)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GST{rcm ? ' (RCM — paid by us)' : ''}</span><span>{inr(totals.tax)}</span></div>
              {ro !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Round-off</span><span>{inr(ro)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: SHEET.INK, marginTop: 4 }}>
                <span>Payable to vendor{rcm ? ' (excl. RCM GST)' : ''}</span><span>{inr(payable)}</span>
              </div>
            </div>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="list" title="Lines">
          {mode === 'po' && po && (po.items?.length || 0) > 0 && (
            <div data-tour="fin-pinv-po-lines" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <button type="button" onClick={loadPoLines} style={sheetBtn('secondary')}>Load PO lines</button>
              <span style={{ fontSize: 12, color: SHEET.MUTED }}>Each bill line is matched to its own PO line and its goods receipt, in the PO&apos;s unit.</span>
            </div>
          )}

          <TaxLinesEditor lines={lines} onChange={setLines} ledgers={ledgers} rates={rates} interstate={interstate} ledgerHint="default: Purchases / vendor default" costObjects={costObjects} />

          {mode === 'po' && po && (po.items?.length || 0) > 1 && (
            <div data-tour="fin-pinv-line-po-map" style={{ margin: '12px 0 0' }}>
              <div style={{ ...sheetLabel, marginBottom: 8 }}>PO line for each bill line</div>
              {lines.map((l, i) => (
                <div key={l.key} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, color: SHEET.BODY, minWidth: 180 }}>Line {i + 1}{l.description ? ` — ${l.description}` : ''}</span>
                  <Select style={{ ...sheetInput, maxWidth: 360 }} value={l.po_item_id ? String(l.po_item_id) : ''} onChange={(e) => setLinePoItem(l.key, e.target.value)}>
                    <option value="">— pick the PO line —</option>
                    {(po.items || []).map((it) => <option key={it.id} value={it.id}>{it.item_name} · {it.quantity} {it.unit || ''} @ {it.unit_price ?? '—'}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          )}
        </SheetSection>

        {mode === 'po' && (previewLoading || previewError || preview) && (
          <SheetSection icon="shield" title="3-way match">
            {previewLoading && <div style={{ fontSize: 12, color: SHEET.MUTED }}>Checking 3-way match…</div>}
            {!previewLoading && previewError && <ErrorBanner error={previewError} />}
            {!previewLoading && preview && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: preview.matching_status === 'matched' ? 'rgba(34,197,94,0.08)' : 'rgba(220,38,38,0.08)' }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge label={preview.matching_status === 'matched' ? '3-way match: within tolerance' : '3-way match: variance — needs approval'} hex={preview.matching_status === 'matched' ? '#16a34a' : '#dc2626'} />
                  <span style={{ fontSize: 12, color: TEXT.secondary }}>
                    PO qty {preview.qty_po} · GRN accepted {preview.qty_gr} · Already invoiced {preview.already_invoiced_qty} ·
                    {' '}Received value {inr(preview.received_value)} · Approved PO value {inr(preview.po_value)} (before GST)
                  </span>
                </div>
                {(preview.lines || []).length > 0 && (
                  <div style={{ overflow: 'auto', marginTop: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 12 }}>
                      <thead>
                        <tr>{['PO line', 'Received', 'Already billed', 'This bill', 'Qty diff', 'PO rate', 'Bill rate', 'Price diff', 'Match'].map((h, i) => (
                          <th key={h} style={{ textAlign: h === 'PO line' ? 'left' : 'right', padding: '5px 8px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>{h}{i === 0 && <> <RowCount count={(preview.lines || []).length} /></>}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {(preview.lines || []).map((m) => (
                          <tr key={m.po_item_id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                            <td style={{ padding: '5px 8px' }}>{m.item_name}{m.category === 'service' ? ' (service entry)' : ''}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{m.received_qty} {m.unit || ''}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{m.already_invoiced_qty}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{m.invoice_qty}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{m.qty_variance > 0 ? `+${m.qty_variance}` : m.qty_variance}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{m.po_rate != null ? inr(m.po_rate) : '—'}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{inr(m.invoice_rate)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{m.price_variance != null ? inr(m.price_variance) : '—'}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                              <Badge label={m.match_status === 'matched' ? 'Matched' : 'Variance'} hex={m.match_status === 'matched' ? '#16a34a' : '#dc2626'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.tolerances && (
                      <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>
                        Tolerances (Procurement › Settings): quantity +{preview.tolerances.qty_tol_pct}% · price ±{preview.tolerances.price_tol_pct}%
                        {preview.tolerances.price_tol_abs ? ` and at most ${inr(preview.tolerances.price_tol_abs)} per line` : ''}
                      </div>
                    )}
                  </div>
                )}
                {preview.variance_reasons.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#b91c1c' }}>
                    {preview.variance_reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </SheetSection>
        )}
      </div>
    </FormPage>
  )
}

// ─── Debit notes ─────────────────────────────────────────────────────────

function DebitNotesTab(ctx: Ctx) {
  const { userId } = ctx
  const { can, canDelete } = useCan()
  const [rows, setRows] = useState<PartyNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Errors>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const proofCounts = useProofCounts('party_note', rows.map((r) => r.id), 'debit_notes')

  const load = useCallback(() => {
    accountsApi.listNotes({ note_type: 'debit_note' }).then(setRows)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load debit notes.')))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<unknown>, context: string) => {
    setBusy(true); setError('')
    try { await fn(); load() } catch (err: unknown) { setError(extractErrorMessages(err, context)) } finally { setBusy(false) }
  }
  const COLS = 11

  // Raising a note replaces the list with the note form ("← Back" returns to the list).
  if (showForm) {
    return <DebitNoteForm {...ctx} onCancel={() => setShowForm(false)} onSaved={(warning) => { setShowForm(false); load(); if (warning) setError(warning) }} />
  }

  return (
    <div>
      <ReasonSheet open={cancelId != null} tour="fin-dn-cancel-dialog" icon="x" title="Cancel this debit note?" requireValue confirmLabel="Cancel note"
        subtitle="Only an unposted note can be cancelled."
        message="A posted note is undone with a fresh opposite document."
        label="Reason for cancelling" placeholder="e.g. Raised against the wrong bill"
        onConfirm={(reason) => { const id = cancelId!; setCancelId(null); act(() => accountsApi.cancelNote(id, reason), 'Could not cancel the debit note.') }}
        onCancel={() => (busy ? null : setCancelId(null))} />
      <ErrorBanner error={error} />

      {can('accounts', 'debit_notes', 'create') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" data-tour="fin-dn-new-btn" style={primaryBtnStyle} onClick={() => setShowForm(true)}>+ Raise debit note</button>
        </div>
      )}

      <TableWrap minWidth={1150} tour="fin-dn-table">
        <thead>
          <tr>
            <th style={thStyle}>Note no. <RowCount count={loading ? 0 : rows.length} /></th><th style={thStyle}>Date</th><th style={thStyle}>Vendor</th><th style={thStyle}>Against bill</th>
            <th style={thStyle}>Reason</th><th style={numTh}>Taxable (₹)</th><th style={numTh}>GST (₹)</th><th style={numTh}>Total (₹)</th>
            <th style={numTh}>Unadjusted (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={COLS} text="No debit notes yet — use + Raise debit note for goods returned or a rate difference." /> : rows.map((n) => {
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
                      <StatusPill status={n.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                      {n.status === 'pending' && <ApprovalBadge status={n.approval_status} stage={n.approval_stage} />}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {n.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {n.approval_status !== 'pending' && can('accounts', 'debit_notes', 'submit') && (
                          <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.submitNote(n.id), 'Could not submit the debit note for approval.')}>Submit for approval</button>
                        )}
                        {isMaker
                          ? <span style={{ fontSize: 11, color: TEXT.muted }}>Posted by another finance user (maker-checker)</span>
                          : can('accounts', 'debit_notes', 'approve') && <button type="button" disabled={busy} style={linkBtnStyle} onClick={() => act(() => accountsApi.postNote(n.id), 'Could not post the debit note.')}>Post</button>}
                        {canDelete('accounts', 'debit_notes', n.created_by_id ?? null) && <button type="button" disabled={busy} style={dangerLinkStyle} onClick={() => setCancelId(n.id)}>Cancel</button>}
                      </div>
                    )}
                  </td>
                </tr>
                {expanded === n.id && (
                  <tr>
                    <td colSpan={COLS} style={{ padding: '12px 18px', background: 'rgba(148,163,184,0.06)', borderTop: `1px solid ${BORDER.normal}` }}>
                      <ApprovalPanel entityType="accounts_party_note" entityId={n.id} onChanged={() => load()} />
                      <LinesTable lines={n.lines} interstate={n.is_interstate} />
                      <RecordFacts>
                        <DetailGroup title="Tax" last>
                          <DetailRow label="Vendor GSTIN">{n.party_gstin ? <span style={{ fontFamily: 'monospace' }}>{n.party_gstin}</span> : null}</DetailRow>
                          <DetailRow label="Place of supply">{n.place_of_supply_state_code || null}</DetailRow>
                          {n.round_off !== 0 && <DetailRow label="Round-off">₹ {inr(n.round_off)}</DetailRow>}
                        </DetailGroup>
                        <DetailGroup title="Record" last>
                          <DetailRow label="Narration">{n.narration || null}</DetailRow>
                          <DetailRow label="Raised by">{n.created_by_name || null}</DetailRow>
                        </DetailGroup>
                      </RecordFacts>
                      <div style={{ marginTop: 14 }}>
                        <FinanceAttachments label={<div style={{ ...labelStyle, marginBottom: 6 }}>Supporting documents</div>} entityType="party_note" entityId={n.id} tabKey="debit_notes"
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

function DebitNoteForm({ setup, ledgers, rates, vendors, onSaved, onCancel }: Ctx & { onSaved: (warning?: string) => void; onCancel: () => void }) {
  const { can } = useCan()
  const codes = setup?.state_codes || {}
  const companyState = setup?.company_gst.state_code || null
  const [postedBills, setPostedBills] = useState<VendorInvoice[]>([])
  const [invoiceId, setInvoiceId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [noteDate, setNoteDate] = useState(todayIso())
  const [reason, setReason] = useState('return')
  const [roundOff, setRoundOff] = useState('0')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<EditableTaxLine[]>([newTaxLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Errors>('')
  const [proof, setProof] = useState<PickedProof[]>([])

  useEffect(() => {
    accountsApi.listVendorInvoices({ status: 'posted' }).then(setPostedBills)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load posted purchase invoices.')))
  }, [])

  const bill = postedBills.find((b) => String(b.id) === invoiceId)
  const vendor = bill ? vendors.find((v) => v.id === bill.vendor_id) : vendors.find((v) => String(v.id) === vendorId)
  const vendorState = vendor ? partyStateCode(vendor.gstin, vendor.state, codes) : null
  const interstate = bill ? bill.is_interstate : vendorState && companyState ? vendorState !== companyState : null

  const billOptions = [{ value: '', label: 'No specific bill (vendor only)' }, ...postedBills.map((b) => ({
    value: String(b.id), label: `${b.invoice_number} — ${b.vendor_name || ''} · ${dmy(b.invoice_date)} · ${inr(b.invoice_total)}`,
  }))]
  const vendorOptions = vendors.map((v) => ({ value: String(v.id), label: `${v.name} (${v.code})` }))
  const ro = Number(roundOff || 0)

  const submit = async () => {
    setError('')
    if (!invoiceId && !vendorId) { setError('Pick the purchase invoice the note corrects — or, for a general adjustment, the vendor.'); return }
    if (Math.abs(ro) >= 1) { setError('Round-off only absorbs paise — it must be less than ₹1 either way.'); return }
    setSaving(true)
    try {
      const created: PartyNote = await accountsApi.createNote({
        note_type: 'debit_note', note_date: noteDate, reason,
        vendor_invoice_id: invoiceId ? Number(invoiceId) : null, vendor_id: invoiceId ? null : Number(vendorId),
        round_off: ro, narration: narration.trim() || null, lines: toLinePayload(lines),
      })
      const proofError = proof.length ? await uploadPickedProof('party_note', created.id, proof, 'The debit note') : ''
      setProof([])
      if (proofError) { onSaved(`${proofError} It stays pending — submit it for approval after.`); return }
      onSaved(can('accounts', 'debit_notes', 'submit')
        ? await submitAfterSave(() => accountsApi.submitNote(created.id), 'The debit note') : '')
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not raise the debit note.'))
    } finally { setSaving(false) }
  }

  return (
    <FormPage tour="fin-dn-form" icon="undo" title="Raise debit note" subtitle="A purchase return or a reduction of a vendor bill — it reverses the input GST on that value." onBack={onCancel} backTour="fin-dn-back"
      footer={<>
        <button type="button" data-tour="fin-dn-close" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" data-tour="fin-dn-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={submit}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save debit note'}</button>
      </>}>
      <div style={{ padding: '20px 24px 0' }}>
        <ErrorBanner error={error} />
        <InfoBanner>
          A debit note covers a rate difference, discount, shortage or goods sent back. Once posted it is set off against the bill automatically,
          so less is payable to the vendor.
        </InfoBanner>
        {bill?.is_reverse_charge && (
          <InfoBanner tone="warning">This bill was under reverse charge — the note reduces the RCM liability and credit, not the amount owed to the vendor for GST.</InfoBanner>
        )}
      </div>

      <SheetColumns
        left={<>
          <SheetSection icon="link" title="Against">
            <SField label="Against purchase invoice" style={{ marginBottom: 12 }} tour="fin-dn-bill">
              <SearchableSelect value={invoiceId} onChange={setInvoiceId} options={billOptions} placeholder="Select a posted bill…" />
              {bill && (
                <button type="button" style={{ ...linkBtnStyle, marginTop: 6 }} onClick={() => setLines(toEditableLines(bill.lines))}>
                  Copy lines from invoice {bill.invoice_number}
                </button>
              )}
            </SField>
            {!invoiceId && (
              <SField label="Vendor" req tour="fin-dn-vendor">
                <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Select a vendor…" />
              </SField>
            )}
          </SheetSection>
          <SheetSection icon="doc" title="Note">
            <SRow mb={0}>
              <SField label="Note date" req style={sw(170)} tour="fin-dn-date">
                <DateField value={noteDate} onChange={setNoteDate} />
              </SField>
              <SField label="Reason" req style={sw(220)} tour="fin-dn-reason">
                <Select style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </SField>
            </SRow>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="doc" title="Narration">
            <SField label="Narration" optional tour="fin-dn-narration">
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. 12 pcs returned vide our challan no. …" />
            </SField>
          </SheetSection>
          <SheetSection icon="doc" title="Supporting documents">
            <ProofPicker entityType="party_note" value={proof} onChange={setProof}
              hint="Optional — e.g. the return challan, the vendor's credit note or the email agreeing the rate difference." />
          </SheetSection>
          <SheetSection icon="rupee" title="Totals">
            <SField label="Round-off (₹)" style={sw(130)} tour="fin-dn-round-off">
              <input type="number" step="0.01" style={sheetInput} value={roundOff} onChange={(e) => setRoundOff(e.target.value)} />
            </SField>
            <p style={sheetHint}>Taxable value, GST and note value are shown under the lines.</p>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="list" title="Lines">
          <TaxLinesEditor lines={lines} onChange={setLines} ledgers={ledgers} rates={rates} interstate={interstate} ledgerHint="default: Purchases" />
        </SheetSection>
      </div>
    </FormPage>
  )
}
