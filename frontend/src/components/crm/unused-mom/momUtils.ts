// Legacy MOM (Minutes of Meeting) helpers. Activities no longer generate
// mom_items rows from numbered text — kept here in case that workflow is
// reinstated.

import { MomItem } from '@/types'

const NUMBERED_LINE = /^\d+\.\s(.*)$/

// Splits a Word-style numbered-list textarea value ("1. foo\n2. bar") into
// individual points. Falls back to the whole text as a single point when no
// numbering was used, so plain single-line activities still work as before.
export function parseNumberedPoints(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const numbered = lines.map((l) => l.match(NUMBERED_LINE)?.[1]).filter((v): v is string => !!v)
  if (numbered.length) return numbered
  return text.trim() ? [text.trim()] : []
}

// Reconstructs a numbered-list textarea value from saved mom_items, so
// re-opening an activity for edit shows the same "1. .. 2. .." text back.
export function momItemsToNumberedText(items: MomItem[] | undefined, field: keyof MomItem): string {
  if (!items?.length) return ''
  const values = items.map((it) => it[field] || '')
  if (values.every((v) => !v)) return ''
  return values.map((v, i) => `${i + 1}. ${v}`).join('\n')
}
