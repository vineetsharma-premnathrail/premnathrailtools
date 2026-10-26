'use client'

import { Columns } from '@phosphor-icons/react'
import Checkbox from '@/components/Checkbox'
import PickerButton from './PickerButton'
import { textActionStyle } from '@/lib/reports/styles'
import type { ColumnDef } from '@/lib/reports/types'

/** Choose the columns of the record list. `value` null = the report's default columns. Tick order never changes the column order. */
export default function ColumnsChooser({ columns, value, onChange, allInExcel, onAllInExcel, tour }: {
  columns: ColumnDef[]
  value: string[] | null
  onChange: (v: string[] | null) => void
  allInExcel?: boolean
  onAllInExcel?: (v: boolean) => void
  tour?: string
}) {
  const defaults = columns.filter((c) => c.default).map((c) => c.key)
  const current = value && value.length ? value : defaults.length ? defaults : columns.map((c) => c.key)
  const toggle = (key: string) => {
    const has = current.includes(key)
    if (has && current.length === 1) return
    const next = columns.map((c) => c.key).filter((k) => (k === key ? !has : current.includes(k)))
    onChange(next)
  }
  return (
    <PickerButton icon={<Columns size={16} />} label="Columns" badge={current.length} tour={tour} minWidth={280} maxHeight={460} title="Choose which columns the record list shows">
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '0 4px 6px' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>{current.length} of {columns.length} shown (at least 1)</span>
          <button type="button" style={textActionStyle} onClick={() => onChange(null)}>Reset</button>
        </div>
        {columns.map((c) => (
          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32, padding: '0 4px', fontSize: 13.5, color: '#334155', cursor: 'pointer' }}>
            <Checkbox checked={current.includes(c.key)} onChange={() => toggle(c.key)} />
            {c.label}
          </label>
        ))}
        {onAllInExcel && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, padding: '6px 4px 0', marginTop: 6, borderTop: '1px solid #e2e8f0', fontSize: 13, color: '#334155', cursor: 'pointer' }}>
            <Checkbox checked={!!allInExcel} onChange={(e) => onAllInExcel(e.target.checked)} />
            Include all columns in Excel
          </label>
        )}
      </div>
    </PickerButton>
  )
}
