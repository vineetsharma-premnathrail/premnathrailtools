'use client'

import Select from '@/components/shared/Select'
import type { DimensionDef } from '@/lib/reports/types'

/** "Group by" and "Then by": two shared Selects. Dimensions about people are left out by the server when the viewer may not see them. */
export default function GroupBySelect({ dims, groupBy, groupBy2, onChange, tour }: {
  dims: DimensionDef[]
  groupBy: string
  groupBy2: string
  onChange: (g1: string, g2: string) => void
  tour?: string
}) {
  const second = dims.filter((d) => d.key !== groupBy)
  return (
    <>
      <Select value={groupBy} onChange={(e) => onChange(e.target.value, e.target.value === groupBy2 ? '' : groupBy2)} aria-label="Group by" title="Group the rows by this field" data-tour={tour} style={{ minWidth: 190 }}>
        <option value="">Group by: none (totals)</option>
        {dims.map((d) => <option key={d.key} value={d.key}>{`Group by: ${d.label}`}</option>)}
      </Select>
      <Select value={groupBy ? groupBy2 : ''} onChange={(e) => onChange(groupBy, e.target.value)} disabled={!groupBy} aria-label="Then by" title={groupBy ? 'Split each group again by this field' : 'Pick a Group by first'} style={{ minWidth: 190 }}>
        <option value="">Then by: none</option>
        {second.map((d) => <option key={d.key} value={d.key}>{`Then by: ${d.label}`}</option>)}
      </Select>
    </>
  )
}
