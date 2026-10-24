'use client'

import { useMemo } from 'react'
import { COLORS, RADII, BORDER, BORDERS, CONTROL, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { CrmActivityAttachment } from '@/types'
import { crmApi } from '@/lib/api'
import { useAttachmentBlobUrl, openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'

// ---- Control + button scale (CONTROL in theme.ts) --------------------------
// Every input, dropdown trigger, date field and button is 38px tall (small: 30px)
// from padding + lineHeight + a 1px border. Module style files (crm/ui, finance,
// hr, sales, pm, electrical, rnd) spread these instead of their own paddings, so
// controls in one row line up app-wide. Override colours, never the height.

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `10px ${CONTROL.padX}px`,
  borderRadius: CONTROL.radius,
  border: `1px solid ${BORDER.normal}`,
  background: COLORS.surface,
  fontSize: CONTROL.fontSize,
  lineHeight: CONTROL.lineHeight,
  minHeight: CONTROL.height,
  color: TEXT.body,
  outline: 'none',
  boxSizing: 'border-box',
  minWidth: 0,
}

/** Shared box for every button: centred icon + label, never wraps, 38px tall. */
export const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontSize: CONTROL.fontSize,
  fontWeight: 600,
  lineHeight: CONTROL.lineHeight,
  padding: '10px 18px',
  minHeight: CONTROL.height,
  borderRadius: CONTROL.radius,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  cursor: 'pointer',
  flex: 'none',
}

export const primaryBtnStyle: React.CSSProperties = {
  ...btnBase,
  border: '1px solid transparent',
  background: COLORS.brandGradient,
  color: '#fff',
}

export const secondaryBtnStyle: React.CSSProperties = {
  ...btnBase,
  border: `1px solid ${BORDER.normal}`,
  background: COLORS.surface,
  color: '#57534e',
}

export const dangerBtnStyle: React.CSSProperties = {
  ...btnBase,
  border: BORDERS.dangerStrong,
  background: 'rgba(220,38,38,0.06)',
  color: COLORS.danger,
}

/** 30px variant for row actions inside tables, chips and toolbars. */
export const smallBtnSize: React.CSSProperties = {
  padding: '6px 12px',
  minHeight: CONTROL.heightSm,
  fontSize: CONTROL.fontSizeSm,
  gap: 4,
}
export const smallPrimaryBtnStyle: React.CSSProperties = { ...primaryBtnStyle, ...smallBtnSize }
export const smallSecondaryBtnStyle: React.CSSProperties = { ...secondaryBtnStyle, ...smallBtnSize }
export const smallDangerBtnStyle: React.CSSProperties = { ...dangerBtnStyle, ...smallBtnSize }

/** Square icon-only button, same height as an input (pairs with a field in one row). */
export const iconBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  padding: 0,
  width: CONTROL.height,
  minWidth: CONTROL.height,
  height: CONTROL.height,
}

// ---- Tables -----------------------------------------------------------------
/** Scroll box around every data table: scrolls both ways inside the card, so a
 * wide table never widens the page; the sticky header stays visible. */
export const tableWrapStyle: React.CSSProperties = {
  width: '100%',
  overflow: 'auto',
  maxHeight: 'calc(100vh - 320px)',
  borderRadius: 12,
  border: `1px solid ${BORDER.light}`,
  background: 'rgba(255,255,255,.55)',
}
export const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
export const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: TEXT.muted,
  background: '#fdf1e6',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 1,
  verticalAlign: 'middle',
}
export const tdStyle: React.CSSProperties = {
  padding: '9px 12px',
  fontSize: 13,
  color: TEXT.body,
  borderTop: `1px solid ${BORDER.light}`,
  verticalAlign: 'middle',
}
export const numThStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' }
export const numTdStyle: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

/** Wraps a <table> in the shared scroll box. `maxHeight="none"` for short tables
 * inside a page that already scrolls. */
export function TableScroll({ children, maxHeight, style, minWidth }: { children: React.ReactNode; maxHeight?: number | string; style?: React.CSSProperties; minWidth?: number }) {
  return (
    <div className="table-scroll" style={{ ...tableWrapStyle, ...(maxHeight !== undefined ? { maxHeight } : {}), ...style }}>
      {minWidth ? <div style={{ minWidth }}>{children}</div> : children}
    </div>
  )
}

/** Toolbar row above a table / list: filters on the left, actions on the right,
 * wraps on narrow screens, every control the same height. */
export function Toolbar({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="ui-toolbar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, ...style }}>{children}</div>
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
    <div className="glass-section" style={{ padding: 18, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), ...style }}>
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
    <div className="glass-section" style={{ padding: 16, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
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
        <ActivityPhotoThumb key={a.id} attachment={a} />
      ))}
    </div>
  )
}

function ActivityPhotoThumb({ attachment }: { attachment: CrmActivityAttachment }) {
  const fetchBlob = useMemo(
    () => () => crmApi.getActivityAttachmentBlob(attachment.activity_id, attachment.id),
    [attachment.activity_id, attachment.id]
  )
  const src = useAttachmentBlobUrl(fetchBlob)
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); openAttachmentBlob(fetchBlob) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={attachment.filename} style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />}
    </a>
  )
}

export function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    fontWeight: 600,
    padding: '6px 11px',
    borderRadius: RADII.md,
    border: `1px solid ${BORDER.normal}`,
    background: COLORS.surface,
    color: '#57534e',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
