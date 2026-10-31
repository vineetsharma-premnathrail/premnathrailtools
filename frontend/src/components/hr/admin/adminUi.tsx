'use client'

// Small shared pieces for the HR administration screens (assets, visitors,
// travel, expense claims). Status label/colour maps stay local to each page
// per the UI convention; this file only holds formatting helpers and the
// layout shells those pages repeat.

import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetIconName } from '@/components/shared/FormSheet'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, inputStyle as sharedInput, pillStyle } from '@/components/shared/ui'

const inrFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmtINR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? inrFormatter.format(n) : '—'
}

/** yyyy-mm-dd (or ISO datetime) → DD-MM-YYYY, matching DateField's display. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m && value.length === 10) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${fmtDate(value)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function Pill({ hex, label }: { hex: string; label: string }) {
  return (
    <span style={pillStyle(hex)}>{label}</span>
  )
}

export function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.map((e, i) => <div key={i}>{e}</div>) : error}
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  if (!message) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.22)', color: '#166534', fontSize: 13 }}>
      {message}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          HR &amp; Administration
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

// Buttons + inputs ride the shared 38px control scale (shared/ui); only the
// glow / translucent background stay local.
export const primaryActionStyle: React.CSSProperties = {
  ...primaryBtnStyle, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}

export const filterInputStyle: React.CSSProperties = { ...sharedInput, width: 'auto', background: 'rgba(255,255,255,.7)' }

export const formInputStyle: React.CSSProperties = { ...sharedInput, background: 'rgba(255,255,255,.7)', fontFamily: 'inherit' }

export const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.secondary, marginBottom: 6, display: 'block',
}

export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export const tableWrapStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}

export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
  color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}

export const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top',
}

export const linkActionStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', background: 'none', border: 'none', padding: 0, whiteSpace: 'nowrap',
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr><td colSpan={colSpan} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{text}</td></tr>
  )
}

/** Form dialog shell for the issue / return / check-in style forms — the
 * app-wide FormSheet popup (icon header, body, Cancel + primary footer).
 * `bare` skips the padded column wrapper so callers can use SheetColumns. */
export function FormDialog({
  open, title, subtitle, children, onClose, footer, maxWidth = 580, icon = 'edit', iconColor, busy = false, tour, bare = false,
}: {
  open: boolean
  title: string
  subtitle?: string
  children: React.ReactNode
  onClose: () => void
  footer: React.ReactNode
  maxWidth?: number
  icon?: SheetIconName
  iconColor?: string
  busy?: boolean
  tour?: string
  bare?: boolean
}) {
  useEscapeKey(open && !busy, onClose)
  if (!open) return null
  return (
    <FormSheet width={maxWidth} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle || ''} onClose={onClose} busy={busy} tour={tour} footer={footer}>
      {bare ? children : <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>}
    </FormSheet>
  )
}

export function StatCard({ label, value, hex, onClick, active }: { label: string; value: number | string; hex: string; onClick?: () => void; active?: boolean }) {
  const base: React.CSSProperties = { ...sectionStyle, padding: '14px 16px', marginBottom: 0, flex: '1 1 150px', minWidth: 140 }
  const body = (
    <>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: hex, margin: 0 }}>{value}</p>
    </>
  )
  if (!onClick) return <div style={base}>{body}</div>
  return (
    // ui-audit-ignore-next-line custom-button — stat card used as a filter toggle, keeps the card look
    <button type="button" onClick={onClick} aria-pressed={!!active} title={active ? `Showing ${label} — click to show all` : `Show ${label}`}
      style={{ ...base, display: 'block', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', ...(active ? { border: `1.5px solid ${hex}`, background: `${hex.startsWith('#') && hex.length === 7 ? hex + '14' : 'rgba(255,255,255,.7)'}` } : {}) }}>
      {body}
    </button>
  )
}
