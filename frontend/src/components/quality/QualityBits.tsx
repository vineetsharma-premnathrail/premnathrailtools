'use client'

// Small shared pieces for the Phase 1 Quality pages (lots, NCR, plans,
// masters, settings): the status pill, the page header row and the label
// maps the backend's coded values need. Kept in one place because the same
// lot / NCR statuses show on five pages.
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'

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
export const SEVERITY_HEX: Record<string, string> = { minor: '#16A34A', major: '#F59E0B', critical: '#DC2626' }
export const APPROVAL_ROLE_LABELS: Record<string, string> = {
  quality_engineer: 'Quality engineer', quality_head: 'Quality head', design: 'Design', purchase: 'Purchase', partner: 'Partner',
}
export const DISPOSITION_TYPE_LABELS: Record<string, string> = {
  use_as_is: 'Use as is', rework: 'Rework', repair: 'Repair', return_to_vendor: 'Return to vendor', scrap: 'Scrap',
}
export const PLAN_STATUS_HEX: Record<string, string> = { draft: '#78716c', approved: '#16A34A', obsolete: '#a8a29e' }

export function Pill({ text, hex }: { text: string; hex?: string }) {
  const c = hex || '#78716c'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${c}1a`, color: c, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  )
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
  return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : d
}
