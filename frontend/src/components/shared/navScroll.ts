// Shared behaviour for every module tab bar (the `.nav-tabs-scroll` row).
// Use as `<div className="nav-tabs-scroll" ref={navScrollRef} ...>`.
//  - sets data-more-left / data-more-right while the row can still scroll that
//    way (CSS in globals.css turns them into an edge fade, works in all browsers)
//  - keeps the active tab in view on load and when the route changes
const ACTIVE_COLOR = 'rgb(255, 106, 42)'

export function navScrollRef(el: HTMLElement | null): (() => void) | void {
  if (!el) return
  const update = () => {
    const max = el.scrollWidth - el.clientWidth
    el.toggleAttribute('data-more-left', el.scrollLeft > 1)
    el.toggleAttribute('data-more-right', max - el.scrollLeft > 1)
  }
  let lastActive: HTMLElement | undefined
  const reveal = () => {
    const active = Array.from(el.querySelectorAll<HTMLElement>('a')).find(
      (a) => getComputedStyle(a).borderBottomColor === ACTIVE_COLOR,
    )
    // Only scroll when the active tab changed, so hover/manual scrolling is not undone.
    if (active && active !== lastActive) active.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    lastActive = active
    update()
  }
  const raf = requestAnimationFrame(reveal)
  el.addEventListener('scroll', update, { passive: true })
  const ro = new ResizeObserver(update)
  ro.observe(el)
  const mo = new MutationObserver(() => requestAnimationFrame(reveal))
  mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
  return () => {
    cancelAnimationFrame(raf)
    el.removeEventListener('scroll', update)
    ro.disconnect()
    mo.disconnect()
  }
}
