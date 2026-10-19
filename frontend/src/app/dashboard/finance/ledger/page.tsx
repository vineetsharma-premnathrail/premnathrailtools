'use client'

/** Journals — manual journal vouchers (draft → posted by another user),
 *  the Day Book, ledger statements and month-end period close. */
import { Fragment, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, costCentersApi, crmApi } from '@/lib/api'
import { CostCenter, DayBook, GLAccount, GLLedger, InternalOrder, JournalEntry, Organization, PeriodClose, Vendor } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import ReasonSheet from '@/components/shared/ReasonSheet'
import {
  FormSheet, FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint,
} from '@/components/shared/FormSheet'
import {
  inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso, currentPeriod, fyStartIso,
  Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader, TableWrap, EmptyRow, StatCard, ledgerOptions,
  ApprovalBadge, submitAfterSave,
} from '@/components/finance/financeUi'
import { recordHref, useRecordId } from '@/lib/recordRef'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { STATUS_LABELS, STATUS_HEX, VOUCHER_LABELS, POSTING_LABELS, VOUCHER_PATH } from '@/components/finance/voucherLabels'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const TABS = ['Journal Vouchers', 'Day Book', 'Ledger Statement', 'Period Close'] as const
type Tab = (typeof TABS)[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. */
const TAB_KEYS: Record<Tab, string> = {
  'Journal Vouchers': 'journal_vouchers', 'Day Book': 'day_book', 'Ledger Statement': 'ledger_statement', 'Period Close': 'period_close',
}

const MANUAL_TYPES = ['adjustment', 'accrual', 'correction', 'depreciation'] as const

/** + = Dr, − = Cr (assets/expenses are naturally Dr, liabilities/income Cr). */
function drcr(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) < 0.005) return '0.00'
  return `${inr(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`
}

function monthStartIso(): string {
  return `${todayIso().slice(0, 7)}-01`
}

/** 1st of the month after the given ISO date — when an accrual reverses. */
function firstOfNextMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

function periodLabel(p: string): string {
  const [y, m] = p.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })
}

type Masters = {
  ledgers: GLAccount[]
  vendors: Vendor[]
  customers: Organization[]
  costCenters: CostCenter[]
}

export default function FinanceJournalsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs: visibleTabs, tab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const { can, canFeature } = useCan()
  const [masters, setMasters] = useState<Masters>({ ledgers: [], vendors: [], customers: [], costCenters: [] })
  const [mastersError, setMastersError] = useState<string[] | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([
      accountsApi.listGLAccounts({ status: 'active' }),
      accountsApi.listVendors({ status: 'active' }),
      crmApi.listOrganizations({ picker: true }),
      costCentersApi.listCostCenters(),
    ])
      .then(([ledgers, vendors, customers, costCenters]) => setMasters({ ledgers, vendors, customers, costCenters }))
      .catch((err) => setMastersError(extractErrorMessages(err, 'Could not load ledgers, parties and cost centres for the journal form.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Journals" subtitle="Manual journal vouchers, the day book of every voucher, ledger statements and month-end period close." />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      <ErrorBanner error={mastersError} />
      {tab === 'Journal Vouchers' && <JournalVouchers masters={masters} userId={user?.id ?? null} canReverse={(!!user?.is_finance_manager || user?.role === 'admin') && canFeature('accounts', 'journal_vouchers', 'reversal', 'cancel')} />}
      {tab === 'Day Book' && <DayBookTab />}
      {tab === 'Ledger Statement' && <LedgerStatementTab ledgers={masters.ledgers} />}
      {tab === 'Period Close' && <PeriodCloseTab canClose={can('accounts', 'period_close', 'approve')} closesDirectly={!!user?.is_finance_manager || user?.role === 'admin'} isAdmin={user?.role === 'admin'} />}
    </div>
  )
}

// ─── Journal vouchers ─────────────────────────────────────────────────

type LineRow = {
  key: string; gl_account_id: string; debit: string; credit: string; cost_center_id: string; internal_order_id: string
  party: string /* 'v:<id>' | 'c:<id>' | '' */; remarks: string
}
function emptyLine(): LineRow {
  return { key: Math.random().toString(36).slice(2), gl_account_id: '', debit: '', credit: '', cost_center_id: '', internal_order_id: '', party: '', remarks: '' }
}

function JournalVouchers({ masters, userId, canReverse }: { masters: Masters; userId: number | null; canReverse: boolean }) {
  const { vendors, customers } = masters
  const { can, canDelete } = useCan()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  // Other Finance pages link here with ?entry=<signed journal ref> — open that voucher.
  const [entryRef] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('entry')))
  const { id: entryId, error: entryLinkError } = useRecordId(entryRef)
  const [expanded, setExpanded] = useState<number | null>(null)
  // Expand the linked voucher once its ref resolves (state adjusted during render, not in an effect).
  const [openedEntry, setOpenedEntry] = useState<number | null>(null)
  if (entryId && entryId !== openedEntry) { setOpenedEntry(entryId); setExpanded(entryId) }
  const [filters, setFilters] = useState({ status: '', voucher_type: '', posting_type: '', from_date: '', to_date: '' })
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [postTarget, setPostTarget] = useState<JournalEntry | null>(null)
  const [discardTarget, setDiscardTarget] = useState<JournalEntry | null>(null)
  const [reverseTarget, setReverseTarget] = useState<JournalEntry | null>(null)
  const router = useRouter()
  const [lookupNo, setLookupNo] = useState('')
  const [lookingUp, setLookingUp] = useState(false)

  // FB03: open one voucher by its number.
  const openByNumber = async () => {
    if (!lookupNo.trim()) return
    setLookingUp(true)
    setError(null)
    try {
      const je: JournalEntry = await accountsApi.getJournalEntryByNumber(lookupNo.trim())
      router.push(recordHref(VOUCHER_PATH, je, 'id', undefined, 'entry'))
    } catch (err) {
      setError(extractErrorMessages(err, `Could not open voucher ${lookupNo.trim()}.`))
      setLookingUp(false)
    }
  }

  const load = () => {
    setLoading(true)
    const params: Record<string, string> = {}
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v })
    accountsApi.listJournalEntries(params)
      .then((rows: JournalEntry[]) => { setEntries(rows); setError(null) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load journal entries.')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  const vendorName = (id?: number | null) => vendors.find((v) => v.id === id)?.name
  const customerName = (id?: number | null) => customers.find((c) => c.id === id)?.name

  const runAction = async (je: JournalEntry, fn: () => Promise<unknown>, ctx: string) => {
    setBusyId(je.id)
    setError(null)
    try {
      await fn()
      load()
    } catch (err) {
      setError(extractErrorMessages(err, ctx))
    } finally {
      setBusyId(null)
    }
  }

  const setF = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }))

  if (entryLinkError) return <InvalidRecordLink message={entryLinkError} listHref="/dashboard/finance/ledger" listLabel="Back to journals" />

  // Creating a journal replaces the list with the voucher form ("← Back" returns to the list).
  if (showForm) {
    return <JournalForm masters={masters} onCancel={() => setShowForm(false)} onCreated={(warning) => { setShowForm(false); load(); if (warning) setError([warning]) }} />
  }

  return (
    <>
      <InfoBanner>
        Manual journals are <strong>drafted by one user and posted by another</strong> (maker-checker) — the second pair of eyes is the
        control against errors and fraud. A posted entry&apos;s amounts and ledgers are never edited or deleted; it is <strong>reversed</strong>
        with a reason and, if needed, re-entered correctly. Only its narration and line remarks can be changed (Open voucher → Change), and
        each change is logged.
      </InfoBanner>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <form data-tour="fin-jv-open-voucher" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }} onSubmit={(ev) => { ev.preventDefault(); openByNumber() }}>
            <Field label="Open voucher no." style={{ flex: '0 1 220px' }}>
              <input style={inputStyle} value={lookupNo} onChange={(ev) => setLookupNo(ev.target.value)} placeholder="e.g. JV/2026-27/0001" />
            </Field>
            <button type="submit" style={{ ...secondaryBtnStyle, marginBottom: 1 }} disabled={!lookupNo.trim() || lookingUp}>{lookingUp ? 'Opening…' : 'Open'}</button>
          </form>
          {can('accounts', 'journal_vouchers', 'create') && <button type="button" data-tour="fin-jv-new-btn" style={primaryBtnStyle} onClick={() => setShowForm(true)}>+ New Journal</button>}
      </div>

      <div data-tour="fin-jv-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Status" style={{ flex: '0 1 140px' }} tour="fin-jv-status">
          <select style={inputStyle} value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Voucher Type" style={{ flex: '0 1 150px' }} tour="fin-jv-voucher-type">
          <select style={inputStyle} value={filters.voucher_type} onChange={(e) => setF({ voucher_type: e.target.value })}>
            <option value="">All</option>
            {Object.entries(VOUCHER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Posting Type" style={{ flex: '0 1 160px' }} tour="fin-jv-posting-type">
          <select style={inputStyle} value={filters.posting_type} onChange={(e) => setF({ posting_type: e.target.value })}>
            <option value="">All</option>
            {Object.entries(POSTING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="From" style={{ flex: '0 1 150px' }} tour="fin-jv-from"><DateField value={filters.from_date} onChange={(v) => setF({ from_date: v })} /></Field>
        <Field label="To" style={{ flex: '0 1 150px' }} tour="fin-jv-to"><DateField value={filters.to_date} onChange={(v) => setF({ to_date: v })} /></Field>
        {Object.values(filters).some(Boolean) && (
          <button type="button" style={{ ...secondaryBtnStyle, marginBottom: 2 }} onClick={() => setFilters({ status: '', voucher_type: '', posting_type: '', from_date: '', to_date: '' })}>Clear</button>
        )}
      </div>

      <TableWrap minWidth={1150} tour="fin-jv-table">
        <thead>
          <tr>
            <th style={thStyle}>Entry No.</th>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Voucher</th>
            <th style={thStyle}>Posting Type</th>
            <th style={thStyle}>Description</th>
            <th style={numTh}>Amount (₹)</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Created / Posted By</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading && <EmptyRow colSpan={9} text="Loading…" />}
          {!loading && entries.length === 0 && <EmptyRow colSpan={9} text="No journal entries match these filters." />}
          {!loading && entries.map((e) => {
            const isMaker = userId != null && e.created_by_id === userId
            const busy = busyId === e.id
            return (
              <Fragment key={e.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <span style={{ color: TEXT.muted, marginRight: 6 }}>{expanded === e.id ? '▾' : '▸'}</span>
                    {e.status === 'draft' ? 'Draft' : e.entry_number}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(e.posting_date)}</td>
                  <td style={tdStyle}>{VOUCHER_LABELS[e.voucher_type] || e.voucher_type}</td>
                  <td style={tdStyle}>
                    {POSTING_LABELS[e.posting_type] || e.posting_type}
                    {e.auto_reverse_on && <div style={{ fontSize: 11, color: TEXT.muted }}>auto-reverses {dmy(e.auto_reverse_on)}</div>}
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 320 }}>
                    {e.description || '—'}
                    {e.reversal_reason && <div style={{ fontSize: 11, color: '#b45309' }}>Reversed {dmy(e.reversal_date)}: {e.reversal_reason}</div>}
                  </td>
                  <td style={numTd}>{inr(e.total_debit)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <StatusPill status={e.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                      {e.status === 'draft' && <ApprovalBadge status={e.approval_status} stage={e.approval_stage} />}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    <div>{e.created_by_name || '—'}</div>
                    {e.posted_by_name && <div style={{ color: TEXT.muted }}>posted: {e.posted_by_name}</div>}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                    {e.status === 'draft' && (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        {e.approval_status !== 'pending' && can('accounts', 'journal_vouchers', 'submit') && (
                          <button type="button" style={linkBtnStyle} disabled={busy} onClick={() => runAction(e, () => accountsApi.submitJournalEntry(e.id), 'Could not submit the journal for approval.')}>Submit for approval</button>
                        )}
                        {isMaker ? (
                          <span style={{ fontSize: 11, color: TEXT.muted }} title="Posted by another finance user (maker-checker)">Awaiting another user</span>
                        ) : can('accounts', 'journal_vouchers', 'approve') && (
                          <button type="button" style={linkBtnStyle} disabled={busy} onClick={() => setPostTarget(e)}>Post</button>
                        )}
                        {canDelete('accounts', 'journal_vouchers', e.created_by_id ?? null) && <button type="button" style={dangerLinkStyle} disabled={busy} onClick={() => setDiscardTarget(e)}>Discard</button>}
                      </div>
                    )}
                    {e.status === 'posted' && (() => {
                      const blocked = reverseBlockedReason(e, canReverse)
                      return blocked
                        ? <span style={{ fontSize: 11, color: TEXT.muted }} title={blocked}>{e.reverses_journal_entry_id ? 'Reversal entry' : !canReverse ? 'Finance Manager reverses' : 'Correct via source'}</span>
                        : <button type="button" style={dangerLinkStyle} disabled={busy} onClick={() => setReverseTarget(e)}>Reverse</button>
                    })()}
                  </td>
                </tr>
                {expanded === e.id && (
                  <tr>
                    <td colSpan={9} style={{ ...tdStyle, background: 'rgba(255,255,255,.45)', padding: '8px 12px 14px 34px' }}>
                      {e.status !== 'draft' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                          <Link href={recordHref(VOUCHER_PATH, e, 'id', undefined, 'entry')} style={{ ...linkBtnStyle, textDecoration: 'none' }}>Open voucher →</Link>
                        </div>
                      )}
                      {e.status === 'draft' && isMaker && (
                        <div style={{ fontSize: 11.5, color: TEXT.muted, marginBottom: 6 }}>You drafted this journal — it must be posted by another finance user (maker-checker).</div>
                      )}
                      {e.status === 'draft' && <ApprovalPanel entityType="accounts_journal_entry" entityId={e.id} onChanged={() => load()} />}
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            {['Ledger', 'Cost Centre', 'Internal Order', 'Party', 'Remarks'].map((h) => <th key={h} style={{ ...thStyle, position: 'static', background: 'transparent', padding: '6px 10px' }}>{h}</th>)}
                            <th style={{ ...numTh, position: 'static', background: 'transparent', padding: '6px 10px' }}>Dr (₹)</th>
                            <th style={{ ...numTh, position: 'static', background: 'transparent', padding: '6px 10px' }}>Cr (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.lines.map((l) => (
                            <tr key={l.id}>
                              <td style={{ ...tdStyle, padding: '6px 10px' }}>{l.gl_account_code} — {l.gl_account_name}</td>
                              <td style={{ ...tdStyle, padding: '6px 10px' }}>{l.cost_center_name || '—'}</td>
                              <td style={{ ...tdStyle, padding: '6px 10px' }}>{l.internal_order_name || '—'}</td>
                              <td style={{ ...tdStyle, padding: '6px 10px' }}>
                                {l.vendor_id ? `Vendor: ${vendorName(l.vendor_id) || `#${l.vendor_id}`}` : l.customer_id ? `Customer: ${customerName(l.customer_id) || `#${l.customer_id}`}` : '—'}
                              </td>
                              <td style={{ ...tdStyle, padding: '6px 10px', color: TEXT.secondary }}>{l.remarks || ''}</td>
                              <td style={{ ...numTd, padding: '6px 10px' }}>{inr(l.debit_amount, { blankZero: true })}</td>
                              <td style={{ ...numTd, padding: '6px 10px' }}>{inr(l.credit_amount, { blankZero: true })}</td>
                            </tr>
                          ))}
                          <tr>
                            <td colSpan={4} style={{ ...tdStyle, padding: '6px 10px', fontWeight: 700 }}>Total</td>
                            <td style={{ ...numTd, padding: '6px 10px', fontWeight: 700 }}>{inr(e.total_debit)}</td>
                            <td style={{ ...numTd, padding: '6px 10px', fontWeight: 700 }}>{inr(e.total_credit)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </TableWrap>

      <ConfirmDialog
        open={!!postTarget}
        title="Post this journal?"
        message={postTarget ? `Posting gives it a JV number and updates every ledger on it (${inr(postTarget.total_debit)}). After posting it can only be corrected by reversal.` : ''}
        confirmLabel="Post Journal"
        danger={false}
        onConfirm={() => { const je = postTarget!; setPostTarget(null); runAction(je, () => accountsApi.postJournalEntry(je.id), 'Could not post the journal.') }}
        onCancel={() => setPostTarget(null)}
      />
      <ConfirmDialog
        open={!!discardTarget}
        title="Discard this draft?"
        message="The draft never reached the books, so discarding it leaves no ledger impact. It stays listed as Discarded for the audit trail."
        confirmLabel="Discard Draft"
        onConfirm={() => { const je = discardTarget!; setDiscardTarget(null); runAction(je, () => accountsApi.discardJournalEntry(je.id), 'Could not discard the draft journal.') }}
        onCancel={() => setDiscardTarget(null)}
      />
      <ReverseDialog key={reverseTarget?.id ?? 0}
        entry={reverseTarget}
        onCancel={() => setReverseTarget(null)}
        onConfirm={(reason, date) => {
          const je = reverseTarget!
          setReverseTarget(null)
          runAction(je, () => accountsApi.reverseJournalEntry(je.id, reason, date || undefined), `Could not reverse ${je.entry_number}.`)
        }}
      />
    </>
  )
}

// Mirrors the backend gate on POST /journal-entries/{id}/reverse.
function reverseBlockedReason(e: JournalEntry, canReverse: boolean): string | null {
  if (e.reverses_journal_entry_id) return 'This entry is itself a reversal — post a fresh journal if the original was right.'
  if (e.reference_document_type) return `Posted by a ${e.reference_document_type.replace(/_/g, ' ')} — correct it through that document (note, voucher cancel, depreciation run, valuation).`
  if (e.posting_type === 'year_end') return 'Year-end closing entry — use Reports > Year-end > Reopen.'
  if (e.posting_type === 'closing_stock') return 'Closing-stock entry — cancel the valuation under Finance > Inventory.'
  if (e.posting_type === 'asset_disposal') return 'Asset disposal — correct it on the asset under Finance > Assets.'
  if (!canReverse) return "Only a Finance Manager (or admin) whose role includes Journal Vouchers › Reverse posted journals can reverse a journal. Ask an admin to tick 'Finance Manager' on your user and grant that feature in your role."
  return null
}

function ReverseDialog({ entry, onCancel, onConfirm }: { entry: JournalEntry | null; onCancel: () => void; onConfirm: (reason: string, date: string) => void }) {
  const [reason, setReason] = useState('')
  const [date, setDate] = useState('')
  if (!entry) return null
  const RED = '#dc2626'
  return (
    <FormSheet tour="fin-jv-reverse-dialog" width={580} icon="undo" iconColor={RED} title={`Reverse ${entry.entry_number}?`}
      subtitle="A new journal with every Dr and Cr swapped is posted; the original stays in the books marked Reversed." onClose={onCancel} busy={false}
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim(), date)} style={sheetBtn('primary', RED, !reason.trim())}>
          <SheetIcon name="undo" size={16} />Reverse Entry
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <label style={sheetLabel}>Reason <Req /></label>
        <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this entry being reversed?" autoFocus />
        <label style={{ ...sheetLabel, marginTop: 14 }}>Reversal date <Optional /></label>
        <div style={{ maxWidth: 200 }}><DateField value={date} onChange={setDate} /></div>
        <p style={sheetHint}>Blank = today. Entries raised by an invoice, note or payment voucher must be corrected through that document instead.</p>
      </div>
    </FormSheet>
  )
}

function JournalForm({ masters, onCancel, onCreated }: { masters: Masters; onCancel: () => void; onCreated: (warning?: string) => void }) {
  const { can } = useCan()
  const { ledgers, vendors, customers, costCenters } = masters
  const [postingDate, setPostingDate] = useState(todayIso())
  const [postingType, setPostingType] = useState<(typeof MANUAL_TYPES)[number]>('adjustment')
  const [description, setDescription] = useState('')
  const [autoReverseOn, setAutoReverseOn] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine(), emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const ledgerOpts = ledgerOptions(ledgers)
  const ccOpts = [{ value: '', label: '— None —' }, ...costCenters.filter((c) => c.status === 'active').map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))]
  // Only released orders (Open / In progress) can take postings.
  const [orders, setOrders] = useState<InternalOrder[]>([])
  useEffect(() => {
    accountsApi.listInternalOrders().then((all: InternalOrder[]) => setOrders(all.filter((o) => o.status === 'open' || o.status === 'in_progress'))).catch(() => setOrders([]))
  }, [])
  const ioOpts = [{ value: '', label: '— None —' }, ...orders.map((o) => ({ value: String(o.id), label: `${o.code} — ${o.name}` }))]
  const partyOpts = [
    ...vendors.map((v) => ({ value: `v:${v.id}`, label: `Vendor · ${v.name}${v.code ? ` (${v.code})` : ''}` })),
    ...customers.map((c) => ({ value: `c:${c.id}`, label: `Customer · ${c.name}` })),
  ]
  const ledgerById = (id: string) => ledgers.find((a) => String(a.id) === id)

  const totalDr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const diff = Math.round((totalDr - totalCr) * 100) / 100
  const balanced = Math.abs(diff) < 0.005 && totalDr > 0

  const setLine = (key: string, patch: Partial<LineRow>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const changeType = (t: (typeof MANUAL_TYPES)[number]) => {
    setPostingType(t)
    if (t === 'accrual' && !autoReverseOn) setAutoReverseOn(firstOfNextMonth(postingDate))
    if (t !== 'accrual') setAutoReverseOn('')
  }

  const submit = async () => {
    setError(null)
    const used = lines.filter((l) => l.gl_account_id || Number(l.debit) || Number(l.credit))
    const missingParty = used.find((l) => ledgerById(l.gl_account_id)?.is_control_account && !l.party)
    if (missingParty) {
      const a = ledgerById(missingParty.gl_account_id)!
      setError([`${a.code} — ${a.name} is a party control account: pick the vendor or customer on that line so their ledger stays in step with the control account.`])
      return
    }
    const missingCo = used.find((l) => {
      const a = ledgerById(l.gl_account_id)
      return a?.cost_object_required && !a.default_cost_center_id && !l.cost_center_id && !l.internal_order_id
    })
    if (missingCo) {
      const a = ledgerById(missingCo.gl_account_id)!
      setError([`${a.code} — ${a.name} is an overhead ledger: pick the cost centre that bears this cost, or the internal order it is spent on.`])
      return
    }
    setSaving(true)
    try {
      const created: JournalEntry = await accountsApi.createJournalEntry({
        posting_date: postingDate,
        posting_type: postingType,
        description: description.trim() || null,
        auto_reverse_on: postingType === 'accrual' && autoReverseOn ? autoReverseOn : null,
        lines: used.map((l) => ({
          gl_account_id: Number(l.gl_account_id) || 0,
          debit_amount: Number(l.debit) || 0,
          credit_amount: Number(l.credit) || 0,
          cost_center_id: l.cost_center_id ? Number(l.cost_center_id) : null,
          internal_order_id: l.internal_order_id ? Number(l.internal_order_id) : null,
          vendor_id: l.party.startsWith('v:') ? Number(l.party.slice(2)) : null,
          customer_id: l.party.startsWith('c:') ? Number(l.party.slice(2)) : null,
          remarks: l.remarks.trim() || null,
        })),
      })
      // The draft goes straight to its approvers (Organization › Approval Workflows › Manual journal voucher).
      onCreated(can('accounts', 'journal_vouchers', 'submit')
        ? await submitAfterSave(() => accountsApi.submitJournalEntry(created.id), 'The journal') : '')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the draft journal.'))
    } finally {
      setSaving(false)
    }
  }

  const cell: React.CSSProperties = { padding: '6px 6px', borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }

  return (
    <FormPage tour="fin-jv-form" icon="doc" title="New Journal" subtitle="Saved as a draft — another finance user posts it (maker-checker)." onBack={onCancel} backTour="fin-jv-back"
      footer={<>
        <button type="button" data-tour="fin-jv-cancel" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" data-tour="fin-jv-save" disabled={!balanced || saving} onClick={submit} style={sheetBtn('primary', SHEET.BLUE, !balanced || saving)}>
          <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Draft'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px 0' }}>
        <ErrorBanner error={error} />
        <InfoBanner>
          Use a journal only for entries no document covers — accruals, provisions, corrections, depreciation. Invoices, notes and payments
          post their own entries. Every journal must balance: total debits = total credits.
        </InfoBanner>
        <SheetSection icon="calendar" title="Voucher">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }} data-tour="fin-jv-date">
              <label style={sheetLabel}>Posting Date <Req /></label>
              <DateField value={postingDate} onChange={(v) => { setPostingDate(v); if (postingType === 'accrual') setAutoReverseOn(firstOfNextMonth(v)) }} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }} data-tour="fin-jv-form-type">
              <label style={sheetLabel}>Posting Type <Req /></label>
              <select style={sheetInput} value={postingType} onChange={(e) => changeType(e.target.value as (typeof MANUAL_TYPES)[number])}>
                {MANUAL_TYPES.map((t) => <option key={t} value={t}>{POSTING_LABELS[t]}</option>)}
              </select>
            </div>
            {postingType === 'accrual' && (
              <div style={{ flex: '0 1 170px', minWidth: 150 }} data-tour="fin-jv-auto-reverse">
                <label style={sheetLabel}>Auto-reverse On</label>
                <DateField value={autoReverseOn} onChange={setAutoReverseOn} />
              </div>
            )}
          </div>
          {postingType === 'accrual' && (
            <p style={sheetHint}>
              An accrual books an expense or income in the month it belongs to, before the bill arrives. When posted, a reversal is
              automatically posted on the auto-reverse date (normally the 1st of next month), so the real bill isn&apos;t counted twice.
            </p>
          )}
        </SheetSection>

        <SheetSection icon="list" title="Lines" extra={<span style={{ fontSize: 12, color: SHEET.MUTED, marginLeft: 'auto' }}>Debit or credit on each line — never both</span>}>
          <div style={{ overflowX: 'auto' }} data-tour="fin-jv-lines">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
              <thead>
                <tr>
                  {['Ledger', 'Party (control a/c)', 'Cost Centre', 'Internal Order', 'Debit (₹)', 'Credit (₹)', 'Remarks', ''].map((h) => (
                    <th key={h} style={{ ...thStyle, position: 'static', background: 'transparent', padding: '6px 6px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const acct = ledgerById(l.gl_account_id)
                  const isControl = !!acct?.is_control_account
                  return (
                    <tr key={l.key}>
                      <td style={{ ...cell, minWidth: 260 }}>
                        <SearchableSelect value={l.gl_account_id} onChange={(v) => setLine(l.key, { gl_account_id: v, party: ledgerById(v)?.is_control_account ? l.party : '' })} options={ledgerOpts} placeholder="Select ledger…" />
                      </td>
                      <td style={{ ...cell, minWidth: 220 }}>
                        {isControl ? (
                          <SearchableSelect value={l.party} onChange={(v) => setLine(l.key, { party: v })} options={partyOpts} placeholder="Vendor / customer (required)" />
                        ) : (
                          <div style={{ fontSize: 12, color: TEXT.muted, paddingTop: 9 }}>—</div>
                        )}
                      </td>
                      <td style={{ ...cell, minWidth: 170 }}>
                        <SearchableSelect value={l.cost_center_id} onChange={(v) => setLine(l.key, { cost_center_id: v })} options={ccOpts}
                          placeholder={acct?.cost_object_required && !acct.default_cost_center_id && !l.internal_order_id ? 'Required' : 'Optional'} />
                      </td>
                      <td style={{ ...cell, minWidth: 170 }}>
                        <SearchableSelect value={l.internal_order_id} onChange={(v) => setLine(l.key, { internal_order_id: v })} options={ioOpts} placeholder="Optional" />
                      </td>
                      <td style={{ ...cell, width: 120 }}>
                        <input type="number" min={0} step="any" style={{ ...sheetInput, textAlign: 'right' }} value={l.debit}
                          onChange={(e) => setLine(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                      </td>
                      <td style={{ ...cell, width: 120 }}>
                        <input type="number" min={0} step="any" style={{ ...sheetInput, textAlign: 'right' }} value={l.credit}
                          onChange={(e) => setLine(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                      </td>
                      <td style={{ ...cell, minWidth: 160 }}>
                        <input style={sheetInput} value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                      </td>
                      <td style={{ ...cell, width: 30, paddingTop: 12 }}>
                        {lines.length > 2 && <button type="button" style={dangerLinkStyle} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td colSpan={4} style={{ ...cell, fontWeight: 700, fontSize: 12.5, textAlign: 'right', paddingTop: 10 }}>Total</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700, fontSize: 12.5, fontVariantNumeric: 'tabular-nums', paddingTop: 10 }}>{inr(totalDr)}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700, fontSize: 12.5, fontVariantNumeric: 'tabular-nums', paddingTop: 10 }}>{inr(totalCr)}</td>
                  <td colSpan={2} style={cell}></td>
                </tr>
              </tbody>
            </table>
          </div>
          <button type="button" data-tour="fin-jv-add-line" style={{ ...sheetBtn('secondary'), marginTop: 10 }} onClick={() => setLines((ls) => [...ls, emptyLine()])}><SheetIcon name="plus" size={14} />Add line</button>
        </SheetSection>
      </div>

      <div style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetColumns
          left={
            <SheetSection icon="shield" title="Before you save">
              <p style={{ fontSize: 13, color: SHEET.BODY, lineHeight: 1.55, margin: 0 }}>
                A party control account (Sundry Debtors / Creditors) needs the vendor or customer on its line, and an overhead ledger needs the cost
                centre or internal order that bears the cost. Once saved, the draft is sent to its approvers if you may submit journals.
              </p>
            </SheetSection>
          }
          right={<>
            <SheetSection icon="doc" title="Narration">
              <div data-tour="fin-jv-description">
                <label style={sheetLabel}>Description / Narration <Optional /></label>
                <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this entry for?" />
              </div>
            </SheetSection>
            <SheetSection icon="rupee" title="Totals">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 6, fontSize: 13, color: SHEET.BODY, fontVariantNumeric: 'tabular-nums' }}>
                <span>Total debit</span><strong style={{ textAlign: 'right' }}>{inr(totalDr)}</strong>
                <span>Total credit</span><strong style={{ textAlign: 'right' }}>{inr(totalCr)}</strong>
              </div>
              <span style={{
                display: 'inline-block', marginTop: 10, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                background: Math.abs(diff) < 0.005 ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.1)',
                color: Math.abs(diff) < 0.005 ? '#16a34a' : '#dc2626',
              }}>
                {Math.abs(diff) < 0.005 ? 'Balanced' : `Difference: ${inr(Math.abs(diff))} ${diff > 0 ? 'more Dr' : 'more Cr'}`}
              </span>
            </SheetSection>
          </>}
        />
      </div>
    </FormPage>
  )
}

// ─── Day book ─────────────────────────────────────────────────────────

function DayBookTab() {
  const [from, setFrom] = useState(monthStartIso())
  const [to, setTo] = useState(todayIso())
  const [voucherType, setVoucherType] = useState('')
  const [data, setData] = useState<DayBook | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    accountsApi.getDayBook(from, to, voucherType)
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the day book.')))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [])

  const totalDr = data?.entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit_amount, 0), 0) ?? 0
  const totalCr = data?.entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit_amount, 0), 0) ?? 0

  return (
    <>
      <InfoBanner>The Day Book lists every posted voucher in date order — the chronological record of all transactions, used to check that nothing was missed or entered twice.</InfoBanner>
      <ErrorBanner error={error} />
      <div data-tour="fin-daybook-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="From" style={{ flex: '0 1 150px' }} tour="fin-daybook-from"><DateField value={from} onChange={setFrom} /></Field>
        <Field label="To" style={{ flex: '0 1 150px' }} tour="fin-daybook-to"><DateField value={to} onChange={setTo} /></Field>
        <Field label="Voucher Type" style={{ flex: '0 1 150px' }} tour="fin-daybook-type">
          <select style={inputStyle} value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
            <option value="">All</option>
            {Object.entries(VOUCHER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <button type="button" data-tour="fin-daybook-show" style={{ ...primaryBtnStyle, marginBottom: 1 }} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
      </div>

      <TableWrap minWidth={950} tour="fin-daybook-table">
        <thead>
          <tr>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Voucher No.</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Particulars</th>
            <th style={numTh}>Dr (₹)</th>
            <th style={numTh}>Cr (₹)</th>
          </tr>
        </thead>
        <tbody>
          {loading && <EmptyRow colSpan={6} text="Loading…" />}
          {!loading && data && data.entries.length === 0 && <EmptyRow colSpan={6} text="No vouchers posted in this range." />}
          {!loading && data?.entries.map((e) => (
            <Fragment key={e.journal_entry_id}>
              <tr>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 700 }}>{dmy(e.posting_date)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 700 }}>
                  <Link href={recordHref(VOUCHER_PATH, e, 'journal_entry_id', undefined, 'entry')} style={{ color: 'inherit' }}>{e.entry_number}</Link>
                </td>
                <td style={tdStyle}>
                  {VOUCHER_LABELS[e.voucher_type] || e.voucher_type}
                  {e.status === 'reversed' && <span style={{ marginLeft: 6 }}><StatusPill status="reversed" labels={STATUS_LABELS} colors={STATUS_HEX} /></span>}
                </td>
                <td style={{ ...tdStyle, color: TEXT.secondary, fontStyle: 'italic' }}>{e.description || ''}</td>
                <td style={numTd}></td>
                <td style={numTd}></td>
              </tr>
              {e.lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, borderTop: 'none' }}></td>
                  <td style={{ ...tdStyle, borderTop: 'none' }}></td>
                  <td style={{ ...tdStyle, borderTop: 'none' }}></td>
                  <td style={{ ...tdStyle, borderTop: 'none', paddingLeft: l.credit_amount > 0 ? 36 : 12 }}>
                    {l.credit_amount > 0 ? 'To ' : ''}{l.gl_account_code} — {l.gl_account_name}
                    {l.remarks && <span style={{ color: TEXT.muted, fontSize: 11.5 }}> · {l.remarks}</span>}
                  </td>
                  <td style={{ ...numTd, borderTop: 'none' }}>{inr(l.debit_amount, { blankZero: true })}</td>
                  <td style={{ ...numTd, borderTop: 'none' }}>{inr(l.credit_amount, { blankZero: true })}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {!loading && data && data.entries.length > 0 && (
            <tr>
              <td colSpan={4} style={{ ...tdStyle, fontWeight: 800 }}>Total — {data.entries.length} voucher(s), value {inr(data.total)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(totalDr)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(totalCr)}</td>
            </tr>
          )}
        </tbody>
      </TableWrap>
    </>
  )
}

// ─── Ledger statement ─────────────────────────────────────────────────

function LedgerStatementTab({ ledgers }: { ledgers: GLAccount[] }) {
  const [ledgerId, setLedgerId] = useState('')
  const [from, setFrom] = useState(fyStartIso())
  const [to, setTo] = useState(todayIso())
  const [data, setData] = useState<GLLedger | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const load = (id = ledgerId) => {
    if (!id) return
    setLoading(true)
    setError(null)
    accountsApi.getGLLedger(Number(id), from, to)
      .then(setData)
      .catch((err) => { setData(null); setError(extractErrorMessages(err, 'Could not load the ledger statement.')) })
      .finally(() => setLoading(false))
  }

  const opts = ledgers.filter((a) => a.status === 'active').map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}${a.group_name ? ` (${a.group_name})` : ''}` }))

  return (
    <>
      <InfoBanner>A ledger statement shows the opening balance, every posting in the period and the running balance. Dr balances are normal for assets and expenses; Cr for liabilities, capital and income.</InfoBanner>
      <ErrorBanner error={error} />
      <div data-tour="fin-ledstmt-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Ledger" style={{ flex: '1 1 300px', maxWidth: 440 }} tour="fin-ledstmt-ledger">
          <SearchableSelect value={ledgerId} onChange={(v) => { setLedgerId(v); load(v) }} options={opts} placeholder="Select ledger…" />
        </Field>
        <Field label="From" style={{ flex: '0 1 150px' }} tour="fin-ledstmt-from"><DateField value={from} onChange={setFrom} /></Field>
        <Field label="To" style={{ flex: '0 1 150px' }} tour="fin-ledstmt-to"><DateField value={to} onChange={setTo} /></Field>
        <button type="button" data-tour="fin-ledstmt-show" style={{ ...primaryBtnStyle, marginBottom: 1 }} onClick={() => load()} disabled={!ledgerId || loading}>{loading ? 'Loading…' : 'Show'}</button>
      </div>

      {data && (
        <div data-tour="fin-ledstmt-stats" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatCard label="Opening" value={drcr(data.opening_balance)} />
          <StatCard label="Total Dr" value={inr(data.total_debit)} />
          <StatCard label="Total Cr" value={inr(data.total_credit)} />
          <StatCard label="Closing" value={drcr(data.closing_balance)} />
        </div>
      )}

      <LedgerTable data={data} loading={loading} emptyText={ledgerId ? 'No postings to this ledger in the range.' : 'Pick a ledger to see its statement.'} />
    </>
  )
}

function LedgerTable({ data, loading, emptyText, drLabel = 'Dr (₹)', crLabel = 'Cr (₹)' }: { data: GLLedger | null; loading: boolean; emptyText: string; drLabel?: string; crLabel?: string }) {
  return (
    <TableWrap minWidth={900} tour="fin-ledstmt-table">
      <thead>
        <tr>
          <th style={thStyle}>Date</th>
          <th style={thStyle}>Voucher No.</th>
          <th style={thStyle}>Type</th>
          <th style={thStyle}>Particulars</th>
          <th style={numTh}>{drLabel}</th>
          <th style={numTh}>{crLabel}</th>
          <th style={numTh}>Balance</th>
        </tr>
      </thead>
      <tbody>
        {loading && <EmptyRow colSpan={7} text="Loading…" />}
        {!loading && !data && <EmptyRow colSpan={7} text={emptyText} />}
        {!loading && data && (
          <>
            <tr>
              <td style={tdStyle}>{dmy(data.from_date)}</td>
              <td colSpan={5} style={{ ...tdStyle, fontWeight: 700 }}>Opening balance</td>
              <td style={{ ...numTd, fontWeight: 700 }}>{drcr(data.opening_balance)}</td>
            </tr>
            {data.rows.length === 0 && <EmptyRow colSpan={7} text={emptyText} />}
            {data.rows.map((r, i) => (
              <tr key={`${r.journal_entry_id}-${i}`}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(r.posting_date)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>
                  <Link href={recordHref(VOUCHER_PATH, r, 'journal_entry_id', undefined, 'entry')} style={{ color: 'inherit' }}>{r.entry_number}</Link>
                </td>
                <td style={tdStyle}>{VOUCHER_LABELS[r.voucher_type] || r.voucher_type}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.description || '—'}</td>
                <td style={numTd}>{inr(r.debit_amount, { blankZero: true })}</td>
                <td style={numTd}>{inr(r.credit_amount, { blankZero: true })}</td>
                <td style={numTd}>{drcr(r.running_balance)}</td>
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
  )
}

// ─── Period close ─────────────────────────────────────────────────────

function recentPeriods(n = 18): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function PeriodCloseTab({ canClose, closesDirectly, isAdmin }: { canClose: boolean; closesDirectly: boolean; isAdmin: boolean }) {
  const [periods, setPeriods] = useState<PeriodClose[]>([])
  const [period, setPeriod] = useState(currentPeriod())
  const [closePrompt, setClosePrompt] = useState(false)
  const [reopenPrompt, setReopenPrompt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')

  const load = () => {
    accountsApi.listPeriodCloses()
      .then(setPeriods)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load accounting periods.')))
  }
  useEffect(load, [])

  const row = periods.find((p) => p.accounting_period === period)
  const isClosed = row?.status === 'closed'
  const closePending = row?.approval_status === 'pending'

  const doClose = async (notes: string) => {
    setBusy(true); setError(null); setNotice(''); setClosePrompt(false)
    try {
      // 202 = submitted and waiting for a Finance Manager (approval engine).
      const out: { approval_status?: string; message?: string } = await accountsApi.closePeriod(period, notes || undefined)
      if (out?.approval_status === 'pending' && out.message) setNotice(out.message)
      load()
    }
    catch (err) { setError(extractErrorMessages(err, `Could not close ${periodLabel(period)}.`)) }
    finally { setBusy(false) }
  }
  const doReopen = async (reason: string) => {
    setBusy(true); setError(null); setReopenPrompt(false)
    try { await accountsApi.reopenPeriod(period, reason); load() }
    catch (err) { setError(extractErrorMessages(err, `Could not reopen ${periodLabel(period)}.`)) }
    finally { setBusy(false) }
  }

  return (
    <>
      <InfoBanner>
        Closing a month locks it: nothing more can be posted with a date in it, so reports for that month stop changing. To close, every
        document dated in the month (invoices, notes, payment vouchers, journals) must be posted — drafts left behind block the close.
        Closing goes through the approval workflow (Organization › Approval Workflows › Accounting period close): a Finance
        Manager&apos;s click closes it at once; anyone else&apos;s request waits for a Finance Manager. Only an admin can reopen, with a reason.
      </InfoBanner>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}

      <div data-tour="fin-period-panel" style={{ ...sectionStyle, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          <Field label="Accounting Period" style={{ flex: '0 1 170px', minWidth: 150 }} tour="fin-period-select">
            <select style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {recentPeriods().map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
          </Field>
          <div data-tour="fin-period-status" style={{ paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusPill status={isClosed ? 'closed' : 'open'} labels={{ open: 'Open', closed: 'Closed' }} colors={{ open: '#16a34a', closed: '#64748b' }} />
            {isClosed && row?.closed_by_name && <span style={{ fontSize: 12, color: TEXT.muted }}>by {row.closed_by_name} on {dmy(row.closed_at)}</span>}
            {!isClosed && <ApprovalBadge status={row?.approval_status} stage={row?.approval_stage} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, paddingBottom: 2 }}>
          {!isClosed && (canClose
            ? <button type="button" data-tour="fin-period-close-btn" style={primaryBtnStyle} disabled={busy || (closePending && !closesDirectly)} onClick={() => setClosePrompt(true)}>
                {closesDirectly ? `Close ${periodLabel(period)}` : closePending ? 'Close requested' : `Request close of ${periodLabel(period)}`}
              </button>
            : <span style={{ fontSize: 12, color: TEXT.muted }}>You need the Approve permission on Period Close to close a period.</span>)}
          {isClosed && (isAdmin
            ? <button type="button" data-tour="fin-period-reopen-btn" style={{ ...secondaryBtnStyle, color: '#b91c1c' }} disabled={busy} onClick={() => setReopenPrompt(true)}>Reopen</button>
            : <span style={{ fontSize: 12, color: TEXT.muted }}>Only an admin can reopen a closed period.</span>)}
        </div>
      </div>

      <ApprovalPanel key={period} entityType="accounts_period_close" entityId={Number(period.replace('-', ''))} title={`Approval — close ${periodLabel(period)}`} onChanged={() => load()} />

      <TableWrap minWidth={800} tour="fin-period-table">
        <thead>
          <tr>
            <th style={thStyle}>Period</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Closed By</th>
            <th style={thStyle}>Notes</th>
            <th style={thStyle}>Reopened</th>
          </tr>
        </thead>
        <tbody>
          {periods.length === 0 && <EmptyRow colSpan={5} text="No period has been closed yet." />}
          {periods.map((p) => (
            <tr key={p.accounting_period} style={{ cursor: 'pointer' }} onClick={() => setPeriod(p.accounting_period)}>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{periodLabel(p.accounting_period)}</td>
              <td style={tdStyle}>
                <StatusPill status={p.status} labels={{ open: 'Open', closed: 'Closed' }} colors={{ open: '#16a34a', closed: '#64748b' }} />
                {p.status !== 'closed' && <span style={{ marginLeft: 6 }}><ApprovalBadge status={p.approval_status} stage={p.approval_stage} /></span>}
              </td>
              <td style={tdStyle}>{p.closed_by_name ? `${p.closed_by_name} · ${dmy(p.closed_at)}` : '—'}</td>
              <td style={{ ...tdStyle, color: TEXT.secondary }}>{p.close_notes || '—'}</td>
              <td style={{ ...tdStyle, color: TEXT.secondary }}>{p.reopened_by_name ? `${p.reopened_by_name} · ${dmy(p.reopened_at)} — ${p.reopen_reason || ''}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <ReasonSheet open={closePrompt} tour="fin-period-close-dialog" icon="clock" danger={false}
        title={`Close accounting period ${periodLabel(period)}?`}
        subtitle="No further postings will be allowed with a date in this month."
        label="Notes" placeholder="e.g. Bank reconciled, all purchase bills booked"
        confirmLabel={closesDirectly ? 'Close Period' : 'Request Close'}
        onConfirm={doClose} onCancel={() => setClosePrompt(false)} />
      <ReasonSheet open={reopenPrompt} tour="fin-period-reopen-dialog" icon="undo" requireValue
        title={`Reopen accounting period ${periodLabel(period)}?`}
        subtitle="Reopening allows postings into a month whose reports may already have been shared."
        message="The reason goes on the audit trail."
        label="Reason for reopening" placeholder="Why must this month take postings again?" confirmLabel="Reopen Period"
        onConfirm={doReopen} onCancel={() => setReopenPrompt(false)} />
    </>
  )
}

