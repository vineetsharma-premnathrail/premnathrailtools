'use client'

/** Finance › Costing & Profitability sub-tabs:
 *  - Cost Estimates  CK11N run / CK13N itemisation / CK24 mark & release + price history
 *  - Order Variance  KKBC_ORD plan / target / actual per work order with variance split
 * Backend: accounts/routes/product_costing.py (logic production/cost_estimating.py). */
import React, { useEffect, useMemo, useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, SHEET, sheetInput, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SRow, SheetBody, SheetFooter, sw } from '@/components/finance/financeSheet'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import Select from '@/components/shared/Select'
import {
  productCostingApi, CostEstimate, CostEstimateLine, CostableItem, StandardPriceRow, OrderVariance, OrderVarianceSummary,
} from '@/lib/controllingCostingApi'
import {
  inr, dmy, todayIso, inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, thStyle, tdStyle,
  numTd, numTh, ErrorBanner, InfoBanner, StatusPill, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'

const EST_LABELS: Record<string, string> = { draft: 'Draft', marked: 'Marked', released: 'Released', superseded: 'Superseded', cancelled: 'Cancelled' }
const EST_HEX: Record<string, string> = { draft: '#64748b', marked: '#b45309', released: '#16a34a', superseded: '#0369a1', cancelled: '#64748b' }
const SOURCE_LABELS: Record<string, string> = {
  sub_estimate: 'Sub-assembly estimate', sub_rollup: 'Rolled up', job_work: 'Job work receipt', standard: 'Standard cost',
  moving_average: 'Moving average', activity_rate: 'Activity rate', workstation_rate: 'Work centre rate',
  costing_sheet: 'Costing sheet', none: 'No cost',
}
const COMPONENT_LABELS: Record<string, string> = { material: 'Material', job_work: 'Job work', labour: 'Labour', overhead: 'Overhead' }
const RED = '#dc2626'
const GREEN = '#16a34a'

function errText(e: unknown, fallback: string) {
  return extractErrorMessages(e, fallback).join(' ')
}

function varColor(v: number) {
  return v > 0.005 ? RED : v < -0.005 ? GREEN : TEXT.body
}

// ─────────────────────────────────────────────────────────────────────────
// Cost estimates (CK11N / CK13N / CK24)
// ─────────────────────────────────────────────────────────────────────────

export function CostEstimatesTab() {
  const { can, canFeature } = useCan()
  const seeHistory = canFeature('accounts', 'product_costing', 'price_history', 'view')
  const canCreate = can('accounts', 'product_costing', 'create')
  const canMark = can('accounts', 'product_costing', 'edit')
  const canRelease = can('accounts', 'product_costing', 'approve')
  const canCancel = can('accounts', 'product_costing', 'delete')

  const [rows, setRows] = useState<CostEstimate[]>([])
  const [items, setItems] = useState<CostableItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [form, setForm] = useState({ item_id: '', bom_id: '', costing_date: todayIso(), lot_size: '', material_overhead_pct: '', labour_overhead_pct: '', remarks: '' })
  const [running, setRunning] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CostEstimate | null>(null)
  const [history, setHistory] = useState<StandardPriceRow[]>([])
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseFrom, setReleaseFrom] = useState(todayIso())
  const [cancelOpen, setCancelOpen] = useState(false)
  const [unmarkOpen, setUnmarkOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setRows(await productCostingApi.list({ search: search || undefined, status: status || undefined }))
      setError(null)
    } catch (e) { setError(errText(e, 'Could not load cost estimates')) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { productCostingApi.costableItems().then(setItems).catch(() => setItems([])) }, [])

  const item = items.find((i) => String(i.item_id) === form.item_id)
  const itemOptions = useMemo(() => items.map((i) => ({ value: String(i.item_id), label: `${i.item_code} — ${i.item_name}` })), [items])

  const open = async (id: number) => {
    try {
      const est = await productCostingApi.get(id)
      setSelected(est)
      setHistory(seeHistory ? await productCostingApi.priceHistory(est.item_id) : [])
      setError(null)
    } catch (e) { setError(errText(e, 'Could not open the estimate')) }
  }

  const run = async () => {
    if (!form.item_id) { setRunError('Pick the item to cost.'); return }
    setRunning(true); setRunError(null)
    try {
      const est = await productCostingApi.run({
        item_id: Number(form.item_id), bom_id: form.bom_id ? Number(form.bom_id) : undefined, costing_date: form.costing_date || undefined,
        lot_size: form.lot_size ? Number(form.lot_size) : undefined,
        material_overhead_pct: form.material_overhead_pct === '' ? undefined : Number(form.material_overhead_pct),
        labour_overhead_pct: form.labour_overhead_pct === '' ? undefined : Number(form.labour_overhead_pct),
        remarks: form.remarks || undefined,
      })
      setNotice(`${est.estimate_number} costed: ${inr(est.total_cost)} for a lot of ${est.lot_size} (unit ${inr(est.unit_cost)}).`)
      setError(null)
      setShowRun(false)
      await load()
      await open(est.id)
    } catch (e) { setRunError(errText(e, 'Could not run the cost estimate')) } finally { setRunning(false) }
  }

  const act = async (fn: () => Promise<CostEstimate>, done: string, fail: string) => {
    try {
      const est = await fn()
      setNotice(done.replace('{n}', est.estimate_number))
      setError(null)
      await load()
      await open(est.id)
    } catch (e) { setError(errText(e, fail)) }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <InfoBanner>
        A cost estimate costs one lot of a product from its production BOM and routing on the costing date: components (a sub-assembly takes its own released estimate,
        else its BOM is rolled up), job-work charges, routing hours × activity rate, and costing-sheet overhead. Mark it, then a controller releases it — that sets the
        item&apos;s standard price from the chosen date and keeps the old price in the history. No journal is posted (periodic inventory).
      </InfoBanner>

      {canCreate && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button data-tour="costing-run-btn" style={primaryBtnStyle} onClick={() => { setRunError(null); setShowRun(true) }}>+ Run cost estimate</button>
        </div>
      )}
      {canCreate && showRun && (
        <FormSheet width={580} tour="costing-run" icon="rupee" title="Run a cost estimate" subtitle="Costs one lot of a product from its production BOM and routing on the costing date." onClose={() => setShowRun(false)} busy={running}
          footer={<SheetFooter onCancel={() => setShowRun(false)} onSubmit={run} busy={running} busyLabel="Costing…" label="Run estimate" />}>
          <SheetBody>
            <SheetError error={runError} />
            <SheetSection icon="box" title="Item">
              <SField label="Item (has a production BOM)" req style={{ marginBottom: 14 }}>
                <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v, bom_id: '' })} options={itemOptions} placeholder="Pick a product or sub-assembly" />
              </SField>
              <SRow mb={0}>
                <SField label="BOM version" style={sw(220)}>
                  <Select style={sheetInput} value={form.bom_id} onChange={(e) => setForm({ ...form, bom_id: e.target.value })} disabled={!item}>
                    <option value="">Active version</option>
                    {item?.boms.map((b) => <option key={b.id} value={b.id}>{b.bom_number} v{b.version} ({b.status})</option>)}
                  </Select>
                </SField>
                <SField label="Costing date" style={sw(160)}><DateField value={form.costing_date} onChange={(v) => setForm({ ...form, costing_date: v })} /></SField>
                <SField label="Lot size" style={sw(120)} hint="Blank = BOM base">
                  <input style={sheetInput} type="number" min={0} value={form.lot_size} placeholder="BOM base" onChange={(e) => setForm({ ...form, lot_size: e.target.value })} />
                </SField>
              </SRow>
            </SheetSection>
            <SheetSection icon="gear" title="Overhead">
              <SRow>
                <SField label="Material OH %" style={sw(140)} hint="Blank = costing sheet">
                  <input style={sheetInput} type="number" min={0} value={form.material_overhead_pct} placeholder="Costing sheet" onChange={(e) => setForm({ ...form, material_overhead_pct: e.target.value })} />
                </SField>
                <SField label="Labour OH %" style={sw(140)} hint="Blank = costing sheet">
                  <input style={sheetInput} type="number" min={0} value={form.labour_overhead_pct} placeholder="Costing sheet" onChange={(e) => setForm({ ...form, labour_overhead_pct: e.target.value })} />
                </SField>
              </SRow>
              <SField label="Remarks" optional>
                <input style={sheetInput} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </SField>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, maxWidth: 280 }} placeholder="Search item / estimate no." value={search}
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load() }} />
        <Select style={{ ...inputStyle, maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(EST_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <button style={secondaryBtnStyle} onClick={load}>Search</button>
      </div>

      <TableWrap minWidth={1100} maxHeight="calc(100vh - 420px)" tour="costing-list">
        <thead>
          <tr>
            <th style={thStyle}>Estimate</th><th style={thStyle}>Item</th><th style={thStyle}>BOM</th><th style={thStyle}>Costing date</th>
            <th style={numTh}>Lot</th><th style={numTh}>Material</th><th style={numTh}>Job work</th><th style={numTh}>Labour</th>
            <th style={numTh}>Overhead</th><th style={numTh}>Unit cost</th><th style={thStyle}>Status</th><th style={thStyle}>Valid</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={13} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={13} text="No cost estimates yet." /> : rows.map((r) => (
            <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer', background: selected?.id === r.id ? 'rgba(15,118,110,.06)' : undefined }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.estimate_number}</td>
              <td style={tdStyle}>{r.item_code} — {r.item_name}</td>
              <td style={tdStyle}>{r.bom_number} v{r.bom_version}</td>
              <td style={tdStyle}>{dmy(r.costing_date)}</td>
              <td style={numTd}>{r.lot_size}</td>
              <td style={numTd}>{inr(r.material_cost)}</td>
              <td style={numTd}>{inr(r.job_work_cost, { blankZero: true })}</td>
              <td style={numTd}>{inr(r.labour_cost)}</td>
              <td style={numTd}>{inr(r.overhead_cost, { blankZero: true })}</td>
              <td style={{ ...numTd, fontWeight: 700 }}>{inr(r.unit_cost)}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={EST_LABELS} colors={EST_HEX} /></td>
              <td style={tdStyle}>{r.valid_from ? `${dmy(r.valid_from)} → ${r.valid_to ? dmy(r.valid_to) : 'open'}` : '—'}</td>
              <td style={tdStyle} onClick={(e) => e.stopPropagation()}><span style={linkBtnStyle} onClick={() => open(r.id)}>View</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {selected && (
        <EstimateDetail est={selected} history={seeHistory ? history : null}
          actions={
            <>
              {selected.status === 'draft' && canMark && <button style={primaryBtnStyle} onClick={() => act(() => productCostingApi.mark(selected.id), '{n} marked — a controller can now release it.', 'Could not mark the estimate')}>Mark for release</button>}
              {selected.status === 'marked' && canRelease && <button style={primaryBtnStyle} onClick={() => { setReleaseFrom(todayIso()); setReleaseOpen(true) }}>Release to standard price</button>}
              {selected.status === 'marked' && canMark && <button style={secondaryBtnStyle} onClick={() => setUnmarkOpen(true)}>Unmark</button>}
              {['draft', 'marked'].includes(selected.status) && canCancel && <button style={secondaryBtnStyle} onClick={() => setCancelOpen(true)}>Cancel estimate</button>}
              <button style={secondaryBtnStyle} onClick={() => setSelected(null)}>Close</button>
            </>
          } />
      )}

      {releaseOpen && selected && (
        <ReleaseDialog est={selected} validFrom={releaseFrom} setValidFrom={setReleaseFrom} onCancel={() => setReleaseOpen(false)}
          onConfirm={() => { setReleaseOpen(false); act(() => productCostingApi.release(selected.id, { valid_from: releaseFrom }), '{n} released — the item\'s standard price is updated.', 'Could not release the estimate') }} />
      )}
      <ReasonSheet icon="x" open={cancelOpen} title="Cancel cost estimate" message="Why is this estimate being cancelled? (kept on the audit trail)" requireValue confirmLabel="Cancel estimate"
        onCancel={() => setCancelOpen(false)}
        onConfirm={(reason) => { setCancelOpen(false); if (selected) act(() => productCostingApi.cancel(selected.id, reason), '{n} cancelled.', 'Could not cancel the estimate') }} />
      <ConfirmDialog open={unmarkOpen} title="Remove the mark?" message="The estimate goes back to draft and can't be released until it is marked again." confirmLabel="Unmark" danger={false}
        onCancel={() => setUnmarkOpen(false)}
        onConfirm={() => { setUnmarkOpen(false); if (selected) act(() => productCostingApi.unmark(selected.id), '{n} is a draft again.', 'Could not unmark the estimate') }} />
    </div>
  )
}

function ReleaseDialog({ est, validFrom, setValidFrom, onCancel, onConfirm }: {
  est: CostEstimate; validFrom: string; setValidFrom: (v: string) => void; onCancel: () => void; onConfirm: () => void
}) {
  useEscapeKey(true, onCancel)
  return (
    <FormSheet width={580} icon="check" iconColor={GREEN} title={`Release ${est.estimate_number}`} subtitle={`${est.item_code} — ${est.item_name}`} onClose={onCancel} busy={false}
      footer={<SheetFooter onCancel={onCancel} onSubmit={onConfirm} busy={false} label="Release" color={GREEN} disabled={!validFrom} />}>
      <SheetBody>
        <p style={{ fontSize: 13, color: SHEET.BODY, lineHeight: 1.6, margin: '0 0 16px' }}>
          Standard price of {est.item_code}: {est.current_standard_cost == null ? 'not set' : inr(est.current_standard_cost)} → <b>{inr(est.unit_cost)}</b>.
          The previously released price ends the day before the date below. No journal is posted.
        </p>
        <SField label="Valid from" req style={{ maxWidth: 200 }}><DateField value={validFrom} onChange={setValidFrom} /></SField>
      </SheetBody>
    </FormSheet>
  )
}

function EstimateDetail({ est, history, actions }: { est: CostEstimate; history: StandardPriceRow[] | null; actions: React.ReactNode }) {
  const lines = est.lines || []
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const hasChildren = useMemo(() => new Set(lines.map((l) => l.parent_line_id).filter(Boolean) as number[]), [lines])
  const parentOf = useMemo(() => new Map(lines.map((l) => [l.id, l.parent_line_id])), [lines])
  const hidden = (l: CostEstimateLine) => {
    let p = l.parent_line_id
    while (p) { if (collapsed.has(p)) return true; p = parentOf.get(p) ?? null }
    return false
  }
  const toggle = (id: number) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div style={sectionStyle} data-tour="costing-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading }}>{est.estimate_number} <StatusPill status={est.status} labels={EST_LABELS} colors={EST_HEX} /></div>
          <div style={{ fontSize: 12.5, color: TEXT.secondary, marginTop: 4 }}>
            {est.item_code} — {est.item_name} · {est.bom_number} v{est.bom_version} · costed {dmy(est.costing_date)} for a lot of {est.lot_size}
            {est.created_by_name ? ` · by ${est.created_by_name}` : ''}
            {est.released_by_name ? ` · released by ${est.released_by_name} (valid ${dmy(est.valid_from)} → ${est.valid_to ? dmy(est.valid_to) : 'open'})` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>{actions}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Material" value={inr(est.material_cost)} />
        <StatCard label="Job work" value={inr(est.job_work_cost)} />
        <StatCard label="Labour" value={inr(est.labour_cost)} />
        <StatCard label={`Overhead (${est.material_overhead_pct}% / ${est.labour_overhead_pct}%)`} value={inr(est.overhead_cost)} />
        <StatCard label="Total (lot)" value={inr(est.total_cost)} />
        <StatCard label="Unit cost" value={inr(est.unit_cost)} tone="#0f766e" />
        <StatCard label="Current standard" value={est.current_standard_cost == null ? '—' : inr(est.current_standard_cost)} />
      </div>
      {est.warnings.length > 0 && (
        <InfoBanner tone="warning"><b>Check before marking:</b><ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{est.warnings.map((w) => <li key={w}>{w}</li>)}</ul></InfoBanner>
      )}
      <TableWrap minWidth={1150} maxHeight="calc(100vh - 300px)">
        <thead>
          <tr>
            <th style={thStyle}>Lvl</th><th style={thStyle}>Line</th><th style={numTh}>Qty</th><th style={thStyle}>UoM</th><th style={numTh}>Unit (₹)</th>
            <th style={numTh}>Material</th><th style={numTh}>Job work</th><th style={numTh}>Labour</th><th style={numTh}>Overhead</th>
            <th style={numTh}>Amount</th><th style={thStyle}>Source</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? <EmptyRow colSpan={11} text="No lines." /> : lines.filter((l) => !hidden(l)).map((l) => (
            <tr key={l.id} style={{ color: l.level > 1 ? TEXT.secondary : undefined }}>
              <td style={tdStyle}>{l.level}</td>
              <td style={{ ...tdStyle, paddingLeft: 12 + (l.level - 1) * 18 }}>
                {hasChildren.has(l.id) && <span style={{ ...linkBtnStyle, marginRight: 6 }} onClick={() => toggle(l.id)}>{collapsed.has(l.id) ? '▸' : '▾'}</span>}
                {l.line_type === 'activity' ? '⚙ ' : l.line_type === 'overhead' ? '∑ ' : ''}{l.description}
                {l.sub_estimate_number && <span style={{ fontSize: 11, color: TEXT.muted }}> ({l.sub_estimate_number})</span>}
              </td>
              <td style={numTd}>{l.quantity}</td>
              <td style={tdStyle}>{l.uom || ''}</td>
              <td style={numTd}>{l.line_type === 'overhead' ? `${(l.unit_cost * 100).toFixed(2)}%` : inr(l.unit_cost)}</td>
              <td style={numTd}>{inr(l.material_amount, { blankZero: true })}</td>
              <td style={numTd}>{inr(l.job_work_amount, { blankZero: true })}</td>
              <td style={numTd}>{inr(l.labour_amount, { blankZero: true })}</td>
              <td style={numTd}>{inr(l.overhead_amount, { blankZero: true })}</td>
              <td style={{ ...numTd, fontWeight: l.level === 1 ? 700 : 400 }}>{inr(l.amount)}</td>
              <td style={{ ...tdStyle, color: l.cost_source === 'none' ? RED : TEXT.secondary }}>{SOURCE_LABELS[l.cost_source] || l.cost_source}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {history && <>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '6px 0 8px' }}>Standard price history — {est.item_code}</div>
      <TableWrap minWidth={800} maxHeight="260px">
        <thead><tr><th style={thStyle}>Valid from</th><th style={thStyle}>Valid to</th><th style={numTh}>Standard price</th><th style={numTh}>Previous</th><th style={thStyle}>Source</th><th style={thStyle}>Estimate</th><th style={thStyle}>Released by</th></tr></thead>
        <tbody>
          {history.length === 0 ? <EmptyRow colSpan={7} text="No standard price released from an estimate yet." /> : history.map((h) => (
            <tr key={h.id}>
              <td style={tdStyle}>{dmy(h.valid_from)}</td><td style={tdStyle}>{h.valid_to ? dmy(h.valid_to) : 'open'}</td>
              <td style={{ ...numTd, fontWeight: 700 }}>{inr(h.standard_cost)}</td><td style={numTd}>{h.previous_cost == null ? '—' : inr(h.previous_cost)}</td>
              <td style={tdStyle}>{h.source}</td><td style={tdStyle}>{h.estimate_number || '—'}</td><td style={tdStyle}>{h.released_by_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      </>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Order variance (KKBC_ORD)
// ─────────────────────────────────────────────────────────────────────────

const WO_STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In progress', completed: 'Completed', closed: 'Closed' }
const WO_STATUS_HEX: Record<string, string> = { draft: '#64748b', released: '#0369a1', in_progress: '#b45309', completed: '#16a34a', closed: '#475569' }
const PLAN_SOURCE: Record<string, string> = { released_estimate: 'Released estimate', bom_preview: 'BOM (no released estimate)', none: 'No plan' }

export function OrderVarianceTab() {
  const [rows, setRows] = useState<OrderVarianceSummary[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<OrderVariance | null>(null)

  useEffect(() => {
    setLoading(true)
    productCostingApi.orderVariances({ status: status || undefined })
      .then((r) => { setRows(r); setError(null) })
      .catch((e) => setError(errText(e, 'Could not load work-order variances')))
      .finally(() => setLoading(false))
  }, [status])

  const open = async (id: number) => {
    try { setDetail(await productCostingApi.orderVariance(id)); setError(null) } catch (e) { setError(errText(e, 'Could not load the order\'s cost analysis')) }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <InfoBanner>
        Plan = the product&apos;s released cost estimate × planned quantity. Target = the same for the quantity completed (planned quantity while nothing is completed).
        Actual = material issued − returned at the value actually issued, labour booked on the shop floor, and overhead from the period-end run. Positive variance = over target.
      </InfoBanner>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <Select style={{ ...inputStyle, maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All work orders</option>
          {Object.entries(WO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <TableWrap minWidth={1050} maxHeight="calc(100vh - 420px)" tour="order-variance-list">
        <thead><tr>
          <th style={thStyle}>Work order</th><th style={thStyle}>Product</th><th style={thStyle}>Status</th><th style={numTh}>Planned</th><th style={numTh}>Done</th>
          <th style={thStyle}>Plan from</th><th style={numTh}>Plan</th><th style={numTh}>Target</th><th style={numTh}>Actual</th><th style={numTh}>Variance</th><th style={thStyle}></th>
        </tr></thead>
        <tbody>
          {loading ? <EmptyRow colSpan={11} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={11} text="No work orders." /> : rows.map((r) => (
            <tr key={r.work_order_id} onClick={() => open(r.work_order_id)} style={{ cursor: 'pointer' }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.wo_number}</td><td style={tdStyle}>{r.product_label}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={WO_STATUS_LABELS} colors={WO_STATUS_HEX} /></td>
              <td style={numTd}>{r.quantity_planned}</td><td style={numTd}>{r.quantity_completed}</td>
              <td style={tdStyle}>{r.estimate_number || PLAN_SOURCE[r.plan_source]}</td>
              <td style={numTd}>{inr(r.plan_total)}</td><td style={numTd}>{inr(r.target_total)}</td><td style={numTd}>{inr(r.actual_total)}</td>
              <td style={{ ...numTd, fontWeight: 700, color: varColor(r.total_variance) }}>{inr(r.total_variance)}{r.total_variance_pct != null ? ` (${r.total_variance_pct}%)` : ''}</td>
              <td style={tdStyle} onClick={(e) => e.stopPropagation()}><span style={linkBtnStyle} onClick={() => open(r.work_order_id)}>View</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {detail && <OrderVarianceDetail v={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function OrderVarianceDetail({ v, onClose }: { v: OrderVariance; onClose: () => void }) {
  return (
    <div style={sectionStyle} data-tour="order-variance-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading }}>{v.wo_number} — {v.product_label}</div>
          <div style={{ fontSize: 12.5, color: TEXT.secondary, marginTop: 4 }}>
            Plan from {v.estimate_number || PLAN_SOURCE[v.plan_source]} · target on {v.target_basis} quantity · overhead {v.overhead_basis === 'overhead_run' ? 'from the period-end run' : `at plan % (${v.material_overhead_pct}% / ${v.labour_overhead_pct}%)`}
          </div>
        </div>
        <button style={secondaryBtnStyle} onClick={onClose}>Close</button>
      </div>
      {v.plan_message && <InfoBanner tone="warning">{v.plan_message}</InfoBanner>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Target" value={inr(v.target_total)} />
        <StatCard label="Actual" value={inr(v.actual_total)} />
        <StatCard label="Variance" value={`${inr(v.total_variance)}${v.total_variance_pct != null ? ` (${v.total_variance_pct}%)` : ''}`} tone={varColor(v.total_variance)} />
        <StatCard label="Input quantity var." value={inr(v.variance_split.input_quantity)} tone={varColor(v.variance_split.input_quantity)} />
        <StatCard label="Input price var." value={inr(v.variance_split.input_price)} tone={varColor(v.variance_split.input_price)} />
        <StatCard label="Resource usage var." value={inr(v.variance_split.resource_usage)} tone={varColor(v.variance_split.resource_usage)} />
        <StatCard label="Labour rate var." value={inr(v.variance_split.rate)} tone={varColor(v.variance_split.rate)} />
        <StatCard label="Scrap (at plan)" value={inr(v.scrap_variance)} />
        <StatCard label="Received to stock" value={inr(v.relieved_to_stock)} />
        <StatCard label="Open WIP" value={inr(v.open_wip)} />
      </div>
      <TableWrap minWidth={700} maxHeight="260px">
        <thead><tr><th style={thStyle}>Cost component</th><th style={numTh}>Plan</th><th style={numTh}>Target</th><th style={numTh}>Actual</th><th style={numTh}>Variance</th><th style={numTh}>%</th></tr></thead>
        <tbody>{v.components.map((c) => (
          <tr key={c.component}><td style={tdStyle}>{COMPONENT_LABELS[c.component]}</td><td style={numTd}>{inr(c.plan)}</td><td style={numTd}>{inr(c.target)}</td>
            <td style={numTd}>{inr(c.actual)}</td><td style={{ ...numTd, color: varColor(c.variance), fontWeight: 700 }}>{inr(c.variance)}</td><td style={numTd}>{c.variance_pct ?? '—'}</td></tr>
        ))}</tbody>
      </TableWrap>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '6px 0 8px' }}>Material</div>
      <TableWrap minWidth={1150} maxHeight="320px">
        <thead><tr>
          <th style={thStyle}>Item</th><th style={numTh}>Target qty</th><th style={numTh}>Actual qty</th><th style={numTh}>Plan rate</th><th style={numTh}>Target</th>
          <th style={numTh}>Actual</th><th style={numTh}>Qty var.</th><th style={numTh}>Price var.</th><th style={numTh}>Total var.</th>
        </tr></thead>
        <tbody>{v.materials.length === 0 ? <EmptyRow colSpan={9} text="No material planned or issued." /> : v.materials.map((m) => (
          <tr key={m.item_id}>
            <td style={tdStyle}>{m.item_code} — {m.item_name}{!m.planned && <span style={{ color: RED, fontSize: 11 }}> (not on plan)</span>}</td>
            <td style={numTd}>{m.target_qty}</td><td style={numTd}>{m.actual_qty}</td><td style={numTd}>{inr(m.plan_rate)}</td>
            <td style={numTd}>{inr(m.target_amount)}</td><td style={numTd}>{inr(m.actual_amount)}</td>
            <td style={{ ...numTd, color: varColor(m.quantity_variance) }}>{inr(m.quantity_variance)}</td>
            <td style={{ ...numTd, color: varColor(m.price_variance) }}>{inr(m.price_variance)}</td>
            <td style={{ ...numTd, fontWeight: 700, color: varColor(m.total_variance) }}>{inr(m.total_variance)}</td>
          </tr>
        ))}</tbody>
      </TableWrap>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '6px 0 8px' }}>Labour by work centre</div>
      <TableWrap minWidth={1050} maxHeight="260px">
        <thead><tr>
          <th style={thStyle}>Work centre</th><th style={numTh}>Target h</th><th style={numTh}>Actual h</th><th style={numTh}>Plan rate</th><th style={numTh}>Target</th>
          <th style={numTh}>Actual</th><th style={numTh}>Usage var.</th><th style={numTh}>Rate var.</th><th style={numTh}>Total var.</th>
        </tr></thead>
        <tbody>{v.labour.length === 0 ? <EmptyRow colSpan={9} text="No routing hours planned or booked." /> : v.labour.map((l) => (
          <tr key={String(l.workstation_id)}>
            <td style={tdStyle}>{l.workstation}</td><td style={numTd}>{l.target_hours}</td><td style={numTd}>{l.actual_hours}</td><td style={numTd}>{inr(l.plan_rate)}</td>
            <td style={numTd}>{inr(l.target_amount)}</td><td style={numTd}>{inr(l.actual_amount)}</td>
            <td style={{ ...numTd, color: varColor(l.usage_variance) }}>{inr(l.usage_variance)}</td>
            <td style={{ ...numTd, color: varColor(l.rate_variance) }}>{inr(l.rate_variance)}</td>
            <td style={{ ...numTd, fontWeight: 700, color: varColor(l.total_variance) }}>{inr(l.total_variance)}</td>
          </tr>
        ))}</tbody>
      </TableWrap>
    </div>
  )
}
