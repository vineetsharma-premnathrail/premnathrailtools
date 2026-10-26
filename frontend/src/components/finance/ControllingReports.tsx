'use client'

/** Controlling reports on Finance › Reports:
 *  - Cost Centres: cost centre x ledger actuals (S_ALR_87013611) with drill to
 *    line items (KSB1) and on to the voucher.
 *  - Internal Orders: plan / actual / commitment / available per order
 *    (S_ALR_87012993) and one order's line items + open POs (KOB1). */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { accountsApi, costCentersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT, BRAND } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { recordHref } from '@/lib/recordRef'
import { VOUCHER_PATH } from '@/components/finance/voucherLabels'
import Select from '@/components/shared/Select'
import {
  inr, dmy, sectionStyle, secondaryBtnStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh, labelStyle,
  ErrorBanner, InfoBanner, StatusPill, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { RowCount } from '@/components/shared/ui'

type CC = { id: number; code: string; name: string; status: string; parent_cost_center_id?: number | null }
type LineItem = {
  journal_entry_line_id: number; journal_entry_id: number; entry_number: string; voucher_type: string; posting_date: string
  gl_account_code: string | null; gl_account_name: string | null; cost_center_code: string | null; internal_order_code: string | null
  party_name: string | null; description: string | null; debit_amount: number; credit_amount: number; running_total: number
}
type LineItems = { code: string; name: string; from_date: string | null; to_date: string; rows: LineItem[]; total_debit: number; total_credit: number; total: number }
type Actuals = {
  from_date: string; to_date: string
  cost_centers: { id: number; code: string; name: string }[]
  rows: { gl_account_id: number; gl_account_code: string; gl_account_name: string; account_type: string; amounts: Record<string, number>; total: number; unassigned: number }[]
  column_totals: Record<string, number>; grand_total: number; unassigned_total: number
}
type IOSummary = {
  id: number; code: string; name: string; order_type: string; status: string; start_date: string | null; end_date: string | null
  cost_center_name: string | null; budgeted_amount: number | null; actual_amount: number; commitment_amount: number
  available_amount: number | null; consumed_pct: number | null
}
type IOReport = {
  summary: IOSummary
  by_ledger: { gl_account_id: number; gl_account_code: string; gl_account_name: string; amount: number }[]
  commitments: { purchase_order_id: number; po_number: string; po_date: string; vendor_name: string | null; status: string; po_value: number; invoiced_value: number; open_value: number }[]
  line_items: LineItems
}

export const IO_STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In progress', completed: 'Completed', closed: 'Closed' }
export const IO_STATUS_HEX: Record<string, string> = { open: '#0369a1', in_progress: '#b45309', completed: '#16a34a', closed: '#64748b' }
const RED = '#dc2626'

function LineItemsTable({ data, loading, tour }: { data: LineItems | null; loading: boolean; tour?: string }) {
  return (
    <TableWrap minWidth={1150} maxHeight="calc(100vh - 260px)" tour={tour}>
      <thead>
        <tr>
          <th style={thStyle}>Date <RowCount count={data?.rows.length ?? 0} /></th><th style={thStyle}>Voucher</th><th style={thStyle}>Ledger</th><th style={thStyle}>Cost centre</th>
          <th style={thStyle}>Order</th><th style={thStyle}>Party</th><th style={thStyle}>Narration</th>
          <th style={numTh}>Debit (₹)</th><th style={numTh}>Credit (₹)</th><th style={numTh}>Running (₹)</th>
        </tr>
      </thead>
      <tbody>
        {!data ? <EmptyRow colSpan={10} text={loading ? 'Loading…' : 'Pick what to show.'} />
          : data.rows.length === 0 ? <EmptyRow colSpan={10} text="No posted line items for this selection." />
          : data.rows.map((r) => (
            <tr key={r.journal_entry_line_id}>
              <td style={tdStyle}>{dmy(r.posting_date)}</td>
              <td style={{ ...tdStyle, fontWeight: 600 }}>
                <Link href={recordHref(VOUCHER_PATH, r, 'journal_entry_id', undefined, 'entry')} style={{ color: BRAND.primaryActive }}>{r.entry_number}</Link>
              </td>
              <td style={tdStyle}>{r.gl_account_code} — {r.gl_account_name}</td>
              <td style={tdStyle}>{r.cost_center_code || '—'}</td>
              <td style={tdStyle}>{r.internal_order_code || '—'}</td>
              <td style={tdStyle}>{r.party_name || '—'}</td>
              <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.description || ''}</td>
              <td style={numTd}>{inr(r.debit_amount, { blankZero: true })}</td>
              <td style={numTd}>{inr(r.credit_amount, { blankZero: true })}</td>
              <td style={{ ...numTd, fontWeight: 600 }}>{inr(r.running_total)}</td>
            </tr>
          ))}
        {data && data.rows.length > 0 && (
          <tr>
            <td colSpan={7} style={{ ...tdStyle, fontWeight: 800, textAlign: 'right' }}>Total</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_debit)}</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_credit)}</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total)}</td>
          </tr>
        )}
      </tbody>
    </TableWrap>
  )
}

// ─── Cost centres ─────────────────────────────────────────────────────────

export function CostCenterReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [centres, setCentres] = useState<CC[]>([])
  const [ccId, setCcId] = useState('')
  const [withSubs, setWithSubs] = useState(true)
  const [actuals, setActuals] = useState<Actuals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  // Drill-down: one cost centre (optionally a group) and optionally one ledger.
  const [drill, setDrill] = useState<{ ccId: number; children: boolean; glId: number | null; label: string } | null>(null)
  const [items, setItems] = useState<LineItems | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)

  useEffect(() => {
    costCentersApi.listCostCenters().then(setCentres)
      .catch((err: unknown) => setError(extractErrorMessages(err, "Couldn't load the cost centres (Organization › Plants › Cost centres).")))
  }, [])

  useEffect(() => {
    if (!fromDate || !toDate) return
    let cancelled = false
    setLoading(true)
    setError(null)
    accountsApi.getCostCenterActuals({ from_date: fromDate, to_date: toDate, cost_center_id: ccId || undefined, include_children: withSubs })
      .then((d: Actuals) => { if (!cancelled) setActuals(d) })
      .catch((err: unknown) => { if (!cancelled) setError(extractErrorMessages(err, "Couldn't load cost-centre actuals.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fromDate, toDate, ccId, withSubs])

  useEffect(() => {
    if (!drill) { setItems(null); return }
    let cancelled = false
    setItemsLoading(true)
    accountsApi.getCostCenterLineItems({ cost_center_id: drill.ccId, include_children: drill.children, gl_account_id: drill.glId ?? undefined, from_date: fromDate, to_date: toDate })
      .then((d: LineItems) => { if (!cancelled) setItems(d) })
      .catch((err: unknown) => { if (!cancelled) setError(extractErrorMessages(err, "Couldn't load the line items.")) })
      .finally(() => { if (!cancelled) setItemsLoading(false) })
    return () => { cancelled = true }
  }, [drill, fromDate, toDate])

  const opts = [{ value: '', label: 'All cost centres' }, ...centres.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}${c.status !== 'active' ? ' (inactive)' : ''}` }))]
  const cols = actuals?.cost_centers || []
  const showUnassigned = !ccId && (actuals?.unassigned_total || 0) !== 0
  const selected = centres.find((c) => String(c.id) === ccId)
  const cellLink = (v: number | undefined, onClick: () => void) => (v ? (
    <button type="button" onClick={onClick} style={{ ...linkBtnStyle, padding: 0, fontVariantNumeric: 'tabular-nums' }}>{inr(v)}</button>
  ) : <span style={{ color: TEXT.muted }}>—</span>)

  return (
    <>
      <InfoBanner>
        Actual costs and revenues (debit minus credit) on P&amp;L ledgers, per cost centre, for the selected range. Click an amount to see
        its line items and open the voucher. &quot;Unassigned&quot; = P&amp;L postings with no cost centre — set &quot;Cost object required&quot; or a
        default cost centre on the ledger (Finance › Masters › Ledgers) to stop them.
      </InfoBanner>
      <ErrorBanner error={error} />
      <div data-tour="fin-rep-cc-filters" style={{ ...sectionStyle, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <label style={labelStyle}>Cost centre</label>
          <SearchableSelect value={ccId} onChange={(v: string) => { setCcId(v); setDrill(null) }} options={opts} placeholder="All cost centres" />
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: TEXT.body, paddingBottom: 9 }}>
          <input type="checkbox" checked={withSubs} onChange={(e) => setWithSubs(e.target.checked)} disabled={!ccId} /> Include sub-centres
        </label>
        {selected && (
          <button type="button" style={{ ...secondaryBtnStyle, marginBottom: 2 }}
            onClick={() => setDrill({ ccId: selected.id, children: withSubs, glId: null, label: `${selected.code} — ${selected.name}${withSubs ? ' (with sub-centres)' : ''}` })}>
            All line items
          </button>
        )}
      </div>

      <TableWrap minWidth={Math.max(700, 320 + (cols.length + 2) * 140)} maxHeight="calc(100vh - 320px)" tour="fin-rep-cc-matrix">
        <thead>
          <tr>
            <th style={thStyle}>Ledger <RowCount count={actuals?.rows.length ?? 0} /></th>
            {cols.map((c) => <th key={c.id} style={numTh} title={c.name}>{c.code}</th>)}
            {showUnassigned && <th style={numTh}>Unassigned</th>}
            <th style={numTh}>Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          {!actuals ? <EmptyRow colSpan={cols.length + 3} text={loading ? 'Loading…' : 'No data.'} />
            : actuals.rows.length === 0 ? <EmptyRow colSpan={cols.length + 3} text="No P&L postings in this range for the selection." />
            : actuals.rows.map((r) => (
              <tr key={r.gl_account_id}>
                <td style={tdStyle}>{r.gl_account_code} — {r.gl_account_name}{r.account_type === 'revenue' && <span style={{ color: TEXT.muted, fontSize: 11 }}> (income)</span>}</td>
                {cols.map((c) => (
                  <td key={c.id} style={numTd}>
                    {cellLink(r.amounts[String(c.id)], () => setDrill({ ccId: c.id, children: false, glId: r.gl_account_id, label: `${c.code} — ${c.name} · ${r.gl_account_code} ${r.gl_account_name}` }))}
                  </td>
                ))}
                {showUnassigned && <td style={{ ...numTd, color: r.unassigned ? RED : TEXT.muted }}>{r.unassigned ? inr(r.unassigned) : '—'}</td>}
                <td style={{ ...numTd, fontWeight: 700 }}>
                  {selected ? cellLink(r.total, () => setDrill({ ccId: selected.id, children: withSubs, glId: r.gl_account_id, label: `${selected.code} — ${selected.name} · ${r.gl_account_code} ${r.gl_account_name}` })) : inr(r.total)}
                </td>
              </tr>
            ))}
          {actuals && actuals.rows.length > 0 && (
            <tr>
              <td style={{ ...tdStyle, fontWeight: 800 }}>Total</td>
              {cols.map((c) => <td key={c.id} style={{ ...numTd, fontWeight: 800 }}>{inr(actuals.column_totals[String(c.id)] || 0)}</td>)}
              {showUnassigned && <td style={{ ...numTd, fontWeight: 800, color: RED }}>{inr(actuals.unassigned_total)}</td>}
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(actuals.grand_total)}</td>
            </tr>
          )}
        </tbody>
      </TableWrap>

      {drill && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '4px 0 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading }}>Line items — {drill.label}</div>
            <button type="button" style={secondaryBtnStyle} onClick={() => setDrill(null)}>Close line items</button>
          </div>
          <LineItemsTable data={items} loading={itemsLoading} tour="fin-rep-cc-lines" />
        </>
      )}
    </>
  )
}

// ─── Internal orders ──────────────────────────────────────────────────────

export function InternalOrdersReport({ toDate, initialOrderId }: { toDate: string; initialOrderId?: number | null }) {
  const [rows, setRows] = useState<IOSummary[] | null>(null)
  const [status, setStatus] = useState('')
  const [orderId, setOrderId] = useState<number | null>(initialOrderId ?? null)
  const [report, setReport] = useState<IOReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  useEffect(() => { if (initialOrderId) setOrderId(initialOrderId) }, [initialOrderId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    accountsApi.getInternalOrdersOverview({ to_date: toDate || undefined, status: status || undefined })
      .then((d: { rows: IOSummary[] }) => { if (!cancelled) setRows(d.rows) })
      .catch((err: unknown) => { if (!cancelled) setError(extractErrorMessages(err, "Couldn't load the internal orders.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [toDate, status])

  useEffect(() => {
    if (!orderId) { setReport(null); return }
    let cancelled = false
    accountsApi.getInternalOrderReport(orderId, { to_date: toDate || undefined })
      .then((d: IOReport) => { if (!cancelled) setReport(d) })
      .catch((err: unknown) => { if (!cancelled) setError(extractErrorMessages(err, "Couldn't load the internal order's line items.")) })
    return () => { cancelled = true }
  }, [orderId, toDate])

  const s = report?.summary
  return (
    <>
      <InfoBanner>
        Budget vs actual for each internal order over its whole life (up to the &quot;to&quot; date). Commitment = issued purchase orders
        that carry the order, less what has already been invoiced and posted. Available = budget − actual − commitment.
      </InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ ...sectionStyle, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 1 180px' }}>
          <label style={labelStyle}>Status</label>
          <Select style={{ width: '100%', padding: '9px 10px', borderRadius: 10, fontSize: 13 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {Object.entries(IO_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
      </div>
      <TableWrap minWidth={1100} maxHeight="calc(100vh - 360px)" tour="fin-rep-io-table">
        <thead>
          <tr>
            <th style={thStyle}>Order <RowCount count={rows?.length ?? 0} /></th><th style={thStyle}>Name</th><th style={thStyle}>Status</th><th style={thStyle}>Cost centre</th>
            <th style={numTh}>Budget (₹)</th><th style={numTh}>Actual (₹)</th><th style={numTh}>Commitment (₹)</th>
            <th style={numTh}>Available (₹)</th><th style={numTh}>Used %</th>
          </tr>
        </thead>
        <tbody>
          {!rows ? <EmptyRow colSpan={9} text={loading ? 'Loading…' : 'No data.'} />
            : rows.length === 0 ? <EmptyRow colSpan={9} text="No internal orders yet — create them under Finance › Masters › Internal Orders." />
            : rows.map((r) => (
              <tr key={r.id} onClick={() => setOrderId(r.id)} style={{ cursor: 'pointer', background: r.id === orderId ? `${BRAND.primary}12` : undefined }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{r.code}</td>
                <td style={tdStyle}>{r.name}</td>
                <td style={tdStyle}><StatusPill status={r.status} colors={IO_STATUS_HEX} labels={IO_STATUS_LABELS} /></td>
                <td style={tdStyle}>{r.cost_center_name || '—'}</td>
                <td style={numTd}>{inr(r.budgeted_amount)}</td>
                <td style={numTd}>{inr(r.actual_amount)}</td>
                <td style={numTd}>{inr(r.commitment_amount, { blankZero: true }) || '—'}</td>
                <td style={{ ...numTd, fontWeight: 700, color: r.available_amount != null && r.available_amount < 0 ? RED : undefined }}>{inr(r.available_amount)}</td>
                <td style={numTd}>{r.consumed_pct != null ? `${r.consumed_pct.toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      {s && report && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '4px 0 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading }}>
              {s.code} — {s.name} <span style={{ fontWeight: 500, color: TEXT.secondary, fontSize: 12.5 }}>({dmy(s.start_date)} to {dmy(s.end_date)})</span>
            </div>
            <button type="button" style={secondaryBtnStyle} onClick={() => setOrderId(null)}>Close order</button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Budget" value={`₹ ${inr(s.budgeted_amount)}`} />
            <StatCard label="Actual (life to date)" value={`₹ ${inr(s.actual_amount)}`} />
            <StatCard label="Commitment (open POs)" value={`₹ ${inr(s.commitment_amount)}`} />
            <StatCard label="Available" value={`₹ ${inr(s.available_amount)}`} tone={s.available_amount != null && s.available_amount < 0 ? RED : undefined} />
          </div>
          {report.commitments.length > 0 && (
            <TableWrap minWidth={800} maxHeight="none" tour="fin-rep-io-commitments">
              <thead>
                <tr><th style={thStyle}>Purchase order <RowCount count={report.commitments.length} /></th><th style={thStyle}>Date</th><th style={thStyle}>Vendor</th><th style={thStyle}>Status</th>
                  <th style={numTh}>PO value (₹)</th><th style={numTh}>Invoiced (₹)</th><th style={numTh}>Open (₹)</th></tr>
              </thead>
              <tbody>
                {report.commitments.map((c) => (
                  <tr key={c.purchase_order_id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{c.po_number}</td><td style={tdStyle}>{dmy(c.po_date)}</td>
                    <td style={tdStyle}>{c.vendor_name || '—'}</td><td style={tdStyle}>{c.status.replace(/_/g, ' ')}</td>
                    <td style={numTd}>{inr(c.po_value)}</td><td style={numTd}>{inr(c.invoiced_value)}</td><td style={{ ...numTd, fontWeight: 700 }}>{inr(c.open_value)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          {report.by_ledger.length > 0 && (
            <TableWrap minWidth={600} maxHeight="none" tour="fin-rep-io-ledgers">
              <thead><tr><th style={thStyle}>Ledger <RowCount count={report.by_ledger.length} /></th><th style={numTh}>Actual (₹)</th></tr></thead>
              <tbody>
                {report.by_ledger.map((g) => (
                  <tr key={g.gl_account_id}><td style={tdStyle}>{g.gl_account_code} — {g.gl_account_name}</td><td style={numTd}>{inr(g.amount)}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <LineItemsTable data={report.line_items} loading={false} tour="fin-rep-io-lines" />
        </>
      )}
    </>
  )
}
