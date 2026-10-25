'use client'

// PO Tracking — "which POs are with the vendor, what is due this week, what is late, what is partly
// received, what is waiting for approval, what is closed?" One row per purchase order (a split
// requisition has several), each with its own vendor, stage, delivery date, progress and value.
// Filtering, sorting and paging run on the server (GET /p2p/po-reports/tracking), so the counts and
// totals are real. A row opens a side detail: Items · Receipts · Approval · Documents · Timeline.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { poReportsApi } from '@/lib/api'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { inputStyle, pageBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, chipBtnStyle, RowCount, Pill, pillStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import POTrackingDetail from '@/components/p2p/POTrackingDetail'
import { DueChip, STAGE_HEX, STAGE_HINT, STAGE_ORDER, StageBadge, TrackRow, money } from '@/components/p2p/POTrackingShared'

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
const COLUMNS: { label: string; sort?: SortKey; compactHide?: boolean }[] = [
  { label: 'PO', sort: 'code' }, { label: 'Stage', sort: 'stage' }, { label: 'Vendor', sort: 'vendor' }, { label: 'Requisition' },
  { label: 'Buyer', compactHide: true }, { label: 'Delivery', sort: 'due' }, { label: 'Delivered', sort: 'progress' },
  { label: 'Value', sort: 'value', compactHide: true }, { label: 'Last activity', compactHide: true },
]

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 5 }
const th: React.CSSProperties = {
  textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted,
  whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1,
}
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: TEXT.secondary, verticalAlign: 'middle' }

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

function Chip({ label, count, hex, active, hint, onClick, tour }: { label: string; count: number; hex: string; active: boolean; hint?: string; onClick: () => void; tour?: string }) {
  return (
    <button type="button" onClick={onClick} title={hint} data-tour={tour} aria-pressed={active}
      style={{ ...chipBtnStyle(active), flex: 'none', whiteSpace: 'nowrap', borderColor: active ? hex : BORDER.normal, background: active ? `${hex}1f` : '#fff', color: active ? hex : TEXT.body, opacity: count === 0 && !active && label !== 'All' ? 0.5 : 1 }}>
      {label}
      <span style={pillStyle(count > 0 ? hex : '#78716c')}>{count.toLocaleString('en-IN')}</span>
    </button>
  )
}

function Progress({ row }: { row: TrackRow }) {
  if (row.stage === 'draft' || row.stage === 'in_approval' || row.stage === 'cancelled') return <span style={{ color: TEXT.muted }}>—</span>
  const pct = Math.max(0, Math.min(100, row.received_pct))
  const hex = row.stage === 'short_closed' ? '#7c3aed' : pct >= 100 ? '#16a34a' : '#d97706'
  const text = row.ordered_qty != null && row.delivered_qty != null
    ? `${+row.delivered_qty.toFixed(3)} / ${+row.ordered_qty.toFixed(3)} ${row.unit || ''}`
    : `${row.lines_complete} of ${row.lines} lines`
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ height: 6, borderRadius: 9999, background: 'rgba(0,0,0,.07)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: hex }} />
      </div>
      <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4, whiteSpace: 'nowrap' }}>{Math.round(pct)}% · {text}</div>
    </div>
  )
}

export default function POTrackingList() {
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
  const [moreOpen, setMoreOpen] = useState(false)
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

  const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setSkip(0) }
  const filtered = !!(stage || query || vendorId || buyerId || overdueOnly || dueSoonOnly || dateFrom || dateTo || opFilter)
  const reset = () => {
    setStage(''); setSearch(''); setQuery(''); setVendorId(''); setBuyerId(''); setOverdueOnly(false); setDueSoonOnly(false)
    setDateFrom(''); setDateTo(''); setOpFilter(null); setSkip(0)
  }
  const sortBy = (key: SortKey) => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(false) } setSkip(0) }

  const rows = data?.rows ?? []
  const split = !!selected && !narrow
  const columns = COLUMNS.filter((c) => !(split && c.compactHide))
  const vendorOptions = useMemo(() => [{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: String(v.id), label: v.name }))], [vendors])
  const buyerOptions = useMemo(() => [{ value: '', label: 'All buyers' }, ...buyers.map((b) => ({ value: String(b.id), label: b.name }))], [buyers])
  const sortOptions = SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
  const counts = data?.counts ?? {}
  const to = Math.min((data?.skip ?? 0) + rows.length, data?.total ?? 0)

  return (
    <div>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>
        Every purchase order and where it stands. Click a status to filter; click a row for its items, receipts, approval, document and timeline.
      </p>

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

      {/* Summary strip: clickable counts — they are the stage filter. */}
      <div className="hide-scrollbar" data-tour="p2p-pot-status-filter" role="group" aria-label="Filter by status" style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, alignItems: 'center', marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
        <Chip label="All" count={data?.all ?? 0} hex="#475569" active={!stage && !overdueOnly && !dueSoonOnly} onClick={() => { setStage(''); setOverdueOnly(false); setDueSoonOnly(false); setSkip(0) }} hint="Every purchase order that matches the filters below." />
        <Chip label="Overdue" count={data?.overdue ?? 0} hex="#dc2626" active={overdueOnly} tour="p2p-pot-overdue-filter" hint="Released POs whose expected delivery date has passed with goods still to come." onClick={() => { setOverdueOnly(!overdueOnly); setDueSoonOnly(false); setSkip(0) }} />
        <Chip label={`Due in ${data?.due_soon_days ?? 7} days`} count={data?.due_soon ?? 0} hex="#d97706" active={dueSoonOnly} hint="Released POs with goods still to come, due today or within the next week." onClick={() => { setDueSoonOnly(!dueSoonOnly); setOverdueOnly(false); setSkip(0) }} />
        <span aria-hidden style={{ flex: 'none', width: 1, alignSelf: 'stretch', background: BORDER.normal, margin: '0 4px' }} />
        {STAGE_ORDER.map((s) => (
          <Chip key={s} label={s === 'with_vendor' ? 'With vendor' : s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')} count={counts[s] ?? 0} hex={STAGE_HEX[s]}
            active={stage === s} hint={STAGE_HINT[s]} onClick={() => { setStage(stage === s ? '' : s); setSkip(0) }} />
        ))}
        {data?.open_value != null && (
          <span style={{ marginLeft: 'auto', flex: 'none', whiteSpace: 'nowrap', fontSize: 13, color: TEXT.secondary }} title="Value still awaited from vendors: released POs, balance only. Short-closed and closed POs are not counted.">
            Open value <strong style={{ color: TEXT.heading }}>{money(data.open_value)}</strong>
          </span>
        )}
      </div>

      {/* Filters — labelled, one height. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end', marginBottom: moreOpen ? 10 : 14 }}>
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle} htmlFor="pot-search">Search</label>
          <input id="pot-search" style={inputStyle} placeholder="PO no., vendor, item, requisition…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle} htmlFor="pot-vendor">Vendor</label>
          <SearchableSelect id="pot-vendor" ariaLabel="Vendor" value={vendorId} onChange={pick(setVendorId)} options={vendorOptions} placeholder="All vendors" />
        </div>
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle} htmlFor="pot-buyer">Buyer</label>
          <SearchableSelect id="pot-buyer" ariaLabel="Buyer" value={buyerId} onChange={pick(setBuyerId)} options={buyerOptions} placeholder="All buyers" />
        </div>
        <div role="group" aria-label="Filter by order project" style={{ minWidth: 0 }}>
          <span style={labelStyle}>Order project</span>
          <OrderProjectPicker value={opFilter} onChange={(v) => pick(setOpFilter)(v)} requireElement={false} placeholder="All order projects" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} style={secondaryBtnStyle}>{moreOpen ? 'Fewer filters' : `More filters${dateFrom || dateTo ? ' (dates set)' : ''}`}</button>
          {filtered && <button type="button" onClick={reset} style={secondaryBtnStyle}>Clear filters</button>}
        </div>
      </div>
      {moreOpen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end', marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <span id="pot-from-label" style={labelStyle}>PO date from</span>
            <div role="group" aria-labelledby="pot-from-label"><DateField value={dateFrom} onChange={pick(setDateFrom)} /></div>
          </div>
          <div style={{ minWidth: 0 }}>
            <span id="pot-to-label" style={labelStyle}>PO date to</span>
            <div role="group" aria-labelledby="pot-to-label"><DateField value={dateTo} onChange={pick(setDateTo)} /></div>
          </div>
          <div style={{ minWidth: 0 }}>
            <label style={labelStyle} htmlFor="pot-sort">Sort by</label>
            <SearchableSelect id="pot-sort" ariaLabel="Sort by" value={sort} onChange={(v) => { setSort(v as SortKey); setDesc(false); setSkip(0) }} options={sortOptions} placeholder="Sort by" />
          </div>
        </div>
      )}

      <div className="ui-cols" style={{ display: 'grid', gridTemplateColumns: split ? 'minmax(0, 1fr) minmax(400px, 460px)' : 'minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div>
          <div data-tour="p2p-pot-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 180, WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: split ? 760 : 1060 }}>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={c.label} style={{ ...th, textAlign: c.label === 'Value' ? 'right' : 'left' }} aria-sort={c.sort && sort === c.sort ? (desc ? 'descending' : 'ascending') : undefined}>
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
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: TEXT.heading }}>
                          <button type="button" aria-label={`Open purchase order ${r.po_number}`} aria-pressed={active} onClick={(e) => { e.stopPropagation(); setSelected(r) }}
                            style={{ background: 'none', border: 'none', margin: 0, paddingBlock: 0, paddingInline: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>{r.po_number}</button>
                          {r.amendment_no > 0 && <span style={{ marginLeft: 6 }}><Pill label={`Rev ${r.amendment_no}`} hex="#78716c" title={`Amended ${r.amendment_no} time(s) after release`} /></span>}</div>
                        <div style={{ fontSize: 11.5, color: TEXT.muted }}>dated {formatDate(r.po_date)}</div>
                      </td>
                      <td style={td}><StageBadge stage={r.stage} label={r.stage_label} /></td>
                      <td style={{ ...td, minWidth: 140 }}>{r.vendor_name || '—'}</td>
                      <td style={{ ...td, minWidth: 140 }}>
                        <div>{r.p2p_number || '—'}</div>
                        {(r.purpose_label || r.charged_to) && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[r.purpose_label, r.charged_to].filter(Boolean).join(' · ')}</div>}
                      </td>
                      {!split && <td style={td}>{r.buyer_name || '—'}</td>}
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div>{r.expected_delivery ? formatDate(r.expected_delivery) : 'Not set'}</div>
                        <div style={{ marginTop: 3 }}><DueChip row={r} /></div>
                      </td>
                      <td style={td}><Progress row={r} /></td>
                      {!split && (
                        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {r.total_value != null ? <><div>{money(r.total_value)}</div>{(r.open_value ?? 0) > 0 && <div style={{ fontSize: 11.5, color: '#d97706' }}>{money(r.open_value)} open</div>}</> : '—'}
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
