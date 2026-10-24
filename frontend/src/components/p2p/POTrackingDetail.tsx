'use client'

// Side detail of one purchase order in PO Tracking: Items · Receipts · Approval · Documents · Timeline.
// Reuses what already exists — the PO itself, its history report, the GRN list, the central
// ApprovalPanel and the managed Word document — nothing is stored or computed twice here.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { approvalsApi, goodsReceiptsApi, p2pApi, poReportsApi, purchaseOrdersApi } from '@/lib/api'
import { P2PGoodsReceipt, P2PPurchaseOrder } from '@/types'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { recordPath } from '@/lib/recordRef'
import { smallSecondaryBtnStyle } from '@/components/shared/ui'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { StageBadge, TrackRow, money } from '@/components/p2p/POTrackingShared'

type Tab = 'items' | 'receipts' | 'approval' | 'documents' | 'timeline'
type HistoryEvent = { type: string; label: string; document_number: string; date: string | null; status?: string | null; quantity?: number }
type History = { lines: { po_item_id: number; item_name: string; unit?: string | null; summary?: { delivered_qty: number; open_qty: number } | null; events: HistoryEvent[] }[] }
type Ev = { at: string; label: string; detail?: string; hex: string }

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary, borderTop: `1px solid ${BORDER.light}` }
const note: React.CSSProperties = { fontSize: 12.5, color: TEXT.muted, margin: 0 }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const GRN_HEX: Record<string, string> = { draft: '#f59e0b', completed: '#16a34a', reversed: '#94a3b8' }
const EVENT_HEX: Record<string, string> = { grn: '#2563eb', rtv: '#dc2626', invoice: '#16a34a', service_entry: '#7c3aed' }

const msg = (err: unknown, fallback: string) => extractErrorMessages(err, fallback).join(' ')

export default function POTrackingDetail({ row, narrow, onClose }: { row: TrackRow; narrow: boolean; onClose: () => void }) {
  const router = useRouter()
  const { canFeature } = useCan()
  const [tab, setTab] = useState<Tab>('items')
  const [po, setPo] = useState<P2PPurchaseOrder | null>(null)
  const [poError, setPoError] = useState('')
  const [history, setHistory] = useState<History | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [grns, setGrns] = useState<P2PGoodsReceipt[] | null>(null)
  const [grnError, setGrnError] = useState('')
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [eventsNote, setEventsNote] = useState('')
  const seeDocument = canFeature('p2p', 'purchase_orders', 'po_document', 'view')

  // The parent mounts this per PO (key = po_id), so every opened row starts clean.
  useEffect(() => {
    let live = true
    purchaseOrdersApi.get(row.po_id).then((d) => live && setPo(d)).catch((e) => live && setPoError(msg(e, `Could not load purchase order ${row.po_number}.`)))
    poReportsApi.history(row.po_id).then((d) => live && setHistory(d)).catch((e) => live && setHistoryError(msg(e, 'Could not load the delivery history of this PO.')))
    return () => { live = false }
  }, [row.po_id, row.po_number])

  useEffect(() => {
    if (tab !== 'receipts' || grns !== null) return
    goodsReceiptsApi.list({ purchase_order_id: row.po_id }).then(setGrns)
      .catch((e) => setGrnError(msg(e, 'Could not load the goods receipts of this PO.')))
  }, [tab, grns, row.po_id])

  useEffect(() => {
    if (tab !== 'timeline' || events !== null || !po || (!history && !historyError)) return
    let live = true
    const notes: string[] = []
    Promise.allSettled([approvalsApi.entity('p2p_purchase_order', row.po_id), row.p2p_request_id ? p2pApi.getAuditTrail(row.p2p_request_id) : Promise.resolve([])])
      .then(([appr, audit]) => {
        if (!live) return
        const out: Ev[] = []
        if (po.created_at) out.push({ at: po.created_at, label: 'PO drafted', detail: po.created_by_name ? `by ${po.created_by_name}` : undefined, hex: '#94a3b8' })
        if (appr.status === 'fulfilled') {
          const all = [...appr.value.history.slice().reverse(), ...(appr.value.current ? [appr.value.current] : [])]
          for (const r of all) {
            out.push({ at: r.submitted_at, label: r.revision > 1 ? `Sent for approval again (#${r.revision})` : 'Sent for approval', detail: r.requester_name ? `by ${r.requester_name}` : undefined, hex: '#f59e0b' })
            for (const s of r.steps) if (s.decided_at) {
              const verb = s.status === 'approved' ? 'approved' : s.status === 'rejected' ? 'rejected' : s.status === 'returned' ? 'returned it' : s.status
              out.push({ at: s.decided_at, label: `${s.stage_name}: ${verb}`, detail: [s.decided_by_name || s.approver_name, s.comment ? `"${s.comment}"` : ''].filter(Boolean).join(' — '), hex: s.status === 'approved' ? '#16a34a' : '#dc2626' })
            }
          }
        } else notes.push(msg(appr.reason, 'The approval steps could not be loaded.'))
        if (audit.status === 'fulfilled') {
          for (const a of audit.value as { action: string; summary: string; performed_at: string | null }[]) {
            if (a.performed_at && (a.summary?.includes(row.po_number) || a.action === 'short_closed' || a.action === 'closed')) {
              out.push({ at: a.performed_at, label: a.action === 'short_closed' ? 'Requisition short-closed' : a.action === 'closed' ? 'Requisition closed' : 'Requisition note', detail: a.summary, hex: '#64748b' })
            }
          }
        } else notes.push(msg(audit.reason, 'The requisition history could not be loaded.'))
        for (const l of history?.lines || []) for (const e of l.events) if (e.date) {
          out.push({ at: e.date, label: `${e.label} ${e.document_number}`, detail: `${l.item_name}: ${e.quantity}${l.unit ? ` ${l.unit}` : ''}${e.status ? ` · ${e.status}` : ''}`, hex: EVENT_HEX[e.type] || '#6b7280' })
        }
        out.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime())
        setEvents(out)
        setEventsNote(notes.join(' '))
      })
    return () => { live = false }
  }, [tab, events, po, history, historyError, row.po_id, row.po_number, row.p2p_request_id])

  const summaryByItem = useMemo(() => {
    const m = new Map<number, { delivered_qty: number; open_qty: number }>()
    for (const l of history?.lines || []) if (l.summary) m.set(l.po_item_id, l.summary)
    return m
  }, [history])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'items', label: 'Items' }, { key: 'receipts', label: 'Receipts' }, { key: 'approval', label: 'Approval' },
    ...(seeDocument ? [{ key: 'documents' as const, label: 'Documents' }] : []), { key: 'timeline', label: 'Timeline' },
  ]
  const showPrices = row.total_value != null
  const reqHref = row.p2p_request_id ? `${recordPath('/dashboard/p2p', row, 'p2p_request_id')}?from=po-approval&po=${encodeURIComponent(row.po_id_ref)}` : null

  const body = (
    <div data-tour="p2p-pot-detail" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: '16px 18px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading }}>{row.po_number}</span>
              <StageBadge stage={row.stage} label={row.stage_label} />
            </div>
            <p style={{ ...note, marginTop: 4 }}>
              {row.vendor_name || 'No vendor'} · PO date {formatDate(row.po_date)} · due {row.expected_delivery ? formatDate(row.expected_delivery) : 'not set'}
            </p>
            {(row.p2p_number || row.purpose_label) && (
              <p style={{ ...note, marginTop: 2 }}>
                {row.p2p_number ? `Requisition ${row.p2p_number}` : ''}{row.purpose_label ? `${row.p2p_number ? ' · ' : ''}${row.purpose_label}` : ''}{row.charged_to ? ` · ${row.charged_to}` : ''}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ ...smallSecondaryBtnStyle, flex: 'none' }}>Close</button>
        </div>
        <div style={{ display: 'flex', gap: 8, margin: '12px 0 4px', flexWrap: 'wrap' }}>
          {reqHref && <button type="button" style={smallSecondaryBtnStyle} onClick={() => router.push(reqHref)}>Open requisition &amp; this PO</button>}
        </div>
        <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${BORDER.light}`, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              style={{ padding: '8px 12px', marginBottom: -1, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                color: tab === t.key ? '#FF7A45' : '#78716c', borderBottom: tab === t.key ? '2px solid #FF7A45' : '2px solid transparent' }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 18px 18px', overflow: 'auto', flex: 1, minHeight: 0 }}>
        {poError && <div style={errBox}>{poError}</div>}
        {tab === 'items' && (
          <>
            {historyError && <p style={{ ...note, marginBottom: 10 }}>Delivered / open quantities are not shown: {historyError}</p>}
            {!po && !poError && <p style={note}>Loading…</p>}
            {po && po.items.length === 0 && <p style={note}>This purchase order has no lines.</p>}
            {po && po.items.length > 0 && (
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead><tr>{['Item', 'Ordered', ...(history ? ['Delivered', 'Open'] : []), ...(showPrices ? ['Line total'] : [])].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {po.items.map((it) => {
                      const s = summaryByItem.get(it.id)
                      return (
                        <tr key={it.id}>
                          <td style={{ ...td, color: TEXT.body }}>{it.item_code ? <strong style={{ color: TEXT.heading }}>{it.item_code} — </strong> : null}{it.item_name}</td>
                          <td style={td}>{it.quantity} {it.unit || ''}</td>
                          {history && <td style={td}>{s ? s.delivered_qty : '—'}</td>}
                          {history && <td style={{ ...td, fontWeight: 700, color: s && s.open_qty > 0 && row.stage !== 'short_closed' ? '#d97706' : '#16a34a' }}>{s ? (row.stage === 'short_closed' ? `${s.open_qty} written off` : s.open_qty) : '—'}</td>}
                          {showPrices && <td style={td}>{it.line_total != null ? money(it.line_total) : '—'}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'receipts' && (
          <>
            {grnError && <div style={errBox}>{grnError}</div>}
            {!grns && !grnError && <p style={note}>Loading…</p>}
            {grns && grns.length === 0 && <p style={note}>Nothing has been received against this PO yet.</p>}
            {grns && grns.length > 0 && (
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead><tr>{['GRN', 'Date', 'Status', 'Received', 'Accepted', 'Vendor invoice'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {grns.map((g) => (
                      <tr key={g.id}>
                        <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{g.grn_number}</td>
                        <td style={td}>{formatDate(g.received_date)}</td>
                        <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${GRN_HEX[g.status] || '#64748b'}1a`, color: GRN_HEX[g.status] || '#64748b', textTransform: 'capitalize' }}>{g.status === 'draft' ? 'In inspection' : g.status}</span></td>
                        <td style={td}>{g.items.reduce((a, i) => a + (i.received_quantity || 0), 0)}</td>
                        <td style={td}>{g.status === 'draft' ? '—' : g.items.reduce((a, i) => a + (i.accepted_quantity || 0), 0)}</td>
                        <td style={td}>{g.vendor_invoice_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'approval' && (
          row.stage === 'draft'
            ? <p style={note}>This PO is still a draft — it has not been sent for approval.</p>
            : <>
                <ApprovalPanel entityType="p2p_purchase_order" entityId={row.po_id} title={`Approval of ${row.po_number}`} />
                <p style={note}>If no approval steps are listed, this PO was approved before the approval workflow was introduced.</p>
              </>
        )}

        {tab === 'documents' && seeDocument && (
          po
            ? <ManagedDocumentPanel entityType="p2p_purchase_order" entityId={po.id} revision={po.revision ?? 0} canModify={false}
                recordLabel="purchase order" downloadName={`PO-${po.po_number}`.replace(/[^A-Za-z0-9._-]+/g, '-')} />
            : <p style={note}>{poError ? 'The document cannot be shown because the PO did not load.' : 'Loading…'}</p>
        )}

        {tab === 'timeline' && (
          <>
            {eventsNote && <p style={{ ...note, marginBottom: 10 }}>Some steps are missing: {eventsNote}</p>}
            {!events && !poError && <p style={note}>Loading…</p>}
            {events && events.length === 0 && <p style={note}>Nothing has happened on this PO yet.</p>}
            {events && events.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: e.hex, marginTop: 5, flex: 'none' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{e.label} <span style={{ fontWeight: 400, color: TEXT.muted }}>· {formatDate(e.at)}</span></div>
                  {e.detail && <div style={{ fontSize: 12.5, color: TEXT.secondary, overflowWrap: 'anywhere' }}>{e.detail}</div>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )

  if (narrow) {
    if (typeof document === 'undefined') return null
    // Phones / small laptops: a drawer over the page (portaled — the glass cards would clip a fixed overlay).
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(28,25,23,0.35)', display: 'flex', justifyContent: 'flex-end' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ width: 'min(520px, 100vw)', height: '100%', background: '#fffaf5', boxShadow: '-12px 0 40px rgba(0,0,0,.18)' }}>{body}</div>
      </div>,
      document.body,
    )
  }
  return (
    <aside style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(),
      position: 'sticky', top: 12, height: 'calc(100vh - 150px)', minHeight: 420, overflow: 'hidden' }}>
      {body}
    </aside>
  )
}
