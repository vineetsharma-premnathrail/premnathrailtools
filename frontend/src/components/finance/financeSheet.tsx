'use client'

// Finance helpers on top of the shared FormSheet kit (components/shared/FormSheet):
// a labelled field, the padded sheet body and the Cancel + primary footer.
// The reason popup is components/shared/ReasonSheet; the error banner is SheetError.

import { SheetIcon, SheetIconName, Req, Optional, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

/** One field: label (with * or "(optional)"), the control, and an optional hint line. */
export function SField({ label, req, optional, hint, tour, style, children }: {
  label: React.ReactNode; req?: boolean; optional?: boolean; hint?: React.ReactNode; tour?: string
  style?: React.CSSProperties; children: React.ReactNode
}) {
  return (
    <div style={style} data-tour={tour}>
      <label style={sheetLabel}>{label}{req && <> <Req /></>}{optional && <> <Optional /></>}</label>
      {children}
      {hint && <p style={sheetHint}>{hint}</p>}
    </div>
  )
}

/** A wrapping row of fields inside a sheet section. */
export function SRow({ children, mb = 14 }: { children: React.ReactNode; mb?: number }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: mb }}>{children}</div>
}

/** Fixed-ish width for a short field inside a sheet row. */
export const sw = (n: number): React.CSSProperties => ({ flex: `0 1 ${n}px`, minWidth: Math.min(n - 20, 140) })
/** Growing field with a ceiling. */
export const sg = (basis: number, max: number): React.CSSProperties => ({ flex: `1 1 ${basis}px`, maxWidth: max, minWidth: 0 })

/** Single-column sheet body (padding matches the PM / R&D sheets). */
export function SheetBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '20px 24px' }}>{children}</div>
}

/** Cancel + primary footer for a FormSheet. */
export function SheetFooter({ onCancel, onSubmit, busy, label, busyLabel = 'Saving…', icon = 'check', color = SHEET.BLUE, disabled, cancelLabel = 'Cancel', cancelTour, submitTour }: {
  onCancel: () => void; onSubmit: () => void; busy: boolean; label: string; busyLabel?: string
  icon?: SheetIconName; color?: string; disabled?: boolean; cancelLabel?: string; cancelTour?: string; submitTour?: string
}) {
  const off = busy || !!disabled
  return (
    <>
      <button type="button" data-tour={cancelTour} onClick={onCancel} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>{cancelLabel}</button>
      <button type="button" data-tour={submitTour} onClick={onSubmit} disabled={off} style={sheetBtn('primary', color, off)}>
        <SheetIcon name={icon} size={16} />{busy ? busyLabel : label}
      </button>
    </>
  )
}
