'use client'

/** Outstanding — receivables and payables party-wise, aged by due date, with
 *  each party's open bills, unadjusted credits and ledger statement. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { AgingBucket, OpenCredit, OpenDocument, PartyOutstanding, PartyOutstandingRow, PartyStatement } from '@/types'
import { TEXT, BRAND } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import DateField from '@/components/erp/DateField'
import AllocateCreditDialog from '@/components/finance/AllocateCreditDialog'
import OutstandingSubNav from '@/components/finance/OutstandingSubNav'
import { useCan } from '@/lib/permissions'
import {
  sectionStyle, primaryBtnStyle, secondaryBtnStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, fyStartIso, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { recordHref } from '@/lib/recordRef'

const TABS = ['Receivables (customers)', 'Payables (vendors)'] as const
type Tab = typeof TABS[number]
type PartyType = 'vendor' | 'customer'

const BUCKETS: AgingBucket[] = ['not_due', '1_30', '31_60', '61_90', 'over_90']
const BUCKET_LABELS: Record<string, string> = { not_due: 'Not due', '1_30': '1–30', '31_60': '31–60', '61_90': '61–90', over_90: '>90' }
const BUCKET_HEX: Record<string, string> = { not_due: '#22c55e', '1_30': '#eab308', '31_60': '#f59e0b', '61_90': '#dc2626', over_90: '#991b1b' }

const VOUCHER_LABELS: Record<string, string> = {
  journal: 'Journal', payment: 'Payment', receipt: 'Receipt', contra: 'Contra', purchase: 'Purchase', sales: 'Sales',
  debit_note: 'Debit note', credit_note: 'Credit note', opening: 'Opening',
}

export default function OutstandingPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')

  const { canFeature } = useCan()
  const seeReceivables = canFeature('accounts', 'outstanding', 'receivables', 'view')
  const seePayables = canFeature('accounts', 'outstanding', 'payables', 'view')
  const visibleTabs = TABS.filter((t) => (t === 'Payables (vendors)' ? seePayables : seeReceivables))
  const [pickedTab, setTab] = useState<Tab>('Receivables (customers)')
  const tab: Tab = visibleTabs.includes(pickedTab) ? pickedTab : (visibleTabs[0] ?? pickedTab)
  const allowed = visibleTabs.length > 0
  const partyType: PartyType = tab === 'Payables (vendors)' ? 'vendor' : 'customer'
  const [data, setData] = useState<PartyOutstanding | null>(null)
  // The tab whose data is on screen; differs from partyType while loading.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<PartyOutstandingRow | null>(null)
  // Key date (S_ALR_87012078/87012168): empty = today; a past date shows
  // only bills open on that date, at the amount that was due then.
  const [asOf, setAsOf] = useState('')
  const loadKey = `${partyType}|${asOf}`

  useEffect(() => {
    if (!isAuthorized || !allowed) return
    accountsApi.partyOutstanding(partyType, asOf || undefined)
      .then((d: PartyOutstanding) => { setData(d); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, `Could not load ${partyType === 'vendor' ? 'payables' : 'receivables'}.`)))
      .finally(() => setLoadedFor(`${partyType}|${asOf}`))
  }, [isAuthorized, allowed, partyType, asOf])
  const loading = loadedFor !== loadKey

  if (isLoading || !isAuthorized) return null

  const current = !loading && data?.party_type === partyType ? data : null
  const rows = current?.rows || []
  const totals = current?.totals || {}
  const showDisputed = partyType === 'customer'
  const COLS = showDisputed ? 12 : 11
  const keyDate = !!asOf && asOf < todayIso()

  return (
    <div>
      <FinanceNav />
      <PageHeader
        title="Outstanding"
        subtitle="Party-wise receivables and payables, aged by due date, with open bills, advances and the party ledger statement."
      />
      <OutstandingSubNav />
      {!allowed && (
        <InfoBanner tone="warning">
          Your role can open Receivables &amp; Payables but neither the customer nor the vendor view (Finance &amp; Accounting › Receivables &amp; Payables ›
          Receivables / Payables). Ask an admin to grant one in Organization › Role &amp; Permissions.
        </InfoBanner>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <SubTabs tabs={visibleTabs} value={tab} onChange={(t) => { setTab(t); setSelected(null) }} />
        <Field label="Key date (as of)" style={{ flex: '0 1 170px', minWidth: 160, marginBottom: 14 }} tour="fin-os-asof">
          <DateField value={asOf} onChange={(v) => { setAsOf(v); setSelected(null) }} />
        </Field>
      </div>
      {keyDate && (
        <InfoBanner tone="warning">
          Key-date view as of <b>{dmy(asOf)}</b>: only bills posted by then, at the amount that was still due then
          (settlements after the key date are added back), aged against the key date. Clear the date to see today.
        </InfoBanner>
      )}
      <InfoBanner>
        Aging is by <b>due date</b> (invoice date + credit days), not invoice date — a bill only becomes overdue after its due date.
        Net = outstanding bills − advances / unadjusted {partyType === 'vendor' ? 'debit' : 'credit'} notes, which equals the
        party&apos;s balance in the {partyType === 'vendor' ? 'Sundry Creditors' : 'Sundry Debtors'} control account.
      </InfoBanner>
      <ErrorBanner error={error} />

      <div data-tour="fin-os-stats" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Total outstanding" value={inr(totals.outstanding ?? 0)} />
        <StatCard label="Overdue" value={inr(totals.overdue ?? 0)} tone={(totals.overdue ?? 0) > 0 ? '#b91c1c' : undefined} />
        <StatCard label={partyType === 'vendor' ? 'Advances paid' : 'Advances received'} value={inr(totals.advances ?? 0)} tone="#b45309" />
        <StatCard label="Net" value={inr(totals.net ?? 0)} />
      </div>

      <TableWrap minWidth={1150} maxHeight={selected ? '380px' : undefined} tour="fin-os-table">
        <thead>
          <tr>
            <th style={thStyle}>{partyType === 'vendor' ? 'Vendor' : 'Customer'}</th>
            <th style={numTh}>Open bills</th>
            <th style={numTh}>Outstanding (₹)</th>
            {BUCKETS.map((b) => <th key={b} style={numTh}>{BUCKET_LABELS[b]}</th>)}
            {showDisputed && <th style={numTh}>Disputed (₹)</th>}
            <th style={numTh}>Overdue (₹)</th>
            <th style={numTh}>Advances (₹)</th>
            <th style={numTh}>Net (₹)</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={COLS} text="Loading…" />
            : rows.length === 0 ? <EmptyRow colSpan={COLS} text={`No ${partyType === 'vendor' ? 'payables' : 'receivables'} outstanding.`} />
            : (
              <>
                {rows.map((r) => {
                  const active = selected?.party_id === r.party_id
                  return (
                    <tr key={r.party_id} onClick={() => setSelected(active ? null : r)}
                      style={{ cursor: 'pointer', background: active ? `${BRAND.primary}14` : undefined }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.party_name}</td>
                      <td style={numTd}>{r.open_bills}</td>
                      <td style={numTd}>{inr(r.outstanding)}</td>
                      {BUCKETS.map((b) => <td key={b} style={{ ...numTd, color: b !== 'not_due' && r[b] > 0 ? BUCKET_HEX[b] : TEXT.body }}>{inr(r[b], { blankZero: true })}</td>)}
                      {showDisputed && <td style={{ ...numTd, color: '#7c3aed' }}>{inr(r.disputed ?? 0, { blankZero: true })}</td>}
                      <td style={{ ...numTd, color: r.overdue > 0 ? '#b91c1c' : TEXT.muted }}>{inr(r.overdue, { blankZero: true })}</td>
                      <td style={{ ...numTd, color: '#b45309' }}>{inr(r.advances, { blankZero: true })}</td>
                      <td style={{ ...numTd, fontWeight: 700 }}>{inr(r.net)}</td>
                    </tr>
                  )
                })}
                <tr>
                  <td style={{ ...tdStyle, fontWeight: 800 }}>Total</td>
                  <td style={numTd}>{rows.reduce((s, r) => s + r.open_bills, 0)}</td>
                  <td style={{ ...numTd, fontWeight: 800 }}>{inr(totals.outstanding ?? 0)}</td>
                  {BUCKETS.map((b) => <td key={b} style={{ ...numTd, fontWeight: 800 }}>{inr(totals[b] ?? 0, { blankZero: true })}</td>)}
                  {showDisputed && <td style={{ ...numTd, fontWeight: 800 }}>{inr(totals.disputed ?? 0, { blankZero: true })}</td>}
                  <td style={{ ...numTd, fontWeight: 800 }}>{inr(totals.overdue ?? 0)}</td>
                  <td style={{ ...numTd, fontWeight: 800 }}>{inr(totals.advances ?? 0)}</td>
                  <td style={{ ...numTd, fontWeight: 800 }}>{inr(totals.net ?? 0)}</td>
                </tr>
              </>
            )}
        </tbody>
      </TableWrap>

      {selected && (
        <PartyDetail key={`${partyType}-${selected.party_id}-${asOf}`} partyType={partyType} party={selected} asOf={asOf} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function PartyDetail({ partyType, party, asOf, onClose }: { partyType: PartyType; party: PartyOutstandingRow; asOf?: string; onClose: () => void }) {
  const [docs, setDocs] = useState<OpenDocument[]>([])
  const [credits, setCredits] = useState<OpenCredit[]>([])
  const [billsLoading, setBillsLoading] = useState(true) // component is keyed per party, so this starts true once
  const [fromDate, setFromDate] = useState(fyStartIso())
  const [toDate, setToDate] = useState(todayIso())
  const [statement, setStatement] = useState<PartyStatement | null>(null)
  const [stmtLoadedFor, setStmtLoadedFor] = useState('')
  const stmtKey = `${fromDate}|${toDate}`
  const stmtLoading = stmtLoadedFor !== stmtKey
  const [error, setError] = useState<string[] | null>(null)
  const { canFeature } = useCan()
  const [setOff, setSetOff] = useState<OpenCredit | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    accountsApi.openBills(partyType, party.party_id, asOf || undefined)
      .then((d: { documents: OpenDocument[]; credits: OpenCredit[] }) => { setDocs(d.documents || []); setCredits(d.credits || []) })
      .catch((err: unknown) => setError(extractErrorMessages(err, `Could not load open bills for ${party.party_name}.`)))
      .finally(() => setBillsLoading(false))
  }, [partyType, party.party_id, party.party_name, reloadKey, asOf])
  const historical = !!asOf && asOf < todayIso()

  useEffect(() => {
    if (!fromDate || !toDate) return
    accountsApi.partyStatement(partyType, party.party_id, fromDate, toDate)
      .then((s: PartyStatement) => setStatement(s))
      .catch((err: unknown) => setError(extractErrorMessages(err, `Could not load the statement for ${party.party_name}.`)))
      .finally(() => setStmtLoadedFor(`${fromDate}|${toDate}`))
  }, [partyType, party.party_id, party.party_name, fromDate, toDate])

  const payHref = recordHref('/dashboard/finance/payments', party, 'party_id', undefined, partyType === 'vendor' ? 'vendor_id' : 'customer_id')
  const sub: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: TEXT.heading, margin: '4px 0 10px' }

  return (
    <div style={sectionStyle} data-tour="fin-os-party">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{party.party_name}</h2>
          <div style={{ fontSize: 12.5, color: TEXT.secondary, marginTop: 4 }}>
            Outstanding {inr(party.outstanding)} · Overdue {inr(party.overdue)} · Advances {inr(party.advances)} · Net {inr(party.net)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={payHref} data-tour="fin-os-record-btn" style={{ ...primaryBtnStyle, textDecoration: 'none' }}>
            {partyType === 'vendor' ? 'Record payment' : 'Record receipt'}
          </Link>
          <button data-tour="fin-os-close" style={secondaryBtnStyle} onClick={onClose}>Close</button>
        </div>
      </div>
      <ErrorBanner error={error} />

      <div style={sub}>Open bills</div>
      <TableWrap minWidth={820} maxHeight="320px" tour="fin-os-bills">
        <thead>
          <tr>
            <th style={thStyle}>Bill no.</th><th style={thStyle}>Date</th><th style={thStyle}>Due date</th>
            <th style={numTh}>Days overdue</th><th style={thStyle}>Bucket</th>
            <th style={numTh}>Bill total (₹)</th><th style={numTh}>Settled (₹)</th><th style={numTh}>Due (₹)</th>
          </tr>
        </thead>
        <tbody>
          {billsLoading ? <EmptyRow colSpan={8} text="Loading…" />
            : docs.length === 0 ? <EmptyRow colSpan={8} text="No open bills." />
            : docs.map((d) => (
              <tr key={`${d.target_type}-${d.id}`}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{d.doc_number}</td>
                <td style={tdStyle}>{dmy(d.doc_date)}</td>
                <td style={tdStyle}>{dmy(d.due_date)}</td>
                <td style={{ ...numTd, color: d.days_overdue > 0 ? '#b91c1c' : TEXT.body }}>{d.days_overdue || '—'}</td>
                <td style={tdStyle}><StatusPill status={d.bucket} labels={BUCKET_LABELS} colors={BUCKET_HEX} /></td>
                <td style={numTd}>{inr(d.total)}</td>
                <td style={numTd}>{inr(d.settled, { blankZero: true })}</td>
                <td style={{ ...numTd, fontWeight: 700 }}>
                  {inr(d.amount_due)}
                  {(d.disputed ?? 0) > 0 && <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>disputed {inr(d.disputed)}</div>}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      {credits.length > 0 && (
        <>
          <div style={sub}>Open credits (advances / unadjusted notes)</div>
          <TableWrap minWidth={640} maxHeight="240px" tour="fin-os-credits">
            <thead>
              <tr>
                <th style={thStyle}>Document</th><th style={thStyle}>Kind</th><th style={thStyle}>Date</th>
                <th style={numTh}>Amount (₹)</th><th style={numTh}>Available to allocate (₹)</th><th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr key={`${c.source_type}-${c.id}`}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{c.doc_number}</td>
                  <td style={tdStyle}>{c.source_type === 'payment' ? 'On-account voucher' : c.source_type === 'advance' ? 'Advance (down payment)' : c.source_type === 'journal' ? 'Journal (JV) credit' : partyType === 'vendor' ? 'Debit note' : 'Credit note'}</td>
                  <td style={tdStyle}>{dmy(c.doc_date)}</td>
                  <td style={numTd}>{inr(c.amount)}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: '#b45309' }}>{inr(c.available)}</td>
                  <td style={tdStyle}>
                    {!historical && docs.length > 0 && canFeature('accounts', 'payments', 'allocation', 'edit') && (
                      <button style={{ fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        onClick={() => setSetOff(c)}>Set off</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: -10, marginBottom: 16 }}>
            Set a credit off against this party&apos;s open bills with &ldquo;Set off&rdquo; — advances, notes and JV credits alike — so the open items match the party balance.
          </div>
        </>
      )}
      {setOff && (
        <AllocateCreditDialog partyType={partyType} partyId={party.party_id} partyName={party.party_name}
          source={{ source_type: setOff.source_type, id: setOff.id, doc_number: setOff.doc_number, available: setOff.available }}
          onClose={() => setSetOff(null)}
          onDone={() => { setSetOff(null); setReloadKey((k) => k + 1) }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={sub}>Statement</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label="From" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-os-stmt-from"><DateField value={fromDate} onChange={setFromDate} /></Field>
          <Field label="To" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-os-stmt-to"><DateField value={toDate} onChange={setToDate} /></Field>
        </div>
      </div>
      <TableWrap minWidth={900} maxHeight="480px" tour="fin-os-statement">
        <thead>
          <tr>
            <th style={thStyle}>Date</th><th style={thStyle}>Voucher no.</th><th style={thStyle}>Type</th><th style={thStyle}>Description</th>
            <th style={numTh}>Debit (₹)</th><th style={numTh}>Credit (₹)</th><th style={numTh}>Balance (₹)</th>
          </tr>
        </thead>
        <tbody>
          {!fromDate || !toDate ? <EmptyRow colSpan={7} text="Pick both a From and a To date to see the statement." />
            : stmtLoading ? <EmptyRow colSpan={7} text="Loading statement…" />
            : !statement ? <EmptyRow colSpan={7} text="The statement could not be loaded — see the message above." /> : (
            <>
              <tr>
                <td style={tdStyle}>{dmy(statement.from_date)}</td>
                <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={5}>Opening balance</td>
                <td style={{ ...numTd, fontWeight: 700 }}>{inr(statement.opening_balance)}</td>
              </tr>
              {statement.rows.length === 0 && <EmptyRow colSpan={7} text="No entries in this period." />}
              {statement.rows.map((r, i) => (
                <tr key={`${r.journal_entry_id}-${i}`}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(r.posting_date)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.voucher_number}</td>
                  <td style={tdStyle}>{VOUCHER_LABELS[r.voucher_type] || r.voucher_type.replace(/_/g, ' ')}</td>
                  <td style={tdStyle}>{r.description || '—'}</td>
                  <td style={numTd}>{inr(r.debit, { blankZero: true })}</td>
                  <td style={numTd}>{inr(r.credit, { blankZero: true })}</td>
                  <td style={numTd}>{inr(r.balance)}</td>
                </tr>
              ))}
              <tr>
                <td style={tdStyle}>{dmy(statement.to_date)}</td>
                <td style={{ ...tdStyle, fontWeight: 800 }} colSpan={5}>Closing balance</td>
                <td style={{ ...numTd, fontWeight: 800 }}>{inr(statement.closing_balance)}</td>
              </tr>
            </>
          )}
        </tbody>
      </TableWrap>
      {statement && (
        <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: -10 }}>
          Balance shown as the {statement.balance_meaning}; a bracketed (negative) balance means the opposite — e.g. an advance.
        </div>
      )}
    </div>
  )
}
