'use client'

// The frame every Hydraulic & Pneumatic create / edit form renders in — the
// app-wide form design (components/shared/FormSheet):
//   mode 'page'  → FormPage: the full-page sheet on a /new route, and in place
//                  on a detail page for the big line-item documents;
//   mode 'sheet' → FormSheet popup (portal) for the medium forms' Edit.
// The body is the children (SheetColumns, or SheetSections in <SheetBody>);
// the footer holds Cancel + the primary button.
import { FormPage, FormSheet, SheetIcon, SheetIconName, SHEET, sheetBtn } from '@/components/shared/FormSheet'

export type HydShellMode = 'page' | 'sheet'

/** Frame props a form takes from the page that renders it. */
export interface HydShellProps {
  mode?: HydShellMode
  title: string
  subtitle: string
  /** Module sub-nav (page mode) — renders above the header. */
  nav?: React.ReactNode
  /** "← Back" pill in the page header (page mode). */
  onBack?: () => void
  /** Cancel button (and the popup's close). Without it no Cancel is shown. */
  onCancel?: () => void
}

export default function HydFormShell({
  mode = 'page', icon, iconColor, title, subtitle, nav, onBack, onCancel, busy, submitLabel, submitIcon = 'check', onSubmit,
  tour, width = 960, submitTour, cancelTour, backTour, children,
}: HydShellProps & {
  icon: SheetIconName
  iconColor?: string
  busy: boolean
  submitLabel: string
  submitIcon?: SheetIconName
  onSubmit: () => void
  tour?: string
  width?: number
  submitTour?: string
  cancelTour?: string
  /** data-tour on the page-mode "← Back" pill. */
  backTour?: string
  children: React.ReactNode
}) {
  const footer = (
    <>
      {onCancel && <button data-tour={cancelTour} type="button" onClick={onCancel} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>}
      <button data-tour={submitTour} type="button" onClick={onSubmit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>
        <SheetIcon name={submitIcon} size={16} />{busy ? 'Saving…' : submitLabel}
      </button>
    </>
  )
  if (mode === 'sheet') {
    return (
      <FormSheet icon={icon} iconColor={iconColor} title={title} subtitle={subtitle} onClose={onCancel || onBack || (() => {})} busy={busy} tour={tour} width={width} footer={footer}>
        {children}
      </FormSheet>
    )
  }
  return (
    <FormPage icon={icon} iconColor={iconColor} title={title} subtitle={subtitle} nav={nav} onBack={onBack} backTour={backTour} tour={tour} footer={footer}>
      {children}
    </FormPage>
  )
}

/** Padded single-column body (when a form has no side panel). */
export function SheetBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '20px 24px' }}>{children}</div>
}

/** Flex field cell sized by basis (ui-behavior sizing rules). */
export function Cell({ basis = 160, grow = false, max, tour, children }: { basis?: number; grow?: boolean; max?: number; tour?: string; children: React.ReactNode }) {
  return <div data-tour={tour} style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 130), maxWidth: max }}>{children}</div>
}

export const fieldRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }
