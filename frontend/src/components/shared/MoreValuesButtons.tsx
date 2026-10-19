'use client'

import { SHEET, SheetIcon } from '@/components/shared/FormSheet'
import { XIcon } from '@/components/crm/ui'

/**
 * Extra phones / emails on one field: a square "+" in the field's own row adds
 * another (a "+ Add phone" link under the field pushed the row out of line),
 * and a matching "×" removes an added one. Both are the input's size and stay
 * top-aligned, so a validation message under an input never stretches them.
 * Up to MAX_EXTRA more per field, and only once the last added one is filled.
 */

export const MAX_EXTRA = 3

/** The square button style shared by every icon button that sits in a field's row. */
export const squareBtn = (color: string, disabled = false): React.CSSProperties => ({
  flex: 'none', width: 38, height: 38, alignSelf: 'flex-start', boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 10,
  border: `1px solid ${SHEET.LINE}`, background: '#fff', color, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
})

/** Whether another value may be added after `extras`. Use it in the add handler too. */
export const canAddMore = (extras: string[]) => extras.length < MAX_EXTRA && !extras.some((x) => !x.trim())

export function AddMoreButton({ onClick, label, extras }: { onClick: () => void; label: string; extras: string[] }) {
  const ok = canAddMore(extras)
  const tip = ok ? label : extras.length >= MAX_EXTRA ? `Up to ${MAX_EXTRA + 1} in total — remove one to add another.` : 'Fill in the empty one first.'
  return (
    <button type="button" onClick={ok ? onClick : undefined} disabled={!ok} title={tip} aria-label={tip} style={squareBtn(SHEET.BLUE, !ok)}>
      <SheetIcon name="plus" size={15} />
    </button>
  )
}

export function RemoveValueButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} style={squareBtn('#DC2626')}><XIcon /></button>
}

/** A field with its button beside it, in one row. */
export function ValueRow({ children, button }: { children: React.ReactNode; button: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {button}
    </div>
  )
}
