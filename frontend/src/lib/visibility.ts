import { createContext, useContext } from 'react'
import { useAuthStore } from '@/store/authStore'
import type { VisibilityCatalogEntry, VisibilityRule } from '@/types'

export type { VisibilityCatalogEntry, VisibilityRule }

/**
 * Role-wise UI visibility (backend core/visibility.py): which sections show,
 * which dropdown values are offered and which table columns show, per screen.
 * A screen asks `useVisibility('<module>:<tab>')`; admins and screens with no
 * rule see everything. Show/hide only — dropdown values are also refused by the
 * server, sections and columns are hidden on screen only.
 *
 * Screens put the result on the page with the wrappers in
 * lib/visibilityComponents.tsx (VisSection, VisTh, VisTd, VisOptionValues), not
 * with `showSection(...) && ...`: the wrappers also drive "Preview & choose" in
 * the Role editor, where the real screen opens and the admin clicks what shows.
 */

// Types live in @/types (VisibilityCatalogEntry = /roles/catalog `visibility[key]`; VisibilityRule = one role's
// overrides for one screen, same shape as the signed-in user's merged `user.visibility[key]`).

// ---- Screens inside one catalogue key (New form / Requisition page / List) ----------------------------------

/** Every item of a catalogue entry may carry the `screen` it belongs to (catalogue `screens: {code: label}`). */
type WithScreen = { screen?: string }
type EntryWithScreens = VisibilityCatalogEntry & { screens?: Record<string, string> }

/** [code, label] of every screen of the entry, in catalogue order. An entry with no `screens` is one screen with the entry's own label. */
export function catalogScreens(entry: VisibilityCatalogEntry | null | undefined): [string, string][] {
  if (!entry) return []
  const screens = Object.entries((entry as EntryWithScreens).screens || {})
  return screens.length ? screens : [['', entry.label]]
}

/** The screen code an item belongs to: its own `screen`, else the first screen. */
export function itemScreen(entry: VisibilityCatalogEntry, item: object | undefined): string {
  const screens = catalogScreens(entry)
  const own = (item as WithScreen | undefined)?.screen
  return own && screens.some(([code]) => code === own) ? own : screens[0]?.[0] ?? ''
}

export interface ScreenItems {
  sections: [string, VisibilityCatalogEntry['sections'][string]][]
  options: [string, VisibilityCatalogEntry['options'][string]][]
  tables: [string, VisibilityCatalogEntry['tables'][string]][]
}

/** The sections, dropdowns and tables of one screen. */
export function screenItems(entry: VisibilityCatalogEntry, screen: string): ScreenItems {
  const mine = <T extends object>(rows: Record<string, T> | undefined) =>
    Object.entries(rows || {}).filter(([, item]) => itemScreen(entry, item) === screen)
  return { sections: mine(entry.sections), options: mine(entry.options), tables: mine(entry.tables) }
}

export function isEmptyVisibilityRule(rule: VisibilityRule | null | undefined): boolean {
  if (!rule) return true
  return !(rule.hidden_sections?.length)
    && !Object.values(rule.options || {}).some((v) => v.length)
    && !Object.values(rule.hidden_columns || {}).some((v) => v.length)
}

function describeParts(rule: VisibilityRule, entry: VisibilityCatalogEntry | null | undefined, screen: string | null): string[] {
  const inScreen = (item: object | undefined) => screen === null || !entry || itemScreen(entry, item) === screen
  const parts: string[] = []
  const sections = (rule.hidden_sections || []).filter((k) => inScreen(entry?.sections?.[k])).length
  if (sections) parts.push(`${sections} section${sections === 1 ? '' : 's'} hidden`)
  for (const [dropdown, allowed] of Object.entries(rule.options || {})) {
    if (!allowed.length || !inScreen(entry?.options?.[dropdown])) continue
    const meta = entry?.options?.[dropdown]
    const total = meta ? Object.keys(meta.values).length : null
    parts.push(`${meta?.label || dropdown}: ${allowed.length}${total != null ? ` of ${total}` : ''} value${(total ?? allowed.length) === 1 ? '' : 's'}`)
  }
  const columns = Object.entries(rule.hidden_columns || {})
    .filter(([table]) => inScreen(entry?.tables?.[table])).reduce((n, [, c]) => n + c.length, 0)
  if (columns) parts.push(`${columns} column${columns === 1 ? '' : 's'} hidden`)
  return parts
}

/**
 * Chip text. "shows everything", or what is hidden — per screen when the entry has several:
 * "New Requisition form: 1 section hidden · Requisitions list: 2 columns hidden".
 */
export function describeVisibilityRule(rule: VisibilityRule | null | undefined, entry: VisibilityCatalogEntry | null | undefined): string {
  if (!rule || isEmptyVisibilityRule(rule)) return 'shows everything'
  const screens = catalogScreens(entry)
  if (!entry || screens.length < 2) return describeParts(rule, entry, null).join(', ')
  return screens
    .map(([code, label]) => ({ label, parts: describeParts(rule, entry, code) }))
    .filter((s) => s.parts.length)
    .map((s) => `${s.label}: ${s.parts.join(', ')}`)
    .join(' · ') || 'shows everything'
}

// ---- Preview & choose (Role editor) ---------------------------------------------------------------------------

/** Set by VisibilityPreviewProvider around a screen mounted in the Role editor's preview. */
export interface VisibilityPreviewValue {
  key: string
  screen: string
  entry: VisibilityCatalogEntry
  /** The rule being edited (the dialog's draft); null = everything shown. */
  rule: VisibilityRule | null
  onToggleSection: (section: string) => void
  onToggleColumn: (table: string, column: string) => void
  /** Offer / stop offering one value of a dropdown (the last value can't be removed). */
  onToggleOption: (dropdown: string, value: string) => void
}

export const VisibilityPreviewContext = createContext<VisibilityPreviewValue | null>(null)

export interface VisibilityApi {
  /** False when the user's roles hide this section (in the preview: when the rule being edited hides it). */
  showSection: (section: string) => boolean
  /** True when at least one of these sections shows (always true in the preview, which draws every section). */
  anySection: (sections: string[]) => boolean
  /** False when the user's roles hide this column of this table. */
  showColumn: (table: string, column: string) => boolean
  /** The dropdown's choices narrowed to the values the user's roles allow (all when unrestricted; every value in the preview). */
  options: <T>(dropdown: string, all: T[], valueOf: (item: T) => string) => T[]
  /** True when any rule applies to this screen. */
  restricted: boolean
  /** True while the screen is drawn inside the Role editor's "Preview & choose". */
  preview: boolean
  /** Preview only: the catalogue says whether this item sits on the screen being previewed (anything else is drawn plain). */
  tracks: (kind: 'section' | 'table' | 'option', code: string) => boolean
  isLocked: (section: string) => boolean
  sectionLabel: (section: string) => string
  columnLabel: (table: string, column: string) => string
  optionValues: (dropdown: string) => [string, string][]
  /** Preview only: is this value of the dropdown offered by the rule being edited? */
  optionOn: (dropdown: string, value: string) => boolean
  toggleSection: (section: string) => void
  toggleColumn: (table: string, column: string) => void
  toggleOption: (dropdown: string, value: string) => void
}

const noop = () => {}

/** The signed-in user's visibility for one screen key (a tab `p2p:purchase_requisitions` or a feature `crm:inquiries_tenders.quotations`). */
export function useVisibility(key: string): VisibilityApi {
  const user = useAuthStore((s) => s.user)
  const ctx = useContext(VisibilityPreviewContext)
  const previewing = !!ctx && ctx.key === key
  const isAdmin = !!user && user.role === 'admin'
  // In the preview the rule being edited applies live (even for an admin); otherwise the user's own merged rule.
  const rule: VisibilityRule | undefined = previewing
    ? ctx!.rule || undefined
    : isAdmin ? undefined : user?.visibility?.[key]
  const hiddenSections = new Set(rule?.hidden_sections || [])
  const entry = previewing ? ctx!.entry : undefined
  const sectionOf = (code: string) => entry?.sections?.[code]
  return {
    showSection: (section) => !hiddenSections.has(section),
    anySection: (sections) => previewing || sections.some((s) => !hiddenSections.has(s)),
    showColumn: (table, column) => !(rule?.hidden_columns?.[table] || []).includes(column),
    options: (dropdown, all, valueOf) => {
      if (previewing) return all
      const allowed = rule?.options?.[dropdown]
      if (!allowed || !allowed.length) return all
      const kept = all.filter((item) => allowed.includes(valueOf(item)))
      // A stale rule that matches nothing must not leave the form without any choice; the server still enforces it.
      return kept.length ? kept : all
    },
    restricted: !isEmptyVisibilityRule(rule),
    preview: previewing,
    tracks: (kind, code) => {
      if (!previewing || !entry) return false
      const item = kind === 'section' ? entry.sections?.[code] : kind === 'table' ? entry.tables?.[code] : entry.options?.[code]
      return !!item && itemScreen(entry, item) === ctx!.screen
    },
    isLocked: (section) => !!sectionOf(section)?.locked,
    sectionLabel: (section) => sectionOf(section)?.label || section,
    columnLabel: (table, column) => entry?.tables?.[table]?.columns?.[column] || column,
    optionValues: (dropdown) => Object.entries(entry?.options?.[dropdown]?.values || {}),
    optionOn: (dropdown, value) => {
      const allowed = rule?.options?.[dropdown]
      return !allowed || !allowed.length || allowed.includes(value)
    },
    toggleSection: previewing ? ctx!.onToggleSection : noop,
    toggleColumn: previewing ? ctx!.onToggleColumn : noop,
    toggleOption: previewing ? ctx!.onToggleOption : noop,
  }
}
