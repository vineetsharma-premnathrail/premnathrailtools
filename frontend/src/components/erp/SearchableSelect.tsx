'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inputStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { CaretDown, PencilSimple } from '@phosphor-icons/react'

export interface SearchableOption {
  value: string
  label: string
  disabled?: boolean
  /** Options with the same group are listed under one small heading. */
  group?: string
}

/** Lists this long or shorter are click-only; longer ones are typed into, right in the field. */
const SEARCH_THRESHOLD = 8
const LIST_MAX_HEIGHT = 280
const MIN_LIST_WIDTH = 240
const GAP = 6

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  onAdd,
  addLabel = '+ Add new',
  onEdit,
  onSearch,
  searchable,
  typeIn = false,
  style,
  triggerStyle,
  id,
  name,
  title,
  ariaLabel,
  required,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  options: SearchableOption[]
  placeholder?: string
  disabled?: boolean
  /** Shows a pinned "add" row at the bottom of the list; gets the current search text. */
  onAdd?: (query: string) => void
  addLabel?: string
  /** Shows a pencil on each option to edit it. */
  onEdit?: (value: string) => void
  /** Server-side search: called with the typed text (debounce in the caller);
   *  `options` are then shown as given, without client-side filtering. Keep the
   *  selected option in `options` so its label stays visible. */
  onSearch?: (query: string) => void
  /** Force typing on/off. Default: on when there are more than 8 options or `onSearch` is given. */
  searchable?: boolean
  /** Always type straight into the field, even for a short list. */
  typeIn?: boolean
  /** Outer box (width, flex, margin). */
  style?: React.CSSProperties
  /** Extra styles for the trigger box (e.g. a compact filter). */
  triggerStyle?: React.CSSProperties
  id?: string
  name?: string
  title?: string
  ariaLabel?: string
  required?: boolean
  /** Focus the trigger on mount (keyboard: Enter / ↓ opens the list). */
  autoFocus?: boolean
}) {
  // Searching always happens in the field itself; there is never a second search box in the list.
  const inline = typeIn || (searchable ?? (!!onSearch || options.length > SEARCH_THRESHOLD))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeInRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  // Latest onSearch for the mount-time outside-click listener; a closed list resets the server search.
  const onSearchRef = useRef(onSearch)
  useEffect(() => { onSearchRef.current = onSearch }, [onSearch])
  const queryRef = useRef('')
  const resetQuery = () => {
    if (queryRef.current) onSearchRef.current?.('')
    queryRef.current = ''
    setQuery('')
  }
  // Opening highlights the current value.
  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = (refocus = false) => {
    setOpen(false)
    resetQuery()
    setActive(-1)
    if (refocus) (typeInRef.current || triggerRef.current)?.focus()
  }

  // Mount only, like the native autoFocus attribute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoFocus && !disabled) (typeInRef.current || triggerRef.current)?.focus() }, [])

  // Escape closes just the list, not the form popup it sits in.
  useEscapeKey(open && !disabled, () => close(true))

  const selected = options.find((o) => o.value === value)
  // An empty-value option ("Select…", "All") reads as the placeholder, not a value.
  const selectedLabel = selected && selected.value !== '' ? selected.label : ''
  const shownPlaceholder = selected && selected.value === '' ? selected.label : placeholder

  // Portaled to <body> with position:fixed so glass cards (backdrop-filter /
  // overflow / transform) never clip it. While open, a requestAnimationFrame loop
  // re-reads the field's rect every frame and writes the list's top/bottom/left/
  // width/maxHeight straight onto its style (no React state, so it never lags a
  // scrolling container, a sticky header or a growing form). It opens upward when
  // there is more room above, is clamped inside the viewport sideways, and closes
  // when the field is scrolled mostly out of view.
  const closeRef = useRef(close)
  closeRef.current = close
  useLayoutEffect(() => {
    if (!open || disabled) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    // Scroll containers that can clip the field.
    const clippers: HTMLElement[] = []
    for (let el = wrapper.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowY)) clippers.push(el)
    }
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const rect = wrapper.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      // Visible part of the field after clipping by the viewport and every scroll container.
      let top = Math.max(0, rect.top)
      let bottom = Math.min(vh, rect.bottom)
      for (const c of clippers) {
        const r = c.getBoundingClientRect()
        top = Math.max(top, r.top)
        bottom = Math.min(bottom, r.bottom)
      }
      if (rect.height > 0 && (rect.bottom < 0 || rect.top > vh || bottom - top < rect.height / 2)) {
        cancelAnimationFrame(raf)
        closeRef.current()
        return
      }
      const box = dropdownRef.current
      if (!box) return
      const width = Math.min(Math.max(rect.width, MIN_LIST_WIDTH), vw - 16)
      const left = Math.max(8, Math.min(rect.left, vw - width - 8))
      const below = vh - rect.bottom - GAP - 8
      const above = rect.top - GAP - 8
      const up = below < Math.min(LIST_MAX_HEIGHT, 200) && above > below
      const maxHeight = up ? Math.min(LIST_MAX_HEIGHT, above) : Math.max(120, Math.min(LIST_MAX_HEIGHT, below))
      const key = `${up}|${up ? vh - rect.top + GAP : rect.bottom + GAP}|${left}|${width}|${maxHeight}`
      if (key === last) return
      last = key
      const st = box.style
      st.top = up ? 'auto' : `${rect.bottom + GAP}px`
      st.bottom = up ? `${vh - rect.top + GAP}px` : 'auto'
      st.left = `${left}px`
      st.width = `${width}px`
      st.maxHeight = `${maxHeight}px`
      st.visibility = 'visible'
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [open, disabled])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
      resetQuery()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = useMemo(() => {
    if (onSearch || !query.trim()) return options
    const q = query.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query, onSearch])

  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (o: SearchableOption) => {
    if (o.disabled) return
    onChange(o.value)
    close(true)
    // Behave like a native select element for code that listens to DOM events (the
    // guided tour's "field filled → next step"): fire 'change' on the trigger
    // after React has committed the new value (data-value below).
    if (o.value !== value) setTimeout(() => triggerRef.current?.dispatchEvent(new Event('change', { bubbles: true })), 0)
  }

  const closeThen = (fn: () => void) => {
    close()
    fn()
  }

  // The "+ Add new" row is the last stop of the arrow-key walk (index = filtered.length).
  const total = filtered.length + (onAdd ? 1 : 0)
  const optionId = (i: number) => `${listId}-o${i}`
  const activeId = open && active >= 0 && active < total ? optionId(active) : undefined
  const runAdd = () => { const q = query; closeThen(() => onAdd?.(q)) }

  const step = (dir: 1 | -1) => {
    if (!total) return
    let i = active
    for (let n = 0; n < total; n++) {
      i = (i + dir + total) % total
      if (i >= filtered.length || !filtered[i].disabled) break
    }
    setActive(i)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      // Space types a space in the type-in field; it doesn't open the list.
      if (e.key === 'Enter' || (e.key === ' ' && !inline) || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (onAdd && active === filtered.length) { runAdd(); return }
      const o = filtered[active]
      if (o) pick(o)
    } else if (e.key === 'Tab') close()
  }

  // Wrapper takes layout props (width/flex/margin); the trigger keeps input look.
  return (
    <div ref={wrapperRef} style={{ position: 'relative', minWidth: 0, ...style }}>
      <div
        ref={triggerRef}
        id={id}
        role={inline ? undefined : 'combobox'}
        tabIndex={disabled || inline ? -1 : 0}
        aria-expanded={inline ? undefined : open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={inline ? undefined : activeId}
        aria-haspopup="listbox"
        aria-disabled={disabled || undefined}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        title={title || selectedLabel || (shownPlaceholder !== 'Select...' ? shownPlaceholder : undefined)}
        data-name={name}
        data-value={value}
        className="ui-select-trigger"
        onClick={() => { if (disabled) return; if (open) { if (!inline) close() } else openList() }}
        onKeyDown={onKeyDown}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: disabled ? 'not-allowed' : inline ? 'text' : 'pointer',
          background: disabled ? '#f5f5f4' : inputStyle.background,
          color: disabled ? '#78716c' : undefined,
          userSelect: 'none',
          ...triggerStyle,
        }}
      >
        {inline ? (
          <input
            ref={typeInRef}
            className="ui-select-typein"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={ariaLabel || title || placeholder}
            disabled={disabled}
            // Closed: shows the picked value. Open: shows what is being typed (empty = whole list).
            value={open ? query : selectedLabel}
            placeholder={open && selectedLabel ? selectedLabel : shownPlaceholder}
            onChange={(e) => { setQuery(e.target.value); queryRef.current = e.target.value; setActive(0); onSearch?.(e.target.value); if (!open) setOpen(true) }}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, font: 'inherit', color: '#1f1108', boxShadow: 'none', textOverflow: 'ellipsis' }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, color: disabled ? '#78716c' : selectedLabel ? '#1f1108' : '#78716c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedLabel || shownPlaceholder}
          </span>
        )}
        {!disabled && (
          <CaretDown size={14} color="#78716c" aria-hidden="true" style={{ flex: 'none', transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
        )}
      </div>

      {open && !disabled && createPortal(
        <div
          ref={dropdownRef}
          className="ui-select-list"
          style={{
            position: 'fixed',
            // top/bottom/left/width/maxHeight are written every frame by the effect above.
            top: -9999,
            left: 0,
            visibility: 'hidden',
            zIndex: 3000,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 16px 36px rgba(0,0,0,0.14)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel || title || placeholder} style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
            {filtered.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#78716c', padding: '10px 14px', margin: 0 }}>
                {options.length === 0 ? 'Nothing to pick yet.' : 'No matches — try another word.'}
              </p>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === value
                const isActive = i === active
                const header = o.group && (i === 0 || filtered[i - 1].group !== o.group)
                return (
                  <div key={`${o.group || ''}|${o.value}`}>
                    {header && (
                      <p style={{ margin: 0, padding: '8px 14px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c' }}>{o.group}</p>
                    )}
                    <div
                      data-idx={i}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      onClick={() => pick(o)}
                      onMouseEnter={() => setActive(i)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '9px 14px',
                        fontSize: 13,
                        lineHeight: '16px',
                        cursor: o.disabled ? 'not-allowed' : 'pointer',
                        opacity: o.disabled ? 0.45 : 1,
                        background: isSel ? 'rgba(244,113,59,0.08)' : isActive ? '#faf9f7' : 'transparent',
                        color: isSel ? '#C2410C' : '#1f1108',
                        fontWeight: isSel ? 700 : 500,
                      }}
                    >
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{o.label}</span>
                      {onEdit && (
                        <button
                          type="button"
                          title={`Edit ${o.label}`}
                          aria-label={`Edit ${o.label}`}
                          onClick={(e) => { e.stopPropagation(); closeThen(() => onEdit(o.value)) }}
                          style={{ flex: 'none', background: 'none', border: 'none', boxShadow: 'none', padding: 2, cursor: 'pointer', color: '#78716c', display: 'flex' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#C2410C' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#78716c' }}
                        >
                          <PencilSimple size={13} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            {/* "+ Add new": last option of the list (kept visible at the bottom), reachable with the arrow keys, Enter adds. */}
            {onAdd && (
              <div
                id={optionId(filtered.length)}
                role="option"
                aria-selected={false}
                onClick={runAdd}
                onMouseEnter={() => setActive(filtered.length)}
                style={{ position: 'sticky', bottom: 0, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#C2410C', cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.06)', background: active === filtered.length ? '#faf9f7' : '#fff' }}
              >
                {addLabel}{query.trim() ? ` "${query.trim()}"` : ''}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
