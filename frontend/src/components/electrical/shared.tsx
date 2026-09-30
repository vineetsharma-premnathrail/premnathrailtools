'use client'

// Style tokens, status labels and small helpers shared by the Electrical
// job-page tabs and register pages, so the ten tab components don't each
// re-declare the same maps. Built from lib/theme like every other module.
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { ElectricalLookupOption } from '@/types'
import { extractErrorMessages } from '@/lib/validation'

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
export const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
export const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
export const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }
export const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
export const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }
export const dangerBtn: React.CSSProperties = { ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }
export const smallDangerBtn: React.CSSProperties = { ...smallBtn, color: DANGER.primary, borderColor: DANGER.border }
export const linkStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
export const tableWrap: React.CSSProperties = { overflow: 'auto', maxHeight: 'calc(100vh - 320px)', borderRadius: 12, border: `1px solid ${BORDER.light}` }
export const mutedText: React.CSSProperties = { fontSize: 13, color: TEXT.muted, margin: 0 }

export const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap', display: 'inline-block' })

export function Pill({ value, labels, hex }: { value: string | null | undefined; labels: Record<string, string>; hex: Record<string, string> }) {
  if (!value) return <span style={{ color: TEXT.muted }}>—</span>
  return <span style={pill(hex[value] || '#78716c')}>{labels[value] || value.replace(/_/g, ' ')}</span>
}

export function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && !error.length)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

export function NoticeBanner({ notice }: { notice: string }) {
  if (!notice) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
      {notice}
    </div>
  )
}

export const JOB_STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', on_hold: 'On Hold', handed_over: 'Handed Over', closed: 'Closed', cancelled: 'Cancelled' }
export const JOB_STATUS_HEX: Record<string, string> = { draft: '#78716c', in_progress: '#F59E0B', on_hold: '#9333EA', handed_over: '#2563EB', closed: '#16A34A', cancelled: '#DC2626' }
export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }
export const STAGE_STATUS_LABELS: Record<string, string> = { not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed', not_applicable: 'N/A' }
export const STAGE_STATUS_HEX: Record<string, string> = { not_started: '#a8a29e', in_progress: '#F59E0B', completed: '#16A34A', not_applicable: '#64748b' }
export const PHASE_LABELS: Record<string, string> = { design: 'Design & Engineering', procurement: 'Procurement', build: 'Assembly & Installation', test_qc: 'Testing & QC', handover: 'Commissioning & Handover' }
export const PHASE_HEX: Record<string, string> = { design: '#2563EB', procurement: '#9333EA', build: '#F59E0B', test_qc: '#0d9488', handover: '#16A34A' }
export const SELECTION_LABELS: Record<string, string> = { proposed: 'Proposed', selected: 'Selected', approved: 'Approved' }
export const SELECTION_HEX: Record<string, string> = { proposed: '#78716c', selected: '#2563EB', approved: '#16A34A' }
export const PROCUREMENT_LABELS: Record<string, string> = { required: 'To Buy', in_stock: 'In Stock', pr_raised: 'PR Raised', ordered: 'Ordered', received: 'Received', issued: 'Issued' }
export const PROCUREMENT_HEX: Record<string, string> = { required: '#DC2626', in_stock: '#0d9488', pr_raised: '#9333EA', ordered: '#2563EB', received: '#16A34A', issued: '#15803d' }
export const PANEL_STATUS_LABELS: Record<string, string> = { designed: 'Designed', in_assembly: 'In Assembly', assembled: 'Assembled', tested: 'Tested', installed: 'Installed' }
export const PANEL_STATUS_HEX: Record<string, string> = { designed: '#78716c', in_assembly: '#F59E0B', assembled: '#2563EB', tested: '#0d9488', installed: '#16A34A' }
export const CABLE_STATUS_LABELS: Record<string, string> = { designed: 'Designed', cut: 'Cut', harnessed: 'Harnessed', installed: 'Installed', terminated: 'Terminated', tested: 'Tested' }
export const CABLE_STATUS_HEX: Record<string, string> = { designed: '#78716c', cut: '#a16207', harnessed: '#F59E0B', installed: '#2563EB', terminated: '#0d9488', tested: '#16A34A' }
export const REVISION_STATUS_LABELS: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting Approval', approved: 'Approved', rejected: 'Rejected', superseded: 'Superseded' }
export const REVISION_STATUS_HEX: Record<string, string> = { draft: '#78716c', submitted: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', superseded: '#a8a29e' }
export const TEST_RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail' }
export const TEST_RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626' }
export const TEST_PHASE_LABELS: Record<string, string> = { factory: 'Factory', commissioning: 'Commissioning' }
export const SEVERITY_LABELS: Record<string, string> = { minor: 'Minor', major: 'Major', critical: 'Critical' }
export const SEVERITY_HEX: Record<string, string> = { minor: '#78716c', major: '#F59E0B', critical: '#DC2626' }
export const ISSUE_STATUS_LABELS: Record<string, string> = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed' }
export const ISSUE_STATUS_HEX: Record<string, string> = { open: '#DC2626', investigating: '#F59E0B', resolved: '#2563EB', closed: '#16A34A' }
export const INSPECTION_LABELS: Record<string, string> = { pending: 'Inspection pending', in_progress: 'Inspecting', passed: 'Passed', failed: 'Failed', conditionally_passed: 'Passed (conditional)' }
export const INSPECTION_HEX: Record<string, string> = { pending: '#F59E0B', in_progress: '#2563EB', passed: '#16A34A', failed: '#DC2626', conditionally_passed: '#0d9488' }

export const today = () => new Date().toISOString().slice(0, 10)
export const toOptions = (rows: ElectricalLookupOption[], none = '— None —') => [{ value: '', label: none }, ...rows.map((r) => ({ value: String(r.id), label: r.label }))]
export const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
export const strOrNull = (v: string) => (v.trim() === '' ? null : v.trim())
export const fmtBytes = (n?: number | null) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Opens a streamed file (drawing revision / document) in a new tab. A blob
 * request's error body is a Blob too, so it's unwrapped for the real reason. */
export async function openBlob(fetcher: () => Promise<Blob>, onError: (msg: string | string[]) => void, fallback: string) {
  try {
    const blob = await fetcher()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err) {
    const body = (err as { response?: { data?: unknown } })?.response?.data
    if (body instanceof Blob) {
      try {
        const parsed = JSON.parse(await body.text())
        if (parsed?.detail) { onError(String(parsed.detail)); return }
      } catch { /* not JSON — fall back below */ }
    }
    onError(extractErrorMessages(err, fallback))
  }
}

/** A small modal shell for the tabs' add/edit forms. */
export function Modal({ open, title, onClose, children, width = 640 }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 150, padding: '6vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, background: '#fff', borderRadius: 18, boxShadow: '0 20px 50px rgba(0,0,0,.18)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: TEXT.muted }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Field wrapper sized by flex basis — see the ui-behavior sizing rules. */
export function F({ label, basis = 160, grow = false, max, children }: { label: string; basis?: number; grow?: boolean; max?: number; children: React.ReactNode }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 140), maxWidth: max }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

export const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }
