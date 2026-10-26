'use client'

import { useState } from 'react'
import Checkbox from '@/components/Checkbox'
import DateField from '@/components/erp/DateField'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetLabel } from '@/components/shared/FormSheet'
import { chipBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { fmtDmy, resolvePreset } from '@/lib/reports/dates'

const CHIPS = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' }, { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_fy', label: 'This financial year' }, { key: 'last_30_days', label: 'Last 30 days' },
]

/** One bar: period chips + custom range, "compare with previous period", Clear filters. A snapshot page ("as of today") has no period. */
export default function DashboardTopBar({ preset, from, to, compare, snapshot, canClear, onPeriod, onCompare, onClear, tour }: {
  preset: string; from: string; to: string; compare: boolean; snapshot: boolean; canClear: boolean
  onPeriod: (p: { preset: string; from: string; to: string }) => void
  onCompare: (v: boolean) => void
  onClear: () => void
  tour?: string
}) {
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [error, setError] = useState('')
  const apply = () => {
    if (!custom) return
    if (!custom.from || !custom.to) { setError('Pick both a From and a To date.'); return }
    if (custom.from > custom.to) { setError(`'From' date ${fmtDmy(custom.from)} is after 'To' date ${fmtDmy(custom.to)} - swap them.`); return }
    onPeriod({ preset: 'custom', ...custom })
    setCustom(null)
    setError('')
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <div data-tour={tour} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }} role="group" aria-label="Period">
        {snapshot ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#57534e' }}>As of today</span>
        ) : (
          <>
            {CHIPS.map((c) => (
              <button key={c.key} type="button" aria-pressed={preset === c.key} style={chipBtnStyle(preset === c.key)}
                onClick={() => { const r = resolvePreset(c.key); if (r) onPeriod({ preset: c.key, ...r }) }}>{c.label}</button>
            ))}
            <button type="button" aria-pressed={preset === 'custom'} style={chipBtnStyle(preset === 'custom')} onClick={() => { setError(''); setCustom({ from, to }) }}>
              {preset === 'custom' ? `${fmtDmy(from)} – ${fmtDmy(to)}` : 'Custom dates'}
            </button>
          </>
        )}
      </div>
      {!snapshot && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#57534e', cursor: 'pointer', marginLeft: 6 }}>
          <Checkbox asSwitch checked={compare} onChange={(e) => onCompare(e.target.checked)} />
          Compare with previous period
        </label>
      )}
      {canClear && <button type="button" onClick={onClear} style={{ ...secondaryBtnStyle, marginLeft: 'auto' }}>Clear filters</button>}
      {custom && (
        <FormSheet icon="calendar" title="Custom dates" subtitle="Both dates are included." width={460} busy={false} onClose={() => setCustom(null)}
          footer={<>
            <button type="button" onClick={() => setCustom(null)} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
            <button type="button" onClick={apply} style={sheetBtn('primary', SHEET.BLUE)}><SheetIcon name="check" size={16} />Apply</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
            <div><label style={sheetLabel}>From</label><DateField value={custom.from} onChange={(v) => { setCustom((c) => c && { ...c, from: v }); setError('') }} /></div>
            <div><label style={sheetLabel}>To</label><DateField value={custom.to} onChange={(v) => { setCustom((c) => c && { ...c, to: v }); setError('') }} /></div>
            {error && <p role="alert" style={{ gridColumn: '1 / -1', fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}
          </div>
        </FormSheet>
      )}
    </div>
  )
}
