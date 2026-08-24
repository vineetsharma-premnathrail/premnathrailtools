'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inputStyle } from '@/components/shared/ui'

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
}: {
  value: string
  onChange: (v: string) => void
  options: SearchableOption[]
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
      setQuery('')
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', marginLeft: 8 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
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
              onChange={(e) => setQuery(e.target.value)}
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
                    padding: '9px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    background: o.value === value ? 'rgba(244,113,59,0.08)' : 'transparent',
                    color: o.value === value ? '#fa9b9b' : '#1f1108',
                    fontWeight: o.value === value ? 700 : 500,
                  }}
                  onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.background = '#faf9f7' }}
                  onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.background = 'transparent' }}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
