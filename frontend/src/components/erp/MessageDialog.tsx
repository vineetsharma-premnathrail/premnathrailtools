'use client'

import { useEscapeKey } from '@/hooks/useEscapeKey'
import { Check, Warning, WarningCircle } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'

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

  if (typeof document === 'undefined') return null
  // Portal to <body>: a glass card (backdrop-filter) would otherwise trap the
  // fixed backdrop inside itself instead of covering the screen.
  return createPortal(
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
            <Check size={20} color={color} />
          ) : variant === 'warning' ? (
            <Warning size={20} color={color} />
          ) : (
            <WarningCircle size={20} color={color} />
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
    </div>,
    document.body,
  )
}
