'use client'

// "Why?" popup for any action that needs a reason or remarks (reject, hold,
// cancel, reopen, return, approve-with-comment…) — PromptDialog's props on the
// app-wide FormSheet look, so callers swap the import and keep their logic.
// If onConfirm returns a promise, the popup shows "Saving…", stays open and
// shows the real error inside when it fails (a thrown error or a returned
// message), and closes only when the caller closes it. The text is trimmed
// before it reaches onConfirm (like PromptDialog).

import { useState } from 'react'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SHEET, SheetIcon, SheetError, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, type SheetIconName } from '@/components/shared/FormSheet'

export type ReasonSheetProps = {
  open: boolean
  title: string
  /** Shown under the title (or as the hint when a subtitle is given). */
  message?: string
  /** Default "Reason…" when required, "Optional reason…" otherwise. */
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button (default true, like PromptDialog). */
  danger?: boolean
  /** Confirm stays disabled until non-blank text is entered. */
  requireValue?: boolean
  /** Label above the text box (default "Reason"). */
  label?: string
  icon?: SheetIconName
  subtitle?: string
  tour?: string
  /** data-tour on the confirm button. */
  confirmTour?: string
  /** Small print under the text box. */
  hint?: React.ReactNode
  /** Header icon + confirm button colour (overrides the danger red / blue). */
  iconColor?: string
  /** Confirm button text while a returned promise runs (default "Saving…"). */
  busyLabel?: string
  /** With requireValue: keep Confirm clickable and show this when the box is empty. */
  requiredMessage?: string
  /** Fallback error when a thrown error carries no reason (default "Could not <confirm label>."). */
  errorFallback?: string
  /** Return a message (or throw) to keep the popup open with that error. */
  onConfirm: (value: string) => void | null | undefined | string | string[] | Promise<void | string | string[] | boolean | null | undefined>
  onCancel: () => void
}

export default function ReasonSheet(props: ReasonSheetProps) {
  // Mounted only while open, so the text box starts empty every time.
  if (!props.open) return null
  return <ReasonSheetBody {...props} />
}

function ReasonSheetBody({
  title, message, placeholder, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true,
  requireValue = false, label = 'Reason', icon, subtitle = '', tour, confirmTour, hint, iconColor, busyLabel = 'Saving…',
  requiredMessage, errorFallback, onConfirm, onCancel,
}: ReasonSheetProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const disabled = busy || (requireValue && !requiredMessage && !value.trim())
  const color = iconColor || (danger ? '#DC2626' : SHEET.BLUE)
  const sheetIcon: SheetIconName = icon || (danger ? 'alert' : 'chat')

  const confirm = async () => {
    if (requireValue && !value.trim()) { setError(requiredMessage || `Enter the ${label.toLowerCase()} — it is required.`); return }
    setError('')
    const isMessage = (x: unknown): x is string | string[] => (typeof x === 'string' && !!x) || (Array.isArray(x) && x.length > 0)
    const r = onConfirm(value.trim())
    if (!(r instanceof Promise)) { if (isMessage(r)) setError(r); return }
    setBusy(true)
    try {
      const out = await r
      if (isMessage(out)) setError(out)
    } catch (err) {
      setError(extractErrorMessages(err, errorFallback || `Could not ${confirmLabel.toLowerCase()}.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet width={580} tour={tour} icon={sheetIcon} iconColor={color} title={title} subtitle={subtitle || message || ''} onClose={onCancel} busy={busy}
      onSubmit={confirm}
      footer={<>
        <button type="button" onClick={onCancel} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>{cancelLabel}</button>
        <button type="submit" data-tour={confirmTour} disabled={disabled} style={sheetBtn('primary', color, disabled)}>
          <SheetIcon name={sheetIcon} size={16} />{busy ? busyLabel : confirmLabel}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <label style={sheetLabel}>{label} {requireValue ? <Req /> : <Optional />}</label>
        <textarea autoFocus style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={value} placeholder={placeholder ?? (requireValue ? 'Reason…' : 'Optional reason…')}
          onChange={(e) => { setValue(e.target.value); if (error) setError('') }} />
        {subtitle && message && <p style={sheetHint}>{message}</p>}
        {hint && <p style={sheetHint}>{hint}</p>}
      </div>
    </FormSheet>
  )
}
