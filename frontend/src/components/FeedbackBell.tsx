'use client'

import { useEffect, useRef, useState } from 'react'
import { feedbackApi } from '@/lib/api'
import { Feedback } from '@/types'

export default function FeedbackBell() {
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [entries, setEntries] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refreshCount = () => {
    feedbackApi.getUnreadCount().then((r) => setUnreadCount(r.count)).catch(() => {})
  }

  useEffect(() => {
    refreshCount()
    const interval = setInterval(refreshCount, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOpen = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      try {
        setEntries(await feedbackApi.list())
      } finally {
        setLoading(false)
      }
    }
  }

  const handleClickEntry = async (f: Feedback) => {
    if (!f.is_read) {
      await feedbackApi.markAsRead(f.id)
      setEntries((prev) => prev.map((x) => (x.id === f.id ? { ...x, is_read: true } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
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
        aria-label="Feedback"
        title="User feedback"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#57534e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              borderRadius: 9999,
              background: '#dc2626',
              color: '#fff',
              fontSize: 9.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 44,
            width: 360,
            maxHeight: 440,
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            zIndex: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1108' }}>User Feedback</span>
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

          {loading ? (
            <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>Loading…</p>
          ) : entries.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>No feedback yet.</p>
          ) : (
            entries.map((f) => (
              <div
                key={f.id}
                onClick={() => handleClickEntry(f)}
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                  background: f.is_read ? '#fff' : 'rgba(244,113,59,0.04)',
                  cursor: 'pointer',
                }}
              >
                <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{f.user_name}</p>
                <p style={{ fontSize: 11, color: '#a8a29e', margin: '0 0 4px' }}>{f.user_email}</p>
                <p style={{ fontSize: 12, color: '#57534e', margin: 0, whiteSpace: 'pre-wrap' }}>{f.message}</p>
                <p style={{ fontSize: 10.5, color: '#a8a29e', margin: '4px 0 0' }}>{new Date(f.created_at).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
