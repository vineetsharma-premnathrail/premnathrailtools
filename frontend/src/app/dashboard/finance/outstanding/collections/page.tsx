'use client'

/** Collections & Dunning (SAP FSCM Collections + F150): worklist of overdue
 *  customers by priority, contact log with promises to pay, the dunning run
 *  and its reminder letters (managed Word documents). Disputed amounts are
 *  left out everywhere on this page. */
import { Fragment, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { CollectionNote, CollectionOverdueItem, CollectionWorklistRow, DunningLetter, DunningProposalCustomer } from '@/types'
import { TEXT, BRAND } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import FinanceNav from '@/components/finance/FinanceNav'
import OutstandingSubNav from '@/components/finance/OutstandingSubNav'
import DunningLetterDoc from '@/components/finance/DunningLetterDoc'
import DateField from '@/components/erp/DateField'
import { FormSheet, SheetColumns, SheetSection, SHEET, sheetInput, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SRow, SheetBody, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import {
  sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, ErrorBanner, InfoBanner, StatusPill, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'

const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_HEX: Record<string, string> = { high: '#dc2626', medium: '#f59e0b', low: '#22c55e' }
const PROMISE_LABELS: Record<string, string> = { open: 'Open', kept: 'Kept', broken: 'Broken', cancelled: 'Cancelled' }
const PROMISE_HEX: Record<string, string> = { open: '#2563eb', kept: '#16a34a', broken: '#dc2626', cancelled: '#78716c' }
const LETTER_LABELS: Record<string, string> = { issued: 'Issued', cancelled: 'Cancelled' }
const LETTER_HEX: Record<string, string> = { issued: '#0f766e', cancelled: '#78716c' }
const NOTE_TYPES: Record<string, string> = {
  call: 'Phone call', email: 'E-mail', visit: 'Visit / meeting', promise_to_pay: 'Promise to pay', reminder_sent: 'Reminder letter sent', note: 'Note',
}

export default function CollectionsPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { canFeature } = useCan()
  const seeDunning = canFeature('accounts', 'collections', 'dunning', 'view')
  const [rows, setRows] = useState<CollectionWorklistRow[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<CollectionWorklistRow | null>(null)
  const [showRun, setShowRun] = useState(false)
  const [reload, setReload] = useState(0)
  const [letters, setLetters] = useState<DunningLetter[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    // Reminder letters are the Dunning feature — skip the call for a role without it.
    Promise.all([accountsApi.collectionsWorklist(), seeDunning ? accountsApi.dunningLetters() : Promise.resolve([])])
      .then(([w, l]: [{ rows: CollectionWorklistRow[]; totals: Record<string, number> }, DunningLetter[]]) => {
        setRows(w.rows || []); setTotals(w.totals || {}); setLetters(l || []); setError(null)
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the collections worklist.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, reload, seeDunning])

  if (isLoading || !isAuthorized) return null
  const canCreate = canFeature('accounts', 'collections', 'dunning', 'create')

  return (
    <div>
      <FinanceNav />
      <PageHeader
        title="Collections & Dunning"
        subtitle="Overdue customers ranked by priority (amount × age, broken promises), the contact log with promises to pay, and reminder letters."
        actions={canCreate ? <button data-tour="fin-coll-run" style={primaryBtnStyle} onClick={() => setShowRun(true)}>Dunning run</button> : undefined}
      />
      <OutstandingSubNav />
      <InfoBanner>
        Only the <b>undisputed</b> overdue amount is chased here — open disputes (Outstanding › Disputes) are left out of the worklist and of reminder letters.
        Reminder levels and the minimum amount are set in Finance › Settings › Collections &amp; dunning.
      </InfoBanner>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Overdue (undisputed)" value={inr(totals.overdue_amount ?? 0)} tone={(totals.overdue_amount ?? 0) > 0 ? '#b91c1c' : undefined} />
        <StatCard label="Customers to chase" value={String(totals.customers ?? 0)} />
        <StatCard label="High priority" value={String(totals.high ?? 0)} tone={(totals.high ?? 0) > 0 ? '#b91c1c' : undefined} />
        <StatCard label="Disputed (not chased)" value={inr(totals.disputed ?? 0)} tone="#7c3aed" />
      </div>

      <TableWrap minWidth={1200} maxHeight={selected ? '360px' : undefined} tour="fin-coll-worklist">
        <thead>
          <tr>
            <th style={thStyle}>Priority</th><th style={thStyle}>Customer</th><th style={numTh}>Overdue (₹)</th><th style={numTh}>Invoices</th>
            <th style={numTh}>Oldest (days)</th><th style={numTh}>Level</th><th style={thStyle}>Last contact</th>
            <th style={thStyle}>Promise to pay</th><th style={thStyle}>Next follow-up</th><th style={numTh}>Broken promises</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={10} text="Loading…" />
            : rows.length === 0 ? <EmptyRow colSpan={10} text="No customer has an undisputed overdue invoice." />
            : rows.map((r) => {
              const active = selected?.customer_id === r.customer_id
              return (
                <tr key={r.customer_id} onClick={() => setSelected(active ? null : r)} style={{ cursor: 'pointer', background: active ? `${BRAND.primary}14` : undefined }}>
                  <td style={tdStyle}><StatusPill status={r.priority} labels={PRIORITY_LABELS} colors={PRIORITY_HEX} /></td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.customer_name}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: '#b91c1c' }}>{inr(r.overdue_amount)}</td>
                  <td style={numTd}>{r.invoices}</td>
                  <td style={numTd}>{r.max_days_overdue}</td>
                  <td style={numTd}>{r.max_dunning_level || '—'}</td>
                  <td style={tdStyle}>{r.last_contact_date ? `${dmy(r.last_contact_date)} · ${NOTE_TYPES[r.last_contact_type || ''] || r.last_contact_type}` : '—'}</td>
                  <td style={tdStyle}>{r.open_promise_date ? `${inr(r.open_promise_amount ?? 0)} by ${dmy(r.open_promise_date)}` : '—'}</td>
                  <td style={tdStyle}>{r.next_follow_up ? dmy(r.next_follow_up) : '—'}</td>
                  <td style={{ ...numTd, color: r.broken_promises ? '#b91c1c' : TEXT.muted }}>{r.broken_promises || '—'}</td>
                </tr>
              )
            })}
        </tbody>
      </TableWrap>

      {selected && (
        <CustomerPanel key={`${selected.customer_id}-${reload}`} customerId={selected.customer_id} customerName={selected.customer_name}
          onClose={() => setSelected(null)} onChanged={() => setReload((k) => k + 1)} />
      )}

      {seeDunning && (
        <div style={sectionStyle} data-tour="fin-coll-letters">
          <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 10px' }}>Reminder letters</h2>
          <LettersTable letters={letters} onChanged={() => setReload((k) => k + 1)} />
        </div>
      )}

      {showRun && <DunningRunDialog onClose={() => setShowRun(false)} onDone={() => { setShowRun(false); setReload((k) => k + 1) }} />}
    </div>
  )
}

function LettersTable({ letters, onChanged }: { letters: DunningLetter[]; onChanged: () => void }) {
  const { canFeature } = useCan()
  const [open, setOpen] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState<DunningLetter | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const canEdit = canFeature('accounts', 'collections', 'dunning', 'edit')
  const canCancel = canFeature('accounts', 'collections', 'dunning', 'cancel')

  return (
    <>
      <ErrorBanner error={error} />
      <TableWrap minWidth={900} maxHeight="420px">
        <thead>
          <tr>
            <th style={thStyle}>Letter</th><th style={thStyle}>Customer</th><th style={thStyle}>Date</th><th style={numTh}>Level</th>
            <th style={numTh}>Overdue (₹)</th><th style={numTh}>Invoices</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {letters.length === 0 ? <EmptyRow colSpan={8} text="No reminder letters yet — run dunning to issue them." />
            : letters.map((l) => (
              <Fragment key={l.id}>
                <tr>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{l.letter_number}</td>
                  <td style={tdStyle}>{l.customer_name || '—'}</td>
                  <td style={tdStyle}>{dmy(l.letter_date)}</td>
                  <td style={numTd}>{l.dunning_level}</td>
                  <td style={numTd}>{inr(l.total_overdue)}</td>
                  <td style={numTd}>{l.items.length}</td>
                  <td style={tdStyle}><StatusPill status={l.status} labels={LETTER_LABELS} colors={LETTER_HEX} /></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <button style={linkBtnStyle} onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide' : 'Letter'}</button>
                    {canCancel && l.status === 'issued' && <> · <button style={dangerLinkStyle} onClick={() => setCancelling(l)}>Cancel</button></>}
                  </td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={8} style={{ ...tdStyle, background: 'rgba(15,118,110,0.03)' }}>
                      {l.status === 'cancelled' && <div style={{ fontSize: 12.5, color: TEXT.secondary }}>Cancelled: {l.cancelled_reason}</div>}
                      <DunningLetterDoc letter={l} canModify={canEdit} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
        </tbody>
      </TableWrap>
      <ReasonSheet open={!!cancelling} icon="x" title={`Cancel ${cancelling?.letter_number ?? ''}?`}
        message="Only cancel a letter that was not sent. Each invoice goes back to the reminder level it had before."
        placeholder="Reason (e.g. payment received before sending)" confirmLabel="Cancel letter" danger requireValue
        onCancel={() => setCancelling(null)}
        onConfirm={(reason) => {
          const l = cancelling
          setCancelling(null)
          if (!l) return
          accountsApi.cancelDunningLetter(l.id, reason).then(onChanged)
            .catch((err: unknown) => setError(extractErrorMessages(err, `Could not cancel ${l.letter_number}.`)))
        }} />
    </>
  )
}

function CustomerPanel({ customerId, customerName, onClose, onChanged }: { customerId: number; customerName: string; onClose: () => void; onChanged: () => void }) {
  const { can, canFeature } = useCan()
  const [items, setItems] = useState<CollectionOverdueItem[]>([])
  const [notes, setNotes] = useState<CollectionNote[]>([])
  const [letters, setLetters] = useState<DunningLetter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [showNote, setShowNote] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    accountsApi.collectionsCustomer(customerId)
      .then((d: { overdue_items: CollectionOverdueItem[]; notes: CollectionNote[]; letters: DunningLetter[] }) => {
        setItems(d.overdue_items || []); setNotes(d.notes || []); setLetters(d.letters || [])
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, `Could not load ${customerName}.`)))
      .finally(() => setLoading(false))
  }, [customerId, customerName, reload])

  const sub: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: TEXT.heading, margin: '4px 0 10px' }
  const canCreate = can('accounts', 'collections', 'create')
  const canEdit = can('accounts', 'collections', 'edit')

  return (
    <div style={sectionStyle} data-tour="fin-coll-customer">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{customerName}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && <button style={primaryBtnStyle} onClick={() => setShowNote(true)}>Log contact / promise</button>}
          <button style={secondaryBtnStyle} onClick={onClose}>Close</button>
        </div>
      </div>
      <ErrorBanner error={error} />

      <div style={sub}>Overdue invoices</div>
      <TableWrap minWidth={820} maxHeight="280px">
        <thead>
          <tr>
            <th style={thStyle}>Invoice</th><th style={thStyle}>Date</th><th style={thStyle}>Due</th><th style={numTh}>Days overdue</th>
            <th style={numTh}>Due (₹)</th><th style={numTh}>Disputed (₹)</th><th style={numTh}>To collect (₹)</th><th style={numTh}>Level</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={8} text="Loading…" />
            : items.length === 0 ? <EmptyRow colSpan={8} text="Nothing overdue." />
            : items.map((i) => (
              <tr key={i.ar_transaction_id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{i.invoice_number}</td>
                <td style={tdStyle}>{dmy(i.invoice_date)}</td>
                <td style={tdStyle}>{dmy(i.due_date)}</td>
                <td style={{ ...numTd, color: '#b91c1c' }}>{i.days_overdue}</td>
                <td style={numTd}>{inr(i.amount_due)}</td>
                <td style={{ ...numTd, color: '#7c3aed' }}>{inr(i.disputed, { blankZero: true })}</td>
                <td style={{ ...numTd, fontWeight: 700 }}>{inr(i.undisputed_due)}</td>
                <td style={numTd}>{i.dunning_level || '—'}</td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      <div style={sub}>Contact log</div>
      <TableWrap minWidth={980} maxHeight="320px">
        <thead>
          <tr>
            <th style={thStyle}>Date</th><th style={thStyle}>Type</th><th style={thStyle}>Contact</th><th style={thStyle}>Notes</th>
            <th style={thStyle}>Promise</th><th style={thStyle}>Follow-up</th><th style={thStyle}>By</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {notes.length === 0 ? <EmptyRow colSpan={8} text="No contact logged yet." />
            : notes.map((n) => (
              <tr key={n.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(n.note_date)}</td>
                <td style={tdStyle}>{NOTE_TYPES[n.note_type] || n.note_type}</td>
                <td style={tdStyle}>{n.contact_person || '—'}</td>
                <td style={tdStyle}>{n.remarks}{n.invoice_number && <div style={{ fontSize: 11.5, color: TEXT.muted }}>Invoice {n.invoice_number}</div>}</td>
                <td style={tdStyle}>
                  {n.note_type === 'promise_to_pay' ? (
                    <>
                      {inr(n.promised_amount ?? 0)} by {dmy(n.promised_date)}{' '}
                      {n.promise_status && <StatusPill status={n.promise_status} labels={PROMISE_LABELS} colors={PROMISE_HEX} />}
                      {n.promise_received != null && n.promise_status !== 'open' && <div style={{ fontSize: 11.5, color: TEXT.muted }}>received {inr(n.promise_received)}</div>}
                    </>
                  ) : '—'}
                </td>
                <td style={tdStyle}>{n.follow_up_date ? dmy(n.follow_up_date) : '—'}</td>
                <td style={tdStyle}>{n.created_by_name || '—'}</td>
                <td style={tdStyle}>
                  {canEdit && n.promise_status === 'open' && (
                    <button style={dangerLinkStyle} onClick={() => accountsApi.cancelPromise(n.id).then(() => { setReload((k) => k + 1); onChanged() })
                      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not cancel the promise.')))}>Cancel promise</button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      {letters.length > 0 && canFeature('accounts', 'collections', 'dunning', 'view') && (
        <>
          <div style={sub}>Reminder letters to this customer</div>
          <LettersTable letters={letters} onChanged={() => { setReload((k) => k + 1); onChanged() }} />
        </>
      )}

      {showNote && <NoteDialog customerId={customerId} customerName={customerName} invoices={items}
        onClose={() => setShowNote(false)} onDone={() => { setShowNote(false); setReload((k) => k + 1); onChanged() }} />}
    </div>
  )
}

function NoteDialog({ customerId, customerName, invoices, onClose, onDone }: {
  customerId: number; customerName: string; invoices: CollectionOverdueItem[]; onClose: () => void; onDone: () => void
}) {
  const [noteType, setNoteType] = useState('call')
  const [noteDate, setNoteDate] = useState(todayIso())
  const [contact, setContact] = useState('')
  const [remarks, setRemarks] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [promisedDate, setPromisedDate] = useState('')
  const [promisedAmount, setPromisedAmount] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [error, setError] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const promise = noteType === 'promise_to_pay'

  async function save() {
    setError(null)
    if (!remarks.trim()) { setError(['Write what was discussed.']); return }
    if (promise && (!promisedDate || !Number(promisedAmount))) { setError(['A promise to pay needs the promised date and amount.']); return }
    setSaving(true)
    try {
      await accountsApi.addCollectionNote({
        customer_id: customerId, note_type: noteType, note_date: noteDate || undefined, contact_person: contact || undefined,
        remarks, ar_transaction_id: invoiceId ? Number(invoiceId) : undefined,
        promised_date: promise ? promisedDate : undefined, promised_amount: promise ? Number(promisedAmount) : undefined,
        follow_up_date: followUp || undefined,
      })
      onDone()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the contact.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet width={960} tour="fin-coll-note-dialog" icon="chat" title="Log contact" subtitle={customerName} onClose={onClose} busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Save" />}>
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="chat" title="Contact">
            <SRow>
              <SField label="Type" req style={sw(190)}>
                <select style={sheetInput} value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                  {Object.entries(NOTE_TYPES).filter(([k]) => k !== 'reminder_sent').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </SField>
              <SField label="Date" style={sw(160)}><DateField value={noteDate} onChange={setNoteDate} /></SField>
            </SRow>
            <SRow>
              <SField label="Spoke to" optional style={sg(180, 280)}>
                <input style={sheetInput} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name / designation" />
              </SField>
              <SField label="Invoice" optional style={sg(200, 300)}>
                <select style={sheetInput} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                  <option value="">Whole account</option>
                  {invoices.map((i) => <option key={i.ar_transaction_id} value={i.ar_transaction_id}>{i.invoice_number} — {inr(i.undisputed_due)}</option>)}
                </select>
              </SField>
            </SRow>
            <SField label="What was said" req>
              <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </SField>
          </SheetSection>
        </>}
        right={<>
          {promise && (
            <SheetSection icon="rupee" title="Promise to pay">
              <SRow mb={0}>
                <SField label="Promised date" req style={sw(160)}><DateField value={promisedDate} onChange={setPromisedDate} /></SField>
                <SField label="Promised amount (₹)" req style={sw(170)}>
                  <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={promisedAmount} onChange={(e) => setPromisedAmount(e.target.value)} />
                </SField>
              </SRow>
              <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '10px 0 0' }}>Checked against receipts after its date: kept if the amount came in, otherwise broken (you are reminded).</p>
            </SheetSection>
          )}
          <SheetSection icon="calendar" title="Follow-up">
            <SField label="Follow-up date" optional style={{ maxWidth: 200 }} hint={promise ? 'Blank = the promised date.' : undefined}>
              <DateField value={followUp} onChange={setFollowUp} />
            </SField>
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}

function DunningRunDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [customers, setCustomers] = useState<DunningProposalCustomer[]>([])
  const [thresholds, setThresholds] = useState<number[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    accountsApi.dunningProposal()
      .then((d: { customers: DunningProposalCustomer[]; thresholds: number[] }) => {
        setCustomers(d.customers || []); setThresholds(d.thresholds || [])
        setPicked(new Set((d.customers || []).map((c) => c.customer_id)))
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not build the dunning proposal.')))
      .finally(() => setLoading(false))
  }, [])

  async function run() {
    setError(null)
    if (!picked.size) { setError(['Tick at least one customer.']); return }
    setRunning(true)
    try {
      await accountsApi.runDunning({ customer_ids: Array.from(picked) })
      onDone()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'The dunning run failed.'))
    } finally {
      setRunning(false)
    }
  }

  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <FormSheet width={960} tour="fin-coll-run-dialog" icon="send" title="Dunning run — today"
      subtitle="One reminder letter per ticked customer; each invoice's reminder level is raised." onClose={onClose} busy={running}
      footer={<SheetFooter onCancel={onClose} cancelLabel="Close" onSubmit={run} busy={running} busyLabel="Issuing…" icon="send"
        label={`Issue ${picked.size} letter${picked.size === 1 ? '' : 's'}`} disabled={!customers.length} />}>
      <SheetBody>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: SHEET.BODY, lineHeight: 1.6 }}>
          Customers with an invoice whose reminder level goes up today
          {thresholds.length === 3 && <> (level 1 after {thresholds[0]} days overdue, level 2 after {thresholds[1]}, final notice after {thresholds[2]})</>}.
        </p>
        <SheetError error={error} />
        <SheetSection icon="users" title="Customers to remind" extra={<span style={{ fontSize: 12, color: SHEET.MUTED }}>{picked.size} of {customers.length} ticked</span>}>
          <TableWrap minWidth={700} maxHeight="55vh">
            <thead>
              <tr><th style={thStyle}></th><th style={thStyle}>Customer</th><th style={numTh}>Letter level</th><th style={numTh}>Overdue (₹)</th><th style={thStyle}>Invoices (level now → new)</th></tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={5} text="Building proposal…" />
                : customers.length === 0 ? <EmptyRow colSpan={5} text="No reminder is due today." />
                : customers.map((c) => (
                  <tr key={c.customer_id}>
                    <td style={tdStyle}><input type="checkbox" checked={picked.has(c.customer_id)} onChange={() => toggle(c.customer_id)} /></td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{c.customer_name}</td>
                    <td style={numTd}>{c.level}</td>
                    <td style={numTd}>{inr(c.total_overdue)}</td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      {c.items.map((i) => `${i.invoice_number} (${i.previous_level}→${i.level})`).join(', ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
        </SheetSection>
      </SheetBody>
    </FormSheet>
  )
}
