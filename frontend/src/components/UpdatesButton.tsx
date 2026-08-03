'use client'

import { useEffect, useRef, useState } from 'react'
import { CHANGELOG } from '@/lib/changelog'

const SEEN_KEY = 'premnathrail_updates_last_seen'

export default function UpdatesButton() {
  const [open, setOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const latestDate = CHANGELOG[0]?.date

  useEffect(() => {
    if (!latestDate) return
    const lastSeen = localStorage.getItem(SEEN_KEY)
    setHasUnseen(!lastSeen || lastSeen < latestDate)
  }, [latestDate])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (next && latestDate) {
      localStorage.setItem(SEEN_KEY, latestDate)
      setHasUnseen(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggleOpen}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.1)',
          background: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="What's new"
        title="What's new"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#57534e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="11" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        {hasUnseen && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#dc2626',
              border: '2px solid #fff',
            }}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 44,
            width: 360,
            maxHeight: 460,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            zIndex: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1f1108' }}>What&apos;s new</span>
              {latestDate && (
                <span style={{ fontSize: 10.5, color: '#a8a29e', marginLeft: 8 }}>
                  Last updated {new Date(latestDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#78716c',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div style={{ overflowY: 'auto' }}>
            {CHANGELOG.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>No updates yet.</p>
            ) : (
              CHANGELOG.map((entry, i) => (
                <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1108', margin: 0 }}>{entry.title}</p>
                    <span style={{ fontSize: 10.5, color: '#a8a29e', whiteSpace: 'nowrap' }}>
                      {new Date(entry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {entry.items.map((item, j) => (
                      <li key={j} style={{ fontSize: 12, color: '#78716c', marginBottom: 2 }}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
