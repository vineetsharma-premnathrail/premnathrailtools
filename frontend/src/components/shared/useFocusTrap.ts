'use client'

// Keyboard focus management shared by every dialog (FormSheet, ConfirmDialog,
// PromptDialog, MessageDialog): moves focus in when it opens, keeps Tab /
// Shift+Tab inside it, and gives focus back to whatever opened it on close.
// Escape is NOT handled here: the dialogs already use useEscapeKey (top-most
// dialog only), so the two stay independent.

import { useEffect, useRef } from 'react'

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// Fields whose onFocus opens a popup (DateField, crm AutoSuggest) carry a marker and are skipped for initial focus.
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="file"]):not([data-no-autofocus]):not([data-tour-no-autofocus]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"]):not([data-no-autofocus])'

// Last element that opened any dialog; fallback when a specific opener is gone.
let lastTrigger: HTMLElement | null = null

function visible(el: HTMLElement) {
  return el.getClientRects().length > 0
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(visible)
}

export interface FocusTrapOptions {
  /** CSS selector of the element to focus first (e.g. the Cancel button of a danger confirm). */
  initial?: string
  /** When no `initial` match: focus the first form field inside (default true). */
  firstField?: boolean
  /** Used when there is no field: CSS selector of the title (give it tabIndex -1). Falls back to the container. */
  fallback?: string
}

/** Attach to the dialog panel: `const ref = useRef<HTMLDivElement>(null); useFocusTrap(open, ref)`. */
export function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>, options: FocusTrapOptions = {}) {
  const opts = useRef(options)
  useEffect(() => { opts.current = options })

  // Capture the opener during render: effects run AFTER children's autoFocus has
  // already moved focus into the dialog, so reading it there would return the
  // dialog's own input. While closed, the slot is cleared for the next opening.
  const openerRef = useRef<HTMLElement | null>(null)
  if (!active) {
    openerRef.current = null
  } else if (!openerRef.current && typeof document !== 'undefined') {
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body) openerRef.current = el
  }

  useEffect(() => {
    if (!active) return
    const root = containerRef.current
    if (!root) return
    let opener = openerRef.current
    if (opener && root.contains(opener)) opener = null
    if (opener) lastTrigger = opener
    const o = opts.current

    // Focus in (unless something inside, e.g. an autoFocus field, already has it).
    if (!root.contains(document.activeElement)) {
      let target: HTMLElement | null = null
      if (o.initial) target = root.querySelector<HTMLElement>(o.initial)
      if (!target && o.firstField !== false) target = Array.from(root.querySelectorAll<HTMLElement>(FIELDS)).find(visible) || null
      if (!target && o.fallback) target = root.querySelector<HTMLElement>(o.fallback)
      if (!target) {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
        target = root
      }
      target.focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = tabbables(root)
      if (!items.length) { e.preventDefault(); root.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const cur = document.activeElement as HTMLElement | null
      if (e.shiftKey && (cur === first || cur === root || !root.contains(cur))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (cur === last || !root.contains(cur))) { e.preventDefault(); first.focus() }
    }
    root.addEventListener('keydown', onKey)

    return () => {
      root.removeEventListener('keydown', onKey)
      // Give focus back to the opener; if it is gone, to the last remembered trigger.
      const back = opener && opener.isConnected ? opener : (lastTrigger && lastTrigger.isConnected ? lastTrigger : null)
      if (back && typeof back.focus === 'function') back.focus({ preventScroll: true })
    }
    // containerRef is stable; only the open state matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
