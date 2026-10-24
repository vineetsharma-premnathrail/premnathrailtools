'use client'

// Shared by PO Tracking's list and its side detail: row type, stage colours and small cells.
import { TEXT } from '@/lib/theme'

/** One row of GET /p2p/po-reports/tracking — one purchase order (a split requisition has several). */
export type TrackRow = {
  po_id: number; po_id_ref: string; po_number: string; po_date: string; po_status: string
  stage: string; stage_label: string; amendment_no: number
  p2p_request_id: number | null; p2p_request_id_ref: string; p2p_number: string | null; pr_status: string | null
  purpose: string | null; purpose_label: string | null; charged_to: string | null
  vendor_id: number | null; vendor_name: string | null; buyer_id: number | null; buyer_name: string | null
  expected_delivery: string | null; days_to_due: number | null; is_overdue: boolean; is_due_soon: boolean
  lines: number; lines_complete: number; ordered_qty: number | null; delivered_qty: number | null; unit: string | null
  received_pct: number; total_value: number | null; open_value: number | null
  last_receipt_date: string | null; last_activity: string | null
}

// What each stage means, in the buyer's words (tooltip + tour).
export const STAGE_ORDER = ['draft', 'in_approval', 'with_vendor', 'partly_received', 'received', 'short_closed', 'closed', 'cancelled'] as const
export const STAGE_HEX: Record<string, string> = {
  draft: '#94a3b8', in_approval: '#f59e0b', with_vendor: '#2563eb', partly_received: '#d97706',
  received: '#16a34a', short_closed: '#7c3aed', closed: '#64748b', cancelled: '#dc2626',
}
export const STAGE_HINT: Record<string, string> = {
  draft: 'Being prepared — not sent for approval yet.',
  in_approval: 'Sent for approval — not an order until its final approval is given.',
  with_vendor: 'Approved and released — waiting for the vendor to deliver.',
  partly_received: 'Part of the quantity has been delivered; the balance is still due.',
  received: 'Everything delivered; the requisition is not closed yet.',
  short_closed: 'Closed with a balance the vendor will not supply — written off.',
  closed: 'Everything delivered and the requisition closed.',
  cancelled: 'Cancelled or rejected — nothing will come.',
}

export const money = (v: number | null | undefined) => `₹${(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function StageBadge({ stage, label }: { stage: string; label: string }) {
  const hex = STAGE_HEX[stage] || '#64748b'
  return (
    <span title={STAGE_HINT[stage]} data-tour="p2p-pot-status-badge"
      style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

/** Days to the PO's expected delivery: red when late, amber when due within a week. */
export function DueChip({ row }: { row: TrackRow }) {
  if (row.days_to_due == null) return <span style={{ color: TEXT.muted, fontSize: 12.5 }}>—</span>
  const d = row.days_to_due
  const [text, hex] = d < 0 ? [`${-d}d late`, '#dc2626'] : d === 0 ? ['Due today', '#d97706'] : d <= 7 ? [`In ${d}d`, '#d97706'] : [`In ${d}d`, '#64748b']
  return (
    <span data-tour="p2p-pot-overdue-badge" style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  )
}
