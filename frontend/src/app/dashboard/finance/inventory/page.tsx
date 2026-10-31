'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { StockValueSummary, PurchaseSalesImpact, InventoryValuation, InventoryValuationLine } from '@/types'
import { TEXT } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, sheetInput, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SheetBody, SheetFooter } from '@/components/finance/financeSheet'
import DateField from '@/components/erp/DateField'
import {
  inputStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, fyStartIso, currentPeriod, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { RowCount } from '@/components/shared/ui'
import { recordHref } from '@/lib/recordRef'

const TABS = ['Stock Value', 'Purchase / Sales Impact', 'Closing Stock'] as const
type Tab = typeof TABS[number]

const SOURCE_HEX: Record<string, string> = { moving_average: '#15803d', standard: '#0369a1', manual: '#7c3aed', none: '#b91c1c' }
const SOURCE_LABELS: Record<string, string> = { moving_average: 'Moving avg', standard: 'Standard cost', manual: 'Manual', none: 'No cost' }
const STATUS_HEX: Record<string, string> = { draft: '#b45309', posted: '#15803d', cancelled: '#64748b' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' }

function qty(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: 4 })
}

export default function FinanceInventoryPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const [tab, setTab] = useState<Tab>('Stock Value')
  const { canFeature } = useCan()
  const isFm = !!user?.is_finance_manager || user?.role === 'admin'
  const canPost = isFm && canFeature('accounts', 'inventory', 'closing_stock', 'approve')
  const canCancel = isFm && canFeature('accounts', 'inventory', 'closing_stock', 'cancel')
  // Stock Value is the tab's base view; the other two are features of it.
  const visibleTabs = TABS.filter((t) => (t !== 'Purchase / Sales Impact' || canFeature('accounts', 'inventory', 'purchase_sales_impact', 'view'))
    && (t !== 'Closing Stock' || canFeature('accounts', 'inventory', 'closing_stock', 'view')))

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Inventory Accounting" subtitle="Stock value from Store, how purchases and sales moved it, and the month-end closing-stock entry (periodic method)." />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      {tab === 'Stock Value' && <StockValueTab />}
      {tab === 'Purchase / Sales Impact' && visibleTabs.includes(tab) && <ImpactTab />}
      {tab === 'Closing Stock' && visibleTabs.includes(tab) && <ClosingStockTab canPost={canPost} canCancel={canCancel} />}
    </div>
  )
}

// ─── Stock value ────────────────────────────────────────────────────────

function StockValueTab() {
  const [data, setData] = useState<StockValueSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [noCostOnly, setNoCostOnly] = useState(false)

  useEffect(() => {
    accountsApi.stockValue()
      .then((d: StockValueSummary) => setData(d))
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the stock value from Store')))
      .finally(() => setLoading(false))
  }, [])

  const itemRows = data ? (noCostOnly ? data.rows.filter((r) => r.rate_source === 'none') : data.rows) : []

  return (
    <div>
      <InfoBanner>
        Live value of stock on hand in Store (including quarantine — it is still our stock), at weighted moving-average cost, or the item&apos;s
        standard cost when no average exists yet. This is what a closing-stock valuation would pick up if created now.
      </InfoBanner>
      <ErrorBanner error={error} />
      {data?.note && <InfoBanner tone="warning">{data.note}</InfoBanner>}
      <div data-tour="fin-inv-sv-stats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label={`Stock value (as of ${data ? dmy(data.as_of) : '—'})`} value={data ? `₹ ${inr(data.total_value)}` : '—'} />
        <StatCard label="Items in stock" value={data ? String(data.rows.length) : '—'} onClick={() => setNoCostOnly(false)} />
        <StatCard label="Items without cost" value={data ? String(data.unvalued_items) : '—'} tone={data?.unvalued_items ? '#b91c1c' : undefined}
          onClick={() => setNoCostOnly((v) => !v)} active={noCostOnly} />
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>By category</h3>
      <TableWrap minWidth={500} maxHeight="none" tour="fin-inv-sv-categories">
        <thead><tr><th style={thStyle}>Category <RowCount count={data?.categories.length ?? 0} /></th><th style={numTh}>Items</th><th style={numTh}>Value (₹)</th></tr></thead>
        <tbody>
          {loading ? <EmptyRow colSpan={3} text="Loading…" /> : !data || data.categories.length === 0 ? <EmptyRow colSpan={3} text="No stock on hand in Store." />
            : data.categories.map((c) => (
              <tr key={c.category}>
                <td style={tdStyle}>{c.category}</td>
                <td style={numTd}>{c.items}</td>
                <td style={numTd}>{inr(c.value)}</td>
              </tr>
            ))}
          {data && data.categories.length > 0 && (
            <tr><td style={{ ...tdStyle, fontWeight: 800 }}>Total</td><td style={{ ...numTd, fontWeight: 800 }}>{data.rows.length}</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_value)}</td></tr>
          )}
        </tbody>
      </TableWrap>

      <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Items</h3>
      <TableWrap minWidth={1000} tour="fin-inv-sv-items">
        <thead>
          <tr>
            <th style={thStyle}>Code <RowCount count={itemRows.length} /></th><th style={thStyle}>Item</th><th style={thStyle}>Category</th>
            <th style={numTh}>Qty</th><th style={thStyle}>UoM</th><th style={numTh}>Rate (₹)</th><th style={numTh}>Value (₹)</th><th style={thStyle}>Rate source</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={8} text="Loading…" /> : !data || itemRows.length === 0 ? <EmptyRow colSpan={8} text={noCostOnly ? 'Every item in stock has a cost. Click Items without cost again to show all.' : 'No stock on hand in Store.'} />
            : itemRows.map((r) => (
              <tr key={r.store_item_id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.item_code}</td>
                <td style={tdStyle}>{r.item_name}</td>
                <td style={tdStyle}>{r.category || '—'}</td>
                <td style={numTd}>{qty(r.quantity)}</td>
                <td style={tdStyle}>{r.uom || ''}</td>
                <td style={numTd}>{inr(r.rate)}</td>
                <td style={numTd}>{inr(r.value)}</td>
                <td style={tdStyle}><StatusPill status={r.rate_source} labels={SOURCE_LABELS} colors={SOURCE_HEX} /></td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ─── Purchase / sales impact ────────────────────────────────────────────

function ImpactTab() {
  const [fromDate, setFromDate] = useState(fyStartIso())
  const [toDate, setToDate] = useState(todayIso())
  const [data, setData] = useState<PurchaseSalesImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)

  const refresh = () => { setLoading(true); setError(null); load() }
  // State is set only after the await, so this is safe to call from an effect.
  const load = async () => {
    try { setData(await accountsApi.purchaseSalesImpact(fromDate, toDate)); setError(null) }
    catch (err: unknown) { setError(extractErrorMessages(err, 'Could not load the purchase / sales impact')) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const tq = (data?.rows || []).reduce((a, r) => ({ pq: a.pq + r.purchase_qty, sq: a.sq + r.sales_qty }), { pq: 0, sq: 0 })

  return (
    <div>
      <InfoBanner>
        Quantity and taxable value bought (posted purchase invoices) and sold (posted sales invoices) per item in the range. Lines linked to a
        Store item are grouped by item; others by their description.
      </InfoBanner>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Field label="From" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-inv-imp-from"><DateField value={fromDate} onChange={setFromDate} /></Field>
        <Field label="To" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-inv-imp-to"><DateField value={toDate} onChange={setToDate} /></Field>
        <button data-tour="fin-inv-imp-show" style={primaryBtnStyle} onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
      </div>
      <ErrorBanner error={error} />
      {data && (
        <div data-tour="fin-inv-imp-stats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <StatCard label="Purchases (taxable)" value={`₹ ${inr(data.total_purchases)}`} />
          <StatCard label="Sales (taxable)" value={`₹ ${inr(data.total_sales)}`} />
        </div>
      )}
      <TableWrap minWidth={850} tour="fin-inv-imp-table">
        <thead>
          <tr>
            <th style={thStyle}>Item / description <RowCount count={data?.rows.length ?? 0} /></th>
            <th style={numTh}>Purchase qty</th><th style={numTh}>Purchase value (₹)</th>
            <th style={numTh}>Sales qty</th><th style={numTh}>Sales value (₹)</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={5} text="Loading…" /> : !data || data.rows.length === 0 ? <EmptyRow colSpan={5} text="No posted purchase or sales invoices in this range." />
            : data.rows.map((r, i) => (
              <tr key={i}>
                <td style={tdStyle}>{r.description || (r.store_item_id ? `Store item #${r.store_item_id}` : '—')}</td>
                <td style={numTd}>{qty(r.purchase_qty)}</td>
                <td style={numTd}>{inr(r.purchase_value, { blankZero: true })}</td>
                <td style={numTd}>{qty(r.sales_qty)}</td>
                <td style={numTd}>{inr(r.sales_value, { blankZero: true })}</td>
              </tr>
            ))}
          {data && data.rows.length > 0 && !loading && (
            <tr>
              <td style={{ ...tdStyle, fontWeight: 800 }}>Total</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{qty(tq.pq)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_purchases)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{qty(tq.sq)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.total_sales)}</td>
            </tr>
          )}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ─── Closing stock valuations ───────────────────────────────────────────

function ClosingStockTab({ canPost, canCancel }: { canPost: boolean; canCancel: boolean }) {
  const { canFeature } = useCan()
  const [list, setList] = useState<InventoryValuation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [period, setPeriod] = useState(currentPeriod())
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newError, setNewError] = useState<string[] | null>(null)
  const [open, setOpen] = useState<InventoryValuation | null>(null)

  // State is set only after the await, so this is safe to call from an effect.
  const load = () => accountsApi.listValuations()
    .then((d: InventoryValuation[]) => { setList(d); setError(null) })
    .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load closing-stock valuations')))
    .finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const create = async () => {
    setCreating(true); setNewError(null)
    try {
      const v: InventoryValuation = await accountsApi.createValuation(period, notes.trim() || undefined)
      setNotes('')
      setShowNew(false)
      setOpen(v)
      load()
    } catch (err: unknown) {
      setNewError(extractErrorMessages(err, `Could not create the closing-stock valuation for ${period}`))
    } finally { setCreating(false) }
  }

  const openValuation = async (id: number) => {
    setError(null)
    try { setOpen(await accountsApi.getValuation(id)) }
    catch (err: unknown) { setError(extractErrorMessages(err, 'Could not open the valuation')) }
  }

  if (open) {
    return <ValuationDetail valuation={open} canPost={canPost} canCancel={canCancel} onChange={(v) => { setOpen(v); load() }} onBack={() => { setOpen(null); load() }} />
  }

  return (
    <div>
      <InfoBanner>
        Periodic inventory (AS-2): during the month purchases are expensed to Purchase Accounts and nothing posts on store movements. At month end
        the stock on hand is valued at weighted average cost and posted as closing stock; it reverses the next day as the new month&apos;s opening stock,
        so the P&amp;L shows opening + purchases − closing = cost of materials consumed. A draft&apos;s quantities can be corrected from a physical count before posting.
      </InfoBanner>
      <ErrorBanner error={error} />
      {canFeature('accounts', 'inventory', 'closing_stock', 'create') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button data-tour="fin-inv-cs-new-btn" style={primaryBtnStyle} onClick={() => { setNewError(null); setShowNew(true) }}>+ New valuation</button>
        </div>
      )}
      {canFeature('accounts', 'inventory', 'closing_stock', 'create') && showNew && (
        <FormSheet width={580} tour="fin-inv-cs-new" icon="box" title="New closing-stock valuation" subtitle="Snapshot of Store stock on hand at weighted-average cost, as a Draft."
          onClose={() => setShowNew(false)} busy={creating}
          footer={<SheetFooter onCancel={() => setShowNew(false)} onSubmit={create} busy={creating} busyLabel="Creating…" label="Create draft from Store" icon="box" disabled={!period} submitTour="fin-inv-cs-create" />}>
          <SheetBody>
            <SheetError error={newError} />
            <SheetSection icon="calendar" title="Period">
              <SField label="Period (month)" req style={{ maxWidth: 200, marginBottom: 14 }} tour="fin-inv-cs-period" hint="The valuation is dated the last day of that month.">
                <input type="month" style={sheetInput} value={period} onChange={(e) => setPeriod(e.target.value)} />
              </SField>
              <SField label="Notes" optional tour="fin-inv-cs-notes">
                <input style={sheetInput} value={notes} placeholder="e.g. physical count by stores team" onChange={(e) => setNotes(e.target.value)} />
              </SField>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}
      <TableWrap minWidth={800} tour="fin-inv-cs-table">
        <thead>
          <tr>
            <th style={thStyle}>Period <RowCount count={list.length} /></th><th style={thStyle}>Valuation date</th><th style={numTh}>Closing stock (₹)</th>
            <th style={thStyle}>Status</th><th style={thStyle}>Journal</th><th style={thStyle}>Notes</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={7} text="Loading…" /> : list.length === 0 ? <EmptyRow colSpan={7} text="No closing-stock valuations yet — use + New valuation at month end." />
            : list.map((v) => (
              <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => openValuation(v.id)}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{v.accounting_period}</td>
                <td style={tdStyle}>{dmy(v.valuation_date)}</td>
                <td style={numTd}>{inr(v.total_value)}</td>
                <td style={tdStyle}><StatusPill status={v.status} labels={STATUS_LABELS} colors={STATUS_HEX} /></td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  {v.journal_entry_id ? <Link href={recordHref('/dashboard/finance/ledger', v, 'journal_entry_id', undefined, 'entry')} style={linkBtnStyle}>Open voucher</Link> : '—'}
                </td>
                <td style={{ ...tdStyle, maxWidth: 320, color: TEXT.secondary }}>{v.notes || ''}</td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <button style={linkBtnStyle} onClick={() => openValuation(v.id)}>{v.status === 'draft' ? 'Open' : 'View'}</button>
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

function ValuationDetail({ valuation, canPost, canCancel, onChange, onBack }: {
  valuation: InventoryValuation; canPost: boolean; canCancel: boolean; onChange: (v: InventoryValuation) => void; onBack: () => void
}) {
  const [error, setError] = useState<string[] | null>(null)
  const [confirmPost, setConfirmPost] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { canFeature } = useCan()
  const isDraft = valuation.status === 'draft'
  const canEditLines = isDraft && canFeature('accounts', 'inventory', 'closing_stock', 'edit')

  const saveLine = async (line: InventoryValuationLine, patch: { quantity?: number; rate?: number }) => {
    setError(null)
    try { onChange(await accountsApi.updateValuationLine(line.id, patch)) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not update ${line.item_code || line.item_name}`)) }
  }

  const post = async () => {
    setConfirmPost(false); setBusy(true); setError(null)
    try { onChange(await accountsApi.postValuation(valuation.id)) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not post closing stock for ${valuation.accounting_period}`)) }
    finally { setBusy(false) }
  }

  const cancel = async (reason: string) => {
    setCancelOpen(false); setBusy(true); setError(null)
    try { onChange(await accountsApi.cancelValuation(valuation.id, reason.trim())) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not cancel the valuation for ${valuation.accounting_period}`)) }
    finally { setBusy(false) }
  }

  const nextDay = (() => {
    const d = new Date(`${valuation.valuation_date}T00:00:00`)
    d.setDate(d.getDate() + 1)
    return dmy(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  })()

  return (
    <div data-tour="fin-inv-val-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div data-tour="fin-inv-val-header">
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading, display: 'flex', gap: 10, alignItems: 'center' }}>
            Closing stock {valuation.accounting_period}
            <StatusPill status={valuation.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
          </div>
          <div style={{ fontSize: 12.5, color: TEXT.secondary, marginTop: 4 }}>
            Valued on {dmy(valuation.valuation_date)} · {valuation.lines.length} item(s)
            {valuation.journal_entry_id && <> · <Link href={recordHref('/dashboard/finance/ledger', valuation, 'journal_entry_id', undefined, 'entry')} style={linkBtnStyle}>View journal voucher</Link></>}
          </div>
          {valuation.notes && <div style={{ fontSize: 12.5, color: TEXT.secondary, marginTop: 4 }}>{valuation.notes}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {canPost && isDraft && <button data-tour="fin-inv-val-post" style={primaryBtnStyle} disabled={busy} onClick={() => setConfirmPost(true)}>Post closing stock</button>}
          {canCancel && valuation.status !== 'cancelled' && <button data-tour="fin-inv-val-cancel" style={{ ...secondaryBtnStyle, color: '#b91c1c' }} disabled={busy} onClick={() => setCancelOpen(true)}>Cancel valuation</button>}
          <button data-tour="fin-inv-val-back" style={secondaryBtnStyle} onClick={onBack}>← Back</button>
        </div>
      </div>
      {!canPost && !canCancel && valuation.status !== 'cancelled' && <InfoBanner>Only a Finance Manager can post or cancel a closing-stock valuation.</InfoBanner>}
      {isDraft && <InfoBanner>Draft: correct any quantity from the physical count, or a rate (it becomes a manual rate), then post. Changes save when you leave the cell.</InfoBanner>}
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Closing stock value" value={`₹ ${inr(valuation.total_value)}`} tour="fin-inv-val-total" />
      </div>
      <TableWrap minWidth={1000} tour="fin-inv-val-lines">
        <thead>
          <tr>
            <th style={thStyle}>Code <RowCount count={valuation.lines.length} /></th><th style={thStyle}>Item</th><th style={thStyle}>Category</th>
            <th style={numTh}>Qty</th><th style={thStyle}>UoM</th><th style={numTh}>Rate (₹)</th><th style={numTh}>Value (₹)</th><th style={thStyle}>Rate source</th>
          </tr>
        </thead>
        <tbody>
          {valuation.lines.length === 0 ? <EmptyRow colSpan={8} text="No items — Store had no stock on hand when this valuation was created." />
            : valuation.lines.map((l) => (
              <tr key={l.id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{l.item_code || '—'}</td>
                <td style={tdStyle}>{l.item_name}</td>
                <td style={tdStyle}>{l.category || '—'}</td>
                <td style={numTd}>{canEditLines ? <NumCell key={`q-${l.id}-${l.quantity}`} value={l.quantity} onCommit={(v) => saveLine(l, { quantity: v })} /> : qty(l.quantity)}</td>
                <td style={tdStyle}>{l.uom || ''}</td>
                <td style={numTd}>{canEditLines ? <NumCell key={`r-${l.id}-${l.rate}`} value={l.rate} onCommit={(v) => saveLine(l, { rate: v })} /> : inr(l.rate)}</td>
                <td style={numTd}>{inr(l.value)}</td>
                <td style={tdStyle}><StatusPill status={l.rate_source} labels={SOURCE_LABELS} colors={SOURCE_HEX} /></td>
              </tr>
            ))}
          {valuation.lines.length > 0 && (
            <tr><td style={{ ...tdStyle, fontWeight: 800 }} colSpan={6}>Total</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(valuation.total_value)}</td><td style={tdStyle} /></tr>
          )}
        </tbody>
      </TableWrap>

      <ConfirmDialog
        open={confirmPost}
        title={`Post closing stock for ${valuation.accounting_period}?`}
        message={`Posts Dr Stock-in-Hand / Cr Changes in Inventories for ${inr(valuation.total_value)} on ${dmy(valuation.valuation_date)}. It reverses automatically on ${nextDay}, becoming next period's opening stock. After posting, the lines can't be edited — cancel and re-create instead.`}
        confirmLabel="Post"
        danger={false}
        onConfirm={post}
        onCancel={() => setConfirmPost(false)}
      />
      <ReasonSheet
        icon="x"
        open={cancelOpen}
        title={`Cancel closing stock for ${valuation.accounting_period}?`}
        message={valuation.status === 'posted'
          ? 'The posted entry and its next-day reversal will both be undone with counter-entries on their own dates. Give the reason.'
          : 'The draft will be marked cancelled. Give the reason.'}
        placeholder="Reason (required)"
        confirmLabel="Cancel valuation"
        requireValue
        onConfirm={cancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  )
}

/** Inline numeric input that saves on blur / Enter, only when the value changed.
 *  Keyed on the saved value, so it remounts with the server's figure after a save. */
function NumCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const commit = () => {
    const n = Number(text)
    if (text.trim() === '' || Number.isNaN(n)) { setText(String(value)); return }
    if (n !== value) onCommit(n)
  }
  return (
    <input type="number" min={0} step="any" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{ ...inputStyle, width: 110, textAlign: 'right', padding: '6px 8px' }} />
  )
}

