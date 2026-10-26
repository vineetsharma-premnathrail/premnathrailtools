'use client'

// Shared by PO Tracking's list and its side detail: row type, stage colours and small cells.
import { TEXT } from '@/lib/theme'
import { pillStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { Funnel } from '@phosphor-icons/react'
import { FormSheet, SheetIcon, SHEET, sheetBtn } from '@/components/shared/FormSheet'

// ---- List layout shared by the RFQ and Purchase Orders tabs (same look as the Service Request Registry) ----
/** One-row text longer than max is cut with an ellipsis (put the full text in title). */
export const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
/** Two-row free-text columns are cut at 50. */
export const clip2 = (v?: string | null) => clip(v, 50)

export const PO_CREATE_BTN: React.CSSProperties = {
  background: '#ea580c', border: '1px solid #c2410c', color: '#fff', fontSize: 13.5, fontWeight: 600,
  padding: '10px 14px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap',
}
export const PO_TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 8px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
  color: '#57534e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1,
}
export const PO_TD: React.CSSProperties = { padding: '10px 8px', fontSize: 13, color: '#57534e', borderTop: '1px solid rgba(0,0,0,0.05)' }
/** Table card; scrolls inside, never sideways (TableFit keeps the columns inside). */
export const PO_CARD: React.CSSProperties = {
  borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
  border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
  overflow: 'auto', maxHeight: 'calc(100vh - 330px)', minHeight: 120,
}

/** Funnel button with the active-filter count badge. */
export function FiltersButton({ count, onOpen, tour }: { count: number; onOpen: () => void; tour: string }) {
  return (
    <button type="button" onClick={onOpen} data-tour={tour} aria-label="Filters" title="Filters"
      style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...(count ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
      <Funnel size={16} weight={count ? 'fill' : 'regular'} />
      Filters
      {count > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>}
    </button>
  )
}

/** The Filters popup: edits a draft (children), Apply copies it into the live filters. */
export function FiltersSheet({ subtitle, tour, applyTour, onClose, onClear, onApply, children }: {
  subtitle: string; tour: string; applyTour: string; onClose: () => void; onClear: () => void; onApply: () => void; children: React.ReactNode
}) {
  return (
    <FormSheet icon="search" title="Filters" subtitle={subtitle} width={560} busy={false} onClose={onClose} tour={tour}
      footer={<>
        <button type="button" onClick={onClear} style={sheetBtn('secondary', SHEET.INK)}>Clear Filters</button>
        <button type="button" onClick={onApply} style={sheetBtn('primary', SHEET.BLUE)} data-tour={applyTour}><SheetIcon name="check" size={16} />Apply Filters</button>
      </>}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </FormSheet>
  )
}

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
      style={pillStyle(hex)}>
      {label}
    </span>
  )
}

/** Days to the PO's expected delivery: red when late, amber when due within a week. */
export function DueChip({ row }: { row: TrackRow }) {
  if (row.days_to_due == null) return <span style={{ color: TEXT.muted, fontSize: 12.5 }}>—</span>
  const d = row.days_to_due
  const [text, hex] = d < 0 ? [`late by ${-d} ${d === -1 ? 'day' : 'days'}`, '#dc2626'] : d === 0 ? ['Due today', '#d97706'] : [`In ${d} ${d === 1 ? 'day' : 'days'}`, d <= 7 ? '#d97706' : '#64748b']
  return (
    <span data-tour="p2p-pot-overdue-badge" style={pillStyle(hex)}>
      {text}
    </span>
  )
}
