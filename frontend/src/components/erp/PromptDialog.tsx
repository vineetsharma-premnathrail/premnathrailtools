'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFocusTrap } from '@/components/shared/useFocusTrap'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'

export default function PromptDialog({
  open,
  title,
  message,
  placeholder = 'Optional reason…',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  requireValue = false,
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
  /** Disable the confirm button until non-blank text is entered (e.g. mandatory approval comments). */
  requireValue?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const confirmDisabled = requireValue && !value.trim()

  useEffect(() => {
    if (open) setValue('')
  }, [open])
  useEscapeKey(open, onCancel)
  const panelRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  useFocusTrap(open, panelRef, { fallback: '[data-dialog-title]' })

  if (!open || typeof document === 'undefined') return null

  // Portal to <body>: a glass card (backdrop-filter) would otherwise trap the
  // fixed backdrop inside itself instead of covering the screen.
  return createPortal(
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
        ref={panelRef}
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`${uid}-t`}
        aria-describedby={message ? `${uid}-d` : undefined}
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
        <p id={`${uid}-t`} data-dialog-title tabIndex={-1} style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 8px', outline: 'none' }}>{title}</p>
        {message && <p id={`${uid}-d`} style={{ fontSize: 13.5, color: '#78716c', margin: '0 0 14px', lineHeight: 1.6 }}>{message}</p>}
        <textarea
          autoFocus
          aria-label={title}
          aria-required={requireValue || undefined}
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
            style={secondaryBtnStyle}
          >
            {cancelLabel}
          </button>
          <button
            disabled={confirmDisabled}
            onClick={() => onConfirm(value.trim() || '')}
            style={{
              ...primaryBtnStyle,
              ...(danger ? { background: '#dc2626' } : {}),
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.55 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
