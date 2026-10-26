'use client'

// Small shared pieces for the Phase 1 Quality pages (lots, NCR, plans,
// masters, settings): the status pill, the page header row and the label
// maps the backend's coded values need. Kept in one place because the same
// lot / NCR statuses show on five pages.
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { FormSheet, SheetIcon, SheetIconName, SheetSection, sheetBtn, SHEET } from '@/components/shared/FormSheet'
import { Pill as SharedPill } from '@/components/shared/ui'

export const INSPECTION_TYPE_LABELS: Record<string, string> = {
  incoming: 'Incoming (GRN)', job_work: 'Job work receipt', first_article: 'First article (FAI)', in_process: 'In-process',
  final: 'Final (production)', third_party: 'Customer / third-party', sales_return: 'Sales return', stock_reinspection: 'Stock re-inspection',
}

export const LOT_STATUS_LABELS: Record<string, string> = {
  created: 'Created', in_inspection: 'In inspection', results_recorded: 'Results recorded', decision_made: 'Decision made', closed: 'Closed', cancelled: 'Cancelled',
}
export const LOT_STATUS_HEX: Record<string, string> = {
  created: '#78716c', in_inspection: '#2563EB', results_recorded: '#7C3AED', decision_made: '#F59E0B', closed: '#16A34A', cancelled: '#a8a29e',
}
export const DECISION_LABELS: Record<string, string> = {
  accept: 'Accept', accept_with_deviation: 'Accept with deviation', reject: 'Reject (full)', partial: 'Reject (partial)',
}

export const NCR_STATUS_LABELS: Record<string, string> = {
  open: 'Open', disposition_decided: 'Disposition decided', action_done: 'Action done', verified: 'Verified', closed: 'Closed', cancelled: 'Cancelled',
}
export const NCR_STATUS_HEX: Record<string, string> = {
  open: '#F59E0B', disposition_decided: '#2563EB', action_done: '#7C3AED', verified: '#0891B2', closed: '#16A34A', cancelled: '#a8a29e',
}
export const SEVERITY_HEX: Record<string, string> = { minor: '#78716c', major: '#F59E0B', critical: '#DC2626' }
export const APPROVAL_ROLE_LABELS: Record<string, string> = {
  quality_engineer: 'Quality engineer', quality_head: 'Quality head', design: 'Design', purchase: 'Purchase', partner: 'Partner',
}
export const DISPOSITION_TYPE_LABELS: Record<string, string> = {
  use_as_is: 'Use as is', rework: 'Rework', repair: 'Repair', return_to_vendor: 'Return to vendor', scrap: 'Scrap',
}
export const PLAN_STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Waiting for approval', approved: 'Approved', obsolete: 'Obsolete' }
export const PLAN_STATUS_HEX: Record<string, string> = { draft: '#78716c', pending_approval: '#F59E0B', approved: '#16A34A', obsolete: '#a8a29e' }

// Phase 3 — CAPA (8D), customer complaints, approved vendor list.
export const CAPA_STATUS_LABELS: Record<string, string> = {
  open: 'Open', root_cause_found: 'Root cause found', actions_in_progress: 'Actions in progress',
  effectiveness_check: 'Effectiveness check', closed: 'Closed', reopened: 'Reopened',
}
export const CAPA_STATUS_HEX: Record<string, string> = {
  open: '#F59E0B', root_cause_found: '#7C3AED', actions_in_progress: '#2563EB', effectiveness_check: '#0891B2', closed: '#16A34A', reopened: '#DC2626',
}
export const CAPA_TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual', ncr: 'Major / Critical NCR', repeat_defect: 'Repeat defect', complaint: 'Customer complaint',
  audit: 'Audit finding', vendor_trend: 'Vendor trend',
}
export const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  open: 'Logged', under_investigation: 'Under investigation', response_sent: 'Response sent',
  customer_accepted: 'Customer accepted', closed: 'Closed', rejected: 'Rejected (not valid)',
}
export const COMPLAINT_STATUS_HEX: Record<string, string> = {
  open: '#F59E0B', under_investigation: '#2563EB', response_sent: '#7C3AED', customer_accepted: '#0891B2', closed: '#16A34A', rejected: '#a8a29e',
}
export const AVL_STATUS_LABELS: Record<string, string> = { trial: 'Trial', approved: 'Approved', on_watch: 'On watch', blocked: 'Blocked' }
export const AVL_STATUS_HEX: Record<string, string> = { trial: '#78716c', approved: '#16A34A', on_watch: '#F59E0B', blocked: '#DC2626' }
export const SAMPLING_LABELS: Record<string, string> = { normal: 'Normal', tightened: 'Tightened', reduced: 'Reduced' }

export function fmtMoney(v?: number | null) {
  return v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN')}`
}

export function Pill({ text, hex }: { text: string; hex?: string }) {
  return <SharedPill label={text} hex={hex || '#78716c'} />
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          {subtitle || 'Quality Module'}
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h1>
      </div>
      {children && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

export const tableWrapStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}
export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
  color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}
export const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
export const filterInputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

export function fmtQty(q?: number | null, uom?: string | null) {
  if (q === null || q === undefined) return '—'
  return `${Number(q.toFixed(4))}${uom ? ` ${uom}` : ''}`
}

export function fmtDate(d?: string | null) {
  if (!d) return '—'
  const s = d.slice(0, 10).split('-')
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : d
}

/**
 * Single-column action popup for the Quality detail pages (record a result,
 * usage decision, add an action …): the shared FormSheet with the error
 * banner inside it and a Cancel + primary footer. Required fields are marked
 * with <Req /> by the caller.
 */
export function ActionSheet({
  icon, iconColor = SHEET.BLUE, title, subtitle, onClose, onSubmit, busy, error, submitLabel, busyLabel = 'Saving…',
  disabled = false, width = 580, tour, children,
}: {
  icon: SheetIconName; iconColor?: string; title: string; subtitle: string
  onClose: () => void; onSubmit: () => void; busy: boolean; error?: string | string[]
  submitLabel: string; busyLabel?: string; disabled?: boolean; width?: number; tour?: string
  children: React.ReactNode
}) {
  const off = busy || disabled
  return (
    <FormSheet width={width} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle} onClose={onClose} busy={busy} tour={tour}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={onSubmit} disabled={off} style={sheetBtn('primary', iconColor, off)}>
          <SheetIcon name={icon} size={16} />{busy ? busyLabel : submitLabel}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error || ''} />
        {children}
      </div>
    </FormSheet>
  )
}

/** Vertical gap between stacked fields inside an ActionSheet / SheetSection. */
export const sheetGap: React.CSSProperties = { marginTop: 14 }

/**
 * In-page block for a result / line grid on a Quality detail page (lot
 * results, plan characteristics): a white card with the SheetSection icon +
 * heading, the grid full width inside. Big grids stay in the page — only the
 * small actions around them open an ActionSheet.
 */
export function SheetBlock({ icon, title, extra, color, children, style }: {
  icon: SheetIconName; title: string; extra?: React.ReactNode; color?: string; children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 18, boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: '20px 24px 2px', marginBottom: 20, ...style }}>
      <SheetSection icon={icon} title={title} color={color} extra={extra ? <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div> : undefined}>
        {children}
      </SheetSection>
    </div>
  )
}
