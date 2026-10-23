'use client'

/** Disputes (SAP FSCM Dispute Management): a disputed amount on a posted
 *  sales invoice, tracked open → under review → resolved by credit note,
 *  write-off or the customer paying. Open disputes are shown apart in aging
 *  and left out of dunning and of the overdue credit block. */
import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { ARDispute, OpenDocument } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import FinanceNav from '@/components/finance/FinanceNav'
import OutstandingSubNav from '@/components/finance/OutstandingSubNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, SHEET, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SRow, SheetBody, SheetFooter, sw } from '@/components/finance/financeSheet'
import {
  primaryBtnStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh, inr, dmy,
  ErrorBanner, InfoBanner, StatusPill, PageHeader, TableWrap, EmptyRow, StatCard, SubTabs,
} from '@/components/finance/financeUi'

const REASONS: Record<string, string> = {
  quality: 'Quality claim', quantity: 'Quantity / short supply', price: 'Price / rate', ld: 'LD (liquidated damages)',
  documentation: 'Documentation', other: 'Other',
}
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', under_review: 'Under review', resolved_credit_note: 'Credit note', resolved_paid: 'Customer paid', written_off: 'Written off',
}
const STATUS_HEX: Record<string, string> = {
  open: '#dc2626', under_review: '#f59e0b', resolved_credit_note: '#16a34a', resolved_paid: '#0f766e', written_off: '#7c3aed',
}
const FILTERS = ['Open', 'Resolved', 'All'] as const
type Filter = typeof FILTERS[number]

export default function DisputesPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { can, canFeature } = useCan()
  const [filter, setFilter] = useState<Filter>('Open')
  const [rows, setRows] = useState<ARDispute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [resolving, setResolving] = useState<ARDispute | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    accountsApi.listDisputes(filter === 'Open' ? { status: 'open_all' } : {})
      .then((d: ARDispute[]) => { setRows(filter === 'Resolved' ? d.filter((x) => !['open', 'under_review'].includes(x.status)) : d); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load disputes.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, filter, reload])

  if (isLoading || !isAuthorized) return null
  const canCreate = can('accounts', 'disputes', 'create')
  const canEdit = can('accounts', 'disputes', 'edit')
  const canResolve = canFeature('accounts', 'disputes', 'resolution', 'approve')
  const open = rows.filter((r) => ['open', 'under_review'].includes(r.status))

  const markReview = (d: ARDispute) => accountsApi.updateDispute(d.id, { status: 'under_review' }).then(() => setReload((k) => k + 1))
    .catch((err: unknown) => setError(extractErrorMessages(err, `Could not update ${d.dispute_number}.`)))

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Disputes" subtitle="Customer claims against a sales invoice — quality, quantity, price, LD or documentation — tracked to resolution."
        actions={canCreate ? <button data-tour="fin-disp-new" style={primaryBtnStyle} onClick={() => setShowNew(true)}>Raise dispute</button> : undefined} />
      <OutstandingSubNav />
      <InfoBanner>
        While a dispute is open its amount is shown in the <b>Disputed</b> column of aging, is not chased in Collections and does not put the customer on credit hold.
        Resolve it with a credit note (Finance › Sales › Credit Notes, against the same invoice), a write-off, or mark it paid when the customer withdraws the claim.
      </InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Open disputes" value={String(open.length)} />
        <StatCard label="Disputed amount (open)" value={inr(open.reduce((s, r) => s + r.disputed_amount, 0))} tone="#7c3aed" />
      </div>
      <SubTabs tabs={FILTERS} value={filter} onChange={setFilter} />
      <TableWrap minWidth={1200} tour="fin-disp-table">
        <thead>
          <tr>
            <th style={thStyle}>Dispute</th><th style={thStyle}>Customer</th><th style={thStyle}>Invoice</th><th style={numTh}>Disputed (₹)</th>
            <th style={numTh}>Invoice due (₹)</th><th style={thStyle}>Reason</th><th style={thStyle}>Description</th><th style={thStyle}>Owner</th>
            <th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={10} text="Loading…" />
            : rows.length === 0 ? <EmptyRow colSpan={10} text="No disputes." />
            : rows.map((d) => (
              <tr key={d.id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{d.dispute_number}<div style={{ fontSize: 11, color: TEXT.muted }}>{dmy(d.raised_on)}</div></td>
                <td style={tdStyle}>{d.customer_name}</td>
                <td style={tdStyle}>{d.invoice_number}</td>
                <td style={{ ...numTd, fontWeight: 700, color: '#7c3aed' }}>{inr(d.disputed_amount)}</td>
                <td style={numTd}>{inr(d.invoice_due ?? 0)}</td>
                <td style={tdStyle}>{REASONS[d.reason] || d.reason}</td>
                <td style={{ ...tdStyle, fontSize: 12, maxWidth: 280 }}>
                  {d.description}
                  {d.resolution_note && <div style={{ color: TEXT.muted, marginTop: 4 }}>Resolution ({d.resolved_by_name}, {dmy(d.resolved_on)}): {d.resolution_note}{d.credit_note_number ? ` — ${d.credit_note_number}` : ''}</div>}
                </td>
                <td style={tdStyle}>{d.owner_name || '—'}</td>
                <td style={tdStyle}><StatusPill status={d.status} labels={STATUS_LABELS} colors={STATUS_HEX} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {canEdit && d.status === 'open' && <><button style={linkBtnStyle} onClick={() => markReview(d)}>Under review</button>{canResolve && ' · '}</>}
                  {canResolve && ['open', 'under_review'].includes(d.status) && <button style={linkBtnStyle} onClick={() => setResolving(d)}>Resolve</button>}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
      {showNew && <NewDisputeDialog onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); setReload((k) => k + 1) }} />}
      {resolving && <ResolveDialog dispute={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); setReload((k) => k + 1) }} />}
    </div>
  )
}

function NewDisputeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [docs, setDocs] = useState<OpenDocument[]>([])
  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('quality')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    accountsApi.openBills('customer')
      .then((d: { documents: OpenDocument[] }) => setDocs(d.documents || []))
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load open sales invoices.')))
  }, [])
  const picked = docs.find((d) => String(d.id) === invoiceId)

  async function save() {
    setError(null)
    if (!picked) { setError(['Pick the sales invoice the customer disputes.']); return }
    setSaving(true)
    try {
      await accountsApi.createDispute({ ar_transaction_id: picked.id, disputed_amount: Number(amount), reason, description })
      onDone()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not raise the dispute.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet width={580} tour="fin-disp-new-dialog" icon="flag" iconColor="#7c3aed" title="Raise dispute" subtitle="A customer claim against a posted sales invoice." onClose={onClose} busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Raise dispute" icon="flag" color="#7c3aed" />}>
      <SheetBody>
        <SheetError error={error} />
        <SheetSection icon="doc" title="Invoice" color="#7c3aed">
          <SField label="Sales invoice" req style={{ marginBottom: 14 }}>
            <SearchableSelect value={invoiceId} onChange={(v) => { setInvoiceId(v); const d = docs.find((x) => String(x.id) === v); if (d) setAmount(String(Math.round((d.amount_due - (d.disputed ?? 0)) * 100) / 100)) }}
              placeholder="Pick an open invoice"
              options={docs.map((d) => ({ value: String(d.id), label: `${d.doc_number} — due ${inr(d.amount_due)} (${dmy(d.due_date)})` }))} />
          </SField>
          <SRow mb={0}>
            <SField label="Disputed amount (₹)" req style={sw(180)}>
              <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </SField>
            <SField label="Reason" req style={sw(250)}>
              <select style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)}>
                {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </SField>
          </SRow>
        </SheetSection>
        <SheetSection icon="chat" title="Claim" color="#7c3aed">
          <SField label="What does the customer dispute?" req>
            <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </SField>
        </SheetSection>
      </SheetBody>
    </FormSheet>
  )
}

function ResolveDialog({ dispute, onClose, onDone }: { dispute: ARDispute; onClose: () => void; onDone: () => void }) {
  const [resolution, setResolution] = useState<'credit_note' | 'write_off' | 'paid'>('credit_note')
  const [note, setNote] = useState('')
  const [notes, setNotes] = useState<{ id: number; note_number: string; status: string; total_amount: number; ar_transaction_id?: number | null }[]>([])
  const [noteId, setNoteId] = useState('')
  const [error, setError] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    accountsApi.listNotes({ note_type: 'credit_note', customer_id: dispute.customer_id })
      .then((d: { id: number; note_number: string; status: string; total_amount: number; ar_transaction_id?: number | null }[]) =>
        setNotes((d || []).filter((n) => n.ar_transaction_id === dispute.ar_transaction_id && ['pending', 'posted'].includes(n.status))))
      .catch(() => setNotes([]))
  }, [dispute.customer_id, dispute.ar_transaction_id])

  async function save() {
    setError(null)
    setSaving(true)
    try {
      await accountsApi.resolveDispute(dispute.id, { resolution, note, party_note_id: resolution === 'credit_note' && noteId ? Number(noteId) : undefined })
      onDone()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not resolve ${dispute.dispute_number}.`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet width={580} tour="fin-disp-resolve-dialog" icon="check" iconColor="#16a34a" title={`Resolve ${dispute.dispute_number}`} subtitle={`${inr(dispute.disputed_amount)} disputed on ${dispute.invoice_number} · ${dispute.customer_name}`} onClose={onClose} busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Resolve" color="#16a34a" />}>
      <SheetBody>
        <SheetError error={error} />
        <SheetSection icon="check" title="Resolution" color="#16a34a">
          <SField label="Resolution" req style={{ marginBottom: 14 }}>
            <select style={sheetInput} value={resolution} onChange={(e) => setResolution(e.target.value as 'credit_note' | 'write_off' | 'paid')}>
              <option value="credit_note">Credit note given (GST reversed by the note)</option>
              <option value="write_off">Write off the disputed amount (no GST change)</option>
              <option value="paid">Claim withdrawn — customer pays in full</option>
            </select>
          </SField>
          {resolution === 'credit_note' && (
            <SField label="Credit note against this invoice" style={{ marginBottom: 14 }}>
              <select style={sheetInput} value={noteId} onChange={(e) => setNoteId(e.target.value)}>
                <option value="">{notes.length ? 'Pick the credit note' : 'None yet — raise it in Finance › Sales › Credit Notes first'}</option>
                {notes.map((n) => <option key={n.id} value={n.id}>{n.note_number} — {inr(n.total_amount)} ({n.status})</option>)}
              </select>
            </SField>
          )}
          {resolution === 'write_off' && (
            <p style={{ fontSize: 12.5, color: SHEET.BODY, margin: '0 0 14px', lineHeight: 1.6 }}>
              Posts Dr deduction ledger / Cr Debtors for the disputed amount (up to what is still due). Above the small-difference tolerance in Finance › Settings only a Finance Manager can do this.
              A reduction of the taxable value (price/rate) should go by credit note instead, so GST is reversed.
            </p>
          )}
          <SField label="Resolution note" req>
            <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} />
          </SField>
        </SheetSection>
      </SheetBody>
    </FormSheet>
  )
}
