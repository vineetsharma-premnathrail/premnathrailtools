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

  // table-scroll
  if (/<table\b/.test(src) && !/(TableScroll|TableWrap|tableWrap|table-scroll|overflowX?:\s*['"](auto|scroll)['"]|overflow:\s*['"]\w+ (auto|scroll)['"])/.test(src)) {
    const i = lines.findIndex((l) => /<table\b/.test(l))
    hit('error', 'table-scroll', i, '<table> with no scroll box — wrap it in <TableScroll> (shared/ui)')
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
