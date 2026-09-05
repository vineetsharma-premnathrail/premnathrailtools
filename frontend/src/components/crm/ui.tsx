'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, RADII, BORDERS, GLASS, SHADOWS, TEXT, BRAND } from '@/lib/theme'
import { CrmActivityAttachment } from '@/types'
import { crmApi } from '@/lib/api'
import { useAttachmentBlobUrl, openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'

export interface SpecRevisionChange {
  field: string
  old: unknown
  new: unknown
}

export interface SpecRevision {
  id: number
  revision_id: string
  performed_by: string
  performed_at: string | null
  changes: SpecRevisionChange[]
}

/** Word-level diff (LCS-based) — used to highlight only the changed words within a field's value. */
function diffWords(oldStr: string, newStr: string): { text: string; type: 'same' | 'removed' | 'added' }[] {
  const oldWords = oldStr.split(/(\s+)/).filter((w) => w !== '')
  const newWords = newStr.split(/(\s+)/).filter((w) => w !== '')
  const m = oldWords.length
  const n = newWords.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const result: { text: string; type: 'same' | 'removed' | 'added' }[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) { result.push({ text: oldWords[i], type: 'same' }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { result.push({ text: oldWords[i], type: 'removed' }); i++ }
    else { result.push({ text: newWords[j], type: 'added' }); j++ }
  }
  while (i < m) { result.push({ text: oldWords[i], type: 'removed' }); i++ }
  while (j < n) { result.push({ text: newWords[j], type: 'added' }); j++ }
  return result
}

function DiffValue({ oldVal, newVal }: { oldVal: unknown; newVal: unknown }) {
  const oldStr = oldVal == null ? '' : String(oldVal)
  const newStr = newVal == null ? '' : String(newVal)
  const parts = diffWords(oldStr, newStr)
  return (
    <p style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' }}>
      {parts.map((p, idx) => {
        if (p.type === 'same') return <span key={idx} style={{ color: COLORS.ink }}>{p.text}</span>
        if (p.type === 'removed') return <span key={idx} style={{ color: '#b91c1c', background: 'rgba(220,38,38,0.12)', textDecoration: 'line-through', borderRadius: 3 }}>{p.text}</span>
        return <span key={idx} style={{ color: '#166534', background: 'rgba(22,163,74,0.14)', fontWeight: 600, borderRadius: 3 }}>{p.text}</span>
      })}
      {parts.length === 0 && <span style={{ color: COLORS.textFaint2 }}>—</span>}
    </p>
  )
}

/**
 * Attach as a form's onKeyDown so Enter never submits it from a plain input/select —
 * only the actual Save/Submit button does. Enter instead moves focus to the next field,
 * like Tab. Textareas and the submit button itself are left alone (multi-line entry,
 * explicit submit).
 */
export function handleEnterAsTab(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter') return
  const target = e.target as HTMLElement
  if (target.tagName === 'TEXTAREA' || (target.tagName === 'BUTTON' && (target as HTMLButtonElement).type === 'submit')) return
  e.preventDefault()
  const focusable = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]')
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null)
  const idx = focusable.indexOf(target)
  if (idx >= 0 && idx + 1 < focusable.length) focusable[idx + 1].focus()
}

/** Compact "REV-N" dropdown — pick a revision to see its changes highlighted in place, or "Current" for live values. */
export function RevisionSelector({ revisions, selectedId, onSelect }: { revisions: SpecRevision[]; selectedId: number | null; onSelect: (id: number | null) => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  if (!revisions || revisions.length === 0) return null
  const selected = revisions.find((r) => r.id === selectedId) || null

  const toggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((v) => !v)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div
        ref={triggerRef}
        onClick={toggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: selected ? 'rgba(255,122,69,0.12)' : 'rgba(0,0,0,0.05)', color: selected ? BRAND.primary : COLORS.textFaint2, fontSize: 11, fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}
      >
        {selected ? selected.revision_id : 'Current'}
        <span style={{ fontSize: 10, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      </div>
      {open && pos && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999998 }} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 999999, minWidth: 220, borderRadius: 12, background: 'rgba(255,255,255,.98)', backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
          <div style={{ maxHeight: 300, overflowY: 'auto', padding: 6 }}>
            <div
              onClick={() => { onSelect(null); setOpen(false) }}
              style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: !selected ? 700 : 500, color: !selected ? BRAND.primary : COLORS.ink, background: !selected ? 'rgba(255,122,69,0.08)' : 'transparent' }}
            >
              Current
            </div>
            {revisions.map((r) => (
              <div
                key={r.id}
                onClick={() => { onSelect(r.id); setOpen(false) }}
                style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: selectedId === r.id ? 'rgba(255,122,69,0.08)' : 'transparent' }}
              >
                <div style={{ fontSize: 12.5, fontWeight: selectedId === r.id ? 700 : 600, color: selectedId === r.id ? BRAND.primary : COLORS.ink }}>{r.revision_id}</div>
                <div style={{ fontSize: 10.5, color: COLORS.textFaint2 }}>{r.performed_by}{r.performed_at ? ` · ${new Date(r.performed_at).toLocaleString()}` : ''}</div>
              </div>
            ))}
          </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

export interface ComboOption {
  key: string
  label: string
  sublabel?: string
}

/**
 * A free-text input with a dropdown of matching options underneath — type to filter/enter
 * a custom value, or click an option to pick it. Includes an inline "+ Add new" row inside
 * the dropdown itself (via onCreateNew) so callers don't need a separate "New" button.
 */
export function ComboBox({
  value, onChange, onPick, options, placeholder, onCreateNew, createLabel = 'Add new', style,
}: {
  value: string
  onChange: (text: string) => void
  onPick?: (opt: ComboOption) => void
  options: ComboOption[]
  placeholder?: string
  onCreateNew?: (query: string) => void
  createLabel?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = value.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(value.toLowerCase()))
    : options

  const openDropdown = () => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    setOpen(true)
  }

  // Enter must never submit the surrounding <form> — it commits the typed/matched value
  // (creating it if it's new) and moves focus to the next field, like Tab would.
  const focusNext = (from: HTMLElement) => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]')
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null)
    const idx = focusable.indexOf(from)
    if (idx >= 0 && idx + 1 < focusable.length) focusable[idx + 1].focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    const exact = options.find((o) => o.label.toLowerCase() === value.trim().toLowerCase())
    if (exact) {
      if (onPick) onPick(exact); else onChange(exact.label)
    } else if (value.trim() && onCreateNew) {
      onCreateNew(value)
    }
    setOpen(false)
    focusNext(e.currentTarget)
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', ...style }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); openDropdown() }}
        onFocus={openDropdown}
        onClick={openDropdown}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 30 }}
      />
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ position: 'absolute', right: 10, top: '50%', transform: open ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)', pointerEvents: 'none', transition: 'transform .15s' }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
      {open && pos && createPortal(
        <>
          <div onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999998 }} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 999999, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 16px 36px rgba(0,0,0,0.14)', overflow: 'hidden' }}>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <p style={{ fontSize: 12.5, color: COLORS.textFaint2, padding: '10px 14px', margin: 0 }}>No matches.</p>
            )}
            {filtered.map((o) => (
              <div
                key={o.key}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { if (onPick) onPick(o); else onChange(o.label); setOpen(false) }}
                style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ color: COLORS.ink, fontWeight: 500 }}>{o.label}</div>
                {o.sublabel && <div style={{ fontSize: 11, color: COLORS.textFaint2 }}>{o.sublabel}</div>}
              </div>
            ))}
            {onCreateNew && (
              <div
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onCreateNew(value); setOpen(false) }}
                style={{ padding: '9px 14px', fontSize: 12.5, fontWeight: 700, color: BRAND.primary, cursor: 'pointer', borderTop: filtered.length > 0 ? '1px solid rgba(0,0,0,0.06)' : undefined }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,122,69,0.06)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                + {createLabel}{value.trim() ? `: "${value.trim()}"` : ''}
              </div>
            )}
          </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

/** An InfoRow that, when the selected revision changed this field, shows the word-level diff inline instead of the plain value. */
export function SpecInfoRow({ label, value, change }: { label: string; value: string; change?: { old: unknown; new: unknown } }) {
  if (!change) return <InfoRow label={label} value={value} />
  return (
    <div style={{ borderRadius: 8, padding: '4px 8px', margin: '-4px -8px', background: 'rgba(255,122,69,0.06)', border: '1px dashed rgba(255,122,69,0.3)' }}>
      <p className="info-row-label" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.textFaint2, margin: '0 0 2px' }}>{label}</p>
      <DiffValue oldVal={change.old} newVal={change.new} />
    </div>
  )
}

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

export function Card({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '0 0 12px' }}>
        <p className="card-title" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: COLORS.ink, margin: 0 }}>{title}</p>
        {actions}
      </div>
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
    border: BORDERS.default,
    background: COLORS.surface,
    color: '#57534e',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
