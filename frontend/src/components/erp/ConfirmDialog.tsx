'use client'

import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFocusTrap } from '@/components/shared/useFocusTrap'
import { Warning } from '@phosphor-icons/react'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'

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
  useEscapeKey(open, onCancel)
  const panelRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  // Danger: Cancel is focused first so Enter never confirms a delete by accident.
  useFocusTrap(open, panelRef, { initial: danger ? '[data-dialog-cancel]' : undefined, firstField: false, fallback: '[data-dialog-title]' })
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
        aria-describedby={`${uid}-d`}
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
          <Warning size={20} color={danger ? '#dc2626' : '#C2410C'} aria-hidden="true" />
        </div>
        <p id={`${uid}-t`} data-dialog-title tabIndex={-1} style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 8px', outline: 'none' }}>{title}</p>
        <p id={`${uid}-d`} style={{ fontSize: 13.5, color: '#78716c', margin: '0 0 22px', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            data-dialog-cancel
            onClick={onCancel}
            style={secondaryBtnStyle}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={danger ? { ...primaryBtnStyle, background: '#dc2626' } : primaryBtnStyle}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
