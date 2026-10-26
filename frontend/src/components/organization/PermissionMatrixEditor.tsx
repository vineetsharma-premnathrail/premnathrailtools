'use client'

import { useMemo, useState } from 'react'
import { PermissionRegistry } from '@/types'
import { TEXT, BORDER, BRAND } from '@/lib/theme'
import { inputStyle, chipBtnStyle, smallSecondaryBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'
import AssigneeRuleDialog, { AssigneeOption, AssigneeRule, describeRule } from '@/components/organization/AssigneeRuleDialog'

/**
 * The Role & Permission matrix: one card per module, one row per tab (grouped
 * sub-tabs under their parent heading), one column per action — a cell only
 * where that action exists on that tab.
 *
 * `value` is a list of raw grants: `module:tab:action` ids or module wildcards
 * (`store:*:*` = Full Access, `store:*:view` = view on every tab). Module
 * presets write wildcards so they keep covering tabs added later; ticking a
 * single box inside a wildcard module turns it into concrete ids first.
 *
 * `inherited` (optional) marks grants the user already gets from a role:
 * shown ticked and locked, with the role names as a tooltip.
 *
 * `assigneeRules` (role editor only): a feature that has an "Assign to"
 * field (registry.assignee_rules.pickers) gets an "Assign to: …" chip on its
 * row that opens AssigneeRuleDialog — who the role may pick there.
 */

type Preset = 'none' | 'view' | 'contributor' | 'full'

const PRESETS: { key: Preset; label: string; hint: string }[] = [
  { key: 'none', label: 'No access', hint: 'Remove every permission in this module' },
  { key: 'view', label: 'View only', hint: 'See every tab; cannot create, change, delete or approve' },
  { key: 'contributor', label: 'Contributor', hint: 'View, create and edit on every tab — no delete, approve or settings' },
  { key: 'full', label: 'Full access', hint: 'Every tab and every action, including approvals and settings' },
]

/** Concrete ids for ONE grant list — the client mirror of the backend's
 * permission_registry.expand_grants, including features: a tab's features
 * follow the tab (their `inherit` action) until the list holds any
 * `module:tab.feature:…` id for that tab. */
export function expandGrants(registry: PermissionRegistry, grants: Iterable<string>): Set<string> {
  const out = new Set<string>()
  const customised = new Set<string>()
  for (const g of grants) {
    const [mk, tk, a] = g.split(':')
    const mod = registry.modules[mk]
    if (!mod || !tk || !a) continue
    if (tk === '*') {
      for (const [tab, acts] of Object.entries(mod.actions)) {
        for (const x of acts) if (a === '*' || x === a) out.add(`${mk}:${tab}:${x}`)
      }
      for (const [tab, feats] of Object.entries(mod.features || {})) {
        // Explicit-only feature actions (inherit null) never come from a wildcard / preset.
        for (const [fk, f] of Object.entries(feats)) for (const x of f.actions) if ((a === '*' || x === a) && f.inherit[x] != null) out.add(`${mk}:${tab}.${fk}:${x}`)
      }
    } else if (tk.includes('.')) {
      const [tab, fk] = tk.split('.')
      customised.add(`${mk}:${tab}`)
      if (mod.features?.[tab]?.[fk]?.actions.includes(a)) {
        out.add(g)
        out.add(`${mk}:${tk}:view`)
        out.add(`${mk}:${tab}:view`)
      }
    } else if (mod.actions[tk]?.includes(a)) {
      out.add(g)
      out.add(`${mk}:${tk}:view`) // any action on a tab implies seeing it (matches the backend)
    }
  }
  // Inherit: an uncustomised tab's features follow the tab's own actions.
  for (const [mk, mod] of Object.entries(registry.modules)) {
    for (const [tab, feats] of Object.entries(mod.features || {})) {
      if (customised.has(`${mk}:${tab}`) || !out.has(`${mk}:${tab}:view`)) continue
      for (const [fk, f] of Object.entries(feats)) {
        for (const [act, legacy] of Object.entries(f.inherit)) {
          if (legacy != null && out.has(`${mk}:${tab}:${legacy}`)) { out.add(`${mk}:${tab}.${fk}:${act}`); out.add(`${mk}:${tab}.${fk}:view`) }
        }
      }
    }
  }
  return out
}

/** Whether a grant list holds any explicit feature id under this tab. */
export function isTabCustomised(grants: Iterable<string>, moduleKey: string, tabKey: string): boolean {
  const prefix = `${moduleKey}:${tabKey}.`
  for (const g of grants) if (g.startsWith(prefix)) return true
  return false
}

function presetGrants(moduleKey: string, preset: Preset): string[] {
  if (preset === 'full') return [`${moduleKey}:*:*`]
  if (preset === 'view') return [`${moduleKey}:*:view`]
  if (preset === 'contributor') return [`${moduleKey}:*:view`, `${moduleKey}:*:create`, `${moduleKey}:*:edit`]
  return []
}

interface Props {
  registry: PermissionRegistry
  value: string[]
  onChange?: (next: string[]) => void
  readOnly?: boolean
  inherited?: Record<string, string[]>
  /** Only show modules with at least one grant (read-only summaries). */
  onlyGranted?: boolean
  assigneeRules?: Record<string, AssigneeRule>
  onAssigneeRulesChange?: (next: Record<string, AssigneeRule>) => void
  assigneeOptions?: { departments: AssigneeOption[]; roles: AssigneeOption[]; users: AssigneeOption[] }
}

export default function PermissionMatrixEditor({ registry, value, onChange, readOnly, inherited, onlyGranted, assigneeRules, onAssigneeRulesChange, assigneeOptions }: Props) {
  const [query, setQuery] = useState('')
  const [ruleKey, setRuleKey] = useState<string | null>(null)
  const pickers = assigneeRules ? registry.assignee_rules?.pickers || {} : {}
  const ruleModes = registry.assignee_rules?.modes || {}
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [openFeatures, setOpenFeatures] = useState<Record<string, boolean>>({})
  const expanded = useMemo(() => expandGrants(registry, value), [registry, value])
  const inheritedSet = useMemo(() => new Set(Object.keys(inherited || {})), [inherited])
  const actions = registry.actions
  const labels = registry.action_labels || {}

  const isOn = (id: string) => expanded.has(id) || inheritedSet.has(id)

  const commit = (next: Iterable<string>) => onChange?.(Array.from(new Set(next)).sort())

  /** Concrete grants of every OTHER module + this module's grants made
   * concrete. Feature ids of tabs that still follow their tab stay implicit
   * (so they keep following it) — except `featureTab`, the tab whose feature
   * is being changed now, which becomes customised with its current values. */
  const concretize = (moduleKey: string, featureTab?: string): Set<string> => {
    const keep = value.filter((g) => !g.startsWith(`${moduleKey}:`))
    const mine = Array.from(expanded).filter((g) => {
      if (!g.startsWith(`${moduleKey}:`)) return false
      const tk = g.split(':')[1]
      if (!tk.includes('.')) return true
      const tab = tk.split('.')[0]
      return tab === featureTab || isTabCustomised(value, moduleKey, tab)
    })
    return new Set([...keep, ...mine])
  }

  const toggle = (moduleKey: string, id: string) => {
    if (readOnly) return
    const [mk, tk] = id.split(':')
    const isFeature = tk.includes('.')
    const tab = tk.split('.')[0]
    const next = concretize(moduleKey, isFeature ? tab : undefined)
    if (next.has(id)) {
      next.delete(id)
      // Removing view removes every action on it — no "edit without view";
      // removing a tab's view also removes its features.
      if (id.endsWith(':view')) {
        const prefix = id.slice(0, -'view'.length)
        Array.from(next).forEach((g) => { if (g.startsWith(prefix) || (!isFeature && g.startsWith(`${mk}:${tk}.`))) next.delete(g) })
      }
      // Unticking the last feature id must not silently re-enable inheritance.
    } else {
      next.add(id)
      // Any action implies seeing it (and a feature implies seeing its tab).
      next.add(`${mk}:${tk}:view`)
      if (isFeature) next.add(`${mk}:${tab}:view`)
    }
    if (isFeature) {
      // A customised tab with no feature left keeps a "customised, none" marker.
      const marker = `${mk}:${tab}.*:none`
      next.delete(marker)
      if (!isTabCustomised(next, mk, tab)) next.add(marker)
    }
    commit(next)
  }

  /** Back to "features follow the tab" for one tab. */
  const resetFeatures = (moduleKey: string, tabKey: string) => {
    if (readOnly) return
    commit(value.filter((g) => !g.startsWith(`${moduleKey}:${tabKey}.`)))
  }

  const toggleRow = (moduleKey: string, tabKey: string) => {
    if (readOnly) return
    const ids = (registry.modules[moduleKey].actions[tabKey] || []).map((a) => `${moduleKey}:${tabKey}:${a}`)
    const next = concretize(moduleKey)
    const allOn = ids.every((id) => next.has(id))
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)))
    commit(next)
  }

  const applyPreset = (moduleKey: string, preset: Preset) => {
    if (readOnly) return
    const keep = value.filter((g) => !g.startsWith(`${moduleKey}:`))
    commit([...keep, ...presetGrants(moduleKey, preset)])
  }

  const activePreset = (moduleKey: string): Preset | null => {
    const mine = value.filter((g) => g.startsWith(`${moduleKey}:`)).sort().join('|')
    for (const p of PRESETS) if (presetGrants(moduleKey, p.key).sort().join('|') === mine) return p.key
    return null
  }

  const q = query.trim().toLowerCase()
  const modules = Object.entries(registry.modules).filter(([mk, mod]) => {
    const total = Object.values(mod.actions).reduce((n, a) => n + a.length, 0)
    if (total === 0) return false
    if (onlyGranted && !Array.from(expanded).concat(Array.from(inheritedSet)).some((g) => g.startsWith(`${mk}:`))) return false
    if (!q) return true
    return mod.label.toLowerCase().includes(q) || Object.values(mod.subtabs).some((l) => l.toLowerCase().includes(q))
      || Object.values(mod.features || {}).some((fs) => Object.values(fs).some((f) => f.label.toLowerCase().includes(q)))
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search module or tab…"
          style={{ ...inputStyle, maxWidth: 280 }} data-tour="perm-matrix-search"
        />
        <button type="button" onClick={() => setOpen(Object.fromEntries(modules.map(([mk]) => [mk, true])))} style={linkBtn}>Expand all</button>
        <button type="button" onClick={() => setOpen({})} style={linkBtn}>Collapse all</button>
      </div>
      {modules.length === 0 && <p style={{ fontSize: 12.5, color: TEXT.muted }}>{onlyGranted ? 'No permissions.' : 'No module matches your search.'}</p>}

      {modules.map(([moduleKey, mod], idx) => {
        const all = [
          ...Object.entries(mod.actions).flatMap(([tk, acts]) => acts.map((a) => `${moduleKey}:${tk}:${a}`)),
          ...Object.entries(mod.features || {}).flatMap(([tk, feats]) => Object.entries(feats).flatMap(([fk, f]) => f.actions.map((a) => `${moduleKey}:${tk}.${fk}:${a}`))),
        ]
        const granted = all.filter(isOn).length
        const preset = activePreset(moduleKey)
        const isOpen = !!open[moduleKey] || !!q
        const tabs = Object.keys(mod.subtabs)
        return (
          <div key={moduleKey} data-tour={idx === 0 ? 'perm-matrix-module' : undefined}
            style={{ marginBottom: 12, borderRadius: 12, border: `1px solid ${BORDER.normal}`, overflow: 'hidden', background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(244,113,59,0.06)', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [moduleKey]: !isOpen }))}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <span style={{ fontSize: 11, color: TEXT.muted, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{mod.label}</span>
                <span style={{ ...pillStyle(granted ? '#047857' : '#64748b'), fontWeight: 600 }}>
                  {granted === 0 ? 'No access' : granted === all.length ? 'Full' : `${granted} / ${all.length}`}
                </span>
              </button>
              {!readOnly && (
                <div data-tour={idx === 0 ? 'perm-matrix-presets' : undefined} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PRESETS.map((p) => (
                    <button key={p.key} type="button" title={p.hint} onClick={() => applyPreset(moduleKey, p.key)}
                      style={chipBtnStyle(preset === p.key)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isOpen && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                      <th style={th('left')}>Tab <RowCount count={tabs.length} /></th>
                      {actions.map((a) => <th key={a} style={th('center')}>{labels[a] || a}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {tabs.map((tabKey, i) => {
                      const group = mod.groups?.[tabKey]
                      const prevGroup = i > 0 ? mod.groups?.[tabs[i - 1]] : undefined
                      const tabActions = mod.actions[tabKey] || []
                      const feats = Object.entries(mod.features?.[tabKey] || {})
                      const fKey = `${moduleKey}:${tabKey}`
                      const featsOpen = !!openFeatures[fKey] || (!!q && feats.some(([, f]) => f.label.toLowerCase().includes(q)))
                      const customisedTab = isTabCustomised(value, moduleKey, tabKey)
                      return [
                        group && group !== prevGroup ? (
                          <tr key={`${tabKey}-group`} style={{ borderTop: `1px solid ${BORDER.normal}`, background: 'rgba(0,0,0,0.015)' }}>
                            <td colSpan={actions.length + 1} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>{group}</td>
                          </tr>
                        ) : null,
                        <tr key={tabKey} style={{ borderTop: `1px solid ${BORDER.normal}` }}>
                          <td style={{ padding: '8px 14px', paddingLeft: group ? 28 : 14, fontSize: 12.5, color: TEXT.body }}>
                            {readOnly ? mod.subtabs[tabKey] : (
                              <span style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => toggleRow(moduleKey, tabKey)} title="Tick / untick every action on this tab">
                                {mod.subtabs[tabKey]}
                              </span>
                            )}
                            {feats.length > 0 && (
                              <button type="button" onClick={() => setOpenFeatures((o) => ({ ...o, [fKey]: !featsOpen }))}
                                title="Sub-tabs, sections and actions inside this tab"
                                style={{ ...smallSecondaryBtnStyle, marginLeft: 8, color: BRAND.primaryActive, background: 'rgba(244,113,59,0.08)', border: '1px solid transparent' }}>
                                {featsOpen ? '▾' : '▸'} {feats.length} feature{feats.length === 1 ? '' : 's'}{customisedTab ? ' · customised' : ''}
                              </button>
                            )}
                          </td>
                          {actions.map((a) => {
                            if (!tabActions.includes(a)) {
                              return <td key={a} style={{ textAlign: 'center', color: '#d4d4d8', fontSize: 12 }}>—</td>
                            }
                            const id = `${moduleKey}:${tabKey}:${a}`
                            const from = inherited?.[id]
                            return (
                              <td key={a} style={{ padding: 6, textAlign: 'center' }} title={from ? `From: ${from.join(', ')}` : undefined}>
                                <div style={{ display: 'inline-flex', opacity: from && !expanded.has(id) ? 0.55 : 1 }}>
                                  <Checkbox checked={isOn(id)} disabled={readOnly || (!!from && !expanded.has(id))} onChange={() => toggle(moduleKey, id)} />
                                </div>
                              </td>
                            )
                          })}
                        </tr>,
                        featsOpen && feats.length > 0 ? (
                          <tr key={`${tabKey}-features-head`} style={{ background: 'rgba(37,99,235,0.03)' }}>
                            <td colSpan={actions.length + 1} style={{ padding: '6px 14px', paddingLeft: group ? 44 : 30, fontSize: 11.5, color: TEXT.muted }}>
                              {customisedTab
                                ? <>Customised for this role — only the ticks below count.{!readOnly && <> <button type="button" onClick={() => resetFeatures(moduleKey, tabKey)} style={linkBtn}>Reset to follow the tab</button></>}</>
                                : <>Following the tab: each feature gets the tab action shown on hover. Tick or untick one to customise.</>}
                            </td>
                          </tr>
                        ) : null,
                        ...(featsOpen ? feats.map(([fk, f]) => (
                          <tr key={`${tabKey}.${fk}`} style={{ borderTop: `1px dashed ${BORDER.normal}`, background: 'rgba(37,99,235,0.02)' }}>
                            <td style={{ padding: '6px 14px', paddingLeft: group ? 44 : 30, fontSize: 12.5, color: TEXT.body }} title={f.hint || undefined}>
                              <span style={{ color: TEXT.muted, marginRight: 6 }}>↳</span>{f.label}
                              <span style={{ ...pillStyle(f.kind === 'sensitive' ? '#b91c1c' : '#64748b'), marginLeft: 6, fontSize: 10, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                                {mod.feature_kinds?.[f.kind] || f.kind}
                              </span>
                              {pickers[`${moduleKey}:${tabKey}.${fk}`] && (
                                <button type="button" onClick={() => setRuleKey(`${moduleKey}:${tabKey}.${fk}`)} data-tour="perm-matrix-assignee-rule"
                                  title={pickers[`${moduleKey}:${tabKey}.${fk}`].hint}
                                  style={{ ...smallSecondaryBtnStyle, marginLeft: 8,
                                    border: `1px solid ${assigneeRules?.[`${moduleKey}:${tabKey}.${fk}`] ? BRAND.primary : BORDER.normal}`,
                                    background: assigneeRules?.[`${moduleKey}:${tabKey}.${fk}`] ? 'rgba(244,113,59,0.08)' : '#fff',
                                    color: assigneeRules?.[`${moduleKey}:${tabKey}.${fk}`] ? BRAND.primaryActive : TEXT.secondary }}>
                                  {pickers[`${moduleKey}:${tabKey}.${fk}`].label}: {describeRule(assigneeRules?.[`${moduleKey}:${tabKey}.${fk}`], ruleModes)} ▾
                                </button>
                              )}
                            </td>
                            {actions.map((a) => {
                              if (!f.actions.includes(a)) return <td key={a} style={{ textAlign: 'center', color: '#d4d4d8', fontSize: 12 }}>—</td>
                              const id = `${moduleKey}:${tabKey}.${fk}:${a}`
                              const from = inherited?.[id]
                              const followsTab = !customisedTab && expanded.has(id)
                              const legacy = f.inherit[a]
                              const tip = from ? `From: ${from.join(', ')}` : legacy == null ? 'Given only when ticked — no preset or tab gives it' : !customisedTab ? `Follows the tab's ${labels[legacy] || legacy}` : undefined
                              return (
                                <td key={a} style={{ padding: 6, textAlign: 'center' }} title={tip}>
                                  <div style={{ display: 'inline-flex', opacity: (from && !expanded.has(id)) || followsTab ? 0.55 : 1 }}>
                                    <Checkbox checked={isOn(id)} disabled={readOnly || (!!from && !expanded.has(id))} onChange={() => toggle(moduleKey, id)} />
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        )) : []),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
      {ruleKey && pickers[ruleKey] && (
        <AssigneeRuleDialog
          open title={pickers[ruleKey].label} hint={pickers[ruleKey].hint}
          rule={assigneeRules?.[ruleKey] || null} modes={ruleModes} readOnly={readOnly || !onAssigneeRulesChange}
          departments={assigneeOptions?.departments || []} roles={assigneeOptions?.roles || []} users={assigneeOptions?.users || []}
          onClose={() => setRuleKey(null)}
          onSave={(rule) => {
            const next = { ...(assigneeRules || {}) }
            if (rule) next[ruleKey] = rule
            else delete next[ruleKey]
            onAssigneeRulesChange?.(next)
            setRuleKey(null)
          }}
        />
      )}
    </div>
  )
}

const linkBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }

function th(align: 'left' | 'center'): React.CSSProperties {
  return { textAlign: align, padding: '8px 6px', paddingLeft: align === 'left' ? 14 : 6, fontSize: 10.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }
}
