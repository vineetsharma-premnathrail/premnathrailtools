'use client'

import { Sigma } from '@phosphor-icons/react'
import Checkbox from '@/components/Checkbox'
import PickerButton from './PickerButton'
import { textActionStyle } from '@/lib/reports/styles'
import { MAX_MEASURES } from '@/lib/reports/params'
import type { MeasureDef } from '@/lib/reports/types'

/** Choose what the summary counts / adds up: 1 to 8 measures, in the order they were ticked. */
export default function MeasuresChooser({ measures, value, defaults, onChange, tour }: {
  measures: MeasureDef[]
  value: string[]
  defaults: string[]
  onChange: (v: string[]) => void
  tour?: string
}) {
  const groups: { name: string; items: MeasureDef[] }[] = []
  for (const m of measures) {
    const name = m.group || 'Measures'
    let g = groups.find((x) => x.name === name)
    if (!g) { g = { name, items: [] }; groups.push(g) }
    g.items.push(m)
  }
  const toggle = (key: string) => {
    if (value.includes(key)) { if (value.length > 1) onChange(value.filter((k) => k !== key)) } else if (value.length < MAX_MEASURES) onChange([...value, key])
  }
  return (
    <PickerButton icon={<Sigma size={16} />} label="Measures" badge={value.length} tour={tour} minWidth={300} maxHeight={460} title="Choose the figures shown for each group">
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '0 4px 6px' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>{value.length} of {MAX_MEASURES} chosen (at least 1)</span>
          <button type="button" style={textActionStyle} onClick={() => onChange(defaults.length ? defaults : value)}>Reset</button>
        </div>
        {groups.map((g) => (
          <div key={g.name}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b', margin: '8px 4px 4px' }}>{g.name}</p>
            {g.items.map((m) => {
              const on = value.includes(m.key)
              const blocked = !on && value.length >= MAX_MEASURES
              return (
                <label key={m.key} title={blocked ? `At most ${MAX_MEASURES} measures - untick one first.` : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32, padding: '0 4px', fontSize: 13.5, color: '#334155', cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1 }}>
                  <Checkbox checked={on} disabled={blocked} onChange={() => toggle(m.key)} />
                  {m.label}
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </PickerButton>
  )
}
