'use client'

/** Bank guarantees, letters of credit, EMD and security deposits — issued to
 *  customers (Indian Railways PBG / ABG / EMD) and received from suppliers.
 *  Issued ones are approved by a Finance approver and then a Partner before
 *  the bank application; margin, commission, release and invocation post
 *  through vouchers. Expiry reminders go out 30/15/7/1 days before. */
import { useEffect, useState } from 'react'
import { accountsApi, crmApi, salesApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { BankGuarantee, financeTreasuryApi } from '@/lib/financeTreasuryApi'
import { BankAccount, GLAccount } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { TreasuryModal as Modal } from '@/components/finance/BankStatementPanel'
import { SheetColumns, SheetSection, SheetIconName, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SRow, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import Select from '@/components/shared/Select'
import {
  inputStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso, Field, ErrorBanner, InfoBanner, StatusPill, TableWrap, EmptyRow, StatCard,
  ApprovalBadge, ledgerOptions,
} from '@/components/finance/financeUi'
import { RowCount, DetailGroup, DetailRow } from '@/components/shared/ui'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved — apply to bank', active: 'Active', released: 'Released', invoked: 'Invoked', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = { draft: '#64748b', submitted: '#f59e0b', approved: '#8b5cf6', active: '#16a34a', released: '#2563eb', invoked: '#dc2626', cancelled: '#94a3b8' }
const MARGIN_LABELS: Record<string, string> = { none: '—', placed: 'Placed', released: 'Released', consumed: 'Consumed' }
const FORM_LABELS: Record<string, string> = { bank_guarantee: 'Bank guarantee', lc: 'Letter of credit', deposit: 'Cash deposit (DD / NEFT / FDR)' }
const EVENT_LABELS: Record<string, string> = {
  created: 'Recorded', submitted: 'Sent for approval', approved: 'Approved', rejected: 'Returned / rejected', issued: 'Issued by bank', extended: 'Extended',
  margin_placed: 'Margin placed', margin_released: 'Margin released', commission: 'Commission', released: 'Released', invoked: 'Invoked', cancelled: 'Cancelled', document: 'Document',
}
type Opt = { value: string; label: string }
type Action = 'issue' | 'margin' | 'commission' | 'extend' | 'release' | 'invoke' | 'cancel'

function expiryTone(d: number | null) {
  if (d == null) return TEXT.secondary
  return d < 0 ? '#dc2626' : d <= 30 ? '#d97706' : TEXT.body
}

export default function GuaranteesTab({ initialId }: { initialId?: number | null }) {
  const { can } = useCan()
  const canCreate = can('accounts', 'guarantees', 'create')
  const [rows, setRows] = useState<BankGuarantee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [openOnly, setOpenOnly] = useState(true)
  const [direction, setDirection] = useState('')
  const [types, setTypes] = useState<Opt[]>([])
  const [showNew, setShowNew] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(initialId ?? null)

  const load = () => {
    setLoading(true)
    financeTreasuryApi.listGuarantees({ open_only: openOnly, direction: direction || undefined })
      .then((r) => { setRows(r); setError(null) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the guarantee register.')))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [openOnly, direction]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { financeTreasuryApi.guaranteeMeta().then((m) => setTypes(m.instrument_types)).catch(() => {}) }, [])

  const active = rows.filter((r) => r.status === 'active')
  const issuedTotal = active.filter((r) => r.direction === 'issued').reduce((s, r) => s + r.amount, 0)
  const margin = rows.filter((r) => r.margin_status === 'placed').reduce((s, r) => s + r.margin_amount, 0)
  const expiring = active.filter((r) => r.days_to_expiry != null && r.days_to_expiry <= 30).length

  return (
    <>
      <InfoBanner>
        Register of <strong>bank guarantees, LCs, EMD and security deposits</strong> — issued to customers (PBG / ABG / EMD for Railway tenders and
        orders) and received from suppliers. An issued instrument is approved by a Finance approver and then a Partner before you apply to the bank;
        margin money, commission, release and invocation are posted as vouchers. Reminders (bell + Teams) go out 30, 15, 7 and 1 day before expiry and
        claim-period end.
      </InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard label="Issued & Active" value={`₹ ${inr(issuedTotal)}`} />
        <StatCard label="Margin / Deposits Blocked" value={`₹ ${inr(margin)}`} />
        <StatCard label="Expiring ≤ 30 Days" value={String(expiring)} tone={expiring ? '#d97706' : undefined} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <Field label="Direction" style={{ flex: '0 1 170px' }}>
          <Select style={inputStyle} value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">Issued & received</option><option value="issued">Issued by us</option><option value="received">Received by us</option>
          </Select>
        </Field>
        <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 10 }}>
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only
        </label>
        <div style={{ flex: 1 }} />
        {canCreate && <button type="button" style={{ ...primaryBtnStyle }} onClick={() => setShowNew(true)}>+ New Instrument</button>}
      </div>

      <TableWrap minWidth={1180}>
        <thead>
          <tr>
            <th style={thStyle}>BG No. <RowCount count={rows.length} /></th><th style={thStyle}>Type</th><th style={thStyle}>Beneficiary / Applicant</th><th style={thStyle}>Linked To</th>
            <th style={thStyle}>Bank / Instrument No.</th><th style={numTh}>Amount (₹)</th><th style={thStyle}>Expiry</th><th style={thStyle}>Claim Until</th>
            <th style={thStyle}>Margin</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading && <EmptyRow colSpan={11} text="Loading…" />}
          {!loading && rows.length === 0 && <EmptyRow colSpan={11} text="No instruments in this view." />}
          {!loading && rows.map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(r.id)}>
              <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.bg_number}<div style={{ fontSize: 10.5, color: TEXT.muted }}>{r.direction === 'issued' ? 'Issued' : 'Received'}</div></td>
              <td style={tdStyle}>{r.instrument_type_label}</td>
              <td style={tdStyle}>{r.customer_name || r.vendor_name || r.counterparty_name || '—'}</td>
              <td style={{ ...tdStyle, fontSize: 12 }}>{[r.sales_order_number, r.tender_label, r.purchase_order_number].filter(Boolean).join(' · ') || '—'}</td>
              <td style={{ ...tdStyle, fontSize: 12 }}>{r.bank_account_label || r.issuing_bank_name || '—'}{r.instrument_number ? <div style={{ color: TEXT.muted }}>{r.instrument_number}</div> : null}</td>
              <td style={numTd}>{inr(r.amount)}</td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: expiryTone(r.days_to_expiry), fontWeight: r.days_to_expiry != null && r.days_to_expiry <= 30 ? 700 : 400 }}>
                {dmy(r.expiry_date)}{r.days_to_expiry != null && <div style={{ fontSize: 10.5 }}>{r.days_to_expiry < 0 ? `${-r.days_to_expiry} d ago` : `${r.days_to_expiry} d left`}</div>}
              </td>
              <td style={tdStyle}>{dmy(r.claim_expiry_date)}</td>
              <td style={tdStyle}>{r.margin_amount ? `${inr(r.margin_amount)} · ${MARGIN_LABELS[r.margin_status]}` : '—'}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} />{r.status === 'submitted' && <div style={{ marginTop: 3 }}><ApprovalBadge status={r.approval_status} stage={r.approval_stage} /></div>}</td>
              <td style={tdStyle} onClick={(e) => e.stopPropagation()}><span style={linkBtnStyle} onClick={() => setDetailId(r.id)}>View</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {showNew && <NewInstrument types={types} onClose={() => setShowNew(false)} onSaved={(bg) => { setShowNew(false); load(); setDetailId(bg.id) }} />}
      {detailId != null && <Detail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </>
  )
}

// ─── New instrument ───────────────────────────────────────────────────

function NewInstrument({ types, onClose, onSaved }: { types: Opt[]; onClose: () => void; onSaved: (bg: BankGuarantee) => void }) {
  const [f, setF] = useState<Record<string, string>>({
    direction: 'issued', instrument_type: 'pbg', instrument_form: 'bank_guarantee', amount: '', margin_percent: '10', bank_account_id: '',
    customer_id: '', vendor_id: '', sales_order_id: '', tender_id: '', counterparty_name: '', issuing_bank_name: '', instrument_number: '',
    issue_date: '', expiry_date: '', claim_expiry_date: '', purpose: '',
  })
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [customers, setCustomers] = useState<Opt[]>([])
  const [vendors, setVendors] = useState<Opt[]>([])
  const [orders, setOrders] = useState<Opt[]>([])
  const [tenders, setTenders] = useState<Opt[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const issued = f.direction === 'issued'

  useEffect(() => {
    accountsApi.listBankAccounts({ status: 'active' }).then((b: BankAccount[]) => setBanks(b.filter((x) => x.account_kind === 'bank'))).catch(() => {})
    crmApi.listOrganizations({ picker: true }).then((o: { id: number; name: string }[]) => setCustomers(o.map((x) => ({ value: String(x.id), label: x.name })))).catch(() => {})
    accountsApi.listVendors().then((v: { id: number; name: string; code?: string }[]) => setVendors(v.map((x) => ({ value: String(x.id), label: `${x.code ? `${x.code} — ` : ''}${x.name}` })))).catch(() => {})
  }, [])
  useEffect(() => {
    if (!f.customer_id) return
    salesApi.listOrders({ customer_id: Number(f.customer_id) })
      .then((rows) => setOrders(rows.filter((o) => !['cancelled', 'rejected'].includes(o.status)).map((o) => ({ value: String(o.id), label: `${o.display_number} (${o.status})` }))))
      .catch(() => {})
    crmApi.listTenders({ org_id: Number(f.customer_id) })
      .then((rows: { id: number; tender_number?: string | null; tender_name?: string | null; universal_id: string }[]) =>
        setTenders(rows.map((t) => ({ value: String(t.id), label: [t.tender_number, t.tender_name].filter(Boolean).join(' — ') || t.universal_id }))))
      .catch(() => {})
  }, [f.customer_id])

  const save = async () => {
    setError(null)
    if (!(Number(f.amount) > 0)) { setError(['Enter the guarantee amount.']); return }
    setBusy(true)
    const n = (k: string) => (f[k] ? Number(f[k]) : null)
    const s = (k: string) => (f[k] ? f[k] : null)
    try {
      const bg = await financeTreasuryApi.createGuarantee({
        direction: f.direction, instrument_type: f.instrument_type, instrument_form: f.instrument_type === 'lc' ? 'lc' : f.instrument_form,
        amount: Number(f.amount), margin_percent: issued && f.instrument_form !== 'deposit' && f.margin_percent !== '' ? Number(f.margin_percent) : null,
        bank_account_id: n('bank_account_id'), customer_id: n('customer_id'), vendor_id: n('vendor_id'), sales_order_id: n('sales_order_id'),
        tender_id: n('tender_id'), counterparty_name: s('counterparty_name'), issuing_bank_name: s('issuing_bank_name'),
        instrument_number: s('instrument_number'), issue_date: s('issue_date'), expiry_date: s('expiry_date'),
        claim_expiry_date: s('claim_expiry_date'), purpose: s('purpose'),
      })
      onSaved(bg)
    } catch (err) { setError(extractErrorMessages(err, 'Could not record the instrument.')) } finally { setBusy(false) }
  }

  return (
    <Modal open title="New bank guarantee / LC / EMD" subtitle={issued ? 'Issued by us — saved as a draft, then sent for Finance + Partner approval before you apply to the bank.' : 'Received by us from a supplier — recorded straight into the register.'}
      icon="shield" onClose={onClose} width={960} busy={busy} raw
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={busy} label={issued ? 'Save draft' : 'Record'} icon={issued ? 'check' : 'plus'} />}>
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="shield" title="Instrument">
            <SRow>
              <SField label="Direction" req style={sw(180)}>
                <Select style={sheetInput} value={f.direction} onChange={(e) => set('direction', e.target.value)}>
                  <option value="issued">Issued by us</option><option value="received">Received by us</option>
                </Select>
              </SField>
              <SField label="Instrument" req style={sg(220, 300)}>
                <Select style={sheetInput} value={f.instrument_type} onChange={(e) => set('instrument_type', e.target.value)}>
                  {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </SField>
            </SRow>
            <SRow mb={0}>
              {issued && ['emd', 'security_deposit'].includes(f.instrument_type) && (
                <SField label="Given as" style={sw(250)}>
                  <Select style={sheetInput} value={f.instrument_form} onChange={(e) => set('instrument_form', e.target.value)}>
                    <option value="bank_guarantee">{FORM_LABELS.bank_guarantee}</option><option value="deposit">{FORM_LABELS.deposit}</option>
                  </Select>
                </SField>
              )}
              <SField label="Amount (₹)" req style={sw(170)}>
                <input type="number" step="any" style={{ ...sheetInput, textAlign: 'right' }} value={f.amount} onChange={(e) => set('amount', e.target.value)} />
              </SField>
              {issued && f.instrument_form !== 'deposit' && f.instrument_type !== 'lc' && (
                <SField label="Margin %" style={sw(110)}>
                  <input type="number" step="any" style={{ ...sheetInput, textAlign: 'right' }} value={f.margin_percent} onChange={(e) => set('margin_percent', e.target.value)} />
                </SField>
              )}
            </SRow>
          </SheetSection>
          <SheetSection icon="users" title={issued ? 'Beneficiary & bank' : 'Applicant & bank'}>
            <SRow>
              {issued
                ? <SField label="Customer (beneficiary)" style={sg(240, 340)}><SearchableSelect value={f.customer_id} onChange={(v) => { setOrders([]); setTenders([]); setF((p) => ({ ...p, customer_id: v, sales_order_id: '', tender_id: '' })) }} options={customers} placeholder="Select customer…" /></SField>
                : <SField label="Supplier (applicant)" style={sg(240, 340)}><SearchableSelect value={f.vendor_id} onChange={(v) => set('vendor_id', v)} options={vendors} placeholder="Select vendor…" /></SField>}
              <SField label={issued ? 'Beneficiary as on instrument' : 'Applicant as on instrument'} style={sg(240, 340)}>
                <input style={sheetInput} value={f.counterparty_name} maxLength={255} onChange={(e) => set('counterparty_name', e.target.value)} placeholder={issued ? 'e.g. PCMM, Central Railway' : ''} />
              </SField>
            </SRow>
            <SRow mb={0}>
              <SField label={issued ? 'Our bank account' : 'Our bank account (claims credited to)'} style={sg(240, 340)}>
                <SearchableSelect value={f.bank_account_id} onChange={(v) => set('bank_account_id', v)} options={banks.map((b) => ({ value: String(b.id), label: `${b.bank_name}${b.account_no ? ` — ${b.account_no}` : ''}` }))} placeholder="Select bank…" />
              </SField>
              {!issued && <SField label="Issuing bank (as printed)" style={sg(220, 300)}><input style={sheetInput} value={f.issuing_bank_name} onChange={(e) => set('issuing_bank_name', e.target.value)} /></SField>}
            </SRow>
          </SheetSection>
        </>}
        right={<>
          {issued && (
            <SheetSection icon="link" title="Linked to">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <SField label="Sales order" optional><SearchableSelect value={f.sales_order_id} onChange={(v) => set('sales_order_id', v)} options={orders} placeholder={f.customer_id ? 'None' : 'Pick the customer first'} /></SField>
                <SField label="Tender" optional><SearchableSelect value={f.tender_id} onChange={(v) => set('tender_id', v)} options={tenders} placeholder={f.customer_id ? 'None' : 'Pick the customer first'} /></SField>
              </div>
            </SheetSection>
          )}
          <SheetSection icon="calendar" title="Dates">
            <SRow mb={0}>
              {!issued && <SField label="Instrument no." style={sw(180)}><input style={sheetInput} value={f.instrument_number} onChange={(e) => set('instrument_number', e.target.value)} /></SField>}
              {!issued && <SField label="Issue date" style={sw(160)}><DateField value={f.issue_date} onChange={(v) => set('issue_date', v)} /></SField>}
              <SField label="Expiry date" style={sw(160)}><DateField value={f.expiry_date} onChange={(v) => set('expiry_date', v)} /></SField>
              <SField label="Claim period ends" style={sw(170)}><DateField value={f.claim_expiry_date} onChange={(v) => set('claim_expiry_date', v)} /></SField>
            </SRow>
          </SheetSection>
          <SheetSection icon="doc" title="Purpose">
            <SField label="Purpose" optional><input style={sheetInput} value={f.purpose} maxLength={300} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. PBG 5% of LOA value, 60 days beyond warranty" /></SField>
          </SheetSection>
        </>}
      />
    </Modal>
  )
}

// ─── Detail + actions ─────────────────────────────────────────────────

function Detail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { can, canFeature } = useCan()
  const [bg, setBg] = useState<BankGuarantee | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    financeTreasuryApi.getGuarantee(id).then(setBg).catch((err) => setError(extractErrorMessages(err, 'Could not load the instrument.')))
  }, [id])

  const done = (b: BankGuarantee) => { setBg(b); setAction(null); onChanged() }
  const submit = async () => {
    setBusy(true); setError(null)
    try { done(await financeTreasuryApi.guaranteeAction(id, 'submit')) } catch (err) { setError(extractErrorMessages(err, 'Could not send it for approval.')) } finally { setBusy(false) }
  }
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null)
    try { done(await financeTreasuryApi.uploadGuaranteeDocument(id, file)) } catch (err) { setError(extractErrorMessages(err, 'Could not upload the instrument copy.')) } finally { setBusy(false) }
  }
  const openDoc = async () => {
    try {
      const blob = await financeTreasuryApi.guaranteeDocument(id)
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch (err) { setError(extractErrorMessages(err, 'Could not open the instrument copy.')) }
  }

  const lifecycle = canFeature('accounts', 'guarantees', 'lifecycle', 'edit')
  const postings = canFeature('accounts', 'guarantees', 'bank_postings', 'create')
  const seeCopy = canFeature('accounts', 'guarantees', 'instrument_copy', 'view')
  const uploadCopy = canFeature('accounts', 'guarantees', 'instrument_copy', 'create')
  const s = bg?.status
  const issued = bg?.direction === 'issued'
  const buttons: { a: Action | 'submit'; label: string; show: boolean }[] = bg ? [
    { a: 'submit', label: 'Send for Approval', show: issued && s === 'draft' && can('accounts', 'guarantees', 'submit') },
    { a: 'issue', label: 'Mark Issued by Bank', show: issued && s === 'approved' && lifecycle },
    { a: 'margin', label: bg.instrument_form === 'deposit' ? 'Post Deposit Payment' : 'Post Margin Money', show: issued && ['approved', 'active'].includes(s!) && bg.margin_status === 'none' && bg.margin_amount > 0 && postings },
    { a: 'commission', label: 'Book Commission', show: issued && bg.instrument_form !== 'deposit' && ['approved', 'active'].includes(s!) && postings },
    { a: 'extend', label: 'Extend', show: s === 'active' && lifecycle },
    { a: 'release', label: 'Release / Close', show: s === 'active' && lifecycle },
    { a: 'invoke', label: 'Record Invocation', show: s === 'active' && canFeature('accounts', 'guarantees', 'invocation', 'approve') },
    { a: 'cancel', label: 'Cancel', show: ['draft', 'submitted', 'approved'].includes(s!) && bg.margin_status === 'none' && can('accounts', 'guarantees', 'cancel') },
  ] : []

  return (
    <Modal open title={bg ? `${bg.bg_number} — ${bg.instrument_type_label}` : 'Instrument'} subtitle={bg ? `${bg.direction === 'issued' ? 'Issued by us' : 'Received by us'} · ${inr(bg.amount)}` : ''} icon="shield" onClose={onClose} width={900}>
      <ErrorBanner error={error} />
      {!bg && !error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      {bg && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <StatusPill status={bg.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
            {bg.status === 'submitted' && <ApprovalBadge status={bg.approval_status} stage={bg.approval_stage} />}
            <div style={{ flex: 1 }} />
            {buttons.filter((b) => b.show).map((b) => (
              <button key={b.a} type="button" disabled={busy} style={b.a === 'submit' || b.a === 'issue' ? primaryBtnStyle : secondaryBtnStyle}
                onClick={() => (b.a === 'submit' ? submit() : setAction(b.a as Action))}>{b.label}</button>
            ))}
          </div>
          <div style={{ marginBottom: 14 }}>
            <DetailGroup title="Party & bank">
              <DetailRow label={issued ? 'Beneficiary' : 'Applicant'}>{bg.customer_name || bg.vendor_name || bg.counterparty_name || null}</DetailRow>
              {(bg.customer_name || bg.vendor_name) && bg.counterparty_name && <DetailRow label="Name on the instrument">{bg.counterparty_name}</DetailRow>}
              <DetailRow label="Bank">{bg.bank_account_label || bg.issuing_bank_name || null}</DetailRow>
              <DetailRow label="Instrument no.">{bg.instrument_number || null}</DetailRow>
              <DetailRow label="Linked to">{[bg.sales_order_number, bg.tender_label, bg.purchase_order_number].filter(Boolean).join(' · ') || null}</DetailRow>
              {bg.purpose && <DetailRow label="Purpose">{bg.purpose}</DetailRow>}
            </DetailGroup>
            <DetailGroup title="Amount & dates">
              <DetailRow label="Amount">₹ {inr(bg.amount)}</DetailRow>
              <DetailRow label={bg.instrument_form === 'deposit' ? 'Deposit' : 'Margin money'}>
                {bg.margin_amount ? `₹ ${inr(bg.margin_amount)}${bg.margin_percent != null && bg.instrument_form !== 'deposit' ? ` (${bg.margin_percent}%)` : ''}${MARGIN_LABELS[bg.margin_status] ? ` · ${MARGIN_LABELS[bg.margin_status]}` : ''}` : null}
              </DetailRow>
              {bg.commission_total > 0 && <DetailRow label="Commission paid">₹ {inr(bg.commission_total)}</DetailRow>}
              <DetailRow label="Issued on">{bg.issue_date ? dmy(bg.issue_date) : null}</DetailRow>
              <DetailRow label="Expires on">{bg.expiry_date ? `${dmy(bg.expiry_date)}${bg.claim_expiry_date ? ` · claims until ${dmy(bg.claim_expiry_date)}` : ''}` : null}</DetailRow>
              {bg.closure_reason && <DetailRow label={bg.status === 'invoked' ? `Invoked (₹ ${inr(bg.invoked_amount)})` : 'Closed because'}>{`${bg.closure_reason}${bg.closed_on ? ` · ${dmy(bg.closed_on)}` : ''}`}</DetailRow>}
            </DetailGroup>
            {seeCopy && (
              <DetailGroup title="Instrument copy" last>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', flexWrap: 'wrap' }}>
                  {bg.document_name ? <button type="button" style={linkBtnStyle} onClick={openDoc}>{bg.document_name}</button> : <span style={{ fontSize: 13, color: TEXT.muted }}>Not uploaded yet</span>}
                  {uploadCopy && !['cancelled'].includes(bg.status) && <input type="file" accept=".pdf,image/*" style={{ ...sheetInput, maxWidth: 280 }} onChange={(e) => upload(e.target.files?.[0])} />}
                </div>
              </DetailGroup>
            )}
          </div>
          <TableWrap minWidth={720} maxHeight="300px">
            <thead><tr><th style={thStyle}>Date <RowCount count={bg.events.length} /></th><th style={thStyle}>Event</th><th style={numTh}>Amount (₹)</th><th style={thStyle}>Voucher</th><th style={thStyle}>Details</th><th style={thStyle}>By</th></tr></thead>
            <tbody>
              {bg.events.length === 0 && <EmptyRow colSpan={6} text="Nothing has happened on this instrument yet." />}
              {bg.events.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(e.event_date)}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{EVENT_LABELS[e.event_type] || e.event_type}</td>
                  <td style={numTd}>{e.amount != null ? inr(e.amount) : '—'}</td>
                  <td style={tdStyle}>{e.voucher_number || '—'}</td>
                  <td style={{ ...tdStyle, color: TEXT.secondary }}>
                    {e.event_type === 'extended' ? `${dmy(e.old_expiry_date)} → ${dmy(e.new_expiry_date)}. ` : ''}{e.notes || (e.event_type === 'extended' ? '' : '—')}
                  </td>
                  <td style={tdStyle}>{e.created_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {action && <ActionDialog bg={bg} action={action} onClose={() => setAction(null)} onDone={done} />}
        </>
      )}
    </Modal>
  )
}

const ACTION_TITLES: Record<Action, string> = {
  issue: 'Mark as issued by the bank', margin: 'Post margin money / deposit', commission: 'Book bank commission', extend: 'Extend the instrument',
  release: 'Release / close', invoke: 'Record invocation (claim)', cancel: 'Cancel the instrument',
}
const ACTION_ICONS: Record<Action, SheetIconName> = {
  issue: 'check', margin: 'rupee', commission: 'rupee', extend: 'calendar', release: 'undo', invoke: 'alert', cancel: 'x',
}

function ActionDialog({ bg, action, onClose, onDone }: { bg: BankGuarantee; action: Action; onClose: () => void; onDone: (b: BankGuarantee) => void }) {
  const [f, setF] = useState<Record<string, string>>({
    instrument_number: bg.instrument_number || '', issue_date: todayIso(), expiry_date: bg.expiry_date || '', claim_expiry_date: bg.claim_expiry_date || '',
    posting_date: todayIso(), amount: action === 'invoke' ? String(bg.amount) : '', payment_mode: 'neft', reference_no: '',
    new_expiry_date: '', new_claim_expiry_date: '', amendment_date: todayIso(), reason: '', release_date: todayIso(), invoke_date: todayIso(), gl_account_id: '',
  })
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  useEffect(() => { if (action === 'invoke') accountsApi.listGLAccounts().then(setLedgers).catch(() => {}) }, [action])

  const payload = (): Record<string, unknown> => {
    const s = (k: string) => f[k] || null
    switch (action) {
      case 'issue': return { instrument_number: f.instrument_number, issue_date: f.issue_date, expiry_date: s('expiry_date'), claim_expiry_date: s('claim_expiry_date') }
      case 'margin': return { posting_date: f.posting_date, payment_mode: f.payment_mode, reference_no: s('reference_no') }
      case 'commission': return { posting_date: f.posting_date, amount: Number(f.amount), payment_mode: f.payment_mode, reference_no: s('reference_no') }
      case 'extend': return { new_expiry_date: f.new_expiry_date, new_claim_expiry_date: s('new_claim_expiry_date'), amendment_date: f.amendment_date, reason: f.reason }
      case 'release': return { release_date: f.release_date, reason: f.reason, payment_mode: f.payment_mode, reference_no: s('reference_no') }
      case 'invoke': return { invoke_date: f.invoke_date, amount: Number(f.amount), reason: f.reason, gl_account_id: f.gl_account_id ? Number(f.gl_account_id) : null, payment_mode: f.payment_mode, reference_no: s('reference_no') }
      case 'cancel': return { reason: f.reason }
    }
  }
  const save = async () => {
    setError(null)
    if (['extend', 'release', 'invoke', 'cancel'].includes(action) && !f.reason.trim()) { setError(['Give the reason — it is kept on the instrument history.']); return }
    if (action === 'extend' && !f.new_expiry_date) { setError(['Enter the new expiry date from the bank\'s amendment.']); return }
    if (action === 'issue' && !f.instrument_number.trim()) { setError(['Enter the bank\'s instrument number.']); return }
    setBusy(true)
    try { onDone(await financeTreasuryApi.guaranteeAction(bg.id, action, payload())) } catch (err) { setError(extractErrorMessages(err, 'Could not save.')) } finally { setBusy(false) }
  }
  const money = ['margin', 'commission', 'release', 'invoke'].includes(action)
  const posting = {
    margin: `Posts a payment voucher: Dr ${bg.instrument_form === 'deposit' ? 'EMD & Security Deposits' : 'Margin Money with Banks'} / Cr ${bg.bank_account_label || 'bank'} for ${inr(bg.margin_amount)}.`,
    commission: 'Posts a payment voucher: Dr Bank Guarantee & LC Commission / Cr bank.',
    release: bg.direction === 'issued' && bg.margin_status === 'placed' ? `The margin of ${inr(bg.margin_amount)} comes back by a receipt voucher (Dr bank / Cr margin).` : 'No money moves — the instrument is just closed.',
    invoke: bg.direction === 'issued'
      ? 'Dr Bank guarantees invoked (or the ledger you pick); the margin is used first (journal), the rest is paid from the bank; any unused margin is refunded.'
      : 'Posts a receipt voucher: Dr bank / Cr LD / penalties recovered from vendors (or the ledger you pick).',
  } as Record<string, string>

  const danger = action === 'invoke' || action === 'cancel'
  const needsReason = ['extend', 'release', 'invoke', 'cancel'].includes(action)
  return (
    <Modal open title={ACTION_TITLES[action]} subtitle={`${bg.bg_number} — ${bg.instrument_type_label}`} icon={ACTION_ICONS[action]} iconColor={danger ? '#dc2626' : undefined}
      onClose={onClose} width={580} busy={busy}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={busy} label="Confirm" icon={ACTION_ICONS[action]} color={danger ? '#dc2626' : undefined} />}>
      {posting[action] && <InfoBanner>{posting[action]}</InfoBanner>}
      <SheetError error={error} />
      <SheetSection icon={ACTION_ICONS[action]} title="Details">
        <SRow mb={needsReason || money ? 14 : 0}>
          {action === 'issue' && <>
            <SField label="Bank's instrument no." req style={sg(200, 260)}><input style={sheetInput} value={f.instrument_number} onChange={(e) => set('instrument_number', e.target.value)} /></SField>
            <SField label="Issue date" style={sw(160)}><DateField value={f.issue_date} onChange={(v) => set('issue_date', v)} /></SField>
            <SField label="Expiry date" style={sw(160)}><DateField value={f.expiry_date} onChange={(v) => set('expiry_date', v)} /></SField>
            <SField label="Claim period ends" style={sw(170)}><DateField value={f.claim_expiry_date} onChange={(v) => set('claim_expiry_date', v)} /></SField>
          </>}
          {(action === 'margin' || action === 'commission') && <SField label="Posting date" style={sw(160)}><DateField value={f.posting_date} onChange={(v) => set('posting_date', v)} /></SField>}
          {action === 'commission' && <SField label="Commission (₹)" style={sw(160)}><input type="number" step="any" style={{ ...sheetInput, textAlign: 'right' }} value={f.amount} onChange={(e) => set('amount', e.target.value)} /></SField>}
          {action === 'extend' && <>
            <SField label="New expiry" req style={sw(160)}><DateField value={f.new_expiry_date} onChange={(v) => set('new_expiry_date', v)} /></SField>
            <SField label="New claim end" style={sw(170)} hint="Blank = keep the period."><DateField value={f.new_claim_expiry_date} onChange={(v) => set('new_claim_expiry_date', v)} /></SField>
            <SField label="Amendment date" style={sw(160)}><DateField value={f.amendment_date} onChange={(v) => set('amendment_date', v)} /></SField>
          </>}
          {action === 'release' && <SField label="Release date" style={sw(160)}><DateField value={f.release_date} onChange={(v) => set('release_date', v)} /></SField>}
          {action === 'invoke' && <>
            <SField label="Invoked on" style={sw(160)}><DateField value={f.invoke_date} onChange={(v) => set('invoke_date', v)} /></SField>
            <SField label="Amount claimed (₹)" style={sw(170)}><input type="number" step="any" style={{ ...sheetInput, textAlign: 'right' }} value={f.amount} onChange={(e) => set('amount', e.target.value)} /></SField>
            <SField label="Ledger" style={sg(240, 340)} hint="Blank = default ledger.">
              <SearchableSelect value={f.gl_account_id} onChange={(v) => set('gl_account_id', v)} options={ledgerOptions(ledgers, (a) => !a.is_control_account)} placeholder="Default ledger" />
            </SField>
          </>}
        </SRow>
        {money && (
          <SRow mb={needsReason ? 14 : 0}>
            <SField label="Mode" style={sw(130)}>
              <Select style={sheetInput} value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>
                {['neft', 'rtgs', 'imps', 'dd'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </Select>
            </SField>
            <SField label="Bank ref / UTR" optional style={sg(180, 260)}><input style={sheetInput} value={f.reference_no} maxLength={100} onChange={(e) => set('reference_no', e.target.value)} /></SField>
          </SRow>
        )}
        {needsReason && (
          <SField label="Reason / letter reference" req>
            <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={f.reason} maxLength={1000} onChange={(e) => set('reason', e.target.value)} />
          </SField>
        )}
      </SheetSection>
    </Modal>
  )
}
