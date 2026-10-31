'use client'

// Procurement progress on the purchase requisition page (2026-10-31): for the requester and every
// buyer. Who approved the requisition, then per line the buyer, RFQ, PO, PO approval (who / when),
// GRNs and the ordered / received / pending quantities. No prices; the vendor name only arrives
// from the server for people who may see PO commercials (GET /p2p/requests/{id}/tracker).

import { Fragment, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { p2pApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { PrTracker as PrTrackerData, TrackerApproval, TrackerLine, TrackerPo } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { GLASS, SHADOWS, TEXT, BORDER } from '@/lib/theme'
import ReassignLineDialog from '@/components/p2p/ReassignLineDialog'
import ShortCloseLineDialog from '@/components/p2p/ShortCloseLineDialog'
import { Pill, RowCount, smallSecondaryBtnStyle, thStyle, numThStyle, tdStyle, numTdStyle } from '@/components/shared/ui'

const EPS = 0.0005
const AMBER = '#d97706'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const eyebrow: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }
const muted: React.CSSProperties = { color: TEXT.muted }

const STATE_HEX: Record<string, string> = {
  awaiting_stock_decision: '#f59e0b', issued_from_stock: '#22c55e', to_quote: '#64748b', quoting: '#6366f1', awarded: '#0ea5e9',
  po_in_approval: '#f59e0b', with_vendor: '#3b82f6', partly_received: '#d97706', received: '#16a34a', short_closed: '#94a3b8',
}
// Waiting states named in the summary chip (everything not yet ordered or already finished).
const WAITING_TEXT: Record<string, (n: number) => string> = {
  awaiting_stock_decision: (n) => `${n} waiting for the stock check`,
  to_quote: (n) => `${n} waiting for an RFQ`,
  quoting: (n) => `${n} waiting for quotes`,
  awarded: (n) => `${n} waiting for the PO upload`,
  po_in_approval: (n) => `${n} PO in approval`,
}
const PO_STAGE_HEX: Record<string, string> = {
  draft: '#64748b', in_approval: '#f59e0b', with_vendor: '#3b82f6', partly_received: '#d97706', received: '#16a34a',
  closed: '#22c55e', short_closed: '#94a3b8', cancelled: '#94a3b8',
}
const PR_HEX: Record<string, string> = {
  approved: '#22c55e', vendor_quotations: '#6366f1', technical_evaluation: '#8b5cf6', commercial_evaluation: '#a855f7',
  vendor_selected: '#0ea5e9', po_drafted: '#64748b', po_raised: '#f59e0b', po_approved: '#22c55e', partially_received: '#d97706',
  received: '#16a34a', closed: '#22c55e', rejected: '#dc2626', cancelled: '#94a3b8', returned: '#7c3aed', submitted: '#3b82f6', draft: '#64748b',
}
const STEP_LABEL: Record<string, string> = { waiting: 'Not yet', pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', returned: 'Returned', skipped: 'Not needed', cancelled: 'Cancelled' }
const STEP_HEX: Record<string, string> = { waiting: '#a8a29e', pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', returned: '#7c3aed', skipped: '#a8a29e', cancelled: '#a8a29e' }
const REQ_LABEL: Record<string, string> = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for changes', cancelled: 'Cancelled' }
const VIA_LABEL: Record<string, string> = { delegation: 'as delegate', escalation: 'after escalation', admin: 'admin stand-in' }

const qty = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const nonNeg = (n: number | null | undefined) => Math.max(0, n ?? 0)
const toBuy = (l: TrackerLine) => nonNeg(l.quantity - (l.issued_qty || 0) - (l.short_closed_qty || 0))
const isLive = (po: TrackerPo) => po.stage !== 'cancelled'

/** Phone width: the table turns into one stacked card per line. */
function useNarrow(maxWidth = 760): boolean {
  return useSyncExternalStore(
    (cb) => { const mq = window.matchMedia(`(max-width:${maxWidth}px)`); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia(`(max-width:${maxWidth}px)`).matches,
    () => false,
  )
}

function safePath(base: string, row: object, key: string): string | null {
  try { return recordPath(base, row, key) } catch { return null }
}

/** "Approved by X on 3 Nov 2026" / "Waiting for A, B" / "Rejected by X" for one approval. */
function approvalText(a: TrackerApproval | null, stage?: string): string {
  if (stage === 'cancelled') return 'Cancelled'
  if (!a) return stage === 'draft' ? 'Not sent for approval yet' : '—'
  const decided = a.steps.filter((s) => s.decided_at).sort((x, y) => (x.decided_at || '').localeCompare(y.decided_at || ''))
  const last = decided[decided.length - 1]
  const who = last?.decided_by_name || last?.approver_name || null
  if (a.status === 'approved') {
    const when = a.completed_at || last?.decided_at
    return `Approved${who ? ` by ${who}` : ''}${when ? ` on ${formatDate(when)}` : ''}`
  }
  if (a.status === 'rejected') {
    const r = decided.find((s) => s.status === 'rejected') || last
    return `Rejected${r?.decided_by_name ? ` by ${r.decided_by_name}` : ''}${r?.decided_at ? ` on ${formatDate(r.decided_at)}` : ''}`
  }
  if (a.status === 'returned') return `Returned for changes${who ? ` by ${who}` : ''}${last?.decided_at ? ` on ${formatDate(last.decided_at)}` : ''}`
  if (a.status === 'cancelled') return 'Approval withdrawn'
  const names = Array.from(new Set(a.steps.filter((s) => s.status === 'pending').map((s) => s.approver_name).filter((n): n is string => !!n)))
  return names.length ? `Waiting for ${names.join(' / ')}` : 'Waiting for approval'
}

function StepList({ approval }: { approval: TrackerApproval }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {approval.steps.map((s, i) => (
        <div key={`${s.sequence}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5, color: TEXT.body }}>
          <Pill label={STEP_LABEL[s.status] || s.status} hex={STEP_HEX[s.status] || '#78716c'} />
          <span style={{ fontWeight: 600, color: TEXT.heading }}>{s.stage_name}</span>
          <span>{s.approver_name || '—'}</span>
          {s.decided_by_name && s.decided_by_name !== s.approver_name && (
            <span style={muted}>decided by {s.decided_by_name}{s.via && VIA_LABEL[s.via] ? ` (${VIA_LABEL[s.via]})` : ''}</span>
          )}
          {s.decided_at && <span style={muted}>{formatDateTime(s.decided_at)}</span>}
          {s.comment && <span style={{ fontStyle: 'italic', color: TEXT.secondary }}>&ldquo;{s.comment}&rdquo;</span>}
        </div>
      ))}
    </div>
  )
}

/** One line of the summary chip: "3 of 5 lines ordered · 2 waiting for an RFQ · 1 PO in approval". */
function summaryText(lines: TrackerLine[]): string {
  const buyLines = lines.filter((l) => toBuy(l) > EPS || l.ordered_qty > EPS)
  const ordered = buyLines.filter((l) => toBuy(l) <= EPS || l.ordered_qty + EPS >= toBuy(l)).length
  const parts = [`${ordered} of ${buyLines.length} line${buyLines.length === 1 ? '' : 's'} ordered`]
  for (const [state, say] of Object.entries(WAITING_TEXT)) {
    const n = lines.filter((l) => l.state === state).length
    if (n) parts.push(say(n))
  }
  const stock = lines.filter((l) => l.state === 'issued_from_stock').length
  if (stock) parts.push(`${stock} issued from stock`)
  const closed = lines.filter((l) => l.state === 'short_closed').length
  if (closed) parts.push(`${closed} closed short`)
  return parts.join(' · ')
}

function PoDetail({ po }: { po: TrackerPo }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.6)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: TEXT.heading, fontSize: 13 }}>{po.po_number}</span>
        <Pill label={po.stage_label} hex={PO_STAGE_HEX[po.stage] || '#64748b'} />
        {!!po.vendor_name && <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{po.vendor_name}</span>}
        <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{qty(po.quantity)} on this line</span>
        {po.expected_delivery && <span style={{ fontSize: 12.5, ...muted }}>Delivery by {formatDate(po.expected_delivery)}</span>}
      </div>
      <p style={eyebrow}>PO approval</p>
      {po.approval && po.approval.steps.length > 0
        ? <StepList approval={po.approval} />
        : <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{approvalText(po.approval, po.stage)}</p>}
      <p style={{ ...eyebrow, marginTop: 8 }}>Goods received</p>
      {po.grns.length === 0 ? (
        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>No goods received yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {po.grns.map((g) => (
            <span key={g.grn_id} style={{ fontSize: 12.5, color: TEXT.body }}>
              <b>{g.grn_number}</b>{g.received_date ? ` · ${formatDate(g.received_date)}` : ''} · received {qty(g.received_qty)} · accepted {qty(g.accepted_qty)}
              {g.rejected_qty > EPS ? ` · rejected ${qty(g.rejected_qty)}` : ''}{g.status && g.status !== 'completed' ? ` · ${g.status.replace(/_/g, ' ')}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** An RFQ page opens for its own buyer and the Purchase head only (anyone else gets a 403), so other buyers' RFQs show as plain text. */
function RfqLinks({ line, linkable }: { line: TrackerLine; linkable: boolean }) {
  if (!line.rfqs.length) return <span style={muted}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {line.rfqs.map((r) => {
        const href = linkable ? safePath('/dashboard/p2p/rfq', r, 'rfq_id') : null
        return (
          <span key={r.rfq_id} title={`${r.buyer_name ? `Buyer ${r.buyer_name} · ` : ''}${r.quote_count} quote${r.quote_count === 1 ? '' : 's'} in`} style={{ whiteSpace: 'nowrap' }}>
            {href ? <Link href={href} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>{r.rfq_number}</Link> : <b>{r.rfq_number}</b>}
            <span style={{ ...muted, fontSize: 11.5 }}> · {r.status === 'draft' ? 'draft' : r.status === 'cancelled' ? 'cancelled' : `${r.quote_count} quote${r.quote_count === 1 ? '' : 's'}`}</span>
          </span>
        )
      })}
    </div>
  )
}

function PoCell({ line }: { line: TrackerLine }) {
  const live = line.pos.filter(isLive)
  if (!live.length) return <span style={muted}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {live.map((p) => (
        <span key={p.po_id} style={{ whiteSpace: 'nowrap' }}>
          <b>{p.po_number}</b>{p.vendor_name != null && p.vendor_name !== '' ? <span style={{ ...muted, fontSize: 11.5 }}> · {p.vendor_name}</span> : null}
        </span>
      ))}
    </div>
  )
}

function ApprovalCell({ line }: { line: TrackerLine }) {
  const live = line.pos.filter(isLive)
  if (!live.length) return <span style={muted}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5 }}>
      {live.map((p) => (
        <span key={p.po_id}>{live.length > 1 ? <b>{p.po_number}: </b> : null}{approvalText(p.approval, p.stage)}</span>
      ))}
    </div>
  )
}

function GrnCell({ line }: { line: TrackerLine }) {
  const grns = line.pos.flatMap((p) => p.grns)
  if (!grns.length) return <span style={muted}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {grns.map((g) => (
        <span key={g.grn_id} style={{ whiteSpace: 'nowrap' }}><b>{g.grn_number}</b>{g.received_date ? <span style={{ ...muted, fontSize: 11.5 }}> · {formatDate(g.received_date)}</span> : null}</span>
      ))}
    </div>
  )
}

function StageCell({ line }: { line: TrackerLine }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <Pill label={line.state_label} hex={STATE_HEX[line.state] || '#64748b'} />
      {line.po_rejected && <Pill label="PO rejected — upload again" hex={AMBER} title="The PO made for this line was rejected in approval. The vendor stays chosen; the buyer uploads a corrected PO." />}
      {line.over_ordered && <Pill label="Over-ordered" hex={AMBER} title="More is on POs than the requisition needs. Check the PO quantities with the buyer." />}
    </div>
  )
}

function WrittenOff({ line }: { line: TrackerLine }) {
  const n = nonNeg(line.short_closed_qty)
  return n > EPS ? <span title={line.short_closed_reason || undefined}>{qty(n)}</span> : <span style={muted}>—</span>
}

/** Quantity not yet on any PO: what a Reassign or Short-close can still act on (never below 0). */
const openToOrder = (l: TrackerLine) => nonNeg(l.quantity - (l.issued_qty || 0) - (l.short_closed_qty || 0) - (l.ordered_qty || 0))

export default function PrTracker({ prId, refreshKey, rfqLinkable, meId, canReassign = false, canShortClose = false, allLines = false, onChanged }: {
  prId: number; refreshKey: number; rfqLinkable: boolean
  /** Signed-in user, and what they may do to a line (the server checks again). */
  meId?: number; canReassign?: boolean; canShortClose?: boolean; allLines?: boolean
  /** A line was reassigned or short-closed: the page reloads. */
  onChanged?: () => void
}) {
  const [data, setData] = useState<PrTrackerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const narrow = useNarrow()
  const [dialog, setDialog] = useState<{ kind: 'reassign' | 'shortclose'; line: TrackerLine } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    p2pApi.tracker(prId)
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the procurement progress. Reload the page; if it keeps failing, ask an admin to check your access to this requisition.').join(' ')))
      .finally(() => setLoading(false))
  }, [prId])

  useEffect(() => { load() }, [load, refreshKey])

  const toggle = (id: number) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const lines = data ? [...data.lines].sort((a, b) => a.pr_item_id - b.pr_item_id) : []
  const approval = data?.pr_approval || null
  const mayReassign = (l: TrackerLine) => canReassign && openToOrder(l) > EPS && l.buyer_id !== meId
  const mayShortClose = (l: TrackerLine) => canShortClose && openToOrder(l) > EPS && (allLines || l.buyer_id === meId)
  const hasActions = lines.some((l) => mayReassign(l) || mayShortClose(l))
  const actionsOf = (l: TrackerLine) => (mayReassign(l) || mayShortClose(l)) ? (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {mayReassign(l) && <button type="button" onClick={() => setDialog({ kind: 'reassign', line: l })} style={smallSecondaryBtnStyle}>Reassign</button>}
      {mayShortClose(l) && <button type="button" onClick={() => setDialog({ kind: 'shortclose', line: l })} style={smallSecondaryBtnStyle}>Short-close</button>}
    </div>
  ) : null
  const dialogLine = dialog ? { pr_item_id: dialog.line.pr_item_id, item_name: dialog.line.item_name, unit: dialog.line.unit, open_to_order: openToOrder(dialog.line), buyer_id: dialog.line.buyer_id } : null
  const closeDialog = () => setDialog(null)
  const doneDialog = () => { setDialog(null); load(); onChanged?.() }
  const canExpand = (l: TrackerLine) => l.pos.length > 0 || l.rfqs.length > 0 || !!l.short_closed_reason

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Procurement progress</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>Who approved it, who is buying each line, and where every line is: RFQ, PO, goods received.</p>
      </div>
      {data && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill label={data.status_label} hex={PR_HEX[data.status] || '#64748b'} />
          {lines.length > 0 && (
            <span data-tour="pr-tracker-summary"><Pill label={summaryText(lines)} hex="#57534e" /></span>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div data-tour="pr-detail-tracker" style={sectionStyle}>
      {header}

      {loading && !data && <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Loading procurement progress…</p>}

      {error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200 }}>{error}</span>
          <button type="button" onClick={load} disabled={loading} style={smallSecondaryBtnStyle}>{loading ? 'Loading…' : 'Try again'}</button>
        </div>
      )}

      {data && (
        <>
          {approval && approval.steps.length > 0 && (
            <div data-tour="pr-tracker-approval" style={{ marginBottom: 16 }}>
              <p style={eyebrow}>Requisition approval · {REQ_LABEL[approval.status] || approval.status}{approval.completed_at ? ` · ${formatDateTime(approval.completed_at)}` : ''}</p>
              <StepList approval={approval} />
            </div>
          )}

          {lines.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
              No lines to follow yet. Lines appear here once the requisition is submitted and the Store has decided what to issue from stock.
            </p>
          ) : narrow ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lines.map((l, idx) => (
                <div key={l.pr_item_id} style={{ borderRadius: 12, border: `1px solid ${BORDER.normal}`, padding: 12, background: 'rgba(255,255,255,.6)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ minWidth: 0, fontSize: 13.5, color: TEXT.heading }}>
                      <span style={muted}>{idx + 1}. </span>{l.item_code && <b>{l.item_code} — </b>}{l.item_name}
                    </div>
                    <StageCell line={l} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', fontSize: 12.5 }}>
                    <div><p style={eyebrow}>Buyer</p>{l.buyer_name || '—'}</div>
                    <div><p style={eyebrow}>RFQ</p><RfqLinks line={l} linkable={rfqLinkable && (allLines || l.buyer_id === meId)} /></div>
                    <div><p style={eyebrow}>PO</p><PoCell line={l} /></div>
                    <div><p style={eyebrow}>Goods received (GRN)</p><GrnCell line={l} /></div>
                    <div style={{ gridColumn: '1 / -1' }}><p style={eyebrow}>PO approval</p><ApprovalCell line={l} /></div>
                    <div><p style={eyebrow}>Requested</p>{qty(l.quantity)} {l.unit || ''}</div>
                    <div><p style={eyebrow}>Ordered</p>{qty(nonNeg(l.ordered_qty))}</div>
                    <div><p style={eyebrow}>Received</p>{qty(nonNeg(l.accepted_qty))}</div>
                    <div><p style={eyebrow}>Pending</p>{qty(nonNeg(l.pending_qty))}</div>
                    {nonNeg(l.short_closed_qty) > EPS && <div><p style={eyebrow}>Written off</p><WrittenOff line={l} /></div>}
                  </div>
                  {l.short_closed_reason && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '8px 0 0', fontStyle: 'italic' }}>Written off: {l.short_closed_reason}</p>}
                  {actionsOf(l) && <div style={{ marginTop: 10 }}>{actionsOf(l)}</div>}
                  {l.pos.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {l.pos.map((p) => <PoDetail key={p.po_id} po={p} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div data-tour="pr-tracker-table" style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 32 }} aria-label="Expand" />
                    <th style={thStyle}>SL<RowCount count={lines.length} /></th>
                    <th style={thStyle}>Item</th>
                    <th style={thStyle}>Buyer</th>
                    <th style={thStyle}>Stage</th>
                    <th style={thStyle}>RFQ</th>
                    <th style={thStyle}>PO</th>
                    <th style={thStyle}>PO approval</th>
                    <th style={thStyle}>GRN</th>
                    <th style={numThStyle}>Requested</th>
                    <th style={numThStyle}>Ordered</th>
                    <th style={numThStyle}>Received</th>
                    <th style={numThStyle}>Pending</th>
                    <th style={numThStyle}>Written off</th>
                    {hasActions && <th style={thStyle}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const expanded = open.has(l.pr_item_id)
                    return (
                      <Fragment key={l.pr_item_id}>
                        <tr>
                          <td style={{ ...tdStyle, padding: '9px 4px 9px 10px' }}>
                            {canExpand(l) && (
                              <button type="button" onClick={() => toggle(l.pr_item_id)} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} the POs and goods received of ${l.item_name}`}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: TEXT.secondary, fontSize: 13, padding: 4, lineHeight: 1 }}>
                                {expanded ? '▾' : '▸'}
                              </button>
                            )}
                          </td>
                          <td style={{ ...tdStyle, color: TEXT.secondary }}>{idx + 1}</td>
                          <td style={{ ...tdStyle, minWidth: 190 }}>{l.item_code && <span style={{ fontWeight: 700, color: TEXT.heading }}>{l.item_code} — </span>}{l.item_name}</td>
                          <td style={{ ...tdStyle, color: TEXT.secondary }}>{l.buyer_name || '—'}</td>
                          <td style={tdStyle}><StageCell line={l} /></td>
                          <td style={tdStyle}><RfqLinks line={l} linkable={rfqLinkable && (allLines || l.buyer_id === meId)} /></td>
                          <td style={tdStyle}><PoCell line={l} /></td>
                          <td style={{ ...tdStyle, minWidth: 190 }}><ApprovalCell line={l} /></td>
                          <td style={tdStyle}><GrnCell line={l} /></td>
                          <td style={numTdStyle}>
                            {qty(l.quantity)} {l.unit || ''}
                            {(l.issued_qty || 0) > EPS && <div style={{ fontSize: 11, color: TEXT.muted }}>{qty(l.issued_qty)} from stock</div>}
                          </td>
                          <td style={numTdStyle}>{qty(nonNeg(l.ordered_qty))}</td>
                          <td style={numTdStyle}>{qty(nonNeg(l.accepted_qty))}</td>
                          <td style={numTdStyle}>{qty(nonNeg(l.pending_qty))}</td>
                          <td style={numTdStyle}><WrittenOff line={l} /></td>
                          {hasActions && <td style={tdStyle}>{actionsOf(l)}</td>}
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={hasActions ? 15 : 14} style={{ ...tdStyle, background: 'rgba(148,163,184,0.06)', padding: '10px 14px 12px 46px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {l.pos.length === 0 && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>No PO on this line yet.</p>}
                                {l.pos.map((p) => <PoDetail key={p.po_id} po={p} />)}
                                {l.short_closed_reason && (
                                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Written off {qty(l.short_closed_qty)}: <i>{l.short_closed_reason}</i></p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <ReassignLineDialog open={dialog?.kind === 'reassign'} prId={prId} line={dialogLine} onClose={closeDialog} onDone={doneDialog} />
      <ShortCloseLineDialog open={dialog?.kind === 'shortclose'} prId={prId} line={dialogLine} onClose={closeDialog} onDone={doneDialog} />
    </div>
  )
}
