'use client'

import { useEffect, useState } from 'react'

export default function PromptDialog({
  open,
  title,
  message,
  placeholder = 'Optional reason…',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (open) setValue('')
  }, [open])

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
          maxWidth: 420,
          background: '#fff',
          borderRadius: 18,
          padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>{title}</p>
        {message && <p style={{ fontSize: 13.5, color: '#78716c', margin: '0 0 14px', lineHeight: 1.6 }}>{message}</p>}
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.12)',
            fontSize: 13.5,
            outline: 'none',
            marginBottom: 20,
            fontFamily: 'inherit',
          }}
        />
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
            onClick={() => onConfirm(value.trim() || '')}
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
