import { useEffect, useRef } from 'react'

// Every open dialog that listens for Escape, in the order it opened — only the
// top-most one reacts, so Escape on a confirm opened over a form popup closes
// just the confirm.
const stack: symbol[] = []

/** Calls `onEscape` when Escape is pressed while `active` is true — lets modals/dialogs
 * be dismissed from the keyboard, matching the click-outside-to-dismiss behavior they
 * already have. With dialogs stacked, only the most recently opened one is dismissed. */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape)
  useEffect(() => { latest.current = onEscape })
  useEffect(() => {
    if (!active) return
    const me = Symbol('escape')
    stack.push(me)
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return
      latest.current()
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      const i = stack.indexOf(me)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
