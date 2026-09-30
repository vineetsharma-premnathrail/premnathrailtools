'use client'

// Small shared pieces for the HR administration screens (assets, visitors,
// travel, expense claims). Status label/colour maps stay local to each page
// per the UI convention; this file only holds formatting helpers and the
// layout shells those pages repeat.

import { useEscapeKey } from '@/hooks/useEscapeKey'
import { TEXT, GLASS, SHADOWS, BORDER, GRADIENTS } from '@/lib/theme'

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
  if (m && value.length === 10) return `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
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
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
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

export const primaryActionStyle: React.CSSProperties = {
  padding: '11px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13.5, fontWeight: 600,
  boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`, whiteSpace: 'nowrap',
}

export const filterInputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}

export const formInputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
  fontFamily: 'inherit',
}

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

/** Form dialog shell with the same backdrop/panel look as ConfirmDialog and
 * PromptDialog, for the issue / return / check-in style forms. */
export function FormDialog({
  open, title, subtitle, children, onClose, footer, maxWidth = 520,
}: {
  open: boolean
  title: string
  subtitle?: string
  children: React.ReactNode
  onClose: () => void
  footer: React.ReactNode
  maxWidth?: number
}) {
  useEscapeKey(open, onClose)
  if (!open) return null
  return (
    <div
      onClick={onClose}
      className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dialog-panel"
        style={{ width: '100%', maxWidth, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>{title}</p>
        {subtitle && <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 14px', lineHeight: 1.5 }}>{subtitle}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: subtitle ? 0 : 12 }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>{footer}</div>
      </div>
    </div>
  )
}

export function StatCard({ label, value, hex }: { label: string; value: number | string; hex: string }) {
  return (
    <div style={{ ...sectionStyle, padding: '14px 16px', marginBottom: 0, flex: '1 1 150px', minWidth: 140 }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: hex, margin: 0 }}>{value}</p>
    </div>
  )
}
