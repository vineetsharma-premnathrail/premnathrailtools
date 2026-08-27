'use client'

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div
      onClick={onCancel}
      className="dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,14,8,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dialog-panel"
        style={{
          width: '100%',
          maxWidth: 400,
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
            background: danger ? 'rgba(220,38,38,0.1)' : 'rgba(244,113,59,0.1)',
            marginBottom: 16,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={danger ? '#dc2626' : '#FF7A45'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>{title}</p>
        <p style={{ fontSize: 13.5, color: '#78716c', margin: '0 0 22px', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '9px 18px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff',
              color: '#57534e',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '9px 18px',
              borderRadius: 10,
              border: 'none',
              background: danger ? '#dc2626' : 'linear-gradient(140deg,#FF7A45,#ffe3d0)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
