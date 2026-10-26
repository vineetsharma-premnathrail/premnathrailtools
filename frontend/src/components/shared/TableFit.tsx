'use client'

import { useEffect } from 'react'

/*
 * TableFit - one mechanism that keeps EVERY table inside its card: long cell text is
 * cut with an ellipsis (full text on hover via the title attribute) instead of
 * scrolling sideways. Mount once in the dashboard layout; it renders nothing.
 *
 * How it works: a MutationObserver finds new/changed tables, a ResizeObserver on each
 * table's parent re-fits when the width changes. A fitted table gets the `table-fit`
 * class (globals.css: fixed layout, width 100%, ellipsis cells) and a <colgroup>
 * (data-table-fit-cols) with column widths computed from the content.
 *
 * A header with data-fit-min="N" marks a column whose cells wrap (put whiteSpace: 'normal'
 * on its cells) and may shrink to N px. Opt out per table or per area with data-table-fit="off" on the table or an ancestor.
 * Editing tables (inputs / selects / textareas / contenteditable), tables with rowSpan
 * or irregular colSpan, and the R&D calculator pages are never touched. A table with its
 * own <colgroup> keeps those widths and only gets the fit + ellipsis rules.
 */

const OFF_ROUTES = /^\/dashboard\/rnd\/(braking|hydraulic|load-distribution|qmax|spline|tractive-effort|vehicle-performance|tools)(\/|$)/
const TITLE_ROWS = 300
const NEVER_CUT_PX = 170 // columns whose natural width is up to this are never truncated
const MIN_TEXT_COL_PX = 80
const HARD_MIN_PX = 40 // below this per flexible column the whole table shrinks proportionally
const COMFORT_PX = 170 // a long-text column is first given up to this much before the rest is shared

const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()

function eligible(table: HTMLTableElement): boolean {
  if (OFF_ROUTES.test(window.location.pathname)) return false
  if (table.closest('[data-table-fit="off"]')) return false
  if (table.querySelector('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return false
  return true
}

/** Header cells + body rows, or null when the layout is irregular (rowSpan / colSpan). */
function readGrid(table: HTMLTableElement): { head: HTMLTableCellElement[]; rows: HTMLTableCellElement[][]; ncols: number } | null {
  const allRows = Array.from(table.rows)
  if (allRows.length === 0) return null
  let headRow: HTMLTableRowElement | undefined = table.tHead?.rows[0]
  if (!headRow && Array.from(allRows[0].cells).every((c) => c.tagName === 'TH')) headRow = allRows[0]
  const head = headRow ? Array.from(headRow.cells) : []
  const bodyRows = allRows.filter((r) => r !== headRow && r.parentElement?.tagName !== 'THEAD')
  const rows: HTMLTableCellElement[][] = []
  let ncols = head.length
  if (head.some((c) => c.colSpan > 1 || c.rowSpan > 1)) return null
  for (const r of bodyRows.slice(0, 400)) {
    const cells = Array.from(r.cells)
    if (cells.length === 1 && cells[0].colSpan > 1) continue // "No records" row
    if (cells.some((c) => c.colSpan > 1 || c.rowSpan > 1)) return null
    if (!ncols) ncols = cells.length
    if (cells.length !== ncols) return null
    rows.push(cells)
  }
  if (ncols < 2 || rows.length === 0) return null
  return { head, rows, ncols }
}

/**
 * Column widths (percent) from MEASURED natural widths. The table is briefly laid out
 * with auto layout and max-content width (no paint happens in between), so every
 * column reports the width its widest cell or header needs, with padding, fonts,
 * badges and buttons included. Short columns (IDs, dates, status, actions...) get
 * their full natural width and are never cut; only wide text columns share what is left.
 */
function measure(table: HTMLTableElement, avail: number): number[] | null {
  const grid = readGrid(table)
  if (!grid) return null
  const { head, rows, ncols } = grid
  table.classList.remove('table-fit')
  table.classList.add('table-fit-measure')
  const probe = head.length ? head : rows[0]
  const natural = probe.map((c) => Math.ceil(c.getBoundingClientRect().width) + 2)
  // Widest body cell content per column (header ignored): columns whose header may wrap are sized by this.
  const bodyMax = natural.map(() => 0)
  const range = document.createRange()
  // Header text width per column (one-line headers must stay whole, so a cut column never gets narrower than its header).
  const headMax = head.length ? head.map((h) => {
    range.selectNodeContents(h)
    const cs = getComputedStyle(h)
    return Math.ceil(range.getBoundingClientRect().width + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) + 2
  }) : natural.map(() => 0)
  for (const cells of rows) {
    cells.forEach((c, i) => {
      range.selectNodeContents(c)
      const cs = getComputedStyle(c)
      const w = Math.ceil(range.getBoundingClientRect().width + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) + 2
      if (w > bodyMax[i]) bodyMax[i] = w
    })
  }
  table.classList.remove('table-fit-measure')
  table.classList.add('table-fit')
  if (natural.length !== ncols || natural.some((w) => !(w > 0))) return null

  // A header marked data-fit-min="N" declares a column whose cells wrap onto more lines
  // (dates, ranges, addresses): it may shrink to N px before any other column is cut.
  const wrapMin = head.length ? head.map((h) => Number(h.dataset.fitMin) || 0) : natural.map(() => 0)
  // data-fit-cut marks the only columns allowed to be cut ("..." / line clamp); every other
  // data-fit-min column keeps the full width of its widest cell (its header just wraps).
  const cutCol = head.length ? head.map((h) => h.hasAttribute('data-fit-cut')) : natural.map(() => false)
  // data-fit-wrap-head: the header may wrap, so the column is sized by its widest body cell instead of by its header.
  const wrapHead = head.length ? head.map((h) => h.hasAttribute('data-fit-wrap-head')) : natural.map(() => false)
  for (let i = 0; i < natural.length; i++) if (wrapMin[i] && !cutCol[i] && wrapHead[i]) natural[i] = Math.max(wrapMin[i], bodyMax[i])
  const fixed = natural.map((n, i) => !cutCol[i] && (n <= NEVER_CUT_PX || !!wrapMin[i]))
  const total = natural.reduce((a, b) => a + b, 0)
  let px: number[]
  if (total <= avail) {
    px = natural.map((n) => (n * avail) / total)
  } else {
    const floorOf = (i: number) => (wrapHead[i] ? wrapMin[i] : Math.max(wrapMin[i] || MIN_TEXT_COL_PX, headMax[i]))
    const fixedSum = natural.reduce((sum, n, i) => sum + (fixed[i] ? n : 0), 0)
    const flexIdx = natural.map((_, i) => i).filter((i) => !fixed[i])
    const rem = avail - fixedSum
    const floors = flexIdx.map((i) => floorOf(i))
    const floorSum = floors.reduce((x, y) => x + y, 0)
    px = natural.slice()
    // Tables that did not mark their cut columns (data-fit-cut) keep the old safe rule: when the text
    // columns cannot all stay readable the table is left alone and scrolls, instead of squeezing to "…".
    if (!cutCol.some(Boolean) && (!flexIdx.length || rem < flexIdx.length * MIN_TEXT_COL_PX)) return null
    if (!flexIdx.length || rem < flexIdx.length * HARD_MIN_PX) {
      // Extreme case (very many columns): everything shrinks in proportion, text is cut with "...".
      px = natural.map((n) => (n * avail) / total)
    } else if (rem < floorSum) {
      // The floors do not fit: flexible columns share what is left in proportion to their floors.
      flexIdx.forEach((i, k) => { px[i] = (rem * floors[k]) / floorSum })
    } else {
      // Fair share first: every flexible column is guaranteed its floor, then a comfortable reading
      // width (wrapping columns their declared minimum, long-text columns up to COMFORT_PX, never
      // more than they need); only what is left over is shared by how much more text each column
      // has. Without this one very long column starves the others. The card never scrolls:
      // whatever does not fit is cut with "..." (full text on hover).
      const comfort = flexIdx.map((i, k) => Math.max(floors[k], wrapMin[i] ? wrapMin[i] : Math.min(natural[i], COMFORT_PX)))
      const comfortSum = comfort.reduce((x, y) => x + y, 0)
      if (rem >= comfortSum) {
        const extra = rem - comfortSum
        const wants = flexIdx.map((i, k) => Math.max(0, natural[i] - comfort[k]))
        const wantSum = wants.reduce((x, y) => x + y, 0)
        flexIdx.forEach((i, k) => { px[i] = comfort[k] + (wantSum > 0 ? (extra * wants[k]) / wantSum : extra / flexIdx.length) })
      } else {
        const gap = comfortSum - floorSum
        flexIdx.forEach((i, k) => { px[i] = floors[k] + (gap > 0 ? ((rem - floorSum) * (comfort[k] - floors[k])) / gap : 0) })
      }
    }
  }
  const sum = px.reduce((x, y) => x + y, 0)
  return px.map((w) => (w / sum) * 100)
}

function unfit(table: HTMLTableElement) {
  table.classList.remove('table-fit', 'table-fit-measure')
  table.querySelector(':scope > colgroup[data-table-fit-cols]')?.remove()
}

function applyColgroup(table: HTMLTableElement, pct: number[]) {
  let cg = table.querySelector<HTMLTableColElement>(':scope > colgroup[data-table-fit-cols]')
  if (!cg) {
    cg = document.createElement('colgroup')
    cg.setAttribute('data-table-fit-cols', '')
    table.insertBefore(cg, table.firstChild)
  }
  while (cg.children.length > pct.length) cg.lastElementChild?.remove()
  while (cg.children.length < pct.length) cg.appendChild(document.createElement('col'))
  pct.forEach((p, i) => { (cg!.children[i] as HTMLElement).style.width = `${p.toFixed(3)}%` })
}

const titled = new WeakSet<HTMLElement>()

function updateTitles(table: HTMLTableElement) {
  let n = 0
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      if (n++ > TITLE_ROWS * 12) return
      let cut = cell.scrollWidth > cell.clientWidth + 1
      if (!cut) {
        for (const el of Array.from(cell.querySelectorAll<HTMLElement>(':scope > div, :scope > span, :scope > a'))) {
          if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) { cut = true; break }
        }
      }
      if (cut) {
        if (!cell.hasAttribute('title')) {
          const t = clean(cell.textContent)
          if (t) { cell.setAttribute('title', t); titled.add(cell) }
        }
      } else if (titled.has(cell)) {
        cell.removeAttribute('title')
        titled.delete(cell)
      }
    }
  }
}

export default function TableFit() {
  useEffect(() => {
    const tracked = new Set<HTMLTableElement>()
    const dirty = new Set<HTMLTableElement>()
    const parents = new Map<Element, Set<HTMLTableElement>>()
    const lastWidth = new WeakMap<Element, number>()
    let frame = 0

    const watchParent = (table: HTMLTableElement) => {
      const p = table.parentElement
      if (!p) return
      let set = parents.get(p)
      if (!set) { set = new Set(); parents.set(p, set); ro.observe(p) }
      set.add(table)
    }

    const fit = (table: HTMLTableElement) => {
      if (!table.isConnected) { tracked.delete(table); return }
      if (!eligible(table)) { unfit(table); return }
      watchParent(table)
      tracked.add(table)
      const parent = table.parentElement
      if (!parent || parent.clientWidth === 0) { unfit(table); return } // hidden tab: retry on resize
      const mine = table.querySelector(':scope > colgroup[data-table-fit-cols]')
      table.classList.add('table-fit')
      if (table.querySelector(':scope > colgroup:not([data-table-fit-cols])')) {
        // the page sets its own column widths: keep them, only add the fit + ellipsis rules
        table.querySelector(':scope > colgroup[data-table-fit-cols]')?.remove()
        updateTitles(table)
        return
      }
      mine?.remove() // measure without our old column widths
      const avail = table.getBoundingClientRect().width
      const pct = avail > 0 ? measure(table, avail) : null
      if (!pct) { unfit(table); return } // irregular, or too narrow to be readable: leave as it was
      applyColgroup(table, pct)
      updateTitles(table)
    }

    const flush = () => {
      frame = 0
      mo.disconnect() // our own writes must not re-trigger us
      try {
        for (const t of Array.from(dirty)) { dirty.delete(t); fit(t) }
      } finally {
        mo.takeRecords()
        mo.observe(document.body, { childList: true, subtree: true })
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(flush) }
    const mark = (t: HTMLTableElement) => { dirty.add(t); schedule() }

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width)
        const prev = lastWidth.get(e.target)
        lastWidth.set(e.target, w)
        if (prev !== undefined && Math.abs(prev - w) < 1) continue
        const set = parents.get(e.target)
        if (!set) continue
        for (const t of Array.from(set)) {
          if (!t.isConnected || t.parentElement !== e.target) set.delete(t)
          else mark(t)
        }
        if (set.size === 0) { parents.delete(e.target); ro.unobserve(e.target) }
      }
    })

    const collect = (node: Node) => {
      if (node.nodeType !== 1) return
      const el = node as Element
      if (el.tagName === 'COLGROUP' && el.hasAttribute('data-table-fit-cols')) return
      if (el.tagName === 'TABLE') mark(el as HTMLTableElement)
      else el.querySelectorAll('table').forEach((t) => mark(t))
    }

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const owner = (r.target as Element).closest?.('table')
        if (owner && !(r.target as Element).closest('colgroup[data-table-fit-cols]')) mark(owner as HTMLTableElement)
        r.addedNodes.forEach(collect)
      }
    })

    document.querySelectorAll('table').forEach((t) => mark(t))
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
      tracked.forEach((t) => { if (t.isConnected) unfit(t) })
    }
  }, [])

  return null
}
