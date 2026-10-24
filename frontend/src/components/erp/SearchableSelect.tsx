'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
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

/** Lists this long or shorter skip the search box — it only gets in the way. */
const SEARCH_THRESHOLD = 8
const LIST_MAX_HEIGHT = 280
const MIN_LIST_WIDTH = 200
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
  /** Force the search box on/off. Default: on when there are more than 8 options. */
  searchable?: boolean
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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: LIST_MAX_HEIGHT })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
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
    if (refocus) triggerRef.current?.focus()
  }

  // Mount only, like the native autoFocus attribute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoFocus && !disabled) triggerRef.current?.focus() }, [])

  // Escape closes just the list, not the form popup it sits in.
  useEscapeKey(open && !disabled, () => close(true))

  const selected = options.find((o) => o.value === value)
  // An empty-value option ("Select…", "All") reads as the placeholder, not a value.
  const selectedLabel = selected && selected.value !== '' ? selected.label : ''
  const shownPlaceholder = selected && selected.value === '' ? selected.label : placeholder
  const showSearch = !!onSearch || (searchable ?? options.length > SEARCH_THRESHOLD)

  // Portaled to <body> with position:fixed, like DateField, so glass cards
  // (backdrop-filter / overflow / transform) never clip it. It opens upward
  // when there's more room above, and is clamped inside the viewport sideways.
  const reposition = () => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(Math.max(rect.width, MIN_LIST_WIDTH), vw - 16)
    const left = Math.max(8, Math.min(rect.left, vw - width - 8))
    const below = vh - rect.bottom - GAP - 8
    const above = rect.top - GAP - 8
    if (below < Math.min(LIST_MAX_HEIGHT, 200) && above > below) {
      setPos({ bottom: vh - rect.top + GAP, left, width, maxHeight: Math.min(LIST_MAX_HEIGHT, above) })
    } else {
      setPos({ top: rect.bottom + GAP, left, width, maxHeight: Math.max(120, Math.min(LIST_MAX_HEIGHT, below)) })
    }
  }

  useEffect(() => {
    if (!open) return
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

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

  const step = (dir: 1 | -1) => {
    if (!filtered.length) return
    let i = active
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length
      if (!filtered[i].disabled) break
    }
    setActive(i)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
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
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-disabled={disabled || undefined}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        title={title}
        data-name={name}
        data-value={value}
        className="ui-select-trigger"
        onClick={() => { if (disabled) return; if (open) close(); else openList() }}
        onKeyDown={onKeyDown}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: disabled ? '#f5f5f4' : inputStyle.background,
          color: disabled ? '#78716c' : undefined,
          userSelect: 'none',
          ...triggerStyle,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, color: disabled ? '#78716c' : selectedLabel ? '#1f1108' : '#a8a29e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || shownPlaceholder}
        </span>
        {!disabled && (
          <CaretDown size={14} color="#a8a29e" style={{ flex: 'none', transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
        )}
      </div>

      {open && !disabled && createPortal(
        <div
          ref={dropdownRef}
          className="ui-select-list"
          style={{
            position: 'fixed',
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
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
          {showSearch && (
            <div style={{ padding: 8, borderBottom: '1px solid rgba(0,0,0,0.06)', flex: 'none' }}>
              <input
                autoFocus
                value={query}
                onKeyDown={onKeyDown}
                onChange={(e) => { setQuery(e.target.value); queryRef.current = e.target.value; setActive(0); onSearch?.(e.target.value) }}
                placeholder="Type to search..."
                style={{ ...inputStyle, minHeight: 34, padding: '8px 10px' }}
              />
            </div>
          )}
          <div ref={listRef} id={listId} role="listbox" style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
            {filtered.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#a8a29e', padding: '10px 14px', margin: 0 }}>
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
                      <p style={{ margin: 0, padding: '8px 14px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e' }}>{o.group}</p>
                    )}
                    <div
                      data-idx={i}
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
                        color: isSel ? '#FF7A45' : '#1f1108',
                        fontWeight: isSel ? 700 : 500,
                      }}
                    >
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{o.label}</span>
                      {onEdit && (
                        <button
                          type="button"
                          title={`Edit ${o.value}`}
                          onClick={(e) => { e.stopPropagation(); closeThen(() => onEdit(o.value)) }}
                          style={{ flex: 'none', background: 'none', border: 'none', boxShadow: 'none', padding: 2, cursor: 'pointer', color: '#a8a29e', display: 'flex' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#FF7A45' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#a8a29e' }}
                        >
                          <PencilSimple size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          {onAdd && (
            <div
              onClick={() => { const q = query; closeThen(() => onAdd(q)) }}
              style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#FF7A45', cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.06)', flex: 'none' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#faf9f7' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {addLabel}{query.trim() ? ` "${query.trim()}"` : ''}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
