'use client'

// Small shared bits for the HR master sections (Designations, Grades,
// Shifts) and the employee screens, so the three near-identical master
// tables stay visually consistent. Styles are built from theme tokens, same
// as every other module's local consts.
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { FormSheet, SheetIconName } from '@/components/shared/FormSheet'

export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export const tableWrapStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}

export const thStyle: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px',
  fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap',
}

export const tdStyle: React.CSSProperties = { padding: '11px 16px', fontSize: 13, color: TEXT.body, borderTop: '1px solid rgba(0,0,0,0.05)', verticalAlign: 'middle' }

export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }

export const hintStyle: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }

export const linkActionStyle: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
export const dangerActionStyle: React.CSSProperties = { ...linkActionStyle, color: '#b91c1c' }
export const mutedActionStyle: React.CSSProperties = { ...linkActionStyle, color: TEXT.secondary }

export const searchInputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)',
  fontSize: 13, outline: 'none', color: TEXT.body, width: 260, maxWidth: '100%', boxSizing: 'border-box',
}

export function ErrorBanner({ errors }: { errors: string[] | string }) {
  const list = Array.isArray(errors) ? errors : errors ? [errors] : []
  if (!list.length) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {list.map((e, i) => <div key={i}>{e}</div>)}
    </div>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, whiteSpace: 'nowrap', background: active ? '#16A34A1a' : 'rgba(100,116,139,0.12)', color: active ? '#16A34A' : TEXT.muted }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

/** Master add/edit popup on the app-wide FormSheet (portal to <body>, icon
 * header, Cancel + primary footer). `bare` skips the padded body wrapper. */
export function Modal({ open, title, onClose, children, width = 580, busy, icon = 'edit', iconColor, subtitle = '', footer, tour, bare = false }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number; busy?: boolean
  icon?: SheetIconName; iconColor?: string; subtitle?: string; footer?: React.ReactNode; tour?: string; bare?: boolean
}) {
  if (!open) return null
  return (
    <FormSheet width={width} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle} onClose={onClose} busy={!!busy} tour={tour} footer={footer}>
      {bare ? children : <div style={{ padding: '20px 24px' }}>{children}</div>}
    </FormSheet>
  )
}

export function MasterToolbar({ search, onSearch, showInactive, onToggleInactive, addLabel, onAdd, placeholder }: {
  search: string; onSearch: (v: string) => void; showInactive: boolean; onToggleInactive: (v: boolean) => void
  addLabel: string; onAdd?: () => void; placeholder: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <input data-tour="hr-mst-search" style={searchInputStyle} value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} />
      <label data-tour="hr-mst-show-inactive" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary, cursor: 'pointer' }}>
        <input type="checkbox" checked={showInactive} onChange={(e) => onToggleInactive(e.target.checked)} />
        Show inactive
      </label>
      <div style={{ flex: 1 }} />
      {/* onAdd omitted = the user lacks Create on HR › Masters: no button. */}
      {onAdd && <button type="button" data-tour="hr-mst-add-btn" onClick={onAdd} style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#FF7A45,#FF6A2A)', color: '#fff', cursor: 'pointer' }}>
        <span style={{ fontSize: 16, lineHeight: 1, marginRight: 6 }}>+</span>{addLabel}
      </button>}
    </div>
  )
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}-${m}-${y}` : iso
}

export function titleCase(s?: string | null): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const AVATAR_COLORS = ['#FF7A45', '#2563EB', '#16A34A', '#7C3AED', '#0891B2', '#DB2777', '#CA8A04', '#475569']

export function initials(name?: string | null): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Initials avatar (the portal doesn't store profile photos yet; a real
 * http(s) photo URL is shown when one exists). */
export function Avatar({ name, url, size = 32, id }: { name?: string | null; url?: string | null; size?: number; id?: number }) {
  const color = AVATAR_COLORS[Math.abs(id ?? (name || '').length) % AVATAR_COLORS.length]
  if (url && /^https?:\/\//.test(url)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name || ''} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
  }
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: `${color}1f`, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 700, flex: 'none', letterSpacing: '.02em' }}>
      {initials(name)}
    </span>
  )
}

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding', active: 'Active', notice: 'On Notice', exited: 'Exited',
}
export const PROBATION_STATUS_LABELS: Record<string, string> = { not_applicable: 'Not applicable', on_probation: 'On probation', confirmed: 'Confirmed' }
export const VERIFICATION_HEX: Record<string, string> = { pending: '#CA8A04', verified: '#16A34A', rejected: '#DC2626' }
export const LOGIN_STATUS_LABELS: Record<string, string> = {
  linked: 'Linked to portal account', pending_first_sign_in: 'Waiting for first sign-in', not_provisioned: 'Not provisioned', not_required: 'HR record only — no login',
}
export const EMPLOYMENT_STATUS_HEX: Record<string, string> = {
  onboarding: '#2563EB', probation: '#CA8A04', active: '#16A34A', notice: '#DC2626', exited: '#64748B',
}
// Workforce type (backend WORKER_TYPES). Not the same as employment type:
// 'contract' here is a contractor's worker, not our fixed-term employee.
export const WORKER_TYPE_LABELS: Record<string, string> = {
  office: 'Office staff', factory: 'Factory / workshop', housekeeping: 'Housekeeping / cleaning', contract: 'Contract labour', other: 'Other',
}
export const WORKER_TYPE_HEX: Record<string, string> = {
  office: '#2563EB', factory: '#EA580C', housekeeping: '#0D9488', contract: '#7C3AED', other: '#64748B',
}
// Dynamic workforce form record state (backend workforce_rules.record_status).
export const RECORD_STATUS_LABELS: Record<string, string> = { draft: 'Draft', incomplete: 'Incomplete', complete: 'Complete' }
export const RECORD_STATUS_HEX: Record<string, string> = { draft: '#64748B', incomplete: '#CA8A04', complete: '#16A34A' }
export const ATTENDANCE_POLICY_LABELS: Record<string, string> = {
  biometric: 'Biometric punch', supervisor: 'Marked by supervisor', self: 'Self-service (portal)', exempt: 'Exempt from attendance',
}

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  permanent: 'Permanent', fixed_term: 'Fixed-term', contract: 'Contractual', trainee: 'Trainee / Apprentice', intern: 'Intern', consultant: 'Consultant',
}

export function StatusPill({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
  )
}
