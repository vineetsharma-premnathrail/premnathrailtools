import { test, expect, type Page } from '@playwright/test'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { checkDialogs, checkFormCards, checkPageOverflow, checkTables, openSomeDialogs, saveShot } from './layout-checks'

// Runtime layout checks on every static dashboard page, at a laptop (1366x768)
// and a phone (390x844) width — see playwright.config.ts for how to run.
//
// HOW TO RUN (the owner runs this; it needs the owner's saved login)
//   1. Frontend on :3000 and backend on :8000 already running.
//   2. Once, or when the session expires:  npm run test:ui:login
//      (a browser opens, the owner signs in; saved to e2e/.auth/state.json)
//   3. npm run test:ui:layout                      every dashboard page, both sizes
//      UI_ROUTES=/dashboard/crm,/dashboard/store npm run test:ui:layout   a few pages
//      UI_SHOTS=D:\shots npm run test:ui:layout    also save one viewport
//        screenshot per page and size to D:\shots\laptop\ and \phone\ — the
//        "visual gate": a UI reviewer LOOKS at these before a screen is passed.
//   Every failure names the page, the screen size and the reason.
//
// Checks added after the 96px dead band above every form footer (layout-checks.ts):
//   page-overflow       the page / main area is not wider than the screen.
//   form-body-padding   .form-page-body bottom padding <= 32px.
//   form-dead-band      empty space between the last field and the footer
//                       <= 160px (> 240px is reported as severe).
//   footer-offscreen / footer-covered   the form footer is fully on screen
//                       and nothing sits on top of it.
//   dialog-offscreen / dialog-footer-hidden / dialog-footer-covered
//                       any open popup (and the first two "New/Add/Create"
//                       popups, opened then closed - nothing is saved) fits the
//                       screen with its footer visible.
//   cell-overlap        text of one table cell does not run into the next cell.
//   clipped-text        a table cell (or a box inside it) with overflow hidden
//                       and no ellipsis does not cut its text off.
//
//   overflow        nothing sticks out past the right/left edge of the screen
//                   unless it sits inside its own scroll box (html/body hide
//                   overflow, so these bugs show up as cut-off content).
//   native-select   no OS <select> list (only `multiple` lists are allowed).
//   row-heights     inputs, dropdowns and styled buttons sharing one row are the
//                   same height (±2px) — the 38px / 30px control scale.
//   clipped-button  no button whose label is cut off.
//   dropdown        an opened dropdown list sits fully inside the screen.

const APP_DIR = join(__dirname, '..', 'src', 'app')

function staticRoutes(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) {
        if (!f.startsWith('[') && !f.startsWith('(') && !f.startsWith('_')) walk(p)
      } else if (f === 'page.tsx') {
        const rel = relative(APP_DIR, dir).split(sep).join('/')
        out.push('/' + rel)
      }
    }
  }
  walk(join(APP_DIR, 'dashboard'))
  return out.sort()
}

const only = (process.env.UI_ROUTES || '').split(',').map((s) => s.trim()).filter(Boolean)
const ROUTES = only.length ? only : staticRoutes()

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

type Problem = { rule: string; detail: string }

async function inspect(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: { rule: string; detail: string }[] = []
    const vw = document.documentElement.clientWidth
    const describe = (el: Element) => {
      const h = el as HTMLElement
      const id = h.id ? `#${h.id}` : ''
      const tour = h.getAttribute('data-tour') ? `[data-tour=${h.getAttribute('data-tour')}]` : ''
      const text = (h.innerText || (h as HTMLInputElement).placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      return `<${el.tagName.toLowerCase()}${id}${tour}> "${text}"`
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const cs = getComputedStyle(el)
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01
    }
    const insideScrollBox = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) return true
        if (cs.position === 'fixed') return true
      }
      return false
    }
    const skip = (el: Element) => !!el.closest('.app-sidebar, .sidebar-backdrop, .bg-blob, .cursor-ripple-wrap, [aria-hidden="true"]')

    // overflow
    const offenders: string[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (offenders.length >= 5) break
      if (skip(el) || !visible(el)) continue
      const r = el.getBoundingClientRect()
      if ((r.right > vw + 1 || r.left < -1) && !insideScrollBox(el)) {
        // report the outermost offender only
        const parent = el.parentElement
        if (parent && parent !== document.body) {
          const pr = parent.getBoundingClientRect()
          if ((pr.right > vw + 1 || pr.left < -1) && !insideScrollBox(parent)) continue
        }
        offenders.push(`${describe(el)} spans ${Math.round(r.left)}…${Math.round(r.right)}px of ${vw}px`)
      }
    }
    for (const o of offenders) problems.push({ rule: 'overflow', detail: o })

    // native-select
    for (const s of Array.from(document.querySelectorAll('select:not([multiple])'))) {
      if (visible(s)) problems.push({ rule: 'native-select', detail: describe(s) })
    }

    // row-heights
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]):not([type=color]), .ui-select-trigger, button',
    )).filter((el) => {
      if (!visible(el) || skip(el) || el.closest('.ui-select-list, table')) return false
      if (el.tagName !== 'BUTTON') return true
      const cs = getComputedStyle(el)
      const styled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopWidth !== '0px'
      return styled && (el.innerText || '').trim().length > 1
    })
    const byParentRow = new Map<Element, HTMLElement[]>()
    for (const c of controls) {
      // the row is the nearest flex/grid container
      let row: Element | null = c.parentElement
      while (row && !/(flex|grid)/.test(getComputedStyle(row).display)) row = row.parentElement
      if (!row) continue
      const list = byParentRow.get(row) || []
      list.push(c)
      byParentRow.set(row, list)
    }
    for (const list of byParentRow.values()) {
      const lines = new Map<number, HTMLElement[]>()
      for (const c of list) {
        const bottom = Math.round(c.getBoundingClientRect().bottom / 4)
        lines.set(bottom, [...(lines.get(bottom) || []), c])
      }
      for (const line of lines.values()) {
        if (line.length < 2) continue
        const hs = line.map((c) => Math.round(c.getBoundingClientRect().height))
        if (Math.max(...hs) - Math.min(...hs) > 2) {
          problems.push({ rule: 'row-heights', detail: line.map((c, i) => `${describe(c)}=${hs[i]}px`).join(' | ') })
        }
      }
    }

    // clipped-button
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
      if (!visible(b) || skip(b)) continue
      if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') {
        problems.push({ rule: 'clipped-button', detail: describe(b) })
      }
    }
    return problems
  })
}

async function checkDropdowns(page: Page): Promise<Problem[]> {
  const problems: Problem[] = []
  const triggers = page.locator('.ui-select-trigger:not([aria-disabled="true"]):visible')
  const n = Math.min(await triggers.count(), 3)
  for (let i = 0; i < n; i++) {
    const t = triggers.nth(i)
    try {
      await t.scrollIntoViewIfNeeded({ timeout: 2000 })
      await t.click({ timeout: 2000 })
      const list = page.locator('.ui-select-list').last()
      await list.waitFor({ state: 'visible', timeout: 2000 })
      const box = await list.boundingBox()
      const vp = page.viewportSize()!
      if (box && (box.y < -1 || box.x < -1 || box.y + box.height > vp.height + 1 || box.x + box.width > vp.width + 1)) {
        problems.push({ rule: 'dropdown', detail: `list ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)} leaves the ${vp.width}×${vp.height} screen` })
      }
      await page.keyboard.press('Escape')
    } catch {
      /* trigger hidden behind something / navigated — the other checks cover it */
    }
  }
  return problems
}

for (const route of ROUTES) {
  test(`layout ${route}`, async ({ page }, testInfo) => {
    const res = await page.goto(route)
    expect(res?.status() ?? 200, `${route} failed to load`).toBeLessThan(500)
    await settle(page)
    if (/\/login/.test(page.url())) throw new Error('Not signed in — run `npm run test:ui:login` first.')
    if (!page.url().includes(route)) test.skip(true, `redirected to ${page.url()} (no access)`)

    const vp = page.viewportSize()!
    const where = `${route} @ ${vp.width}x${vp.height}`
    const problems = [
      ...(await inspect(page)),
      ...(await checkPageOverflow(page)),
      ...(await checkTables(page)),
      ...(await checkFormCards(page)),
      ...(await checkDialogs(page)),
      ...(await checkDropdowns(page)),
    ]
    // screenshot before popups are opened below, so it shows the page itself
    await saveShot(page, process.env.UI_SHOTS, testInfo.project.name, route)
    problems.push(...(await openSomeDialogs(page, route)))
    for (const p of problems) expect.soft(p, `[${where}] ${p.rule}: ${p.detail}`).toBeUndefined()
  })
}
