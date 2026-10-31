'use client'

// PO Tracking — "which POs are with the vendor, what is due this week, what is late, what is partly
// received, what is waiting for approval, what is closed?" One row per purchase order (a split
// requisition has several), each with its own vendor, stage, delivery date, progress and value.
// Filtering, sorting and paging run on the server (GET /p2p/po-reports/tracking), so the counts and
// totals are real. A row opens a side detail: Items · Receipts · Approval · Documents · Timeline.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { poReportsApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { inputStyle, pageBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, RowCount, Pill, StatChip } from '@/components/shared/ui'
import Select from '@/components/shared/Select'
import { sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import POTrackingDetail from '@/components/p2p/POTrackingDetail'
import { DueChip, FiltersButton, FiltersSheet, PO_CARD, PO_TD, PO_TH, STAGE_ORDER, StageBadge, TrackRow, clip, clip2, money } from '@/components/p2p/POTrackingShared'

type Data = {
  rows: TrackRow[]; total: number; skip: number; limit: number; counts: Record<string, number>; all: number
  overdue: number; due_soon: number; open_value: number | null; due_soon_days: number
}
type SortKey = 'code' | 'urgency' | 'due' | 'date' | 'vendor' | 'stage' | 'value' | 'progress'

const PAGE = 50
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'code', label: 'PO number (A → Z)' }, { value: 'urgency', label: 'Most urgent first' }, { value: 'due', label: 'Delivery date' },
  { value: 'date', label: 'PO date' }, { value: 'vendor', label: 'Vendor' }, { value: 'stage', label: 'Stage' },
  { value: 'value', label: 'PO value' }, { value: 'progress', label: 'Delivered %' },
]
const COLUMNS: { label: string; sort?: SortKey; compactHide?: boolean; cut?: boolean }[] = [
  { label: 'PO', sort: 'code' }, { label: 'PO date', sort: 'date' }, { label: 'Stage', sort: 'stage' }, { label: 'Vendor', sort: 'vendor', cut: true }, { label: 'Requisition' },
  { label: 'Charged to', compactHide: true, cut: true }, { label: 'Buyer', compactHide: true, cut: true }, { label: 'Delivery', sort: 'due' }, { label: 'Delivered', sort: 'progress' },
  { label: 'Value', sort: 'value', compactHide: true }, { label: 'Last activity', compactHide: true },
]

const th: React.CSSProperties = PO_TH
const td: React.CSSProperties = { ...PO_TD, verticalAlign: 'middle' }
const NO_FILTERS = { stage: '', delivery: '', vendorId: '', buyerId: '', dateFrom: '', dateTo: '', opFilter: null as OrderProjectValue | null, sort: 'code' as SortKey }

function useNarrow(limit = 1180) {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < limit)
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [limit])
  return narrow
}

function Progress({ row }: { row: TrackRow }) {
  if (row.stage === 'draft' || row.stage === 'in_approval' || row.stage === 'cancelled') return <span style={{ color: TEXT.muted }}>—</span>
  const pct = Math.max(0, Math.min(100, row.received_pct))
  const hex = row.stage === 'short_closed' ? '#7c3aed' : pct >= 100 ? '#16a34a' : '#d97706'
  const text = row.ordered_qty != null && row.delivered_qty != null
    ? `${+row.delivered_qty.toFixed(3)} / ${+row.ordered_qty.toFixed(3)} ${row.unit || ''}`
    : `${row.lines_complete} of ${row.lines} lines`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <div style={{ width: 48, height: 6, flex: 'none', borderRadius: 9999, background: 'rgba(0,0,0,.07)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: hex }} />
      </div>
      <span style={{ fontSize: 11.5, color: TEXT.muted }}>{Math.round(pct)}% · {text}</span>
    </div>
  )
}

export default function POTrackingList({ lead }: { lead?: React.ReactNode }) {
  const narrow = useNarrow()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filtersError, setFiltersError] = useState('')
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([])
  const [buyers, setBuyers] = useState<{ id: number; name: string }[]>([])

  // The "bucket" of the old PO Tracking link / bell (?bucket=overdue | due_soon | <stage>) pre-sets a chip.
  const bucket = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('bucket')
  const [stage, setStage] = useState(bucket && (STAGE_ORDER as readonly string[]).includes(bucket) ? bucket : '')
  const [overdueOnly, setOverdueOnly] = useState(bucket === 'overdue')
  const [dueSoonOnly, setDueSoonOnly] = useState(bucket === 'due_soon')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [buyerId, setBuyerId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [opFilter, setOpFilter] = useState<OrderProjectValue | null>(null)
  // Default order is PO number A → Z (the app standard); "Most urgent first" is one pick away.
  const [sort, setSort] = useState<SortKey>('code')
  const [desc, setDesc] = useState(false)
  const [skip, setSkip] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [draft, setDraft] = useState(NO_FILTERS)
  const [selected, setSelected] = useState<TrackRow | null>(null)
  const reqId = useRef(0)

  const loadFilters = useCallback(() => {
    setFiltersError('')
    poReportsApi.trackingFilters().then((o) => { setVendors(o.vendors); setBuyers(o.buyers) })
      .catch((err) => setFiltersError(extractErrorMessages(err, 'Could not load the vendor and buyer lists.').join(' ')))
  }, [])
  useEffect(() => { loadFilters() }, [loadFilters])

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setSkip(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    const id = ++reqId.current
    setLoading(true)
    poReportsApi.tracking({
      stage: stage || undefined, search: query || undefined, vendor_id: vendorId || undefined, buyer_id: buyerId || undefined,
      overdue_only: overdueOnly || undefined, due_soon_only: dueSoonOnly || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined,
      ...(opFilter ? (opFilter.elementId ? { order_project_element_id: opFilter.elementId } : { order_project_id: opFilter.projectId }) : {}),
      sort, desc, skip, limit: PAGE,
    })
      .then((d: Data) => { if (id === reqId.current) { setData(d); setError('') } })
      .catch((err) => { if (id === reqId.current) setError(extractErrorMessages(err, 'Could not load the purchase orders.').join(' ')) })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [stage, query, vendorId, buyerId, overdueOnly, dueSoonOnly, dateFrom, dateTo, opFilter, sort, desc, skip])

  useEffect(() => { Promise.resolve().then(load) }, [load])

  const filtered = !!(stage || query || vendorId || buyerId || overdueOnly || dueSoonOnly || dateFrom || dateTo || opFilter)
  const activeFilterCount = [stage, vendorId, buyerId, overdueOnly || dueSoonOnly, dateFrom, dateTo, opFilter].filter(Boolean).length
  const reset = () => {
    setStage(''); setSearch(''); setQuery(''); setVendorId(''); setBuyerId(''); setOverdueOnly(false); setDueSoonOnly(false)
    setDateFrom(''); setDateTo(''); setOpFilter(null); setSort('code'); setDesc(false); setSkip(0); setShowFilters(false)
  }
  const openFilters = () => {
    setDraft({ stage, delivery: overdueOnly ? 'overdue' : dueSoonOnly ? 'due_soon' : '', vendorId, buyerId, dateFrom, dateTo, opFilter, sort })
    setShowFilters(true)
  }
  const applyFilters = () => {
    setStage(draft.stage); setOverdueOnly(draft.delivery === 'overdue'); setDueSoonOnly(draft.delivery === 'due_soon')
    setVendorId(draft.vendorId); setBuyerId(draft.buyerId); setDateFrom(draft.dateFrom); setDateTo(draft.dateTo); setOpFilter(draft.opFilter)
    if (draft.sort !== sort) { setSort(draft.sort); setDesc(false) }
    setSkip(0); setShowFilters(false)
  }
  // Count chips = quick filters on the same states the Filters popup sets (Stage, Delivery); clicking the active one clears it.
  const chipOverdue = overdueOnly && !stage
  const chipDueSoon = dueSoonOnly && !stage
  const chipWithVendor = stage === 'with_vendor' && !overdueOnly && !dueSoonOnly
  const chipAll = !stage && !overdueOnly && !dueSoonOnly
  const pickChip = (c: 'all' | 'overdue' | 'due_soon' | 'with_vendor') => {
    setStage(c === 'with_vendor' && !chipWithVendor ? 'with_vendor' : '')
    setOverdueOnly(c === 'overdue' && !chipOverdue)
    setDueSoonOnly(c === 'due_soon' && !chipDueSoon)
    setSkip(0)
  }
  const sortBy = (key: SortKey) => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(false) } setSkip(0) }

  const rows = data?.rows ?? []
  const split = !!selected && !narrow
  const columns = COLUMNS.filter((c) => !(split && c.compactHide))
  const vendorOptions = useMemo(() => [{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: String(v.id), label: v.name }))], [vendors])
  const buyerOptions = useMemo(() => [{ value: '', label: 'All buyers' }, ...buyers.map((b) => ({ value: String(b.id), label: b.name }))], [buyers])
  const sortOptions = SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
  const counts = data?.counts ?? {}
  const stageLabel = (s: string) => (s === 'with_vendor' ? 'With vendor' : s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '))
  const to = Math.min((data?.skip ?? 0) + rows.length, data?.total ?? 0)

  return (
    <div>
      {filtersError && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{filtersError} The Vendor and Buyer filters are empty until it loads.</span>
          <button type="button" onClick={loadFilters} style={smallSecondaryBtnStyle}>Try again</button>
        </div>
      )}
      {error && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={load} style={smallSecondaryBtnStyle}>Try again</button>
        </div>
      )}

      {/* Counters follow the active filters. */}
      <div data-tour="p2p-pot-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <StatChip label="Purchase orders" value={data?.all ?? 0} color="#3b82f6" onClick={() => pickChip('all')} active={chipAll} />
        <StatChip label="Overdue" value={data?.overdue ?? 0} color="#dc2626" onClick={() => pickChip('overdue')} active={chipOverdue} />
        <StatChip label={`Due in ${data?.due_soon_days ?? 7} days`} value={data?.due_soon ?? 0} color="#ca8a04" onClick={() => pickChip('due_soon')} active={chipDueSoon} />
        <StatChip label="With vendor" value={counts.with_vendor ?? 0} color="#16a34a" onClick={() => pickChip('with_vendor')} active={chipWithVendor} />
        {data?.open_value != null && (
          <span style={{ whiteSpace: 'nowrap', fontSize: 13, color: TEXT.secondary, marginLeft: 6 }} title="Value still awaited from vendors: released POs, balance only. Short-closed and closed POs are not counted.">
            Open value <strong style={{ color: TEXT.heading }}>{money(data.open_value)}</strong>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {lead}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input id="pot-search" aria-label="Search purchase orders" data-tour="p2p-pot-search" style={{ ...inputStyle, width: 280, maxWidth: '100%' }} placeholder="PO no., vendor, item, requisition..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <FiltersButton count={activeFilterCount} onOpen={openFilters} tour="p2p-pot-filter-btn" />
          {activeFilterCount > 0 && <button type="button" onClick={reset} style={secondaryBtnStyle} data-tour="p2p-pot-clear-btn">Clear</button>}
        </div>
      </div>

      {showFilters && (
        <FiltersSheet subtitle="Narrow the purchase orders, then press Apply." tour="p2p-pot-filter-sheet" applyTour="p2p-pot-apply-btn" onClose={() => setShowFilters(false)} onClear={reset} onApply={applyFilters}>
          <div data-tour="p2p-pot-status-filter">
            <label style={sheetLabel}>Stage</label>
            <Select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))} style={sheetInput}>
              <option value="">All Stages</option>
              {STAGE_ORDER.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </Select>
          </div>
          <div data-tour="p2p-pot-overdue-filter">
            <label style={sheetLabel}>Delivery</label>
            <Select value={draft.delivery} onChange={(e) => setDraft((d) => ({ ...d, delivery: e.target.value }))} style={sheetInput}>
              <option value="">Any delivery date</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">{`Due in ${data?.due_soon_days ?? 7} days`}</option>
            </Select>
          </div>
          <div>
            <label style={sheetLabel} htmlFor="pot-vendor">Vendor</label>
            <SearchableSelect id="pot-vendor" ariaLabel="Vendor" value={draft.vendorId} onChange={(v) => setDraft((d) => ({ ...d, vendorId: v }))} options={vendorOptions} placeholder="All vendors" />
          </div>
          <div>
            <label style={sheetLabel} htmlFor="pot-buyer">Buyer</label>
            <SearchableSelect id="pot-buyer" ariaLabel="Buyer" value={draft.buyerId} onChange={(v) => setDraft((d) => ({ ...d, buyerId: v }))} options={buyerOptions} placeholder="All buyers" />
          </div>
          <div role="group" aria-label="Filter by project">
            <span style={sheetLabel}>Project</span>
            <OrderProjectPicker value={draft.opFilter} onChange={(v) => setDraft((d) => ({ ...d, opFilter: v }))} requireElement={false} placeholder="All projects" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <span id="pot-from-label" style={sheetLabel}>PO date from</span>
              <div role="group" aria-labelledby="pot-from-label"><DateField value={draft.dateFrom} onChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))} /></div>
            </div>
            <div>
              <span id="pot-to-label" style={sheetLabel}>PO date to</span>
              <div role="group" aria-labelledby="pot-to-label"><DateField value={draft.dateTo} onChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))} /></div>
            </div>
          </div>
          <div>
            <label style={sheetLabel} htmlFor="pot-sort">Sort by</label>
            <SearchableSelect id="pot-sort" ariaLabel="Sort by" value={draft.sort} onChange={(v) => setDraft((d) => ({ ...d, sort: v as SortKey }))} options={sortOptions} placeholder="Sort by" />
          </div>
        </FiltersSheet>
      )}

      <div className="ui-cols" style={{ display: 'grid', gridTemplateColumns: split ? 'minmax(0, 1fr) minmax(400px, 460px)' : 'minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div>
          <div data-tour="p2p-pot-table" style={{ ...PO_CARD, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={c.label} data-fit-min={60} data-fit-cut={c.cut ? '' : undefined} style={{ ...th, textAlign: c.label === 'Value' ? 'right' : 'left' }} aria-sort={c.sort && sort === c.sort ? (desc ? 'descending' : 'ascending') : undefined}>
                      {c.sort
                        ? <button type="button" onClick={() => sortBy(c.sort as SortKey)} title={c.label === 'Delivery' ? 'Sort by Delivery — expected delivery date; the chip shows days left or how late' : `Sort by ${c.label}`}
                            style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', textAlign: 'inherit' }}>
                            {c.label}{sort === c.sort ? (desc ? ' ↓' : ' ↑') : ''}
                          </button>
                        : c.label}
                      {i === 0 && <RowCount count={data?.total ?? rows.length} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !data && <tr><td colSpan={columns.length} role="status" style={{ ...td, textAlign: 'center', padding: 28 }}>Loading…</td></tr>}
                {!loading && !error && rows.length === 0 && (
                  <tr><td colSpan={columns.length} style={{ ...td, textAlign: 'center', padding: 28 }}>
                    {filtered ? 'No purchase order matches these filters. ' : 'No purchase orders yet — they appear here once a PO is drafted from an approved requisition. '}
                    {filtered && <button type="button" onClick={reset} style={{ background: 'none', border: 'none', paddingBlock: 0, paddingInline: 0, font: 'inherit', color: '#c2410c', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button>}
                  </td></tr>
                )}
                {rows.map((r) => {
                  const active = selected?.po_id === r.po_id
                  const edge = r.is_overdue ? '#dc2626' : r.is_due_soon ? '#d97706' : 'transparent'
                  return (
                    <tr key={r.po_id} onClick={() => setSelected(r)}
                      style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', opacity: loading ? 0.6 : 1,
                        background: active ? 'rgba(255,122,69,0.10)' : r.is_overdue ? 'rgba(220,38,38,0.045)' : undefined, boxShadow: `inset 3px 0 0 ${edge}` }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700, color: TEXT.heading }}>
                        <button type="button" aria-label={`Open purchase order ${r.po_number}`} aria-pressed={active} onClick={(e) => { e.stopPropagation(); setSelected(r) }}
                          style={{ background: 'none', border: 'none', margin: 0, paddingBlock: 0, paddingInline: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>{r.po_number}</button>
                        {r.amendment_no > 0 && <span style={{ marginLeft: 6 }}><Pill label={`Rev ${r.amendment_no}`} hex="#78716c" title={`Amended ${r.amendment_no} time(s) after release`} /></span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(r.po_date)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><StageBadge stage={r.stage} label={r.stage_label} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }} title={r.vendor_name || undefined}>{clip(r.vendor_name)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.p2p_number || '—'}</td>
                      {!split && (
                        <td data-fit-clamp style={td}>
                          <div title={[r.purpose_label, r.charged_to].filter(Boolean).join(' · ') || undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip2([r.purpose_label, r.charged_to].filter(Boolean).join(' · '))}</div>
                        </td>
                      )}
                      {!split && <td style={{ ...td, whiteSpace: 'nowrap' }} title={r.buyer_name || undefined}>{clip(r.buyer_name)}</td>}
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.expected_delivery ? formatDate(r.expected_delivery) : 'Not set'} <DueChip row={r} />
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><Progress row={r} /></td>
                      {!split && (
                        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                          title={(r.open_value ?? 0) > 0 ? `${money(r.open_value)} still open` : undefined}>
                          {r.total_value != null ? money(r.total_value) : '—'}
                        </td>
                      )}
                      {!split && <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12.5 }}>{r.last_activity ? formatDate(r.last_activity) : '—'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5, color: TEXT.muted }}>
            <span aria-live="polite">{data && data.total > 0 ? `Showing ${data.skip + 1}–${to} of ${data.total} purchase orders` : ''}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={pageBtnStyle(skip === 0)} disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>← Previous</button>
              <button type="button" style={pageBtnStyle(!data || to >= data.total)} disabled={!data || to >= data.total} onClick={() => setSkip(skip + PAGE)}>Next →</button>
            </span>
          </div>
        </div>

        {selected && <POTrackingDetail key={selected.po_id} row={selected} narrow={narrow} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}
