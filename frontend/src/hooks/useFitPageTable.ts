'use client'

import { RefObject, useEffect } from 'react'

// Below this the table would be too short to work in — the page keeps its
// own scroll instead (long forms / detail pages genuinely need it).
const MIN_TABLE_HEIGHT = 220
// Matches the mobile breakpoint in globals.css: there the shell has auto
// height and the page scrolls normally.
const MOBILE_MAX_WIDTH = 900
// Room for a wrapper's padding / caption / "no rows" footer around the table.
const MAX_NON_TABLE_HEIGHT = 120

type Fitted = { box: HTMLElement; head: HTMLElement | null; addedOverflow: boolean }

/**
 * App-wide "no whole-page scrollbar": when a dashboard page is taller than
 * the window, the page's tallest table is shrunk by exactly the overflow so
 * the page fits, and the table scrolls inside with its header row pinned.
 * Pages whose overflow can't be absorbed by a table keep the page scroll.
 * Opt a table out with `data-no-fit-table` on it or any ancestor.
 */
export function useFitPageTable(mainRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const main = mainRef.current
    if (!enabled || !main) return
    let fitted: Fitted | null = null
    let frame = 0

    const release = () => {
      if (!fitted) return
      const { box, head, addedOverflow } = fitted
      box.style.maxHeight = ''
      if (addedOverflow) box.style.overflowY = ''
      if (head) Object.assign(head.style, { position: '', top: '', zIndex: '', background: '' })
      fitted = null
    }

    // The table's own scroll wrapper if it has one, else its parent.
    const scrollBoxOf = (table: HTMLElement): { box: HTMLElement; addedOverflow: boolean } => {
      for (let el = table.parentElement; el && el !== main; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY
        if (oy === 'auto' || oy === 'scroll') return { box: el, addedOverflow: false }
        if (oy === 'hidden') break
      }
      return { box: table.parentElement as HTMLElement, addedOverflow: true }
    }

    const fit = () => {
      frame = 0
      const prev = fitted
      const prevScroll = prev?.box.scrollTop ?? 0
      // Measure the page at its natural height (same frame — no flicker).
      release()
      if (window.innerWidth <= MOBILE_MAX_WIDTH) return
      const overflow = main.scrollHeight - main.clientHeight
      if (overflow <= 0) return

      const tables = Array.from(main.querySelectorAll('table')).filter(
        (t) => t.offsetHeight > 0 && !t.parentElement?.closest('table') && !t.closest('[data-no-fit-table]'),
      )
      if (!tables.length) return
      const table = tables.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a))
      const { box, addedOverflow } = scrollBoxOf(table)
      if (!box || box === main) return
      // The box must be essentially just the table — never a whole form or
      // page section, which would only move the page scroll inside a box.
      if (box.offsetHeight - table.offsetHeight > MAX_NON_TABLE_HEIGHT) return

      const target = Math.floor(box.offsetHeight - overflow)
      if (target < MIN_TABLE_HEIGHT) return

      // max-height excludes padding/border unless the box is border-box.
      const cs = getComputedStyle(box)
      const edges = cs.boxSizing === 'border-box' ? 0
        : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((s, k) => s + parseFloat(cs[k as 'paddingTop']), 0)
      box.style.maxHeight = `${target - edges}px`
      if (addedOverflow) box.style.overflowY = 'auto'
      const head = table.tHead
      if (head) Object.assign(head.style, { position: 'sticky', top: '0', zIndex: '2', background: '#fff' })
      fitted = { box, head, addedOverflow }
      if (prev?.box === box) box.scrollTop = prevScroll
    }

    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit) }

    // Re-fit on window resize, page content resize (data loads, images) and
    // DOM changes (route change, expanded rows, filters). Only childList /
    // text changes are watched, so our own style writes don't loop.
    const resize = new ResizeObserver(schedule)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(main)
      Array.from(main.children).forEach((c) => resize.observe(c))
    }
    const mutation = new MutationObserver(() => { observeChildren(); schedule() })
    mutation.observe(main, { childList: true, subtree: true, characterData: true })
    observeChildren()
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      release()
    }
  }, [mainRef, enabled])
}
