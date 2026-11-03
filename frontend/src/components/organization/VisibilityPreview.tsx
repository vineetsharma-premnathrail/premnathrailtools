'use client'

import { useEffect, useRef } from 'react'
import { beginPreviewWriteGuard } from '@/lib/previewWriteGuard'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFocusTrap } from '@/components/shared/useFocusTrap'
import { TEXT, BORDER } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import { VisibilityPreviewProvider } from '@/lib/visibilityComponents'
import type { VisibilityPreviewValue } from '@/lib/visibility'

/**
 * "Preview & choose": the real screen opens full width inside the Role editor, drawn with sample data in
 * preview mode (lib/visibility.ts, useVisibility().preview). The admin clicks the eye on any section / column
 * and the value ticks under a dropdown; every other button, link and submit is blocked and nothing is saved.
 *
 * A screen is mounted here by its catalogue key + screen code (PREVIEW_SCREENS). The screen finds out it is
 * being previewed from the context — it takes no props — so each screen only has to (1) use the Vis* wrappers
 * and (2) skip its own loading / saving when `vis.preview`.
 */

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [role="combobox"]'
// Fields, Selects and buttons of the sample screen look switched off; only the toggles stay lit.
const DIM_CSS = '[data-vis-preview-body] :is(input, textarea, select, [role="combobox"], button:not([data-vis-toggle])) { opacity: 0.6; cursor: default; }'

// Preview screens are registered per module in src/lib/visibilityPreviews/<module>.tsx and
// collected in src/lib/visibilityPreviews/index.ts (Manager-owned index).
import { PREVIEW_SCREENS } from '@/lib/visibilityPreviews'

/** Whether a catalogue key + screen can be previewed (the dialog shows "Preview & choose" only then). */
export function hasVisibilityPreview(key: string, screen: string): boolean {
  return !!PREVIEW_SCREENS[key]?.[screen]
}

export default function VisibilityPreview({ open, screenLabel, roleName, value, onClose }: {
  open: boolean
  screenLabel: string
  /** Name of the role being edited. */
  roleName?: string
  /** What the screen reads (key, screen, the rule being edited) and the toggles it calls. */
  value: VisibilityPreviewValue
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEscapeKey(open, onClose)
  useFocusTrap(open, panelRef, { firstField: false, fallback: '[data-dialog-title]' })
  const bodyRef = useRef<HTMLDivElement>(null)
  // API-layer safety net: no write request leaves the browser while the preview is open.
  useEffect(() => (open ? beginPreviewWriteGuard() : undefined), [open])
  // Keyboard users must not tab through the dead controls of the sample screen: everything focusable
  // inside the screen body leaves the tab order (and says it is disabled) except the visibility toggles.
  // The screen loads its parts later, so new nodes are swept too.
  useEffect(() => {
    if (!open) return
    const root = bodyRef.current
    if (!root) return
    const sweep = () => root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
      if (el.closest('[data-vis-toggle]')) return
      if (el.getAttribute('tabindex') !== '-1') el.setAttribute('tabindex', '-1')
      if (el.getAttribute('aria-disabled') !== 'true') el.setAttribute('aria-disabled', 'true')
    })
    sweep()
    const observer = new MutationObserver(sweep)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [open])
  if (!open || typeof document === 'undefined') return null
  const Screen = PREVIEW_SCREENS[value.key]?.[value.screen]

  // Everything on the previewed screen is inert except the visibility toggles and typing into text fields.
  // Checkboxes, radios and file inputs are not text fields: they are blocked too, so they never change.
  const NON_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'])
  const isTextField = (target: HTMLElement) => {
    if (target.closest('textarea')) return true
    const input = target.closest('input') as HTMLInputElement | null
    return !!input && !NON_TEXT_INPUT.has((input.type || 'text').toLowerCase())
  }
  const guard = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-vis-toggle]') || isTextField(target)) return
    e.preventDefault()
    e.stopPropagation()
  }
  // A press on a checkbox / radio (or its label) is stopped before it can focus or start a toggle; other presses stay normal so scrolling and text selection work.
  const boxGuard = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-vis-toggle]')) return
    const input = target.closest('input') as HTMLInputElement | null
    if (input && (input.type === 'checkbox' || input.type === 'radio')) { e.preventDefault(); e.stopPropagation() }
  }
  // Keyboard: Enter / Space / arrows / Home / End / Page keys must not open or change a Select, press a button or tick a box.
  // Tab, Escape and typing into text fields stay free.
  const BLOCKED_KEYS = new Set(['Enter', ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
  const keyGuard = (e: React.KeyboardEvent) => {
    if (!BLOCKED_KEYS.has(e.key)) return
    const target = e.target as HTMLElement
    if (target.closest('[data-vis-toggle]')) return
    // Typing a space, moving the caret or pressing Enter inside a text field is harmless (submit is blocked separately).
    if (isTextField(target)) return
    e.preventDefault()
    e.stopPropagation()
  }

  return createPortal(
    <div className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 210, padding: 12 }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="visibility-preview-title" aria-describedby="visibility-preview-hint" className="dialog-panel"
        style={{ width: '100%', maxWidth: 1440, height: '96vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '16px 24px', borderBottom: `1px solid ${BORDER.normal}` }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 id="visibility-preview-title" data-dialog-title tabIndex={-1} style={{ margin: 0, fontSize: 18, fontWeight: 700, color: TEXT.heading, outline: 'none' }}>
              {screenLabel} — preview for role {roleName || 'being edited'}
            </h2>
            <p id="visibility-preview-hint" style={{ margin: '2px 0 0', fontSize: 12.5, color: TEXT.muted }}>
              Click the eye on any section or column to hide or show it for this role. Your choices stay in the Visibility window until you click Apply there; nothing typed here is saved.
            </p>
          </div>
          <button type="button" onClick={onClose} style={primaryBtnStyle}>Done</button>
        </div>
        <style>{DIM_CSS}</style>
        <div ref={bodyRef} data-vis-preview-body="" onClickCapture={guard} onMouseDownCapture={boxGuard} onAuxClickCapture={guard} onKeyDownCapture={keyGuard} onKeyUpCapture={keyGuard} onSubmitCapture={guard} onDropCapture={guard}
          style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 16, background: '#f8fafc' }}>
          <VisibilityPreviewProvider value={value}>
            {Screen ? <Screen /> : <p style={{ fontSize: 13, color: TEXT.muted }}>This screen has no preview yet — use the list in the previous window.</p>}
          </VisibilityPreviewProvider>
        </div>
      </div>
    </div>,
    document.body,
  )
}
