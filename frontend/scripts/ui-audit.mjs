#!/usr/bin/env node
// Static UI consistency test — `npm run test:ui` (or `node scripts/ui-audit.mjs [paths…]`).
//
// Fails (exit 1) on the mistakes that kept coming back app-wide:
//   native-select    a native <select> (OS list, wrong height, clipped) — use
//                    components/shared/Select (drop-in) or SearchableSelect.
//                    `multiple` lists are allowed.
//   browser-dialog   window.confirm / alert / prompt — use ConfirmDialog / PromptDialog.
//   overlay-portal   a full-screen fixed overlay (position fixed + inset 0) in a file
//                    that never calls createPortal — glass cards (backdrop-filter)
//                    trap it, so it renders clipped inside the card.
//   unclamped-popup  a fixed popup positioned at `rect.left` with no clamping —
//                    it runs off the right edge of the screen; use placePopover().
//   table-scroll     a <table> in a file with no scroll box (TableScroll,
//                    tableWrapStyle, .table-scroll or overflow auto/scroll) — a
//                    wide table then widens the whole page.
// Warns (shown with --warn, never fails):
//   adhoc-button     a <button> with its own inline padding and no shared button
//                    style spread — sizes drift from the 38px / 30px scale.
//   fixed-grid       an inline grid with 3+ fixed-px tracks — won't fit a laptop
//                    or phone; use minmax()/auto-fit or className="ui-cols".
//
// Escape hatch, for a deliberate exception only: a comment
// `ui-audit-ignore <rule>` anywhere in the file skips that rule for the file;
// `ui-audit-ignore-next-line <rule>` skips the next line.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const args = process.argv.slice(2)
const showWarn = args.includes('--warn')
const asJson = args.includes('--json')
const targets = args.filter((a) => !a.startsWith('--'))
const roots = (targets.length ? targets : ['src']).map((t) => join(ROOT, t))

const ALLOW_SELECT = new Set(['src/components/shared/Select.tsx'])
// The validated R&D engineering tools are never edited (owner, 2026-10-24) —
// no rule reports them, so no sweep touches them.
const FROZEN = /^src\/app\/dashboard\/rnd\/(braking|qmax|tractive-effort|load-distribution|spline|vehicle-performance|hydraulic|history)\/|^src\/components\/rnd\/(ToolCalculatorPage|toolStyles|CalcResults)\b/

function walk(p, out) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.')) walk(join(p, f), out)
  } else if (/\.(tsx|ts|jsx)$/.test(p) && !/\.d\.ts$/.test(p)) out.push(p)
  return out
}

const files = roots.flatMap((r) => walk(r, []))
const findings = []
const add = (level, rule, file, line, msg) => findings.push({ level, rule, file, line, msg })

for (const abs of files) {
  const file = relative(ROOT, abs).split(sep).join('/')
  if (FROZEN.test(file)) continue
  const src = readFileSync(abs, 'utf8')
  const lines = src.split(/\r?\n/)
  const fileIgnored = (rule) => new RegExp(`ui-audit-ignore\\s+[^\\n]*\\b${rule}\\b`).test(src)
  const lineIgnored = (i, rule) => i > 0 && new RegExp(`ui-audit-ignore-next-line\\s+[^\\n]*\\b${rule}\\b`).test(lines[i - 1])
  const hit = (level, rule, i, msg) => {
    if (fileIgnored(rule) || lineIgnored(i, rule)) return
    add(level, rule, file, i + 1, msg)
  }

  // native-select: look at the whole opening tag (may span lines) for `multiple`.
  if (!ALLOW_SELECT.has(file)) {
    const re = /<select\b([^>]*)>/gs
    let m
    while ((m = re.exec(src))) {
      if (/\bmultiple\b/.test(m[1])) continue
      const i = src.slice(0, m.index).split('\n').length - 1
      hit('error', 'native-select', i, 'native <select> — use <Select> from components/shared/Select (same children/onChange)')
    }
  }

  lines.forEach((l, i) => {
    if (/\bwindow\.(confirm|alert|prompt)\s*\(/.test(l) || /(^|[\s;({!&|])alert\s*\(/.test(l)) {
      if (!/^\s*(\/\/|\*)/.test(l)) hit('error', 'browser-dialog', i, 'browser dialog — use ConfirmDialog / PromptDialog')
    }
  })

  // overlay-portal: a fixed full-screen layer without createPortal in the file.
  if (!/createPortal\s*\(/.test(src)) {
    lines.forEach((l, i) => {
      if (!/position:\s*['"]fixed['"]/.test(l)) return
      const win = lines.slice(Math.max(0, i - 2), i + 4).join(' ')
      if (/inset:\s*0\b/.test(win) || (/top:\s*0\b/.test(win) && /left:\s*0\b/.test(win) && /(right:\s*0\b|width:\s*['"]100v?w)/.test(win))) {
        hit('error', 'overlay-portal', i, 'full-screen fixed overlay without createPortal — portal it to document.body')
      }
    })
  }

  // unclamped-popup: a fixed popup placed straight at the trigger's left edge
  // (`left: rect.left`) runs off the right of the screen — use placePopover.
  lines.forEach((l, i) => {
    if (/\bleft:\s*(rect|r)\.left\b/.test(l) && /set[A-Z]\w*\(/.test(l) && !/Math\.(max|min)|placePopover/.test(l)) {
      hit('error', 'unclamped-popup', i, 'popup placed at the trigger\'s left edge without clamping — use placePopover() from lib/popover')
    }
  })

  // scrolling-tabs: a tab row (flex + bottom border) with overflow-x — overflow-y
  // then becomes auto too, the active tab's underline pokes 1px out, and a
  // scrollbar appears beside the tabs. Tab rows wrap (flexWrap) instead.
  lines.forEach((l, i) => {
    if (/display:\s*'flex'/.test(l) && /borderBottom:/.test(l) && /overflowX?:\s*'(auto|scroll)'/.test(l)) {
      hit('error', 'scrolling-tabs', i, "tab row with overflow-x — use flexWrap: 'wrap' instead (a scrollbar appears next to the tabs)")
    }
  })

  // table-count: every table with a header row shows how many rows it holds
  // (after search / filters) next to its first header — <RowCount count={…} />.
  {
    const heads = lines.map((l, i) => (/<thead\b/.test(l) ? i : -1)).filter((i) => i >= 0)
    const counts = (src.match(/<RowCount\b/g) || []).length
    // One <RowCount> per table header; flag the tables beyond the counted ones.
    heads.slice(counts).forEach((i) => {
      hit('error', 'table-count', i, 'table without a row count — put <RowCount count={filteredRows.length} /> in its first header cell (shared/ui)')
    })
  }

  // table-scroll
  if (/<table\b/.test(src) && !/(TableScroll|TableWrap|tableWrap|table-scroll|overflowX?:\s*['"](auto|scroll)['"]|overflow:\s*['"]\w+ (auto|scroll)['"])/.test(src)) {
    const i = lines.findIndex((l) => /<table\b/.test(l))
    hit('error', 'table-scroll', i, '<table> with no scroll box — wrap it in <TableScroll> (shared/ui)')
  }

  // custom-pill: a hand-made pill span — use <Pill> / pillStyle() from shared/ui.
  if (file !== 'src/components/shared/ui.tsx') {
    lines.forEach((l, i) => {
      if (/<span\b[^>]*style=\{\{[^}]*borderRadius:\s*(9999|999)\b/.test(l) && !/\.\.\.\s*pillStyle\(/.test(l)) {
        hit('error', 'custom-pill', i, 'hand-made pill — use <Pill label hex /> or pillStyle(hex) from shared/ui')
      }
    })
  }

  // warnings
  lines.forEach((l, i) => {
    if (/<button\b[^>]*style=\{\{[^}]*\bpadding:/.test(l) && !/\.\.\.\s*\w*(btn|Btn|BTN|button|Button)\w*/.test(l)) {
      hit('warn', 'adhoc-button', i, 'button with its own padding — spread primary/secondary/small*BtnStyle from shared/ui')
    }
    const g = l.match(/gridTemplateColumns:\s*['"`]([^'"`]+)['"`]/)
    if (g && !/minmax|auto-fit|auto-fill/.test(g[1])) {
      const px = (g[1].match(/\b\d{2,4}px\b/g) || []).length
      if (px >= 3 && !/ui-cols|className=/.test(lines.slice(Math.max(0, i - 2), i + 2).join(' '))) {
        hit('warn', 'fixed-grid', i, `grid "${g[1]}" has ${px} fixed px tracks — use minmax()/auto-fit or className="ui-cols"`)
      }
    }
  })
}

// ---- custom-button (error): nobody builds their own button box ---------------
// A button's size (padding / radius / font) comes from the shared styles in
// components/shared/ui.tsx (primary/secondary/danger/small*/iconBtnStyle, btnBase)
// or FormSheet's sheetBtn. Flags (1) a <button> whose inline style sets padding
// without spreading one of those, and (2) a local `xxxBtn` style constant /
// helper that sets padding without spreading one. Text links and tabs
// (transparent / none background) are not pill buttons and are left alone.
const SHARED_SPREAD = /\.\.\.\s*\(?\s*(\w*(?:[Bb]tn|Button|BTN)\w*|btnBase|smallBtnSize)\b|\b(sheetBtn|actionBtn|smallActionBtn|pageBtnStyle|squareBtn|smBtnStyle|calcButtonStyle|chipBtnStyle|segmentBtnStyle)\s*\(/
const NOT_A_PILL = /background(Color)?:\s*['"](none|transparent)['"]/
const BUTTON_EXEMPT_FILES = new Set([
  'src/components/shared/ui.tsx', 'src/components/shared/FormSheet.tsx', 'src/components/shared/MoreValuesButtons.tsx',
])

function balanced(src, open) {
  // text from `open` (index of '{') to its matching '}'
  let depth = 0
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}' && --depth === 0) return src.slice(open, k + 1)
  }
  return src.slice(open)
}

for (const abs of files) {
  const file = relative(ROOT, abs).split(sep).join('/')
  if (BUTTON_EXEMPT_FILES.has(file) || FROZEN.test(file)) continue
  const src = readFileSync(abs, 'utf8')
  if (new RegExp('ui-audit-ignore\\s+[^\\n]*\\bcustom-button\\b').test(src)) continue
  const lineOf = (idx) => src.slice(0, idx).split('\n').length
  const ignoredAt = (ln) => {
    const prev = src.split('\n')[ln - 2] || ''
    return /ui-audit-ignore-next-line\s+[^\n]*\bcustom-button\b/.test(prev)
  }
  const flag = (idx, msg) => { const ln = lineOf(idx); if (!ignoredAt(ln)) add('error', 'custom-button', file, ln, msg) }

  // (1) inline styles on <button>
  const btnRe = /<button\b/g
  let m
  while ((m = btnRe.exec(src))) {
    const s = src.indexOf('style={', m.index)
    const close = src.indexOf('>', m.index)
    if (s < 0 || (close >= 0 && s > close && !src.slice(m.index, s).includes('=>'))) continue
    if (src.slice(m.index, s).includes('</button')) continue
    const obj = balanced(src, s + 6)
    if (!/\bpadding\s*:/.test(obj) || SHARED_SPREAD.test(obj) || NOT_A_PILL.test(obj)) continue
    flag(m.index, 'button builds its own box (padding) — spread primaryBtnStyle / secondaryBtnStyle / dangerBtnStyle / small*BtnStyle from shared/ui')
  }

  // (2) local button style constants / helpers
  const constRe = /\b(?:const|let)\s+(\w*(?:[Bb]tn|Button)\w*)\s*(?::\s*[\w.<>[\]]+\s*)?=\s*(?:\([^)]*\)\s*(?::\s*[\w.<>]+\s*)?=>\s*\(?\s*)?\{/g
  while ((m = constRe.exec(src))) {
    const obj = balanced(src, m.index + m[0].length - 1)
    if (!/\bpadding\s*:/.test(obj) || SHARED_SPREAD.test(obj) || NOT_A_PILL.test(obj)) continue
    flag(m.index, `local button style "${m[1]}" builds its own box — spread a shared button style (shared/ui) instead`)
  }
}

const errors = findings.filter((f) => f.level === 'error')
const warns = findings.filter((f) => f.level === 'warn')

if (asJson) {
  console.log(JSON.stringify({ errors, warns }, null, 2))
} else {
  for (const f of errors) console.log(`ERROR ${f.rule.padEnd(15)} ${f.file}:${f.line}  ${f.msg}`)
  if (showWarn) for (const f of warns) console.log(`warn  ${f.rule.padEnd(15)} ${f.file}:${f.line}  ${f.msg}`)
  const byRule = {}
  for (const f of findings) byRule[`${f.level}:${f.rule}`] = (byRule[`${f.level}:${f.rule}`] || 0) + 1
  console.log(`\nUI audit: ${files.length} files, ${errors.length} error(s), ${warns.length} warning(s)`)
  for (const [k, n] of Object.entries(byRule).sort()) console.log(`  ${k.padEnd(28)} ${n}`)
}
process.exit(errors.length ? 1 : 0)
