'use client'

// My Lines — the buyer's worklist: every requisition line the buyer must still quote, order or chase, one row
// per line. A buyer sees own lines; the Purchase head (All buyers' lines) sees every buyer's lines plus the
// lines that have no buyer yet, and can move a line's not-yet-ordered quantity to another buyer.
// Backend: GET /p2p/my-lines (no prices), POST .../reassign-buyer, POST .../short-close.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const COLUMNS_BASE = ['PR no.', 'Item', 'To buy', 'Not yet ordered', 'Ordered', 'Received', 'Pending', 'Stage', 'RFQ', 'PO', 'Required by', 'Priority', 'Requester']
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
              ? 'Requisition lines of every buyer, and lines that have no buyer yet. Lines of one requisition go on one RFQ; lines of different requisitions cannot share an RFQ.'
              : 'Requisition lines you buy: what is still to quote, to order, or waiting for goods. Lines of different requisitions cannot share an RFQ.'}
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
                  {c}{i === 0 && <RowCount count={data?.total ?? rows.length} />}
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
            {rows.map((r) => {
              const late = !!r.required_date && r.required_date.slice(0, 10) < today && r.open_to_order > 0
              const sub = [r.purpose_label, r.charged_to].filter(Boolean).join(' · ')
              const hasOpen = r.open_to_order > 1e-6
              const youCanRaise = canRaiseRfq && r.state === 'to_quote' && r.buyer_id != null && (mine(r) || canWorkAll)
              const youCanMove = canMove && hasOpen
              const youCanClose = canShortClose && hasOpen && (mine(r) || canWorkAll)
              return (
                <tr key={r.pr_item_id} style={late ? { background: 'rgba(220,38,38,0.045)' } : undefined}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 700 }}>
                    <Link href={recordPath('/dashboard/p2p', r, 'p2p_request_id')} style={{ color: TEXT.heading, textDecoration: 'none' }}>{r.p2p_number}</Link>
                  </td>
                  <td style={{ ...tdStyle, minWidth: 200 }} title={sub || undefined}>
                    <div style={{ fontWeight: 600, color: TEXT.heading }}>{r.item_name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.item_code ? `${r.item_code}` : 'No item code'}{r.charged_to ? ` · ${r.charged_to}` : ''}</div>
                  </td>
                  <td style={numTdStyle}>{fmtQty(r.buy_qty)} {r.unit || ''}</td>
                  <td style={{ ...numTdStyle, fontWeight: hasOpen ? 700 : 400, color: hasOpen ? TEXT.heading : TEXT.muted }}>{fmtQty(r.open_to_order)}</td>
                  <td style={numTdStyle}>{fmtQty(r.ordered_qty)}</td>
                  <td style={numTdStyle}>{fmtQty(r.accepted_qty)}</td>
                  <td style={numTdStyle}>{fmtQty(r.pending_receipt)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}><div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <Pill label={r.state_label} hex={STATE_HEX[r.state] || '#64748b'} />
                      {r.po_rejected && <Pill label="PO rejected — upload again" hex="#d97706" title="The PO made for this line was rejected in approval. The vendor stays chosen; the buyer uploads a corrected PO." />}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {r.rfqs.length ? r.rfqs.map((q, i) => (
                      <span key={q.id}>{i > 0 && ', '}
                        {mine(r) || canWorkAll
                          ? <Link href={recordPath('/dashboard/p2p/rfq', q)} style={{ color: '#2563eb', textDecoration: 'none' }} title={`RFQ ${RFQ_STATUS[q.status] || q.status}`}>{q.rfq_number}</Link>
                          : <span title={`RFQ ${RFQ_STATUS[q.status] || q.status} — it belongs to ${r.buyer_name || 'another buyer'}`}>{q.rfq_number}</span>}
                      </span>
                    )) : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {r.pos.length ? r.pos.map((p, i) => (
                      <span key={p.id}>{i > 0 && ', '}
                        <Link href={recordPath('/dashboard/p2p/purchase-orders', p)} style={{ color: '#2563eb', textDecoration: 'none' }} title={p.stage_label}>{p.po_number}</Link>
                      </span>
                    )) : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: late ? '#b91c1c' : undefined, fontWeight: late ? 600 : undefined }}>
                    {r.required_date ? formatDate(r.required_date) : '—'}{late ? ' · late' : ''}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{isUrgent(r.priority) ? <Pill label={priorityLabel(r.priority)} hex="#dc2626" /> : <span style={{ color: TEXT.muted }}>{priorityLabel(r.priority)}</span>}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.requester_name || '—'}</td>
                  {isHead && <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.buyer_name || <span style={{ color: '#b91c1c', fontWeight: 600 }}>Unassigned</span>}</td>}
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {youCanRaise && (
                        <button type="button" data-tour="my-lines-raise-rfq" style={smallSecondaryBtnStyle}
                          onClick={() => router.push(recordHref('/dashboard/p2p/rfq/new', r, 'p2p_request_id', undefined, 'pr_id'))}
                          title="Opens the RFQ for this requisition with your lines. Lines of different requisitions cannot be on one RFQ.">Raise RFQ</button>
                      )}
                      {youCanMove && <button type="button" data-tour="my-lines-reassign" style={smallSecondaryBtnStyle} onClick={() => setMoving(r)}
                        title="Move the not-yet-ordered quantity of this line to another buyer">Reassign</button>}
                      {youCanClose && <button type="button" data-tour="my-lines-short-close" style={smallSecondaryBtnStyle} onClick={() => setClosing(r)}
                        title="Write off the not-yet-ordered quantity of this line">Short-close</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScroll>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5, color: TEXT.muted }}>
        <span aria-live="polite">{data && data.total > 0 ? `Showing ${data.skip + 1}–${to} of ${data.total} lines` : ''}</span>
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
