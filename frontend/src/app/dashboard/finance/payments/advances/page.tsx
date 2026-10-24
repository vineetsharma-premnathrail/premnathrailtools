'use client'

/** Advances & write-offs: open customer / supplier down payments (held on
 *  their own advance ledgers) with Adjust against the invoice, and
 *  standalone write-offs of what is left on a bill. */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, crmApi } from '@/lib/api'
import { financePaymentsApi } from '@/lib/financePaymentsApi'
import { GLAccount, OpenAdvance, OpenDocument, Organization, SettlementDeduction, Vendor } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SheetFooter, SField, SRow, sw, sg } from '@/components/finance/financeSheet'
import { FormSheet, SheetColumns, SheetSection, sheetInput, sheetHint } from '@/components/shared/FormSheet'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import AllocateCreditDialog, { CreditSource } from '@/components/finance/AllocateCreditDialog'
import Select from '@/components/shared/Select'
import {
  primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, ErrorBanner, InfoBanner, StatusPill, PageHeader, TableWrap, EmptyRow, SubTabs, ledgerOptions,
} from '@/components/finance/financeUi'

const TABS = ['Open advances', 'Write-offs'] as const
type Tab = typeof TABS[number]
const REASONS = [
  { value: 'rounding', label: 'Rounding / small difference' },
  { value: 'short_payment', label: 'Short payment written off' },
  { value: 'ld_deduction', label: 'Liquidated damages (LD)' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'bank_charges', label: 'Bank charges' },
  { value: 'cash_discount', label: 'Cash (early-payment) discount' },
  { value: 'other', label: 'Other (pick the ledger)' },
]
const WO_STATUS_LABELS: Record<string, string> = { posted: 'Posted', cancelled: 'Cancelled', pending: 'Pending' }
const WO_STATUS_HEX: Record<string, string> = { posted: '#22c55e', cancelled: '#78716c', pending: '#f59e0b' }

export default function AdvancesWriteOffsPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { canFeature } = useCan()
  const router = useRouter()
  // Payments features: Allocate payments to bills (Adjust), Write-offs & short payments.
  const canAllocate = canFeature('accounts', 'payments', 'allocation', 'edit')
  const seeWriteOffs = canFeature('accounts', 'payments', 'write_offs', 'view')
  const canWriteOff = canFeature('accounts', 'payments', 'write_offs', 'create')
  const canCancelWriteOff = canFeature('accounts', 'payments', 'write_offs', 'cancel')
  const visibleTabs = TABS.filter((t) => t !== 'Write-offs' || seeWriteOffs)
  const [tab, setTab] = useState<Tab>('Open advances')
  const [error, setError] = useState<string[] | null>(null)
  const [message, setMessage] = useState<{ title: string; message: string } | null>(null)

  const [advances, setAdvances] = useState<OpenAdvance[]>([])
  const [advLoading, setAdvLoading] = useState(true)
  const [adjust, setAdjust] = useState<OpenAdvance | null>(null)

  const [writeOffs, setWriteOffs] = useState<SettlementDeduction[]>([])
  const [woLoading, setWoLoading] = useState(true)
  const [cancelWo, setCancelWo] = useState<SettlementDeduction | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Organization[]>([])
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [partyType, setPartyType] = useState<'customer' | 'vendor'>('customer')
  const [partyId, setPartyId] = useState('')
  const [docs, setDocs] = useState<OpenDocument[]>([])
  const [docId, setDocId] = useState('')
  const [reason, setReason] = useState('rounding')
  const [amount, setAmount] = useState('')
  const [woDate, setWoDate] = useState(todayIso())
  const [glId, setGlId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string[] | null>(null)
  const [woOpen, setWoOpen] = useState(false)

  const loadAdvances = () => {
    setAdvLoading(true)
    financePaymentsApi.openAdvances()
      .then(setAdvances)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the open advances.')))
      .finally(() => setAdvLoading(false))
  }
  const loadWriteOffs = () => {
    setWoLoading(true)
    financePaymentsApi.listWriteOffs()
      .then(setWriteOffs)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the write-offs.')))
      .finally(() => setWoLoading(false))
  }

  useEffect(() => {
    if (!isAuthorized) return
    loadAdvances()
    if (seeWriteOffs) loadWriteOffs()
    Promise.all([
      accountsApi.listVendors().then(setVendors),
      crmApi.listOrganizations({ picker: true }).then(setCustomers),
      accountsApi.listGLAccounts({ status: 'active' }).then(setLedgers),
    ]).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load vendors, customers or ledgers.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  function pickParty(id: string) {
    setPartyId(id)
    setDocId('')
    setDocs([])
    if (!id) return
    accountsApi.openItems(partyType, Number(id))
      .then((d: { documents: OpenDocument[] }) => setDocs(d.documents || []))
      .catch((err: unknown) => setFormError(extractErrorMessages(err, 'Could not load the party\'s open bills.')))
  }

  async function saveWriteOff() {
    setFormError(null)
    const doc = docs.find((d) => String(d.id) === docId)
    const errs: string[] = []
    if (!doc) errs.push('Pick the bill to write off.')
    const amt = Math.round(Number(amount || 0) * 100) / 100
    if (amt <= 0) errs.push('Enter an amount greater than zero.')
    if (doc && amt > doc.amount_due + 0.001) errs.push(`${doc.doc_number} has only ${inr(doc.amount_due)} due.`)
    if (reason === 'other' && !glId) errs.push('Pick the ledger for an "Other" write-off.')
    if (errs.length || !doc) { setFormError(errs); return }
    setSaving(true)
    try {
      await financePaymentsApi.writeOff({
        target_type: doc.target_type, target_id: doc.id, amount: amt, reason, write_off_date: woDate,
        gl_account_id: glId ? Number(glId) : null, remarks: remarks.trim() || null,
      })
      setMessage({ title: 'Written off', message: `${inr(amt)} of ${doc.doc_number} has been written off and the bill's due amount reduced.` })
      setAmount(''); setRemarks(''); setDocId(''); pickParty(partyId)
      setWoOpen(false)
      loadWriteOffs()
    } catch (err: unknown) {
      setFormError(extractErrorMessages(err, 'Could not post the write-off.'))
    } finally {
      setSaving(false)
    }
  }

  async function doCancelWo(why: string) {
    const w = cancelWo
    setCancelWo(null)
    if (!w) return
    try {
      await financePaymentsApi.cancelWriteOff(w.id, why)
      loadWriteOffs()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not cancel the write-off.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  const partyOptions = partyType === 'vendor'
    ? vendors.map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}` }))
    : customers.map((c) => ({ value: String(c.id), label: c.org_code ? `${c.org_code} — ${c.name}` : c.name }))
  const otherLedgers = ledgerOptions(ledgers, (a) => !a.is_control_account)
  const adjustSource: CreditSource | null = adjust ? { source_type: 'advance', id: adjust.id, doc_number: adjust.payment_number, available: adjust.balance } : null

  return (
    <div>
      <FinanceNav />
      <PageHeader
        title="Advances & write-offs"
        subtitle="Down payments held on the advance ledgers until they are adjusted against the invoice, and write-offs of what is left on a bill."
        actions={<button style={secondaryBtnStyle} onClick={() => router.push('/dashboard/finance/payments')}>← Back</button>}
      />
      <ErrorBanner error={error} />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />

      {tab === 'Open advances' && (
        <>
          <InfoBanner>
            Customer advances sit on Advances from Customers (Other Current Liabilities) and supplier advances on Advances to Suppliers
            (Short-term Loans &amp; Advances) — shown separately on the Balance Sheet, not netted in receivables / payables. When the invoice is
            raised, Adjust the advance against it.
          </InfoBanner>
          <TableWrap minWidth={1050}>
            <thead>
              <tr>
                <th style={thStyle}>Voucher</th><th style={thStyle}>Date</th><th style={thStyle}>Type</th><th style={thStyle}>Party</th>
                <th style={thStyle}>Against</th><th style={numTh}>Advance (₹)</th><th style={numTh}>Adjusted (₹)</th><th style={numTh}>Open (₹)</th><th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {advLoading ? <EmptyRow colSpan={9} text="Loading advances…" />
                : advances.length === 0 ? <EmptyRow colSpan={9} text="No open advances." />
                : advances.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{a.payment_number}</td>
                    <td style={tdStyle}>{dmy(a.payment_date)}</td>
                    <td style={tdStyle}>{a.party_type === 'customer' ? 'From customer' : 'To supplier'}</td>
                    <td style={tdStyle}>{a.party_name}</td>
                    <td style={tdStyle}>{a.sales_order_number || a.purchase_order_number || <span style={{ color: TEXT.muted }}>On account — {a.advance_reason}</span>}</td>
                    <td style={numTd}>{inr(a.amount)}</td>
                    <td style={numTd}>{inr(a.adjusted, { blankZero: true })}</td>
                    <td style={numTd}>{inr(a.balance)}</td>
                    <td style={tdStyle}>{canAllocate && <button style={linkBtnStyle} onClick={() => setAdjust(a)}>Adjust</button>}</td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {tab === 'Write-offs' && seeWriteOffs && (
        <>
          {canWriteOff && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button type="button" style={primaryBtnStyle} onClick={() => { setFormError(null); setWoOpen(true) }}>+ Write off a bill</button>
            </div>
          )}
          {woOpen && canWriteOff && (
            <FormSheet tour="fin-wo-form" icon="tag" title="Write off what is left on a bill"
              subtitle="For the paise left after a receipt, or an LD / short payment agreed after the receipt was posted."
              onClose={() => setWoOpen(false)} busy={saving}
              footer={<SheetFooter onCancel={() => setWoOpen(false)} onSubmit={saveWriteOff} busy={saving} busyLabel="Posting…" label="Post write-off" />}>
              <SheetColumns
                left={<>
                  <ErrorBanner error={formError} />
                  <SheetSection icon="users" title="Bill">
                    <SRow>
                      <SField label="Party type" style={sw(160)}>
                        <Select style={sheetInput} value={partyType} onChange={(e) => { setPartyType(e.target.value as 'customer' | 'vendor'); setPartyId(''); setDocs([]); setDocId('') }}>
                          <option value="customer">Customer</option>
                          <option value="vendor">Vendor</option>
                        </Select>
                      </SField>
                      <SField label={partyType === 'vendor' ? 'Vendor' : 'Customer'} req style={sg(240, 360)}>
                        <SearchableSelect value={partyId} onChange={pickParty} options={partyOptions} placeholder="Search party…" />
                      </SField>
                    </SRow>
                    <SField label="Bill" req>
                      <Select style={sheetInput} value={docId} onChange={(e) => setDocId(e.target.value)}>
                        <option value="">{partyId ? (docs.length ? 'Pick bill' : 'No open bills') : 'Pick party first'}</option>
                        {docs.map((d) => <option key={d.id} value={String(d.id)}>{d.doc_number} — due {inr(d.amount_due)}</option>)}
                      </Select>
                    </SField>
                  </SheetSection>
                  <p style={sheetHint}>
                    Up to the small-difference tolerance (Finance Settings) any Payments editor can post it; above it a Finance Manager must. A rate
                    difference or return needs a credit / debit note instead, so GST is reversed.
                  </p>
                </>}
                right={<>
                  <SheetSection icon="rupee" title="Write-off">
                    <SField label="Reason" req style={{ marginBottom: 12 }}>
                      <Select style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)}>
                        {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    </SField>
                    <SRow mb={12}>
                      <SField label="Amount (₹)" req style={sw(150)}>
                        <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={amount} onChange={(e) => setAmount(e.target.value)} />
                      </SField>
                      <SField label="Date" req style={sw(170)}><DateField value={woDate} onChange={setWoDate} /></SField>
                    </SRow>
                    <SField label="Ledger" req={reason === 'other'} optional={reason !== 'other'} style={{ marginBottom: 12 }}>
                      <SearchableSelect value={glId} onChange={setGlId} options={[{ value: '', label: '— default for the reason —' }, ...otherLedgers]} placeholder="Default ledger" />
                    </SField>
                    <SField label="Remarks" optional>
                      <input style={sheetInput} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                    </SField>
                  </SheetSection>
                </>}
              />
            </FormSheet>
          )}
          <TableWrap minWidth={900}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th><th style={thStyle}>Bill</th><th style={thStyle}>Reason</th><th style={thStyle}>Ledger</th>
                <th style={numTh}>Amount (₹)</th><th style={thStyle}>Remarks</th><th style={thStyle}>Status</th><th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {woLoading ? <EmptyRow colSpan={8} text="Loading write-offs…" />
                : writeOffs.length === 0 ? <EmptyRow colSpan={8} text="No write-offs yet." />
                : writeOffs.map((w) => (
                  <tr key={w.id}>
                    <td style={tdStyle}>{dmy(w.adjustment_date)}</td>
                    <td style={tdStyle}>{w.target_number}</td>
                    <td style={tdStyle}>{w.reason_label}</td>
                    <td style={tdStyle}>{w.gl_account_code} — {w.gl_account_name}</td>
                    <td style={numTd}>{inr(w.amount)}</td>
                    <td style={tdStyle}>{w.remarks || ''}</td>
                    <td style={tdStyle}><StatusPill status={w.status} labels={WO_STATUS_LABELS} colors={WO_STATUS_HEX} /></td>
                    <td style={tdStyle}>{w.status === 'posted' && canCancelWriteOff && <button style={dangerLinkStyle} onClick={() => setCancelWo(w)}>Cancel</button>}</td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {adjust && adjustSource && (
        <AllocateCreditDialog partyType={adjust.party_type} partyId={adjust.party_id} partyName={adjust.party_name} source={adjustSource}
          onClose={() => setAdjust(null)}
          onDone={(total) => {
            const a = adjust
            setAdjust(null)
            setMessage({ title: 'Advance adjusted', message: `${inr(total)} of ${a.payment_number} has been adjusted against the selected invoice(s).` })
            loadAdvances()
          }} />
      )}
      <ReasonSheet
        open={!!cancelWo}
        tour="fin-wo-cancel-dialog"
        icon="x"
        title="Cancel this write-off?"
        subtitle={cancelWo ? `${inr(cancelWo.amount)} on ${cancelWo.target_number}` : ''}
        message="Its journal is reversed and the bill becomes due again by this amount."
        label="Reason for cancelling"
        placeholder="e.g. Customer paid the balance after all"
        confirmLabel="Cancel write-off"
        requireValue
        onConfirm={doCancelWo}
        onCancel={() => setCancelWo(null)}
      />
      <MessageDialog open={!!message} variant="success" title={message?.title || ''} message={message?.message || ''} onClose={() => setMessage(null)} />
    </div>
  )
}
