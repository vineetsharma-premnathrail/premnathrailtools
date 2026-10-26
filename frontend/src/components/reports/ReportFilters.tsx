'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Funnel, X } from '@phosphor-icons/react'
import Select from '@/components/shared/Select'
import Checkbox from '@/components/Checkbox'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { reportsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { chipStyle } from '@/lib/reports/styles'
import { tokenLabel } from '@/lib/reports/format'
import type { FilterDef } from '@/lib/reports/types'

type Values = Record<string, string[]>

// value -> label for looked-up people / customers / machines, so chips show names, not ids.
const labelCache = new Map<string, string>()
export const rememberLabel = (filter: string, value: string, label: string) => { labelCache.set(`${filter}|${value}`, label) }
export const labelOf = (filter: string, value: string, opts?: { value: string; label: string }[] | null) =>
  opts?.find((o) => o.value === value)?.label || labelCache.get(`${filter}|${value}`) || tokenLabel(value)

/** Funnel button with the active-filter count badge (the look of the registry pages). */
export function FiltersButton({ count, onOpen, tour }: { count: number; onOpen: () => void; tour?: string }) {
  return (
    <button type="button" onClick={onOpen} data-tour={tour} aria-label="Filters" title="Filters"
      style={{ ...secondaryBtnStyle, ...(count ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
      <Funnel size={16} weight={count ? 'fill' : 'regular'} />
      Filters
      {count > 0 && <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>}
    </button>
  )
}

function Chips({ items, onRemove }: { items: { value: string; label: string }[]; onRemove: (v: string) => void }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {items.map((it) => (
        <span key={it.value} style={chipStyle}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
          <button type="button" aria-label={`Remove ${it.label}`} onClick={() => onRemove(it.value)}
            style={{ width: 20, height: 20, borderRadius: 10, border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={12} weight="bold" />
          </button>
        </span>
      ))}
    </div>
  )
}

/** Type to search the scoped list (people / customers / machines), click to add; several can be chosen. */
function LookupPicker({ module, report, def, value, onChange }: {
  module: string; report: string; def: FilterDef; value: string[]; onChange: (v: string[]) => void
}) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const my = ++seq.current
    const t = setTimeout(() => {
      setLoading(true)
      setError('')
      reportsApi.options(module, report, def.key, q.trim())
        .then((r) => { if (my === seq.current) { r.forEach((o) => rememberLabel(def.key, o.value, o.label)); setOpts(r) } })
        .catch((err) => { if (my === seq.current) setError(extractErrorMessages(err, `The ${def.label.toLowerCase()} list could not be loaded - close and reopen Filters to try again.`).join(' ')) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [module, report, def.key, def.label, q])

  const shown = opts.filter((o) => !value.includes(o.value))
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${def.label.toLowerCase()}...`} aria-label={`Search ${def.label}`} style={sheetInput} />
      <div style={{ marginTop: 6, maxHeight: 132, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
        {loading && <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', padding: 10 }}>Loading...</p>}
        {!loading && error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: '#b91c1c', padding: 10 }}>{error}</p>}
        {!loading && !error && shown.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', padding: 10 }}>{q ? 'Nothing matches - check the spelling.' : 'No more choices in your data.'}</p>}
        {!loading && !error && shown.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange([...value, o.value])}
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#334155', fontSize: 13, minHeight: 32, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ paddingLeft: 10 }}>{o.label}</span>
          </button>
        ))}
      </div>
      <Chips items={value.map((v) => ({ value: v, label: labelOf(def.key, v, opts) }))} onRemove={(v) => onChange(value.filter((x) => x !== v))} />
    </div>
  )
}

function FilterField({ module, report, def, value, onChange }: {
  module: string; report: string; def: FilterDef; value: string[]; onChange: (v: string[]) => void
}) {
  switch (def.type) {
    case 'select':
      return (
        <Select value={value[0] || ''} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])} style={sheetInput} aria-label={def.label}>
          <option value="">Any</option>
          {(def.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
    case 'multi_select': {
      const left = (def.options || []).filter((o) => !value.includes(o.value))
      return (
        <div>
          <Select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} style={sheetInput} placeholder={value.length ? 'Add another...' : 'Any'} aria-label={def.label}>
            <option value="">{value.length ? 'Add another...' : 'Any'}</option>
            {left.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Chips items={value.map((v) => ({ value: v, label: labelOf(def.key, v, def.options) }))} onRemove={(v) => onChange(value.filter((x) => x !== v))} />
        </div>
      )
    }
    case 'user':
    case 'entity':
      return <LookupPicker module={module} report={report} def={def} value={value} onChange={onChange} />
    case 'bool':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 38, fontSize: 13.5, color: SHEET.BODY, cursor: 'pointer' }}>
          <Checkbox checked={value[0] === '1'} onChange={(e) => onChange(e.target.checked ? ['1'] : [])} />
          Only these
        </label>
      )
    case 'int':
      return <input type="number" inputMode="numeric" min={0} value={value[0] || ''} onChange={(e) => onChange(e.target.value === '' ? [] : [e.target.value])} style={sheetInput} aria-label={def.label} />
    default:
      return <input value={value[0] || ''} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])} style={sheetInput} aria-label={def.label} />
  }
}

/** The Filters button and its popup: edits a draft, Apply copies it into the live filters. */
export default function ReportFilters({ module, report, defs, value, locked, onApply, tour }: {
  module: string
  report: string
  defs: FilterDef[]
  value: Values
  locked: Record<string, string>
  onApply: (v: Values) => void
  tour?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Values>({})
  const lockedKeys = useMemo(() => new Set(Object.keys(locked)), [locked])
  const count = Object.entries(value).filter(([k, v]) => v.length && !lockedKeys.has(k)).length

  const groups = useMemo(() => {
    const out: { name: string; items: FilterDef[] }[] = []
    for (const d of defs) {
      if (lockedKeys.has(d.key)) continue
      const name = d.group || ''
      let g = out.find((x) => x.name === name)
      if (!g) { g = { name, items: [] }; out.push(g) }
      g.items.push(d)
    }
    return out
  }, [defs, lockedKeys])

  const openIt = () => { setDraft(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, [...v]]))); setOpen(true) }
  const clean = (v: Values): Values => Object.fromEntries(Object.entries(v).filter(([, a]) => a.length))
  const keepLocked = (v: Values): Values => ({ ...v, ...Object.fromEntries(Object.entries(locked).map(([k, x]) => [k, x.split(',')])) })
  const apply = () => { onApply(keepLocked(clean(draft))); setOpen(false) }
  const clear = () => { onApply(keepLocked({})); setOpen(false) }

  return (
    <>
      <FiltersButton count={count} onOpen={openIt} tour={tour} />
      {open && (
        <FormSheet icon="search" title="Filters" subtitle="All conditions must match. Several values inside one filter mean any of them." width={560} busy={false} onClose={() => setOpen(false)} tour={tour ? `${tour}-sheet` : undefined}
          footer={<>
            <button type="button" onClick={clear} style={sheetBtn('secondary', SHEET.INK)}>Clear Filters</button>
            <button type="button" onClick={apply} style={sheetBtn('primary', SHEET.BLUE)}><SheetIcon name="check" size={16} />Apply Filters</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {groups.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: SHEET.MUTED }}>This report has no filters you can change.</p>}
            {groups.map((g) => (
              <div key={g.name || 'all'}>
                {g.name && <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: SHEET.MUTED, margin: '0 0 10px' }}>{g.name}</p>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
                  {g.items.filter((d) => !(d.key.endsWith('_max') && defs.some((x) => x.key === `${d.key.slice(0, -4)}_min`))).map((d) => {
                    // Paired whole-number filters (x_min / x_max) read as one From / To field.
                    const maxDef = d.key.endsWith('_min') ? defs.find((x) => x.key === `${d.key.slice(0, -4)}_max`) : undefined
                    if (maxDef) {
                      const title = d.label.replace(/\s*(from|min(imum)?)/i, '').trim() || d.label
                      return (
                        <div key={d.key} style={{ minWidth: 0 }}>
                          <label style={sheetLabel}>{title}</label>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
                            <input type="number" inputMode="numeric" min={0} placeholder="From" aria-label={`${title} from`} style={sheetInput} value={draft[d.key]?.[0] || ''}
                              onChange={(e) => setDraft((x) => ({ ...x, [d.key]: e.target.value === '' ? [] : [e.target.value] }))} />
                            <input type="number" inputMode="numeric" min={0} placeholder="To" aria-label={`${title} to`} style={sheetInput} value={draft[maxDef.key]?.[0] || ''}
                              onChange={(e) => setDraft((x) => ({ ...x, [maxDef.key]: e.target.value === '' ? [] : [e.target.value] }))} />
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div key={d.key} style={{ minWidth: 0, ...(d.type === 'user' || d.type === 'entity' ? { gridColumn: '1 / -1' } : {}) }}>
                        <label style={sheetLabel}>{d.label}</label>
                        <FilterField module={module} report={report} def={d} value={draft[d.key] || []} onChange={(v) => setDraft((x) => ({ ...x, [d.key]: v }))} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </FormSheet>
      )}
    </>
  )
}
