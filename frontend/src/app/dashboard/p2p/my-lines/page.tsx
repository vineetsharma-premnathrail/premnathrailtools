'use client'

// My Lines — the buyer's worklist: every requisition line the buyer must still quote, order or chase. The server
// sends one row per line; the page shows ONE ROW per requisition + item category + buyer (owner, 2026-11-02): the
// lines of one requisition that share a category and a buyer go on one RFQ together, so they are one piece of work.
// A row expands to its lines (Reassign / Short-close act on a line). A buyer sees own lines; the Purchase head
// (All buyers' lines) sees every buyer's lines plus the lines that have no buyer yet, and can move a line's
// not-yet-ordered quantity to another buyer.
// Backend: GET /p2p/my-lines (no prices), POST .../reassign-buyer, POST .../short-close.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, poReportsApi } from '@/lib/api'
import { MyLineRow, MyLinesResponse } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordHref, recordPath } from '@/lib/recordRef'
import { isUrgent, priorityLabel } from '@/lib/priority'
import P2PNav from '@/components/p2p/P2PNav'
import ReassignLineDialog from '@/components/p2p/ReassignLineDialog'
import ShortCloseLineDialog from '@/components/p2p/ShortCloseLineDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Pill, RowCount, TableScroll, chipBtnStyle, inputStyle, pageBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, thStyle, tdStyle, numThStyle, numTdStyle } from '@/components/shared/ui'

const PAGE = 100
const COLUMNS_BASE = ['PR no.', 'Category · items', 'To buy', 'Not yet ordered', 'Ordered', 'Received', 'Pending', 'Stage', 'RFQ', 'PO', 'Required by', 'Priority', 'Requester']

/** One row of the table: the lines of one requisition that share an item category and a buyer. */
type LineGroup = {
  key: string; pr: MyLineRow; category: string | null; buyer_id: number | null; buyer_name: string | null; lines: MyLineRow[]
  unit: string | null  // the common unit of the lines, null when they differ (then no totals are shown)
  buy_qty: number | null; open_to_order: number | null; ordered_qty: number | null; accepted_qty: number | null; pending_receipt: number | null
  states: string[]; rfqs: MyLineRow['rfqs']; pos: MyLineRow['pos']; po_rejected: boolean
}

const groupKey = (r: MyLineRow) => `${r.p2p_request_id}|${r.category || ''}|${r.buyer_id ?? ''}`

/** Rows -> groups, in the order the rows arrive (requisition number, then line). */
function groupLines(rows: MyLineRow[]): LineGroup[] {
  const out: LineGroup[] = []
  const byKey = new Map<string, LineGroup>()
  for (const r of rows) {
    const k = groupKey(r)
    let g = byKey.get(k)
    if (!g) {
      g = { key: k, pr: r, category: r.category, buyer_id: r.buyer_id, buyer_name: r.buyer_name, lines: [], unit: null,
        buy_qty: 0, open_to_order: 0, ordered_qty: 0, accepted_qty: 0, pending_receipt: 0, states: [], rfqs: [], pos: [], po_rejected: false }
      byKey.set(k, g); out.push(g)
    }
    g.lines.push(r)
  }
  for (const g of out) {
    const units = new Set(g.lines.map((l) => (l.unit || '').trim().toLowerCase()))
    const same = units.size === 1
    g.unit = same ? g.lines[0].unit : null
    const sum = (f: (l: MyLineRow) => number) => (same ? g.lines.reduce((a, l) => a + (f(l) || 0), 0) : null)
    g.buy_qty = sum((l) => l.buy_qty); g.open_to_order = sum((l) => l.open_to_order); g.ordered_qty = sum((l) => l.ordered_qty)
    g.accepted_qty = sum((l) => l.accepted_qty); g.pending_receipt = sum((l) => l.pending_receipt)
    g.states = STATE_ORDER.filter((st) => g.lines.some((l) => l.state === st))
    g.rfqs = Array.from(new Map(g.lines.flatMap((l) => l.rfqs).map((q) => [q.id, q])).values())
    g.pos = Array.from(new Map(g.lines.flatMap((l) => l.pos).map((po) => [po.id, po])).values())
    g.po_rejected = g.lines.some((l) => l.po_rejected)
  }
  return out
}
// Stage chips in the order a line moves through them.
const STATE_ORDER = ['awaiting_stock_decision', 'to_quote', 'quoting', 'awarded', 'po_in_approval', 'with_vendor', 'partly_received', 'received', 'short_closed', 'issued_from_stock']
const STATE_LABEL: Record<string, string> = {
  awaiting_stock_decision: 'Waiting for stock check', to_quote: 'RFQ not sent', quoting: 'Waiting for quotes', awarded: 'Vendor chosen',
  po_in_approval: 'PO in approval', with_vendor: 'With vendor', partly_received: 'Partly received', received: 'Received',
  short_closed: 'Closed short', issued_from_stock: 'Issued from stock',
}
const STATE_HEX: Record<string, string> = {
  awaiting_stock_decision: '#94a3b8', to_quote: '#dc2626', quoting: '#f59e0b', awarded: '#2563eb', po_in_approval: '#d97706',
  with_vendor: '#0891b2', partly_received: '#d97706', received: '#16a34a', short_closed: '#7c3aed', issued_from_stock: '#64748b',
}
const RFQ_STATUS: Record<string, string> = { draft: 'draft', locked: 'sent' }

const fmtQty = (n: number | null | undefined) => (n == null ? '—' : Number(n.toFixed(3)).toLocaleString('en-IN'))
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }
const okBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }

export default function MyLinesPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const { can, canFeature } = useCan()
  const isAdmin = user?.role === 'admin'
  const allowed = canFeature('p2p', 'purchase_requisitions', 'my_lines', 'view')
  // Purchase head = may see and work every buyer's lines.
  const isHead = canFeature('p2p', 'purchase_requisitions', 'all_lines', 'view')
  const canRaiseRfq = can('p2p', 'rfq', 'create')
  const canWorkAll = isAdmin || canFeature('p2p', 'purchase_requisitions', 'all_lines', 'edit')
  // Reassigning a line is the Purchase head's action (admin or All buyers' lines > edit); a plain buyer never sees it.
  const canMove = canWorkAll && can('p2p', 'purchase_requisitions', 'edit') && canFeature('p2p', 'purchase_requisitions', 'buyer', 'edit')
  // Short-close needs the Purchase app as well as the Close right.
  const isPurchaseTeam = isAdmin || !!user?.apps?.includes('purchase')
  const canShortClose = isPurchaseTeam && canFeature('p2p', 'purchase_requisitions', 'close', 'edit')

  const [data, setData] = useState<MyLinesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [state, setState] = useState('')
  const [urgentOnly, setUrgentOnly] = useState(false)   // server filter: only Urgent requisitions
  const [overdueOnly, setOverdueOnly] = useState(false)  // server filter: open lines past the required date
  const [buyer, setBuyer] = useState('')          // '' = all buyers (head) / own lines (buyer); '0' = unassigned; else a user id
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [skip, setSkip] = useState(0)
  const [buyerNames, setBuyerNames] = useState<Record<string, string>>({})
  const [moving, setMoving] = useState<MyLineRow | null>(null)
  const [closing, setClosing] = useState<MyLineRow | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())  // group keys whose lines are open
  const reqId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setSkip(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Buyer filter list (head only): buyers who already hold POs, plus every buyer seen on a loaded page.
  useEffect(() => {
    if (!isAuthorized || !isHead) return
    poReportsApi.trackingFilters().then((o: { buyers?: { id: number; name: string }[] }) => {
      setBuyerNames((m) => ({ ...Object.fromEntries((o.buyers || []).map((b) => [String(b.id), b.name])), ...m }))
    }).catch(() => { /* the list still fills from the lines on screen */ })
  }, [isAuthorized, isHead])

  const load = useCallback(() => {
    if (!isAuthorized || !allowed) return
    const id = ++reqId.current
    setLoading(true)
    const params: Parameters<typeof p2pApi.myLines>[0] = { skip, limit: PAGE }
    if (isHead) { if (buyer === '') params.all = true; else params.buyer_id = Number(buyer) }
    if (state) params.state = state
    if (query) params.search = query
    if (urgentOnly) params.urgent = true
    if (overdueOnly) params.overdue = true
    p2pApi.myLines(params)
      .then((d) => {
        if (id !== reqId.current) return
        setData(d); setError('')
        setBuyerNames((m) => {
          const next = { ...m }
          for (const r of d.rows) if (r.buyer_id != null && r.buyer_name) next[String(r.buyer_id)] = r.buyer_name
          return next
        })
      })
      .catch((err) => { if (id === reqId.current) setError(extractErrorMessages(err, 'Could not load your lines.').join(' ')) })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [isAuthorized, allowed, isHead, buyer, state, query, urgentOnly, overdueOnly, skip])
  useEffect(() => { Promise.resolve().then(load) }, [load])

  const rows = data?.rows ?? []
  const groups = useMemo(() => groupLines(data?.rows ?? []), [data])
  const toggle = (k: string) => setExpanded((e) => { const n = new Set(e); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const counts = data?.counts ?? {}
  const countTotal = Object.values(counts).reduce((a, b) => a + b, 0)
  const buyerOptions = useMemo(() => [
    { value: '', label: 'All buyers' }, { value: '0', label: 'Unassigned (no buyer yet)' },
    ...Object.entries(buyerNames).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ value: id, label: name })),
  ], [buyerNames])
  const columns = isHead ? [...COLUMNS_BASE, 'Buyer', ''] : [...COLUMNS_BASE, '']
  const filtered = !!(state || query || urgentOnly || overdueOnly || buyer)
  const reset = () => { setState(''); setSearch(''); setQuery(''); setUrgentOnly(false); setOverdueOnly(false); setBuyer(''); setSkip(0) }
  const today = todayIso()
  const to = Math.min((data?.skip ?? 0) + (data?.rows.length ?? 0), data?.total ?? 0)

  const mine = (r: MyLineRow) => r.buyer_id != null && r.buyer_id === user?.id
  const after = (msg: string) => { setMoving(null); setClosing(null); setNotice(msg); load() }

  if (isLoading || !isAuthorized) return null
  if (!allowed) {
    return (
      <div>
        <P2PNav />
        <p style={{ fontSize: 13, color: TEXT.muted }}>
          My Lines is not on your role. Ask an admin to tick Procurement › Purchase Requisitions › My Lines tab (view) for you (Organization › Roles).
        </p>
      </div>
    )
  }

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My Lines</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '4px 0 0' }}>
            {isHead
              ? 'Requisition lines of every buyer, and lines that have no buyer yet. One row per requisition, item category and buyer; open a row to see its lines. Lines of one requisition go on one RFQ; lines of different requisitions cannot share an RFQ.'
              : 'Requisition lines you buy: what is still to quote, to order, or waiting for goods. One row per requisition and item category; open a row to see its lines. Lines of different requisitions cannot share an RFQ.'}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" style={errBox}>
          <span>{error}</span>
          <button type="button" onClick={load} style={smallSecondaryBtnStyle}>Try again</button>
        </div>
      )}
      {notice && <div role="status" style={okBox}>{notice}</div>}

      {/* Stage chips with counts: click one to filter, click it again to clear. */}
      <div data-tour="my-lines-stages" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => { setState(''); setSkip(0) }} style={chipBtnStyle(!state)}>All {countTotal}</button>
        {STATE_ORDER.filter((s) => counts[s] || state === s).map((s) => (
          <button key={s} type="button" onClick={() => { setState(state === s ? '' : s); setSkip(0) }} style={chipBtnStyle(state === s)} aria-pressed={state === s}>
            {STATE_LABEL[s] || s} {counts[s] ?? 0}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" data-tour="my-lines-urgent" onClick={() => { setUrgentOnly(!urgentOnly); setSkip(0) }} aria-pressed={urgentOnly} style={chipBtnStyle(urgentOnly)}>Urgent only</button>
        <button type="button" data-tour="my-lines-overdue" onClick={() => { setOverdueOnly(!overdueOnly); setSkip(0) }} aria-pressed={overdueOnly} style={chipBtnStyle(overdueOnly)}
          title="Open lines whose requisition is past its required date">Overdue</button>
        {(urgentOnly || overdueOnly) && <span style={{ fontSize: 12, color: TEXT.muted }}>Stage counts above are for {[urgentOnly && 'urgent', overdueOnly && 'overdue'].filter(Boolean).join(' and ')} lines only.</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isHead && (
            <div style={{ width: 240, maxWidth: '100%' }} data-tour="my-lines-buyer">
              <SearchableSelect ariaLabel="Buyer" value={buyer} onChange={(v) => { setBuyer(v); setSkip(0) }} options={buyerOptions} placeholder="All buyers" />
            </div>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search lines" data-tour="my-lines-search"
            placeholder="PR no., item code or name, project..." style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
          {filtered && <button type="button" onClick={reset} style={secondaryBtnStyle}>Clear</button>}
        </div>
      </div>

      <TableScroll minWidth={isHead ? 1500 : 1380} style={{ opacity: loading && data ? 0.6 : 1 }}>
        <table data-tour="my-lines-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c || 'actions'} style={['To buy', 'Not yet ordered', 'Ordered', 'Received', 'Pending'].includes(c) ? numThStyle : thStyle}>
                  {c}{i === 0 && <RowCount count={groups.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={columns.length} role="status" style={{ ...tdStyle, textAlign: 'center', padding: 28 }}>Loading…</td></tr>}
            {!loading && !error && rows.length === 0 && (
              <tr><td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', padding: 28 }}>
                {filtered
                  ? 'No line matches these filters. '
                  : isHead
                    ? 'No requisition line is waiting for a buyer. Lines appear here once a requisition is approved and sent to procurement. '
                    : 'No line is assigned to you. Lines appear here when an approved requisition has an item you buy; if you expected one, ask the Purchase head. '}
                {filtered && <button type="button" onClick={reset} style={{ background: 'none', border: 'none', paddingBlock: 0, paddingInline: 0, font: 'inherit', color: '#c2410c', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button>}
              </td></tr>
            )}
            {groups.map((g) => {
              const r = g.pr
              const open = expanded.has(g.key)
              const hasOpen = g.lines.some((l) => l.open_to_order > 1e-6)
              const late = !!r.required_date && r.required_date.slice(0, 10) < today && hasOpen
              const sub = [r.purpose_label, r.charged_to].filter(Boolean).join(' · ')
              const groupMine = g.buyer_id != null && g.buyer_id === user?.id
              const youCanRaise = canRaiseRfq && g.states.includes('to_quote') && g.buyer_id != null && (groupMine || canWorkAll)
              const lineActions = g.lines.some((l) => l.open_to_order > 1e-6 && (canMove || (canShortClose && (mine(l) || canWorkAll))))
              const n = g.lines.length
              const mixedTitle = 'The lines use different units — open the row to see each line'
              const qty = (v: number | null, bold = false) => (
                <td style={{ ...numTdStyle, fontWeight: bold ? 700 : 400, color: bold ? TEXT.heading : undefined }} title={v == null ? mixedTitle : undefined}>
                  {v == null ? 'mixed' : fmtQty(v)}
                </td>
              )
              return (
                <Fragment key={g.key}>
                  <tr style={late ? { background: 'rgba(220,38,38,0.045)' } : undefined}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 700 }}>
                      <Link href={recordPath('/dashboard/p2p', r, 'p2p_request_id')} style={{ color: TEXT.heading, textDecoration: 'none' }}>{r.p2p_number}</Link>
                    </td>
                    <td style={{ ...tdStyle, minWidth: 220 }} title={sub || undefined}>
                      <button type="button" onClick={() => toggle(g.key)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the ${n} line${n === 1 ? '' : 's'} of ${r.p2p_number}${g.category ? ` · ${g.category}` : ''}`}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left', color: TEXT.heading }}>
                        <div style={{ fontWeight: 600 }}>{open ? '▾' : '▸'} {g.category || 'No category'} <span style={{ fontWeight: 400, color: TEXT.muted }}>· {n} item{n === 1 ? '' : 's'}</span></div>
                        <div style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'normal' }}>
                          {g.lines.slice(0, 3).map((l) => l.item_name).join(', ')}{n > 3 ? ` +${n - 3} more` : ''}{r.charged_to ? ` · ${r.charged_to}` : ''}
                        </div>
                      </button>
                    </td>
                    <td style={numTdStyle} title={g.buy_qty == null ? mixedTitle : undefined}>{g.buy_qty == null ? 'mixed' : `${fmtQty(g.buy_qty)} ${g.unit || ''}`}</td>
                    {qty(g.open_to_order, hasOpen)}
                    {qty(g.ordered_qty)}
                    {qty(g.accepted_qty)}
                    {qty(g.pending_receipt)}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}><div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        {g.states.map((st) => <Pill key={st} label={STATE_LABEL[st] || st} hex={STATE_HEX[st] || '#64748b'} />)}
                        {g.po_rejected && <Pill label="PO rejected — upload again" hex="#d97706" title="The PO made for a line here was rejected in approval. The vendor stays chosen; the buyer uploads a corrected PO." />}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {g.rfqs.length ? g.rfqs.map((q, i) => (
                        <span key={q.id}>{i > 0 && ', '}
                          {groupMine || canWorkAll
                            ? <Link href={recordPath('/dashboard/p2p/rfq', q)} style={{ color: '#2563eb', textDecoration: 'none' }} title={`RFQ ${RFQ_STATUS[q.status] || q.status}`}>{q.rfq_number}</Link>
                            : <span title={`RFQ ${RFQ_STATUS[q.status] || q.status} — it belongs to ${g.buyer_name || 'another buyer'}`}>{q.rfq_number}</span>}
                        </span>
                      )) : <span style={{ color: TEXT.muted }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {g.pos.length ? g.pos.map((po, i) => (
                        <span key={po.id}>{i > 0 && ', '}
                          <Link href={recordPath('/dashboard/p2p/purchase-orders', po)} style={{ color: '#2563eb', textDecoration: 'none' }} title={po.stage_label}>{po.po_number}</Link>
                        </span>
                      )) : <span style={{ color: TEXT.muted }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: late ? '#b91c1c' : undefined, fontWeight: late ? 600 : undefined }}>
                      {r.required_date ? formatDate(r.required_date) : '—'}{late ? ' · late' : ''}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{isUrgent(r.priority) ? <Pill label={priorityLabel(r.priority)} hex="#dc2626" /> : <span style={{ color: TEXT.muted }}>{priorityLabel(r.priority)}</span>}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.requester_name || '—'}</td>
                    {isHead && <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{g.buyer_name || <span style={{ color: '#b91c1c', fontWeight: 600 }}>Unassigned</span>}</td>}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {youCanRaise && (
                          <button type="button" data-tour="my-lines-raise-rfq" style={smallSecondaryBtnStyle}
                            onClick={() => router.push(recordHref('/dashboard/p2p/rfq/new', r, 'p2p_request_id', undefined, 'pr_id'))}
                            title="Opens the RFQ for this requisition with your lines. Lines of different requisitions cannot be on one RFQ.">Raise RFQ</button>
                        )}
                        {lineActions && !open && <button type="button" style={smallSecondaryBtnStyle} onClick={() => toggle(g.key)} title="Open the lines to reassign or short-close one">Lines</button>}
                      </div>
                    </td>
                  </tr>
                  {open && g.lines.map((l) => {
                    const lOpen = l.open_to_order > 1e-6
                    const youCanMove = canMove && lOpen
                    const youCanClose = canShortClose && lOpen && (mine(l) || canWorkAll)
                    return (
                      <tr key={l.pr_item_id} style={{ background: 'rgba(15,23,42,0.025)' }}>
                        <td style={{ ...tdStyle, color: TEXT.muted, fontSize: 12 }}>line</td>
                        <td style={{ ...tdStyle, minWidth: 200, paddingLeft: 24 }}>
                          <div style={{ fontWeight: 600, color: TEXT.heading }}>{l.item_name}</div>
                          <div style={{ fontSize: 11.5, color: TEXT.muted }}>{l.item_code || 'No item code'}</div>
                        </td>
                        <td style={numTdStyle}>{fmtQty(l.buy_qty)} {l.unit || ''}</td>
                        <td style={{ ...numTdStyle, fontWeight: lOpen ? 700 : 400, color: lOpen ? TEXT.heading : TEXT.muted }}>{fmtQty(l.open_to_order)}</td>
                        <td style={numTdStyle}>{fmtQty(l.ordered_qty)}</td>
                        <td style={numTdStyle}>{fmtQty(l.accepted_qty)}</td>
                        <td style={numTdStyle}>{fmtQty(l.pending_receipt)}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}><div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            <Pill label={l.state_label} hex={STATE_HEX[l.state] || '#64748b'} />
                            {l.po_rejected && <Pill label="PO rejected — upload again" hex="#d97706" title="The PO made for this line was rejected in approval. The vendor stays chosen; the buyer uploads a corrected PO." />}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: TEXT.muted }}>{l.rfqs.length ? l.rfqs.map((q) => q.rfq_number).join(', ') : '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: TEXT.muted }}>{l.pos.length ? l.pos.map((po) => po.po_number).join(', ') : '—'}</td>
                        <td style={tdStyle} />
                        <td style={tdStyle} />
                        <td style={tdStyle} />
                        {isHead && <td style={tdStyle} />}
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            {youCanMove && <button type="button" data-tour="my-lines-reassign" style={smallSecondaryBtnStyle} onClick={() => setMoving(l)}
                              title="Move the not-yet-ordered quantity of this line to another buyer">Reassign</button>}
                            {youCanClose && <button type="button" data-tour="my-lines-short-close" style={smallSecondaryBtnStyle} onClick={() => setClosing(l)}
                              title="Write off the not-yet-ordered quantity of this line">Short-close</button>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </TableScroll>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5, color: TEXT.muted }}>
        <span aria-live="polite">{data && data.total > 0 ? `Showing ${data.skip + 1}–${to} of ${data.total} lines in ${groups.length} row${groups.length === 1 ? '' : 's'}` : ''}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={pageBtnStyle(skip === 0)} disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>← Previous</button>
          <button type="button" style={pageBtnStyle(!data || to >= data.total)} disabled={!data || to >= data.total} onClick={() => setSkip(skip + PAGE)}>Next →</button>
        </span>
      </div>

      <ReassignLineDialog open={!!moving} prId={moving?.p2p_request_id ?? 0}
        line={moving ? { pr_item_id: moving.pr_item_id, item_name: moving.item_name, unit: moving.unit, open_to_order: moving.open_to_order, buyer_id: moving.buyer_id } : null}
        onClose={() => setMoving(null)} onDone={() => after(`${moving?.item_name ?? 'The line'} moved to its new buyer. The old buyer, the new buyer and the requester have been told.`)} />
      <ShortCloseLineDialog open={!!closing} prId={closing?.p2p_request_id ?? 0}
        line={closing ? { pr_item_id: closing.pr_item_id, item_name: closing.item_name, unit: closing.unit, open_to_order: closing.open_to_order, buyer_id: closing.buyer_id } : null}
        onClose={() => setClosing(null)} onDone={() => after(`${closing?.item_name ?? 'The line'} short-closed. The requester has been told.`)} />
    </div>
  )
}
