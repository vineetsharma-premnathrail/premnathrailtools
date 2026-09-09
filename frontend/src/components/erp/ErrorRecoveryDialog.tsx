'use client'

import { useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

/**
 * Center-screen error popup for failures that need more than a dismiss button —
 * a load failure the user can only get out of by refreshing or reloading the app.
 * Renders regardless of page scroll position (fixed, viewport-centered).
 */
export default function ErrorRecoveryDialog({
  open,
  title = 'Something Went Wrong',
  message,
  onClose,
}: {
  open: boolean
  title?: string
  message: string
  onClose?: () => void
}) {
  const [actioning, setActioning] = useState<'refresh' | 'reload' | null>(null)
  useEscapeKey(open && !!onClose, () => onClose?.())

  if (!open) return null

  const refreshPage = () => {
    if (actioning) return
    setActioning('refresh')
    window.location.reload()
  }

  const reloadApp = () => {
    if (actioning) return
    setActioning('reload')
    window.location.href = '/dashboard'
  }

  return (
    <div
      className="dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,14,8,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 400,
        padding: 16,
      }}
    >
      <div
        className="dialog-panel"
        style={{
          width: '100%',
          maxWidth: 440,
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
            background: 'rgba(220,38,38,0.1)',
            marginBottom: 16,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>{title}</p>
        <p style={{ fontSize: 13.5, color: '#78716c', margin: '0 0 22px', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          {onClose && (
            <button
              onClick={onClose}
              disabled={!!actioning}
              style={{ fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', cursor: actioning ? 'default' : 'pointer', opacity: actioning ? 0.6 : 1 }}
            >
              Dismiss
            </button>
          )}
          <button
            onClick={refreshPage}
            disabled={!!actioning}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#fff7ed', color: '#c2410c', cursor: actioning ? 'default' : 'pointer', opacity: actioning ? 0.6 : 1 }}
          >
            {actioning === 'refresh' ? 'Refreshing…' : 'Refresh Page'}
          </button>
          <button
            onClick={reloadApp}
            disabled={!!actioning}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', cursor: actioning ? 'default' : 'pointer', opacity: actioning ? 0.6 : 1 }}
          >
            {actioning === 'reload' ? 'Reloading…' : 'Reload App'}
          </button>
        </div>
      </div>
    </div>
  )
}
