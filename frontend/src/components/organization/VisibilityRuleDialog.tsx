'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFocusTrap } from '@/components/shared/useFocusTrap'
import { TEXT, BORDER } from '@/lib/theme'
import { Pill, chipBtnStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'
import VisibilityPreview, { hasVisibilityPreview } from '@/components/organization/VisibilityPreview'
import { catalogScreens, isEmptyVisibilityRule, itemScreen, screenItems } from '@/lib/visibility'
import type { VisibilityCatalogEntry, VisibilityRule } from '@/types'

/**
 * What the members of a role see on one screen (backend core/visibility.py):
 * which sections show, which dropdown values are offered, which table columns
 * show. Opened from the "Visibility" chip of the Permission Matrix. `rule`
 * null = everything shown; Apply returns null (never {}) when nothing is
 * customised.
 */

const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }

export default function VisibilityRuleDialog({ open, entry, entryKey, roleName, keyLabel, rule, readOnly, onClose, onApply }: {
  open: boolean
  entry: VisibilityCatalogEntry
  /** Catalogue key of the entry (e.g. p2p:purchase_requisitions); needed for "Preview & choose". */
  entryKey?: string
  /** Name of the role being edited, shown in the preview title. */
  roleName?: string
  /** Name of the tab / feature the rule belongs to, shown in the title. */
  keyLabel: string
  rule: VisibilityRule | null
  readOnly?: boolean
  onClose: () => void
  onApply: (rule: VisibilityRule | null) => void
}) {
  const uid = useId()
  const screens = catalogScreens(entry)
  const [screen, setScreen] = useState(screens[0]?.[0] ?? '')
  const [previewing, setPreviewing] = useState(false)
  // Everything of every screen drives the saved rule; the tabs only show one screen's items at a time.
  const sectionEntries = Object.entries(entry.sections || {})
  const optionEntries = Object.entries(entry.options || {})
  const tableEntries = Object.entries(entry.tables || {})
  const shownItems = screenItems(entry, screen)

  const [hiddenSections, setHiddenSections] = useState<string[]>(
    () => (rule?.hidden_sections || []).filter((k) => entry.sections?.[k] && !entry.sections[k].locked))
  // dropdown -> allowed values; missing = "All values"
  const [allowed, setAllowed] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(rule?.options || {})) if (entry.options?.[k] && v.length) out[k] = v.filter((x) => x in entry.options[k].values)
    return out
  })
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(rule?.hidden_columns || {})) if (entry.tables?.[k] && v.length) out[k] = v.filter((x) => x in entry.tables[k].columns)
    return out
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [resetNote, setResetNote] = useState(false)

  // Element ids (the visible text labels are bound to the controls with htmlFor).
  const id = (...parts: string[]) => `${uid}-${parts.join('-')}`
  const titleId = id('title')
  const descId = 'visibility-dialog-desc'

  const panelRef = useRef<HTMLDivElement>(null)
  useEscapeKey(open, onClose)
  useFocusTrap(open, panelRef, { firstField: false, fallback: '[data-dialog-title]' })

  // The shared Checkbox only forwards name/description props, so the state attributes of the
  // "All values" switches (invalid / expanded / controls) are set on its input here.
  useEffect(() => {
    for (const [dd] of optionEntries) {
      const input = document.getElementById(id('dd', dd))
      if (!input) continue
      const all = !(dd in allowed)
      if (errors[dd]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid')
      input.setAttribute('aria-expanded', all ? 'false' : 'true')
      if (all) input.removeAttribute('aria-controls'); else input.setAttribute('aria-controls', id('ddlist', dd))
    }
  })

  if (!open || typeof document === 'undefined') return null

  const touch = () => setResetNote(false)
  const clearError = (dd: string) => setErrors((e) => { const n = { ...e }; delete n[dd]; return n })
  const toggleSection = (k: string) => {
    touch()
    setHiddenSections((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]))
  }
  const setAllValues = (dd: string, all: boolean) => {
    touch(); clearError(dd)
    setAllowed((a) => {
      const n = { ...a }
      // Switching "All values" off starts with every value ticked; untick the ones to remove.
      if (all) delete n[dd]
      else n[dd] = Object.keys(entry.options[dd].values)
      return n
    })
  }
  const toggleValue = (dd: string, v: string) => {
    touch(); clearError(dd)
    setAllowed((a) => {
      const cur = a[dd] || []
      return { ...a, [dd]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }
    })
  }
  const toggleColumn = (table: string, c: string) => {
    touch()
    setHiddenColumns((h) => {
      const cur = h[table] || []
      return { ...h, [table]: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] }
    })
  }

  const reset = () => { setHiddenSections([]); setAllowed({}); setHiddenColumns({}); setErrors({}); setResetNote(true) }

  /** The rule the three states add up to (a dropdown with no value picked yet is left out; Apply refuses that). */
  const compose = (): VisibilityRule => {
    const next: VisibilityRule = {}
    // Catalogue order keeps the saved rule stable between edits.
    const sections = sectionEntries.map(([k]) => k).filter((k) => hiddenSections.includes(k) && !entry.sections[k].locked)
    if (sections.length) next.hidden_sections = sections
    const options: Record<string, string[]> = {}
    for (const [dd, meta] of optionEntries) {
      const keys = Object.keys(meta.values)
      const picked = keys.filter((v) => (allowed[dd] || []).includes(v))
      // Every value ticked is the same as "All values".
      if (dd in allowed && picked.length && picked.length < keys.length) options[dd] = picked
    }
    if (Object.keys(options).length) next.options = options
    const columns: Record<string, string[]> = {}
    for (const [t, meta] of tableEntries) {
      const hidden = Object.keys(meta.columns).filter((c) => (hiddenColumns[t] || []).includes(c))
      if (hidden.length) columns[t] = hidden
    }
    if (Object.keys(columns).length) next.hidden_columns = columns
    return next
  }

  // The preview offers/withdraws one value at a time on top of the same draft; the last value always stays.
  const toggleOptionValue = (dd: string, v: string) => {
    touch(); clearError(dd)
    setAllowed((a) => {
      const keys = Object.keys(entry.options[dd].values)
      const cur = dd in a ? a[dd] : keys
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
      if (!next.length) return a
      const n = { ...a }
      if (next.length === keys.length) delete n[dd]
      else n[dd] = keys.filter((x) => next.includes(x))
      return n
    })
  }

  const apply = () => {
    const errs: Record<string, string> = {}
    for (const [dd, vals] of Object.entries(allowed)) {
      if (!vals.length) errs[dd] = `Pick at least one ${entry.options[dd].label} value, or switch it back to All values.`
    }
    setErrors(errs)
    const firstBad = optionEntries.map(([dd]) => dd).find((dd) => errs[dd])
    if (firstBad) {
      // Open the screen tab that holds the problem, bring it into view and put the keyboard on its switch.
      const focusIt = () => {
        document.getElementById(id('card', firstBad))?.scrollIntoView({ block: 'nearest' })
        document.getElementById(id('dd', firstBad))?.focus({ preventScroll: true })
      }
      const badScreen = itemScreen(entry, entry.options[firstBad])
      if (badScreen !== screen) { setScreen(badScreen); requestAnimationFrame(focusIt) } else focusIt()
      return
    }
    const next = compose()
    onApply(isEmptyVisibilityRule(next) ? null : next)
  }

  const row = (children: React.ReactNode, key: string) => (
    <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 10px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff' }}>
      {children}
    </div>
  )
  /** Visible name (a <label> bound to the control) plus an optional sub-text the control is described by. */
  const text = (labelId: string, controlId: string, label: string, subId?: string, sub?: string) => (
    <span style={{ flex: 1, minWidth: 0 }}>
      <label id={labelId} htmlFor={controlId} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT.heading, cursor: readOnly ? 'default' : 'pointer' }}>{label}</label>
      {sub && <span id={subId} style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{sub}</span>}
    </span>
  )
  const plainLabel = (controlId: string, label: string) => (
    <label htmlFor={controlId} style={{ fontSize: 13, color: TEXT.body, cursor: readOnly ? 'default' : 'pointer' }}>{label}</label>
  )

  return createPortal(
    <div className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} onClick={(e) => e.stopPropagation()} className="dialog-panel"
        style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ padding: '22px 24px 0' }}>
          <h3 id={titleId} data-dialog-title tabIndex={-1} style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: TEXT.heading, outline: 'none' }}>
            Visibility — {keyLabel}
          </h3>
          <p id={descId} style={{ margin: '0 0 12px', fontSize: 12.5, color: TEXT.muted }}>
            Choose what members of this role see on this screen. Dropdown values are also refused by the server; sections and columns are hidden on screen only.
          </p>
        </div>

        {screens.length > 1 && (
          <div role="tablist" aria-label="Screens" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 24px 10px' }}>
            {screens.map(([code, label]) => (
              <button key={code} type="button" role="tab" id={id('tab', code)} aria-selected={screen === code} aria-controls={id('panel')}
                tabIndex={screen === code ? 0 : -1}
                onClick={() => setScreen(code)} style={chipBtnStyle(screen === code)}
                onKeyDown={(e) => {
                  // Roving tabindex: arrows move between the screen tabs, Home / End jump to the first / last.
                  const at = screens.findIndex(([c]) => c === code)
                  const to = e.key === 'ArrowRight' ? (at + 1) % screens.length : e.key === 'ArrowLeft' ? (at - 1 + screens.length) % screens.length
                    : e.key === 'Home' ? 0 : e.key === 'End' ? screens.length - 1 : -1
                  if (to < 0) return
                  e.preventDefault()
                  setScreen(screens[to][0])
                  document.getElementById(id('tab', screens[to][0]))?.focus()
                }}>{label}</button>
            ))}
          </div>
        )}
        {entryKey && hasVisibilityPreview(entryKey, screen) && (
          <div style={{ padding: '0 24px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setPreviewing(true)} style={primaryBtnStyle}>{readOnly ? 'Preview screen' : 'Preview & choose'}</button>
            <span style={{ fontSize: 12, color: TEXT.muted, flex: '1 1 200px', minWidth: 0 }}>
              {readOnly ? 'Opens the real screen with sample data.' : 'Opens the real screen with sample data — click the eye on what should show or hide.'}
            </span>
          </div>
        )}

        <div
          id={id('panel')}
          {...(screens.length > 1
            ? { role: 'tabpanel', 'aria-labelledby': id('tab', screen), ...(readOnly ? { tabIndex: 0 } : {}) }
            : readOnly ? { tabIndex: 0, role: 'region', 'aria-label': `Visibility settings for ${keyLabel} (read only)` } : {})}
          style={{ padding: '0 24px 4px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {shownItems.sections.length > 0 && (
            <Group id={id('g-sections')} title="Sections">
              {shownItems.sections.map(([k, s]) => {
                const locked = !!s.locked
                const shown = locked || !hiddenSections.includes(k)
                const sub = locked ? 'Required — always shown' : s.hint
                return row(
                  <>
                    <Checkbox id={id('sec', k)} checked={shown} disabled={readOnly || locked} onChange={() => toggleSection(k)}
                      aria-describedby={sub ? id('secsub', k) : undefined} />
                    {text(id('seclabel', k), id('sec', k), s.label, id('secsub', k), sub)}
                    {!locked && !shown && <Tag>Hidden</Tag>}
                  </>, k)
              })}
            </Group>
          )}

          {shownItems.options.length > 0 && (
            <Group id={id('g-dropdowns')} title="Dropdowns">
              {shownItems.options.map(([dd, meta]) => {
                const all = !(dd in allowed)
                const describedBy = [meta.hint ? id('ddsub', dd) : '', errors[dd] ? id('dderr', dd) : ''].filter(Boolean).join(' ') || undefined
                return (
                  <div key={dd} id={id('card', dd)} style={{ border: `1px solid ${errors[dd] ? 'rgba(220,38,38,0.5)' : BORDER.normal}`, borderRadius: 10, padding: '8px 10px', background: '#fff' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <Checkbox id={id('dd', dd)} asSwitch checked={all} disabled={readOnly} onChange={(e) => setAllValues(dd, e.target.checked)}
                        aria-describedby={describedBy} />
                      {text(id('ddlabel', dd), id('dd', dd), `${meta.label} — ${all ? 'All values' : 'Only the ticked values'}`, id('ddsub', dd), meta.hint)}
                    </div>
                    {!all && (
                      <div id={id('ddlist', dd)} role="group" aria-labelledby={id('ddlabel', dd)} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, paddingLeft: 4 }}>
                        {Object.entries(meta.values).map(([v, label]) => (
                          <div key={v} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <Checkbox id={id('val', dd, v)} checked={(allowed[dd] || []).includes(v)} disabled={readOnly} onChange={() => toggleValue(dd, v)} />
                            {plainLabel(id('val', dd, v), label)}
                          </div>
                        ))}
                      </div>
                    )}
                    {errors[dd] && <p id={id('dderr', dd)} role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: '#b91c1c' }}>{errors[dd]}</p>}
                  </div>
                )
              })}
            </Group>
          )}

          {shownItems.tables.length > 0 && (
            <Group id={id('g-tables')} title="Tables">
              {shownItems.tables.map(([t, meta]) => (
                <div key={t} role="group" aria-labelledby={id('tlabel', t)} style={{ border: `1px solid ${BORDER.normal}`, borderRadius: 10, padding: '8px 10px', background: '#fff' }}>
                  <div id={id('tlabel', t)} style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, marginBottom: 6 }}>{meta.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Object.entries(meta.columns).map(([c, label]) => {
                      const shown = !(hiddenColumns[t] || []).includes(c)
                      return (
                        <div key={c} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <Checkbox id={id('col', t, c)} checked={shown} disabled={readOnly} onChange={() => toggleColumn(t, c)} />
                          {plainLabel(id('col', t, c), label)}
                          {!shown && <Tag>Hidden</Tag>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </Group>
          )}
        </div>

        {/* Announces the Reset result to screen readers; nothing visible. */}
        <div role="status" aria-live="polite" style={srOnly}>{resetNote ? 'Everything is shown again. Apply to keep it.' : ''}</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '14px 24px 18px', borderTop: `1px solid ${BORDER.normal}`, marginTop: 8 }}>
          {!readOnly && <button type="button" onClick={reset} style={secondaryBtnStyle}>Reset to show everything</button>}
          <span style={{ flex: 1, minWidth: 0 }} />
          <button type="button" onClick={onClose} style={secondaryBtnStyle}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button type="button" onClick={apply} style={primaryBtnStyle}>Apply</button>}
        </div>

        {previewing && entryKey && (
          <VisibilityPreview open roleName={roleName} onClose={() => setPreviewing(false)}
            screenLabel={screens.find(([code]) => code === screen)?.[1] || entry.label}
            value={{
              key: entryKey, screen, entry, rule: compose(),
              onToggleSection: (k) => { if (!readOnly && !entry.sections[k]?.locked) toggleSection(k) },
              onToggleColumn: (t, c) => { if (!readOnly) toggleColumn(t, c) },
              onToggleOption: (dd, v) => { if (!readOnly) toggleOptionValue(dd, v) },
            }} />
        )}
      </div>
    </div>,
    document.body,
  )
}

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-labelledby={id}>
      <div id={id} style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Tag({ children }: { children: string }) {
  return <Pill label={children} hex="#b45309" />
}
