'use client'

import { useRef, useState } from 'react'
import { CalendarBlank } from '@phosphor-icons/react'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetLabel } from '@/components/shared/FormSheet'
import { secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import { fmtDmy, PRESET_FALLBACK, presetLabel, resolvePreset } from '@/lib/reports/dates'
import { useOutside } from '@/lib/reports/useOutside'
import { menuItemStyle } from '@/lib/reports/styles'

export interface PeriodValue { preset: string; from: string; to: string }

/** The period pill: "This month - 01-10-2026 to 26-10-2026". Presets open in a popover, Custom in its own small popup. */
export default function DateRangeControl({ value, presets, disabled, disabledText = 'All dates', onChange, tour }: {
  value: PeriodValue
  presets: { key: string; label: string }[]
  disabled?: boolean
  disabledText?: string
  onChange: (v: PeriodValue) => void
  tour?: string
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [error, setError] = useState('')
  const anchor = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useOutside(open, [anchor, box], () => setOpen(false))
  const list = presets.length ? presets.filter((p) => p.key !== 'custom') : PRESET_FALLBACK

  const pick = (key: string) => {
    const r = resolvePreset(key)
    if (r) onChange({ preset: key, ...r })
    setOpen(false)
  }
  const applyCustom = () => {
    if (!custom) return
    if (!custom.from || !custom.to) { setError('Pick both a From and a To date.'); return }
    if (custom.from > custom.to) { setError(`'From' date ${fmtDmy(custom.from)} is after 'To' date ${fmtDmy(custom.to)} - swap them.`); return }
    onChange({ preset: 'custom', ...custom })
    setCustom(null)
    setError('')
  }

  return (
    <>
      <button ref={anchor} type="button" disabled={disabled} data-tour={tour} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        title={disabled ? 'This report is not tied to a date, so it has no period to pick.' : 'Change the period'}
        style={{ ...secondaryBtnStyle, opacity: disabled ? 0.65 : 1, cursor: disabled ? 'not-allowed' : 'pointer', maxWidth: '100%' }}>
        <CalendarBlank size={16} />
        {disabled ? disabledText : `${presetLabel(value.preset, presets)} · ${fmtDmy(value.from)} – ${fmtDmy(value.to)}`}
      </button>
      <AnchoredPopover anchorRef={anchor} boxRef={box} open={open && !disabled} minWidth={240} maxHeight={420}>
        <div role="menu" style={{ padding: 6, display: 'flex', flexDirection: 'column' }}>
          {list.map((p) => (
            <button key={p.key} type="button" role="menuitemradio" aria-checked={value.preset === p.key} onClick={() => pick(p.key)}
              style={menuItemStyle(value.preset === p.key)}>
              {p.label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setError(''); setCustom({ from: value.from, to: value.to }) }}
            style={{ ...menuItemStyle(value.preset === 'custom'), borderTop: '1px solid #e2e8f0', borderRadius: 0, marginTop: 4 }}>
            Custom range...
          </button>
        </div>
      </AnchoredPopover>
      {custom && (
        <FormSheet icon="calendar" title="Custom period" subtitle="Both dates are included." width={460} busy={false} onClose={() => setCustom(null)}
          footer={<>
            <button type="button" onClick={() => setCustom(null)} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
            <button type="button" onClick={applyCustom} style={sheetBtn('primary', SHEET.BLUE)}><SheetIcon name="check" size={16} />Apply</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
            <div>
              <label style={sheetLabel}>From</label>
              <DateField value={custom.from} onChange={(v) => { setCustom((c) => c && { ...c, from: v }); setError('') }} />
            </div>
            <div>
              <label style={sheetLabel}>To</label>
              <DateField value={custom.to} onChange={(v) => { setCustom((c) => c && { ...c, to: v }); setError('') }} />
            </div>
            {error && <p role="alert" style={{ gridColumn: '1 / -1', fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}
          </div>
        </FormSheet>
      )}
    </>
  )
}
