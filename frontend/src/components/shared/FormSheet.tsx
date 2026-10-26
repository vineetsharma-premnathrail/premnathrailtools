'use client'

// Big two-column popup form — the look of PM's "Create Task" / "Create
// Milestone" sheet, shared so other modules' create forms (R&D tasks) match it.
// Rendered through a portal to <body> (glass cards clip fixed overlays).

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { useFocusTrap } from '@/components/shared/useFocusTrap'
import { CONTROL } from '@/lib/theme'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { Check, Plus, X, ListChecks, User, Calendar, Paperclip, PencilSimple, Clock, ChatCircle, ShieldCheck, ArrowCounterClockwise, MagnifyingGlass, CaretLeft, CaretRight, ClockCounterClockwise, WarningCircle, Flag, Tag, Package, Truck, Gear, Star, Trash, Link as LinkIcon, FileText, CurrencyInr, Buildings, Users, ShoppingCart, Wrench, UploadSimple, PaperPlaneRight, MapPin, IdentificationCard, AddressBook } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

export const SHEET = {
  INK: '#0f172a',
  BODY: '#334155',
  MUTED: '#64748b',
  LINE: '#e2e8f0',
  SOFT: '#f8fafc',
  BLUE: '#2563eb',
}
const { INK, BODY, MUTED, LINE, BLUE } = SHEET

export const sheetInput: React.CSSProperties = { width: '100%', padding: `${CONTROL.padY}px ${CONTROL.padX}px`, borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 13.5, lineHeight: CONTROL.lineHeight, minHeight: CONTROL.height, color: INK, background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
export const sheetLabel: React.CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 600, color: BODY, marginBottom: 6 }
export const sheetHint: React.CSSProperties = { fontSize: 12, color: MUTED, margin: '6px 0 0' }
/** Visually hidden, still read by screen readers. */
export const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', border: 0, whiteSpace: 'nowrap' }
/** Required marker: red star for sighted users (hidden from screen readers) + " (required)" for them. */
export const Req = () => <><span aria-hidden="true" style={{ color: '#be123c' }}>*</span><span style={srOnly}> (required)</span></>

/** A labelled field with the label bound to its control (htmlFor/id), plus
 * aria-required / aria-invalid / aria-describedby (hint and error). Pass ONE
 * control as the child (input, textarea, select, SearchableSelect with no own id…).
 * An id already set on the child is kept. Same look as the plain label + control. */
export function SheetField({ label, required, error, hint, children, style }: {
  label: React.ReactNode; required?: boolean; error?: string | null; hint?: React.ReactNode
  children: React.ReactElement<Record<string, unknown>>; style?: React.CSSProperties
}) {
  const uid = useId()
  const childProps = (isValidElement(children) ? children.props : {}) as Record<string, unknown>
  const id = (childProps.id as string | undefined) || `f${uid}`
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [childProps['aria-describedby'] as string | undefined, hintId, errId].filter(Boolean).join(' ') || undefined
  const control = isValidElement(children)
    ? cloneElement(children, { id, ...(required ? { 'aria-required': true } : {}), ...(error ? { 'aria-invalid': true } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) })
    : children
  return (
    <div style={style}>
      <label htmlFor={id} style={sheetLabel}>{label}{required && <> <Req /></>}</label>
      {control}
      {hint && <p id={hintId} style={sheetHint}>{hint}</p>}
      {error && <p id={errId} role="alert" style={{ fontSize: 12, color: '#b91c1c', margin: '6px 0 0' }}>{error}</p>}
    </div>
  )
}

export function sheetBtn(kind: 'primary' | 'secondary' | 'ghost' | 'danger', color = BLUE, disabled = false): React.CSSProperties {
  // Same 38px scale as inputs and the shared buttons (CONTROL), so a footer or
  // field-row button lines up with the fields next to it. Ghost (icon/close,
  // inline text actions) keeps its compact size.
  const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: `0 ${CONTROL.padX + 2}px`, minHeight: CONTROL.height, boxSizing: 'border-box', borderRadius: CONTROL.radius, fontSize: CONTROL.fontSize, lineHeight: CONTROL.lineHeight, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }
  if (kind === 'primary') return { ...base, border: 'none', background: color, color: '#fff', boxShadow: `0 4px 12px ${color}33` }
  if (kind === 'ghost') return { ...base, border: 'none', background: 'transparent', color, padding: '6px 8px', minHeight: 0 }
  if (kind === 'danger') return { ...base, border: '1px solid #fecdd3', background: '#fff1f2', color: '#be123c' }
  return { ...base, border: `1px solid ${LINE}`, background: '#fff', color: INK }
}

export type SheetIconName = 'check' | 'plus' | 'x' | 'list' | 'user' | 'calendar' | 'clip' | 'edit'
  | 'clock' | 'chat' | 'shield' | 'undo' | 'search' | 'left' | 'right' | 'history' | 'alert' | 'flag' | 'tag'
  | 'box' | 'truck' | 'gear' | 'star' | 'trash' | 'link' | 'doc' | 'rupee' | 'building' | 'users' | 'cart' | 'tool' | 'upload' | 'send'
  | 'location' | 'idcard' | 'contact'
export function SheetIcon({ name, size = 16, color = 'currentColor' }: { name: SheetIconName; size?: number; color?: string }) {
  const p: Record<SheetIconName, PhosphorIcon> = {
    check: Check,
    plus: Plus,
    x: X,
    list: ListChecks,
    user: User,
    calendar: Calendar,
    clip: Paperclip,
    edit: PencilSimple,
    clock: Clock,
    chat: ChatCircle,
    shield: ShieldCheck,
    undo: ArrowCounterClockwise,
    search: MagnifyingGlass,
    left: CaretLeft,
    right: CaretRight,
    history: ClockCounterClockwise,
    alert: WarningCircle,
    flag: Flag,
    tag: Tag,
    box: Package,
    truck: Truck,
    gear: Gear,
    star: Star,
    trash: Trash,
    link: LinkIcon,
    doc: FileText,
    rupee: CurrencyInr,
    building: Buildings,
    users: Users,
    cart: ShoppingCart,
    tool: Wrench,
    upload: UploadSimple,
    send: PaperPlaneRight,
    // Meaning-first: 'location' for addresses / sites, 'idcard' for registration
    // & tax IDs (GST, PAN), 'contact' for phone / email blocks. 'truck' is for
    // dispatch / vehicles and 'rupee' for money only.
    location: MapPin,
    idcard: IdentificationCard,
    contact: AddressBook,
  }
  const Glyph = p[name]
  return <Glyph size={size} color={color} aria-hidden style={{ flexShrink: 0 }} />
}

/** A titled block inside the sheet (icon + heading + content). */
export function SheetSection({ icon, title, extra, children, color = BLUE }: { icon: SheetIconName; title: string; extra?: React.ReactNode; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <SheetIcon name={icon} size={18} color={color} />
        <h4 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>{title}</h4>
        {extra}
      </div>
      {children}
    </div>
  )
}

export const Optional = () => <span style={{ fontSize: 12, color: MUTED }}>(optional)</span>

/** Red error banner for the top of a sheet body — the real reason and how to fix it. */
export function SheetError({ error }: { error?: string | string[] | null }) {
  if (!error || (Array.isArray(error) && !error.length)) return null
  return (
    <div role="alert" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) && error.length > 1
        ? <ul style={{ margin: 0, paddingLeft: 18 }}>{error.map((m, i) => <li key={i}>{m}</li>)}</ul>
        : Array.isArray(error) ? error[0] : error}
    </div>
  )
}

/** The popup: header (icon, title, subtitle, close), body, footer buttons. Escape closes it. */
export function FormSheet({ icon, iconColor = BLUE, title, subtitle, onClose, busy, children, footer, tour, width = 960, onSubmit }: {
  icon: SheetIconName; iconColor?: string; title: string; subtitle: string; onClose: () => void; busy: boolean
  children: React.ReactNode
  /** Omit for a view-only popup — no footer strip is drawn. */
  footer?: React.ReactNode; tour?: string
  /** Max width — 960 for the two-column forms, ~560 for a single-column one. */
  width?: number
  /** Pressing Enter in a field calls this (body + footer become a <form>); make the primary button type="submit". */
  onSubmit?: () => void
}) {
  // Escape closes it (only the top-most dialog reacts when several are open); not while saving.
  useEscapeKey(true, () => { if (!busy) onClose() })
  // Focus moves into the popup (first field, else the title), Tab stays inside, focus returns to the opener on close.
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(true, panelRef, { fallback: '[data-sheet-title]' })
  if (typeof document === 'undefined') return null
  return createPortal(
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 150, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
      <div ref={panelRef} data-tour={tour} data-form-sheet role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px rgba(15,23,42,0.25)' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${LINE}` }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: iconColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SheetIcon name={icon} size={22} color="#fff" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id={titleId} data-sheet-title tabIndex={-1} style={{ fontSize: 20, fontWeight: 700, color: INK, margin: 0 }}>{title}</h3>
            <p style={{ fontSize: 13, color: MUTED, margin: '2px 0 0', wordBreak: 'break-word' }}>{subtitle}</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => !busy && onClose()} style={sheetBtn('ghost', MUTED)}><SheetIcon name="x" size={20} /></button>
        </div>
        {(() => {
          // The body scrolls inside the panel (which is capped to the window height);
          // the footer buttons stay visible below it.
          const colStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }
          const body = <>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>{children}</div>
            {footer && <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${LINE}`, flexWrap: 'wrap', background: '#fff', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>{footer}</div>}
          </>
          return onSubmit
            ? <form noValidate style={colStyle} onSubmit={(e) => { e.preventDefault(); if (!busy) onSubmit() }}>{body}</form>
            : <div style={colStyle}>{body}</div>
        })()}
      </div>
    </div>,
    document.body,
  )
}

/** Full-page version of FormSheet for documents with line rows (PO, PR, GRN, SO, invoices, BOM, stock moves):
 * the same header / sections / right panel / footer, laid out in the page instead of a popup. */
export function FormPage({ icon, iconColor = BLUE, title, titleExtra, subtitle, onBack, backLabel = '← Back', backTour, children, footer, tour, nav }: {
  icon: SheetIconName; iconColor?: string; title: string; subtitle: string
  /** Next to the title — e.g. a status badge. */
  titleExtra?: React.ReactNode
  /** Shown as the app-wide "← Back" pill, top-right in the header row. */
  onBack?: () => void; backLabel?: string
  /** data-tour id for the Back pill. */
  backTour?: string
  children: React.ReactNode; footer: React.ReactNode; tour?: string
  /** Module sub-nav — renders above the header block. */
  nav?: React.ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const maxHeight = useFitToMain(cardRef)
  return (
    <div>
      {nav}
      <div ref={cardRef} data-tour={tour} className="form-page-card"
        style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, boxShadow: '0 1px 3px rgba(15,23,42,0.05)', display: 'flex', flexDirection: 'column', maxHeight, overflow: maxHeight ? 'hidden' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: iconColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SheetIcon name={icon} size={22} color="#fff" /></span>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: 0 }}>{title}</h1>{titleExtra}
            </div>
            <p style={{ fontSize: 13, color: MUTED, margin: '2px 0 0', wordBreak: 'break-word' }}>{subtitle}</p>
          </div>
          {onBack && <button type="button" data-tour={backTour} onClick={onBack} style={secondaryBtnStyle}>{backLabel}</button>}
        </div>
        {/* The body scrolls (each column on its own on wide screens — globals.css
            .form-page-body); the header and the footer stay put. */}
        <div className="form-page-body" style={{ flex: '1 1 auto', minHeight: 0, overflowY: maxHeight ? 'auto' : undefined, display: 'flex', flexDirection: 'column' }}>{children}</div>
        <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${LINE}`, flexWrap: 'wrap', background: '#fff', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>{footer}</div>
      </div>
    </div>
  )
}

// Below this a fitted form would be too cramped to work in — the page keeps
// its own scroll instead. Same mobile breakpoint as useFitPageTable.
const MIN_FIT_HEIGHT = 360
const MOBILE_MAX_WIDTH = 900

/** App-wide "no whole-page scrollbar" for forms: the max height that makes
 * the card end at the bottom of the dashboard's scroll area (<main>), so the
 * body scrolls inside the card and its footer never floats over the fields.
 * undefined = don't fit (phone width, or too little room). */
function useFitToMain(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)
  useEffect(() => {
    const card = ref.current
    const main = card?.closest('main')
    if (!card || !main) return
    let frame = 0
    const fit = () => {
      frame = 0
      if (window.innerWidth <= MOBILE_MAX_WIDTH) { setMaxHeight(undefined); return }
      const pad = parseFloat(getComputedStyle(main).paddingBottom) || 0
      const top = card.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
      const room = Math.floor(main.clientHeight - top - pad)
      setMaxHeight(room >= MIN_FIT_HEIGHT ? room : undefined)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit) }
    fit()
    const ro = new ResizeObserver(schedule)
    ro.observe(main)
    if (card.parentElement) ro.observe(card.parentElement)
    window.addEventListener('resize', schedule)
    return () => { ro.disconnect(); window.removeEventListener('resize', schedule); if (frame) cancelAnimationFrame(frame) }
  }, [ref])
  return maxHeight
}

/** Left (main fields) and right (grey side panel) columns of the sheet body. */
export function SheetColumns({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="sheet-columns" style={{ display: 'flex', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 440px', minWidth: 0, padding: '20px 24px', borderRight: `1px solid ${LINE}` }}>{left}</div>
      <div style={{ flex: '1 1 300px', minWidth: 0, padding: '20px 24px', background: '#fcfcfd', borderBottomRightRadius: 18 }}>{right}</div>
    </div>
  )
}

/** Drag-and-drop file picker (up to 10). */
export function FileDropZone({ files, onChange, accept, max = 10, hint, tour }: {
  files: File[]; onChange: (f: File[]) => void
  /** File types the picker offers, e.g. ".pdf,.dwg" or "image/*". */
  accept?: string
  /** Most files kept (1 = a single-file picker). */
  max?: number
  /** Replaces the "Any type · up to N files" line. */
  hint?: string
  tour?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const add = (list: FileList | null) => onChange(max === 1 ? Array.from(list || []).slice(0, 1) : [...files, ...Array.from(list || [])].slice(0, max))
  return (
    <div>
      <div data-tour={tour} onClick={() => ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
        style={{ border: `1.5px dashed ${over ? BLUE : '#cbd5e1'}`, borderRadius: 12, padding: '18px 12px', textAlign: 'center', cursor: 'pointer', background: over ? '#eff6ff' : '#fff' }}>
        <SheetIcon name="clip" size={22} color={BLUE} />
        <div style={{ fontSize: 13, color: BODY, marginTop: 6 }}>Drag and drop files here, or{' '}
          {/* Real button: keyboard-reachable; the click also bubbles to the zone, so stop it to open the picker once. */}
          <button type="button" aria-label={max === 1 ? 'Click to browse for a file' : 'Click to browse for files'} onClick={(e) => { e.stopPropagation(); ref.current?.click() }}
            style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: BLUE, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>click to browse</button></div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{hint || `${accept ? accept.replace(/,/g, ' ') : 'Any type'} · ${max === 1 ? 'one file' : `up to ${max} files`}`}</div>
        <input ref={ref} type="file" multiple={max !== 1} accept={accept} hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      </div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            // ui-audit-ignore-next-line custom-pill — picked-file chip (name + remove ×, ellipsis), not a status badge
            <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px', borderRadius: 999, background: '#f1f5f9', color: BODY, maxWidth: '100%' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: MUTED, display: 'inline-flex' }}><SheetIcon name="x" size={12} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
