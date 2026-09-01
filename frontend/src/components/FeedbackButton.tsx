'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { feedbackApi } from '@/lib/api'

export default function FeedbackButton({ variant = 'icon' }: { variant?: 'icon' | 'row' }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target)) return
      if (panelRef.current && !panelRef.current.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOpen = () => {
    const next = !open
    if (next && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const panelWidth = 340
      if (variant === 'row') {
        setCoords({ top: rect.top - 8, left: Math.min(rect.left, window.innerWidth - panelWidth - 12) })
      } else {
        setCoords({ top: rect.bottom + 8, left: Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 12) })
      }
    }
    if (next) {
      setSubmitted(false)
      setError('')
    }
    setOpen(next)
  }

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await feedbackApi.submit(message.trim())
      setMessage('')
      setSubmitted(true)
    } catch {
      setError('Could not send feedback. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const icon = (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  )

  return (
    <>
      {variant === 'row' ? (
        <button
          ref={btnRef}
          onClick={toggleOpen}
          className="sidebar-flat-btn"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '10px 14px',
            marginBottom: 6,
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
            color: '#57534e',
            fontFamily: 'inherit',
          }}
        >
          {icon}
          Feedback
        </button>
      ) : (
        <button
          ref={btnRef}
          onClick={toggleOpen}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '1px solid rgba(0,0,0,0.1)',
            background: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#57534e',
          }}
          aria-label="Feedback"
          title="Feedback"
        >
          {icon}
        </button>
      )}

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: variant === 'row' ? undefined : coords.top,
            bottom: variant === 'row' ? window.innerHeight - coords.top : undefined,
            left: coords.left,
            width: 340,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            zIndex: 1000,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1108' }}>Send feedback</span>
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

          <div style={{ padding: 16 }}>
            {submitted ? (
              <p style={{ fontSize: 12.5, color: '#047857', margin: 0 }}>
                Thanks! Your feedback has been sent to the admin.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: '#78716c', margin: '0 0 10px' }}>
                  Report an issue or suggest what you&apos;d like to see next.
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your feedback or suggestion..."
                  rows={4}
                  maxLength={4000}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.1)',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: 10.5, color: '#a8a29e', margin: '4px 0 0', textAlign: 'right' }}>{message.length}/4000</p>
                {error && <p style={{ fontSize: 11.5, color: '#b91c1c', margin: '6px 0 0' }}>{error}</p>}
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !message.trim()}
                  style={{
                    marginTop: 10,
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: 'none',
                    background: submitting || !message.trim() ? '#fca87a' : '#FF7A45',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: submitting || !message.trim() ? 'default' : 'pointer',
                  }}
                >
                  {submitting ? 'Sending…' : 'Submit'}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
