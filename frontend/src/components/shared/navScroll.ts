// Shared behaviour for every module tab bar (the `.nav-tabs-scroll` row).
// Use as `<div className="nav-tabs-scroll" ref={navScrollRef} ...>`.
//  - sets data-more-left / data-more-right while the row can still scroll that
//    way (CSS in globals.css turns them into an edge fade, works in all browsers)
//  - keeps the active tab in view (centred, so the tabs on both sides show) on load and route change
//  - shows ‹ / › buttons at the edges while more tabs are hidden that way (click = next page of tabs)
const ACTIVE_COLOR = 'rgb(255, 106, 42)'

function arrowButton(dir: 'left' | 'right'): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'nav-tabs-arrow'
  b.textContent = dir === 'left' ? '‹' : '›'
  b.setAttribute('aria-label', dir === 'left' ? 'Show earlier tabs' : 'Show more tabs')
  b.title = dir === 'left' ? 'Earlier tabs' : 'More tabs'
  return b
}

export function navScrollRef(el: HTMLElement | null): (() => void) | void {
  if (!el) return
  // ‹ › live in the row's parent (the row itself is masked at the edges), placed over its ends.
  const host = el.parentElement
  const left = arrowButton('left')
  const right = arrowButton('right')
  if (host) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    host.appendChild(left)
    host.appendChild(right)
  }
  const page = (dir: 1 | -1) => el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' })
  left.addEventListener('click', () => page(-1))
  right.addEventListener('click', () => page(1))
  const update = () => {
    const max = el.scrollWidth - el.clientWidth
    const moreL = el.scrollLeft > 1
    const moreR = max - el.scrollLeft > 1
    el.toggleAttribute('data-more-left', moreL)
    el.toggleAttribute('data-more-right', moreR)
    const top = `${el.offsetTop + (el.offsetHeight - 26) / 2}px`
    left.style.top = right.style.top = top
    left.style.left = `${el.offsetLeft}px`
    right.style.left = `${el.offsetLeft + el.clientWidth - 26}px`
    left.style.display = moreL ? 'inline-flex' : 'none'
    right.style.display = moreR ? 'inline-flex' : 'none'
  }
  let lastActive: HTMLElement | undefined
  const reveal = () => {
    const active = Array.from(el.querySelectorAll<HTMLElement>('a')).find(
      (a) => getComputedStyle(a).borderBottomColor === ACTIVE_COLOR,
    )
    // Only scroll when the active tab changed, so hover/manual scrolling is not undone.
    if (active && active !== lastActive) active.scrollIntoView({ inline: 'center', block: 'nearest' })
    lastActive = active
    update()
  }
  const raf = requestAnimationFrame(reveal)
  // A mouse wheel scrolls up / down only; while the tab row can still move sideways, turn it into
  // sideways scrolling so every tab is reachable without a trackpad (the scroll bar is hidden).
  const wheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 1) return
    const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY))
    if (next === el.scrollLeft) return
    e.preventDefault()
    el.scrollLeft = next
  }
  el.addEventListener('wheel', wheel, { passive: false })
  el.addEventListener('scroll', update, { passive: true })
  const ro = new ResizeObserver(update)
  ro.observe(el)
  const mo = new MutationObserver(() => requestAnimationFrame(reveal))
  mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
  return () => {
    cancelAnimationFrame(raf)
    el.removeEventListener('scroll', update)
    el.removeEventListener('wheel', wheel)
    ro.disconnect()
    mo.disconnect()
    left.remove()
    right.remove()
  }
}
