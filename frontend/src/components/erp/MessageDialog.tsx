'use client'

import { useEscapeKey } from '@/hooks/useEscapeKey'

const VARIANT_COLOR: Record<'success' | 'error' | 'warning', string> = {
  success: '#16a34a',
  error: '#dc2626',
  warning: '#b45309',
}

export default function MessageDialog({
  open,
  variant,
  title,
  message,
  closeLabel = 'OK',
  onClose,
  actionLabel,
  onAction,
}: {
  open: boolean
  variant: 'success' | 'error' | 'warning'
  title: string
  message: string | string[]
  closeLabel?: string
  onClose: () => void
  /** Optional secondary action button (e.g. "Reload Page") shown next to Close —
   * for errors where the fix is to refresh stale data rather than just dismiss. */
  actionLabel?: string
  onAction?: () => void
}) {
  useEscapeKey(open, onClose)
  if (!open) return null
  const color = VARIANT_COLOR[variant]
  const messages = Array.isArray(message) ? message : [message]

  return (
    <div
      onClick={onClose}
      className="dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,14,8,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 300,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dialog-panel"
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          borderRadius: 18,
          padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `${color}1a`,
            marginBottom: 16,
          }}
        >
          {variant === 'success' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : variant === 'warning' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>{title}</p>
        {messages.length === 1 ? (
          <p style={{ fontSize: 13.5, color: '#78716c', margin: '0 0 22px', lineHeight: 1.6 }}>{messages[0]}</p>
        ) : (
          <ul style={{ margin: '0 0 22px', paddingLeft: 18, fontSize: 13.5, color: '#78716c', lineHeight: 1.7 }}>
            {messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '9px 18px',
                borderRadius: 10,
                border: `1px solid ${color}`,
                background: '#fff',
                color,
                cursor: 'pointer',
              }}
            >
              {actionLabel}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '9px 18px',
              borderRadius: 10,
              border: 'none',
              background: color,
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
