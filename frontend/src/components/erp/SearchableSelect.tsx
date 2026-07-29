'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface SearchableOption {
  value: string
  label: string
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
}: {
  value: string
  onChange: (v: string) => void
  options: SearchableOption[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label || ''

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
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
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.1)',
          background: '#fff',
          fontSize: 13.5,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: selectedLabel ? '#1f1108' : '#a8a29e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', marginLeft: 8 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 6,
            zIndex: 50,
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
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.1)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
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
        </div>
      )}
    </div>
  )
}
