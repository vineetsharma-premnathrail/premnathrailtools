import { useEffect } from 'react'

/** Calls `onEscape` when Escape is pressed while `active` is true — lets modals/dialogs
 * be dismissed from the keyboard, matching the click-outside-to-dismiss behavior they
 * already have. */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [active, onEscape])
}
