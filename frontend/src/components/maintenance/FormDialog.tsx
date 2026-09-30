'use client'

import { useEscapeKey } from '@/hooks/useEscapeKey'

/** Modal shell for the Maintenance action forms (convert to work order,
 * complete, issue spare, log labour…) — same backdrop/panel look as
 * ConfirmDialog/PromptDialog, but with arbitrary fields inside and its own
 * error slot so a rejected action keeps the user's input on screen. */
export default function FormDialog({
  open,
  title,
  error,
  confirmLabel = 'Save',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  error?: string | string[]
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: React.ReactNode
}) {
  useEscapeKey(open, onCancel)
  if (!open) return null

  return (
    <div
      onClick={onCancel}
      className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dialog-panel"
        style={{ width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 16px' }}>{title}</p>
        {error && (Array.isArray(error) ? error.length > 0 : true) && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onCancel} style={{
            fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
            background: '#fff', color: '#57534e', cursor: 'pointer',
          }}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} style={{
            fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg,#FF7A45,#FF5A1F)', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
          }}>{busy ? 'Saving…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
