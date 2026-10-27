'use client'

import Checkbox from '@/components/Checkbox'
import { secondaryBtnStyle } from '@/components/shared/ui'
import DateRangeControl from './DateRangeControl'

const PRESETS = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' }, { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_fy', label: 'This financial year' }, { key: 'last_30_days', label: 'Last 30 days' },
]

/** One bar: period dropdown (presets + custom range), "compare with previous period", Clear filters. A snapshot page ("as of today") has no period. */
export default function DashboardTopBar({ preset, from, to, compare, snapshot, canClear, onPeriod, onCompare, onClear, tour }: {
  preset: string; from: string; to: string; compare: boolean; snapshot: boolean; canClear: boolean
  onPeriod: (p: { preset: string; from: string; to: string }) => void
  onCompare: (v: boolean) => void
  onClear: () => void
  tour?: string
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {snapshot ? (
        <span data-tour={tour} style={{ fontSize: 13, fontWeight: 600, color: '#57534e' }}>As of today</span>
      ) : (
        <DateRangeControl tour={tour} value={{ preset, from, to }} presets={PRESETS} onChange={onPeriod} />
      )}
      {!snapshot && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#57534e', cursor: 'pointer', marginLeft: 6 }}>
          <Checkbox asSwitch checked={compare} onChange={(e) => onCompare(e.target.checked)} />
          Compare with previous period
        </label>
      )}
      {canClear && <button type="button" onClick={onClear} style={{ ...secondaryBtnStyle, marginLeft: 'auto' }}>Clear filters</button>}
    </div>
  )
}
