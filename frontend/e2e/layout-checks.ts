import type { Page } from '@playwright/test'

// Shared layout checks for layout.spec.ts. One exported function per check,
// each returns the problems it found (empty = pass). They run inside the
// browser via page.evaluate, so the callbacks may not use outer variables.
//
// Born from the 96px dead band above every full-page form footer (2026-10-26):
// tsc, the static audit, the reviewer and QA all passed it because nobody
// measured the real screen. These checks measure it.

export type Problem = { rule: string; detail: string }

/** Full-page forms (.form-page-card): no padding hack, no dead band, footer reachable. */
export async function checkFormCards(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = []
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    for (const card of Array.from(document.querySelectorAll<HTMLElement>('.form-page-card'))) {
      if (!vis(card)) continue
      const body = card.querySelector<HTMLElement>('.form-page-body')
      const footer = card.lastElementChild as HTMLElement | null
      if (!body || !footer || footer === body) continue

      // (b1) the body must not carry a big bottom padding
      const pb = parseFloat(getComputedStyle(body).paddingBottom) || 0
      if (pb > 32) out.push({ rule: 'form-body-padding', detail: `.form-page-body padding-bottom is ${pb}px (max 32px) - a footer-clearance hack leaves an empty band above the footer` })

      // (b2) gap between the last visible content and the footer, when the content
      // fits (a scrolling body has no dead band by definition)
      if (body.scrollHeight <= body.clientHeight + 1) {
        let lastBottom = body.getBoundingClientRect().top
        for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
          if (!vis(el)) continue
          const cs = getComputedStyle(el)
          if (cs.position === 'fixed' || cs.position === 'absolute') continue
          // a box with no text/controls and no paint is empty space, not content
          const paints = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px'
          const leaf = el.children.length === 0
          if (!paints && leaf && !(el.textContent || '').trim() && !/^(INPUT|SELECT|TEXTAREA|BUTTON|SVG|IMG|HR)$/i.test(el.tagName)) continue
          lastBottom = Math.max(lastBottom, el.getBoundingClientRect().bottom)
        }
        const gap = Math.round(footer.getBoundingClientRect().top - lastBottom)
        if (gap > 240) out.push({ rule: 'form-dead-band', detail: `${gap}px of empty space between the last field and the footer (severe, > 240px)` })
        else if (gap > 160) out.push({ rule: 'form-dead-band', detail: `${gap}px of empty space between the last field and the footer (max 160px)` })
      }

      // (c) the footer is reachable: fully on screen and not covered by anything
      footer.scrollIntoView({ block: 'end' })
      const r = footer.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      if (r.top < -1 || r.bottom > vh + 1 || r.left < -1 || r.right > vw + 1) {
        out.push({ rule: 'footer-offscreen', detail: `form footer ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)} is outside the ${vw}x${vh} screen after scrolling to it` })
      } else {
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (top && !footer.contains(top)) {
          out.push({ rule: 'footer-covered', detail: `form footer is covered by <${top.tagName.toLowerCase()} class="${String((top as HTMLElement).className).slice(0, 40)}">` })
        }
      }
      window.scrollTo(0, 0)
    }
    return out
  })
}

/** Any open [role=dialog]: inside the screen, footer visible and not covered. */
export async function checkDialogs(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = []
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    for (const d of Array.from(document.querySelectorAll<HTMLElement>('[role=dialog]'))) {
      const r = d.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || getComputedStyle(d).visibility === 'hidden') continue
      const name = (d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.textContent || 'dialog').trim().slice(0, 40)
      if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1) {
        out.push({ rule: 'dialog-offscreen', detail: `"${name}" ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)} leaves the ${vw}x${vh} screen (maxHeight not respected)` })
        continue
      }
      const footer = d.lastElementChild as HTMLElement | null
      if (!footer || footer === d) continue
      const fr = footer.getBoundingClientRect()
      if (fr.bottom > vh + 1 || fr.top < 0) {
        out.push({ rule: 'dialog-footer-hidden', detail: `"${name}" footer is outside the screen` })
        continue
      }
      const top = document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2)
      if (top && !footer.contains(top)) {
        out.push({ rule: 'dialog-footer-covered', detail: `"${name}" footer is covered by <${top.tagName.toLowerCase()}>` })
      }
    }
    return out
  })
}

/** Open (and close again) up to two "New / Add / Create" popups so checkDialogs has something to measure. Read-only: nothing is submitted. */
export async function openSomeDialogs(page: Page, route: string): Promise<Problem[]> {
  const problems: Problem[] = []
  const btns = page.getByRole('button', { name: /^\s*(\+|new\b|add\b|create\b)/i })
  const n = Math.min(await btns.count(), 2)
  for (let i = 0; i < n; i++) {
    try {
      const b = btns.nth(i)
      if (!(await b.isVisible())) continue
      await b.click({ timeout: 2000 })
      await page.waitForTimeout(500)
      if (!page.url().includes(route)) { await page.goto(route); continue } // it navigated to a form page - not a dialog
      problems.push(...(await checkDialogs(page)))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    } catch { /* button covered / disabled - other checks cover it */ }
  }
  return problems
}

/** Tables: text of one cell must not run into the next cell; cells must not silently clip text. */
export async function checkTables(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = []
    const textBox = (cell: HTMLElement) => {
      let left = Infinity, right = -Infinity
      const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!(n.textContent || '').trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of Array.from(range.getClientRects())) {
          if (r.width === 0) continue
          left = Math.min(left, r.left); right = Math.max(right, r.right)
        }
      }
      return right === -Infinity ? null : { left, right }
    }
    const label = (c: HTMLElement) => `"${(c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`
    let overlaps = 0, clips = 0
    for (const tr of Array.from(document.querySelectorAll<HTMLTableRowElement>('table tr'))) {
      const cells = Array.from(tr.children) as HTMLElement[]
      // (e) overlap between neighbouring cells
      for (let i = 0; i + 1 < cells.length && overlaps < 5; i++) {
        const a = textBox(cells[i]), b = textBox(cells[i + 1])
        if (a && b && a.right > b.left + 1 && a.left < b.right) {
          overlaps++
          out.push({ rule: 'cell-overlap', detail: `text of ${label(cells[i])} runs into ${label(cells[i + 1])} (${Math.round(a.right)}px > ${Math.round(b.left)}px)` })
        }
      }
      // (f) clipped without an ellipsis
      for (const c of cells) {
        if (clips >= 5) break
        const cs = getComputedStyle(c)
        if (cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis' && c.scrollWidth > c.clientWidth + 1) {
          clips++
          out.push({ rule: 'clipped-text', detail: `cell ${label(c)} cuts its text off (${c.scrollWidth}px of content in ${c.clientWidth}px, no ellipsis)` })
        }
        for (const el of Array.from(c.querySelectorAll<HTMLElement>('span, div, a'))) {
          const s = getComputedStyle(el)
          if (s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && clips < 5) {
            clips++
            out.push({ rule: 'clipped-text', detail: `${label(el)} inside a cell cuts its text off (${el.scrollWidth}px in ${el.clientWidth}px, no ellipsis)` })
          }
        }
      }
    }
    return out
  })
}

/** Tables fit their card: the nearest horizontal scroll box around a table must not scroll sideways (TableFit keeps them fitted). */
export async function checkTableHorizontalScroll(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = []
    // phones: a table with many columns cannot be readable in 390px, TableFit leaves those scrolling on purpose
    if (document.documentElement.clientWidth < 700) return out
    if (/^\/dashboard\/rnd\/(braking|hydraulic|load-distribution|qmax|spline|tractive-effort|vehicle-performance|tools)(\/|$)/.test(window.location.pathname)) return out
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'))
    tables.forEach((t, i) => {
      if (t.closest('[data-table-fit="off"]')) return
      if (t.querySelector('input, select, textarea, [contenteditable]')) return // editing tables keep their widths
      const r = t.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      let box: HTMLElement | null = t.parentElement
      while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement
      if (box && box.scrollWidth > box.clientWidth + 2) {
        out.push({ rule: 'table-horizontal-scroll', detail: `table #${i + 1} (${t.rows.length} rows, ${t.rows[0]?.cells.length ?? 0} columns) makes its card scroll sideways (${box.scrollWidth}px of content in ${box.clientWidth}px) - TableFit did not fit it` })
      }
    })
    return out
  })
}

/** Horizontal page overflow. */
export async function checkPageOverflow(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = []
    const de = document.documentElement
    for (const [name, el] of [['page', de], ['main', document.querySelector('main')]] as const) {
      if (el && el.scrollWidth > (name === 'page' ? window.innerWidth : el.clientWidth) + 2) {
        out.push({ rule: 'page-overflow', detail: `${name} scrollWidth ${el.scrollWidth}px is wider than its ${name === 'page' ? window.innerWidth : el.clientWidth}px box` })
      }
    }
    return out
  })
}

/** Save a viewport screenshot (visual-gate evidence) when UI_SHOTS=dir is set. */
export async function saveShot(page: Page, dir: string | undefined, project: string, route: string) {
  if (!dir) return
  const { mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const folder = join(dir, project)
  mkdirSync(folder, { recursive: true })
  const name = (route.replace(/^\/+/, '').replace(/[^\w-]+/g, '_') || 'root') + '.png'
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  await page.screenshot({ path: join(folder, name), fullPage: false })
}
