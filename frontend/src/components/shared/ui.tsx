'use client'

import { Fragment, cloneElement, isValidElement, useId, useMemo } from 'react'
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
  padding: `${CONTROL.padY}px ${CONTROL.padX}px`,
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
  padding: `${CONTROL.padY}px ${CONTROL.padX}px`,
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
  padding: `${CONTROL.padYSm}px 10px`,
  minHeight: CONTROL.heightSm,
  fontSize: CONTROL.fontSizeSm,
  gap: 4,
}
export const smallPrimaryBtnStyle: React.CSSProperties = { ...primaryBtnStyle, ...smallBtnSize }
export const smallSecondaryBtnStyle: React.CSSProperties = { ...secondaryBtnStyle, ...smallBtnSize }
export const smallDangerBtnStyle: React.CSSProperties = { ...dangerBtnStyle, ...smallBtnSize }

/** Filter chip / pill toggle (30px): "All · Open · Closed", quick ranges, tag pickers.
 * Active = filled brand colour. Use for choices, not for actions. */
export function chipBtnStyle(active = false): React.CSSProperties {
  return {
    ...btnBase,
    ...smallBtnSize,
    borderRadius: 999,
    border: `1px solid ${active ? 'transparent' : BORDER.normal}`,
    // Active fill is the darker brand shade: white on #FF7A45 is only 2.6:1, on #C2410C 5.2:1.
    background: active ? '#C2410C' : COLORS.surface,
    color: active ? '#fff' : '#57534e',
  }
}

/** One option of a segmented control (2–4 fixed choices side by side, 38px),
 * e.g. Project / Inhouse. Wrap the options in a flex row with gap 0 or 4. */
export function segmentBtnStyle(active = false): React.CSSProperties {
  return {
    ...btnBase,
    padding: `${CONTROL.padY}px ${CONTROL.padX}px`,
    border: `1px solid ${active ? COLORS.brand : BORDER.normal}`,
    background: active ? COLORS.brandLight : COLORS.surface,
    color: active ? COLORS.brandDark : '#57534e',
  }
}

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

/** Row count shown next to a table's first header (ID / No. / Code), app-wide:
 * `<th>ID <RowCount count={rows.length} /></th>`. Pass the rows left after
 * search + filters (for a server-paged list, the server's total for the current
 * filters — not the page size), so the number always matches what the user is
 * looking at. */
export function RowCount({ count, title }: { count: number; title?: string }) {
  // Not shown on screen (the owner does not want a "N found" badge in table headers); kept for screen readers.
  return (
    <span
      data-row-count={count}
      style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
    >
      {title ?? `${count.toLocaleString('en-IN')} ${count === 1 ? 'record' : 'records'} found with the current search and filters`}
    </span>
  )
}

/** Small counter chip for the header of a list page: a number in colour and a label ("305 Machines"). */
/** Count chip. With `onClick` it is a filter button (owner, 2026-10-31: every count
 * applies its filter); `active` = that filter is on — clicking again should clear it. */
export function StatChip({ label, value, color, onClick, active }: { label: string; value: number; color: string; onClick?: () => void; active?: boolean }) {
  const style: React.CSSProperties = {
    ...pillStyle('#57534e'), gap: 6, padding: '3px 12px', fontSize: 12, fontWeight: 600,
    background: active ? `${color}14` : 'rgba(255,255,255,.7)', border: `1px solid ${active ? color : 'rgba(0,0,0,0.08)'}`,
  }
  const body = (
    <>
      <span style={{ fontSize: 15, fontWeight: 700, color }}>{value.toLocaleString('en-IN')}</span>
      {label}
    </>
  )
  if (!onClick) return <span style={style}>{body}</span>
  return (
    // ui-audit-ignore-next-line custom-button — count chip used as a filter toggle, keeps the chip look
    <button type="button" onClick={onClick} aria-pressed={!!active} title={active ? `Showing ${label} — click to show all` : `Show ${label}`}
      style={{ ...style, cursor: 'pointer', fontFamily: 'inherit' }}>
      {body}
    </button>
  )
}

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
  // Bind the label to its control: a single element child gets the generated id
  // (an id it already has is kept). Several children / text: label stays unbound as before.
  const uid = useId()
  const only = isValidElement(children) ? (children as React.ReactElement<{ id?: string }>) : null
  // Skip plain wrappers (div, span, Fragment): a label cannot point at those.
  const bindable = !!only && only.type !== Fragment && (typeof only.type !== 'string' || ['input', 'select', 'textarea', 'button'].includes(only.type))
  const id = bindable ? (only!.props.id || `f${uid}`) : undefined
  const control = bindable ? cloneElement(only!, { id }) : children
  return (
    <div>
      <label htmlFor={id} className="field-label" style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.textFaint2, marginBottom: 6 }}>{label}</label>
      {control}
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

// ---- Status pills --------------------------------------------------------------
/** The one status / priority / type pill: tinted background, coloured text, one
 * line. Use `<Pill label hex />` (or `pillStyle(hex)` on your own span) instead of
 * a hand-made `borderRadius: 9999` span. */
// Text on the 10% tint must reach 4.5:1 (WCAG AA). The fill/tint keeps the status
// colour; only the TEXT colour is darkened. Known colours map to fixed readable
// shades; any other 6-digit hex is darkened step by step until it passes.
const PILL_TEXT: Record<string, string> = {
  '#16a34a': '#166534', '#22c55e': '#166534', '#10b981': '#166534',
  '#d97706': '#92400e', '#f59e0b': '#92400e', '#eab308': '#854d0e',
  '#94a3b8': '#475569', '#64748b': '#475569',
  '#2563eb': '#1d4ed8', '#3b82f6': '#1d4ed8',
  '#ff7a45': '#c2410c', '#f4713b': '#c2410c',
}
function lum(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: number[], b: number[]): number {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export function readableOnTint(hex: string): string {
  const mapped = PILL_TEXT[hex.toLowerCase()]
  if (mapped) return mapped
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const tint = base.map((v) => Math.round(v * 0.1 + 255 * 0.9))
  let c = base
  for (let k = 1; k <= 20 && ratio(c, tint) < 4.5; k++) c = base.map((v) => Math.round(v * (1 - k * 0.05)))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}
export function pillStyle(hex: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, lineHeight: '16px',
    padding: '2px 10px', borderRadius: 9999, background: `${hex}1a`, color: readableOnTint(hex), whiteSpace: 'nowrap', flex: 'none',
  }
}
export function Pill({ label, hex = '#78716c', title }: { label: React.ReactNode; hex?: string; title?: string }) {
  return <span title={title} style={pillStyle(hex)}>{label}</span>
}

// ---- Detail / overview layout (read-only record views) ---------------------
// The pattern of R&D › Prototype › Overview, which the owner found clear: one card,
// a summary on top (what the record is, its key facts on one line), then every
// detail as a label–value list grouped by thin dividers. Use it for any record's
// read-only view instead of a grid of separate glass cards.

/** One card holding a whole record view. */
export function DetailCard({ children, style, tour }: { children: React.ReactNode; style?: React.CSSProperties; tour?: string }) {
  return (
    <div data-tour={tour} style={{ borderRadius: 18, background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15,23,42,0.06)', padding: '22px 26px', marginBottom: 20, ...style }}>
      {children}
    </div>
  )
}

/** Top of a DetailCard: the record's name, one plain sentence of what it is /
 * why it exists, and its key facts (status, dates, owner) on one line. */
export function DetailSummary({ title, text, meta, actions }: { title: React.ReactNode; text?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ paddingBottom: 16, borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 6px', overflowWrap: 'anywhere' }}>{title}</h2>
        {text && <p style={{ fontSize: 14, lineHeight: '21px', color: '#334155', margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{text}</p>}
        {meta && <div style={{ fontSize: 13, color: '#64748b', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{meta}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

/** A group of DetailRows, separated from the next group by a thin line. */
export function DetailGroup({ title, children, last }: { title?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: last ? 'none' : '1px solid #e2e8f0' }}>
      {title && <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b', margin: '8px 0 2px' }}>{title}</p>}
      {children}
    </div>
  )
}

/** One line: fixed-width label left, value right ("—" when empty). Wraps on a phone. */
/** `emptyText`: what a blank value shows (default "—", e.g. "Not added"). */
export function DetailRow({ label, children, emptyText = '—' }: { label: string; children: React.ReactNode; emptyText?: string }) {
  const empty = children === null || children === undefined || children === '' || children === false
  return (
    <div style={{ display: 'flex', gap: 16, padding: '8px 0', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 190px', fontSize: 13, color: '#64748b' }}>{label}</div>
      <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13.5, lineHeight: '20px', color: empty ? '#64748b' : '#0f172a', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{empty ? emptyText : children}</div>
    </div>
  )
}
