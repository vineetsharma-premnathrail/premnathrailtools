'use client'

// Small shared pieces of the Sales Library screens: file-type badge, expiry badge,
// link chips, multi-pick field, tag field, link-option loader, row menu, error text.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DotsThree, X } from '@phosphor-icons/react'
import Select from '@/components/shared/Select'
import SearchableSelect from '@/components/erp/SearchableSelect'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { Pill, iconBtnStyle, pillStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import { SheetIcon, sheetInput } from '@/components/shared/FormSheet'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { recordHref } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import {
  FILE_KIND_BADGE, FILE_KIND_HEX, LINK_TYPE_HEX, LINK_TYPE_LABEL, salesLibraryApi,
  type LibDocument, type LibLink, type LibLinkType,
} from '@/lib/salesLibraryApi'

/** Real backend reason as one line (also unwraps the JSON error of a failed Blob request). */
export async function errorText(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      return extractErrorMessages({ response: { data: parsed } }, fallback).join(' ')
    } catch { /* not JSON */ }
  }
  return extractErrorMessages(err, fallback).join(' ')
}

export const LIBRARY_PATH = '/dashboard/crm/library'

/** Signed link to a document (null when the API gave no signed reference — never a raw id). */
export function documentHref(doc: { id: number; id_ref?: string }): string | null {
  if (!doc.id_ref) return null
  return recordHref(LIBRARY_PATH, doc, 'id', undefined, 'doc')
}

export function FileTypeBadge({ kind, size = 34 }: { kind: string; size?: number }) {
  const hex = FILE_KIND_HEX[kind] || FILE_KIND_HEX.other
  return (
    <span aria-hidden="true" style={{ flex: 'none', width: size, height: size, borderRadius: 9, background: `${hex}1a`, color: hex, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, letterSpacing: '.02em' }}>
      {FILE_KIND_BADGE[kind] || FILE_KIND_BADGE.other}
    </span>
  )
}

/** Days from today to an ISO date (negative = past). */
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (isNaN(d.getTime())) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}

export function ExpiryBadge({ doc }: { doc: Pick<LibDocument, 'expiry_date' | 'is_expired'> }) {
  if (!doc.expiry_date) return <span style={{ color: TEXT.muted }}>—</span>
  const days = daysUntil(doc.expiry_date)
  if (doc.is_expired || (days !== null && days < 0)) return <Pill label="Expired" hex="#dc2626" title={`Expired on ${formatDate(doc.expiry_date)}`} />
  if (days !== null && days <= 30) return <Pill label={days === 0 ? 'Expires today' : `Expires in ${days}d`} hex="#d97706" title={`Valid until ${formatDate(doc.expiry_date)}`} />
  return <span style={{ fontSize: 12.5, color: TEXT.body, whiteSpace: 'nowrap' }}>{formatDate(doc.expiry_date)}</span>
}

export function LinkChips({ links, max = 2 }: { links: LibLink[]; max?: number }) {
  if (!links.length) return <span style={{ color: TEXT.muted }}>—</span>
  const shown = links.slice(0, max)
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {shown.map((l) => (
        <span key={`${l.link_type}-${l.link_id}`} title={`${LINK_TYPE_LABEL[l.link_type]}: ${l.name || l.link_id}`} style={{ ...pillStyle(LINK_TYPE_HEX[l.link_type]), fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {l.name || `${LINK_TYPE_LABEL[l.link_type]} ${l.link_id}`}
        </span>
      ))}
      {links.length > max && <span title={links.slice(max).map((l) => l.name).filter(Boolean).join(', ')} style={{ fontSize: 11.5, color: TEXT.muted }}>+{links.length - max}</span>}
    </span>
  )
}

/** Chip removable by its ×. */
export function RemovableChip({ label, hex = '#57534e', onRemove, disabled }: { label: string; hex?: string; onRemove: () => void; disabled?: boolean }) {
  return (
    <span style={{ ...pillStyle(hex), fontWeight: 600, gap: 4, paddingRight: 6, maxWidth: '100%' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <button type="button" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove}
        style={{ border: 'none', background: 'none', padding: 0, cursor: disabled ? 'not-allowed' : 'pointer', color: 'inherit', display: 'inline-flex' }}>
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  )
}

/** Server-searched pick list for products / projects / customers: the first 50 load at once, typing searches (debounced). */
export type PickKind = 'product' | 'project' | 'organization'
export type RemotePicker = { options: { value: string; label: string }[]; onSearch: (q: string) => void; loading: boolean; error: string }

// Names of every row ever loaded, so a chosen chip keeps its name after the list changes.
const pickLabels = new Map<string, string>()
export function pickLabel(kind: PickKind, id: string | number): string | undefined { return pickLabels.get(`${kind}:${id}`) }

function pickOption(kind: PickKind, r: { id: number; code: string; name: string }): { value: string; label: string } {
  const label = kind === 'product' ? `${r.code} — ${r.name}`.trim() : kind === 'project' ? (r.code || r.name) : r.name
  pickLabels.set(`${kind}:${r.id}`, label)
  return { value: String(r.id), label }
}

export function useRemotePicker(kind: PickKind): RemotePicker {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const run = useCallback(async (q: string) => {
    const my = ++seq.current
    setLoading(true)
    try {
      const rows = await salesLibraryApi.pick(kind, q)
      if (my !== seq.current) return
      setOptions(rows.map((r) => pickOption(kind, r)))
      setError('')
    } catch (err) {
      const msg = await errorText(err, 'The list could not be loaded. Reload the page and try again.')
      if (my === seq.current) setError(msg)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [kind])
  // Deferred so the effect itself sets no state.
  useEffect(() => { Promise.resolve().then(() => run('')) }, [run])
  useEffect(() => () => clearTimeout(timer.current), [])
  const onSearch = useCallback((q: string) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => run(q.trim()), 250)
  }, [run])
  return { options, onSearch, loading, error }
}

/** One value from a server-searched list (with an empty "none" choice); the chosen row stays listed whatever is searched. */
export function RemoteSelect({ picker, kind, value, onChange, allLabel, fallbackLabel, disabled, ariaLabel, style }: {
  picker: RemotePicker
  kind: PickKind
  value: string
  onChange: (v: string) => void
  allLabel: string
  /** Name shown for a chosen value whose name was never loaded. */
  fallbackLabel?: string
  disabled?: boolean
  ariaLabel?: string
  style?: React.CSSProperties
}) {
  const chosen = value && !picker.options.some((o) => o.value === value)
    ? [{ value, label: pickLabel(kind, value) || fallbackLabel || 'Selected item' }]
    : []
  return (
    <SearchableSelect value={value} onChange={onChange} onSearch={picker.onSearch} disabled={disabled} ariaLabel={ariaLabel}
      placeholder={picker.loading ? 'Loading…' : allLabel} style={style}
      options={[{ value: '', label: allLabel }, ...chosen, ...picker.options]} />
  )
}

/** Pick several values: the list adds a chip, × removes it. Give it `picker` (server search) or a fixed `options` list. */
export function MultiPicker({ options, picker, kind, selected, onChange, placeholder, hex, disabled, knownLabels }: {
  options?: { value: string; label: string }[]
  picker?: RemotePicker
  kind?: PickKind
  selected: string[]
  onChange: (v: string[]) => void
  placeholder: string
  hex?: string
  disabled?: boolean
  /** Names for already-chosen values the list may not contain (e.g. links read from the document). */
  knownLabels?: Record<string, string>
}) {
  const list = picker ? picker.options : options ?? []
  const labelOf = (v: string) => list.find((o) => o.value === v)?.label || knownLabels?.[v] || (kind ? pickLabel(kind, v) : undefined) || 'Selected item'
  const free = list.filter((o) => !selected.includes(o.value))
  const add = (v: string) => { if (v) onChange([...selected, v]) }
  return (
    <div>
      {picker
        ? <SearchableSelect value="" onChange={add} onSearch={picker.onSearch} options={free} disabled={disabled} ariaLabel={placeholder}
            placeholder={picker.loading && !list.length ? 'Loading…' : placeholder} />
        : <Select value="" placeholder={placeholder} disabled={disabled} style={{ ...sheetInput, width: '100%' }} onChange={(e) => add(e.target.value)}>
            {free.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>}
      {picker?.error && <p role="alert" style={{ fontSize: 12.5, color: '#b91c1c', margin: '6px 0 0' }}>{picker.error}</p>}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {selected.map((v) => <RemovableChip key={v} label={labelOf(v)} hex={hex} disabled={disabled} onRemove={() => onChange(selected.filter((x) => x !== v))} />)}
        </div>
      )}
    </div>
  )
}

/** Tags: type, Enter or the + button adds a chip. */
export function TagsField({ tags, onChange, disabled }: { tags: string[]; onChange: (t: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const add = () => {
    const parts = text.split(',').map((t) => t.trim()).filter(Boolean)
    if (!parts.length) return
    const next = [...tags]
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setText('')
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} placeholder="Type a tag and press Enter (e.g. brochure, 2026)"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add() } }}
          style={{ ...sheetInput, flex: 1, minWidth: 0 }} aria-label="Add a tag" />
        <button type="button" aria-label="Add tag" title="Add tag" disabled={disabled || !text.trim()} onClick={add}
          style={{ ...iconBtnStyle, opacity: !text.trim() || disabled ? 0.5 : 1 }}>
          <SheetIcon name="plus" size={16} />
        </button>
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {tags.map((t) => <RemovableChip key={t} label={t} disabled={disabled} onRemove={() => onChange(tags.filter((x) => x !== t))} />)}
        </div>
      )}
    </div>
  )
}

/** Links of a document as the three selected-id lists the forms edit. */
export function splitLinks(links: LibLink[]): { products: string[]; projects: string[]; orgs: string[] } {
  const pick = (t: LibLinkType) => links.filter((l) => l.link_type === t).map((l) => String(l.link_id))
  return { products: pick('product'), projects: pick('project'), orgs: pick('organization') }
}

export function joinLinks(products: string[], projects: string[], orgs: string[]): { link_type: LibLinkType; link_id: number }[] {
  return [
    ...products.map((v) => ({ link_type: 'product' as const, link_id: Number(v) })),
    ...projects.map((v) => ({ link_type: 'project' as const, link_id: Number(v) })),
    ...orgs.map((v) => ({ link_type: 'organization' as const, link_id: Number(v) })),
  ]
}

// ---- Row menu (⋯) ---------------------------------------------------------

export type MenuItem = { label: string; onClick: () => void; danger?: boolean }

export function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || boxRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (!items.length) return null
  return (
    <>
      <button ref={btnRef} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        style={{ ...smallSecondaryBtnStyle, border: 'none', background: 'transparent', padding: 0, width: 28, minWidth: 28 }}>
        <DotsThree size={18} weight="bold" aria-hidden="true" />
      </button>
      <AnchoredPopover anchorRef={btnRef} boxRef={boxRef} open={open} align="right" minWidth={170} maxHeight={260} style={{ padding: 6 }}>
        <div role="menu" onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: it.danger ? '#b91c1c' : '#1f1108' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? 'rgba(220,38,38,0.08)' : 'rgba(255,122,69,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              {it.label}
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </>
  )
}
