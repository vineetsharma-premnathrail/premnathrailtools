'use client'

import { COLORS, RADII, BORDERS, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { CrmActivityAttachment } from '@/types'

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: RADII.lg,
  border: BORDERS.default,
  background: COLORS.surface,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

export const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '10px 20px',
  borderRadius: RADII.lg,
  border: 'none',
  background: COLORS.brandGradient,
  color: '#fff',
  cursor: 'pointer',
}

export const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: RADII.lg,
  border: BORDERS.default,
  background: COLORS.surface,
  color: '#57534e',
  cursor: 'pointer',
}

export const dangerBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: RADII.lg,
  border: BORDERS.default,
  background: COLORS.surface,
  color: COLORS.danger,
  cursor: 'pointer',
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label" style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.textFaint2, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

export function Section({ title, children, style, contentStyle }: { title: string; children: React.ReactNode; style?: React.CSSProperties; contentStyle?: React.CSSProperties }) {
  return (
    <div style={{ padding: 18, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), ...style }}>
      <p className="section-title" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...contentStyle }}>{children}</div>
    </div>
  )
}

// `auto-fit, minmax(...)` rather than a fixed `1fr 1fr` — columns collapse to
// a single stacked column once the viewport can't fit them at their minimum
// width (phones), instead of squeezing both into an unreadably narrow strip.
export function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>{children}</div>
}

export function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>{children}</div>
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
      <p className="card-title" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: COLORS.ink, margin: '0 0 12px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="info-row-label" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.textFaint2, margin: '0 0 2px' }}>{label}</p>
      <p className="info-row-value" style={{ fontSize: 13, color: COLORS.ink, margin: 0, whiteSpace: 'pre-wrap' }}>{value}</p>
    </div>
  )
}

/** Read-only photo thumbnail strip for an Activity — shown wherever an
 * Activity is listed/viewed (Org tab, Inquiry tab, Activities list). Photos
 * themselves are only added/removed from the Activity form itself. */
export function ActivityPhotos({ attachments }: { attachments?: CrmActivityAttachment[] }) {
  if (!attachments?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {attachments.map((a) => (
        <a key={a.id} href={a.sharepoint_url || '#'} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.sharepoint_url} alt={a.filename} style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />
        </a>
      ))}
    </div>
  )
}

export function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    fontWeight: 600,
    padding: '6px 11px',
    borderRadius: RADII.md,
    border: BORDERS.default,
    background: COLORS.surface,
    color: '#57534e',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
