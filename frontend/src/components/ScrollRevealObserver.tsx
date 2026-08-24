'use client'

import { useEffect } from 'react'

/**
 * App-wide scroll-reveal: any element with class="reveal-on-scroll" (see
 * globals.css) fades + rises into view the first time it enters the
 * viewport, on both mobile and desktop scrolling. Mount once near the root
 * so no per-page/per-component wiring is needed — a MutationObserver keeps
 * re-scanning as the SPA swaps page content in and out.
 */
export default function ScrollRevealObserver({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  useEffect(() => {
    const root = containerRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { root, threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )

    const observeAll = () => {
      root.querySelectorAll('.reveal-on-scroll:not(.is-visible)').forEach((el) => io.observe(el))
    }

    observeAll()

    const mo = new MutationObserver(observeAll)
    mo.observe(root, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [containerRef])

  return null
}
