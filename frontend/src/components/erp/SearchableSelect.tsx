'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inputStyle } from '@/components/shared/ui'
import { CaretDown, PencilSimple } from '@phosphor-icons/react'

export interface SearchableOption {
  value: string
  label: string
}

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
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // Latest onSearch for the mount-time outside-click listener; a closed list resets the server search.
  const onSearchRef = useRef(onSearch)
  useEffect(() => { onSearchRef.current = onSearch }, [onSearch])
  const queryRef = useRef('')
  const resetQuery = () => {
    if (queryRef.current) onSearchRef.current?.('')
    queryRef.current = ''
    setQuery('')
  }

  const selectedLabel = options.find((o) => o.value === value)?.label || ''

  // Portaled to <body> with position:fixed, like DateField, so the dropdown
  // isn't clipped or overlapped by sibling cards/sections that establish
  // their own stacking context — it has to track the trigger's position
  // manually across scroll/resize instead of relying on a positioned parent.
  const reposition = () => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width })
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

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    resetQuery()
  }

  const closeThen = (fn: () => void) => {
    setOpen(false)
    resetQuery()
    fn()
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: disabled ? '#f5f5f4' : inputStyle.background,
          color: disabled ? '#78716c' : undefined,
        }}
      >
        <span style={{ color: disabled ? '#78716c' : selectedLabel ? '#1f1108' : '#a8a29e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || placeholder}
        </span>
        {!disabled && (
          <CaretDown size={14} color="#a8a29e" style={{ flex: 'none', marginLeft: 8 }} />
        )}
      </div>

      {open && !disabled && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
            zIndex: 1000,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 16px 36px rgba(0,0,0,0.14)',
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); queryRef.current = e.target.value; onSearch?.(e.target.value) }}
              placeholder="Type to search..."
              style={{ ...inputStyle, padding: '8px 10px' }}
            />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#a8a29e', padding: '10px 14px', margin: 0 }}>No matches.</p>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.value}
                  onClick={() => pick(o.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '9px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    background: o.value === value ? 'rgba(244,113,59,0.08)' : 'transparent',
                    color: o.value === value ? '#FF7A45' : '#1f1108',
                    fontWeight: o.value === value ? 700 : 500,
                  }}
                  onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.background = '#faf9f7' }}
                  onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.background = 'transparent' }}
                >
                  <span>{o.label}</span>
                  {onEdit && (
                    <button
                      type="button"
                      title={`Edit ${o.value}`}
                      onClick={(e) => { e.stopPropagation(); closeThen(() => onEdit(o.value)) }}
                      style={{ flex: 'none', background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#a8a29e', display: 'flex' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#FF7A45' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#a8a29e' }}
                    >
                      <PencilSimple size={13} />
                    </button>
                  )}
                </div>
              ))
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
