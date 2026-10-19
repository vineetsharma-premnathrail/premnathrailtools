'use client'

import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SHEET, SheetIcon, sheetBtn, type SheetIconName } from '@/components/shared/FormSheet'

/** Popup shell for the Maintenance action forms (convert to work order,
 * complete, issue spare, log labour…) — the app-wide FormSheet look (icon
 * header, title, subtitle, close, footer), with arbitrary fields inside and
 * its own error slot so a rejected action keeps the user's input on screen.
 * Always portaled to <body> by FormSheet (glass cards clip fixed overlays). */
export default function FormDialog({
  open,
  title,
  subtitle = '',
  icon = 'edit',
  iconColor = SHEET.BLUE,
  width = 580,
  error,
  confirmLabel = 'Save',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  /** One line under the title — what the action does. */
  subtitle?: string
  icon?: SheetIconName
  iconColor?: string
  width?: number
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
    <FormSheet width={width} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle} onClose={onCancel} busy={busy}
      footer={<>
        <button type="button" onClick={onCancel} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="maint-dialog-confirm" type="button" onClick={onConfirm} disabled={busy} style={sheetBtn('primary', iconColor, busy)}>
          <SheetIcon name="check" size={16} />{busy ? 'Saving…' : confirmLabel}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (Array.isArray(error) ? error.length > 0 : true) && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
        {children}
      </div>
    </FormSheet>
  )
}
