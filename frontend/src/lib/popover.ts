// One placement rule for every hand-positioned popup (position: fixed, portaled
// to <body>): calendars, combobox lists, menus. Without it a popup opened from
// a field near the right edge ran off the screen (cut-off calendar columns), and
// one near the bottom ran below it.
//
//   const r = trigger.getBoundingClientRect()
//   setPos(placePopover(r, { width: 280, height: 340 }))
//
// Below the trigger and left-aligned by default; flips above when there is more
// room there; lines up with the trigger's right edge when it would overflow on
// the right; always kept 8px inside the screen.

const EDGE = 8

export function placePopover(
  rect: DOMRect,
  size: { width: number; height: number },
  gap = 6,
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const { width, height } = size

  const below = vh - rect.bottom - gap - EDGE
  const above = rect.top - gap - EDGE
  const up = below < height && above > below
  const top = up ? Math.max(EDGE, rect.top - gap - height) : rect.bottom + gap

  const left = rect.left + width > vw - EDGE ? rect.right - width : rect.left
  return { top, left: Math.max(EDGE, Math.min(left, vw - width - EDGE)) }
}
