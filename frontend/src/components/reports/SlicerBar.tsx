'use client'

import { useEffect, useRef, useState } from 'react'
import { CaretDown, CaretUp, Funnel } from '@phosphor-icons/react'
import Checkbox from '@/components/Checkbox'
import PickerButton from './PickerButton'
import { rememberLabel } from './ReportFilters'
import { inputStyle } from '@/components/shared/ui'
import { reportsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { textActionStyle } from '@/lib/reports/styles'
import type { FilterDef } from '@/lib/reports/types'

type Opt = { value: string; label: string }

/** The searchable, multi-select list inside one slicer. People, customers and machines are searched on the server (your own data only). */
function SlicerList({ module, report, def, value, onChange }: { module: string; report: string; def: FilterDef; value: string[]; onChange: (v: string[]) => void }) {
  const lookup = def.type === 'user' || def.type === 'entity' || !!def.has_lookup
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState<Opt[]>(def.options || [])
  const [loading, setLoading] = useState(lookup)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    if (!lookup) return
    const my = ++seq.current
    const t = setTimeout(() => {
      setLoading(true)
      setError('')
      reportsApi.options(module, report, def.key, q.trim())
        .then((r) => { if (my === seq.current) { r.forEach((o) => rememberLabel(def.key, o.value, o.label)); setOpts(r) } })
        .catch((err) => { if (my === seq.current) setError(extractErrorMessages(err, `The ${def.label.toLowerCase()} list could not be loaded - close this list and open it again.`).join(' ')) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [lookup, module, report, def.key, def.label, q])

  const shown = lookup ? opts : opts.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (o: Opt) => {
    rememberLabel(def.key, o.value, o.label)
    onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])
  }
  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {(lookup || (def.options?.length || 0) > 7) && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${def.label.toLowerCase()}...`} aria-label={`Search ${def.label}`} style={inputStyle} />}
      {value.length > 0 && <button type="button" style={{ ...textActionStyle, alignSelf: 'flex-start' }} onClick={() => onChange([])}>Clear {def.label}</button>}
      {loading && <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>Loading...</p>}
      {!loading && error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: '#b91c1c' }}>{error}</p>}
      {!loading && !error && shown.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>{q ? 'Nothing matches - check the spelling.' : 'Nothing to choose from in your data.'}</p>}
      {!loading && !error && shown.map((o) => (
        <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32, fontSize: 13.5, color: '#334155', cursor: 'pointer' }}>
          <Checkbox checked={value.includes(o.value)} onChange={() => toggle(o)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/** One "Filters" button. Its popover lists every slicer; open one to search and tick values. */
export default function SlicerBar({ module, optionsReport, defs, value, onChange, tour }: {
  module: string
  /** Any report of the same data, used to look up people / customers / machines. */
  optionsReport: string
  defs: FilterDef[]
  value: Record<string, string[]>
  onChange: (key: string, v: string[]) => void
  tour?: string
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  if (!defs.length) return null
  const total = defs.reduce((n, d) => n + (value[d.key]?.length || 0), 0)
  return (
    <div data-tour={tour} style={{ display: 'flex' }} aria-label="Slicers">
      <PickerButton label="Filters" icon={<Funnel size={15} weight={total ? 'fill' : 'regular'} />} badge={total || ''} minWidth={320} maxHeight={480}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
          {total > 0 && (
            <button type="button" style={{ ...textActionStyle, alignSelf: 'flex-end', margin: '4px 12px' }} onClick={() => defs.forEach((d) => { if (value[d.key]?.length) onChange(d.key, []) })}>Clear all filters</button>
          )}
          {defs.map((d) => {
            const n = value[d.key]?.length || 0
            const isOpen = openKey === d.key
            return (
              <div key={d.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpenKey(isOpen ? null : d.key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 12px', background: isOpen ? '#f8fafc' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155', textAlign: 'left' }}>
                  <span style={{ flex: 1 }}>{d.label}</span>
                  {n > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#fff1eb', color: '#c2410c', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>}
                  {isOpen ? <CaretUp size={12} /> : <CaretDown size={12} />}
                </button>
                {isOpen && <SlicerList module={module} report={optionsReport} def={d} value={value[d.key] || []} onChange={(v) => onChange(d.key, v)} />}
              </div>
            )
          })}
        </div>
      </PickerButton>
    </div>
  )
}
