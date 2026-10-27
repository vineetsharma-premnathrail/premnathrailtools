'use client'

import { useEffect, useRef, useState } from 'react'
import { FunnelSimple } from '@phosphor-icons/react'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'

export interface FilterField {
  key: string
  label: string
  value: string
  /** The empty-value option is added for you ("All"). */
  options: { value: string; label: string }[]
  /** Label of the empty choice; default "All". */
  allLabel?: string
  /** Value that counts as "no filter" for the badge; default ''. */
  defaultValue?: string
}

/**
 * Toolbar "Filter" button: opens a panel with one dropdown per field. The badge
 * shows how many filters are on. The page keeps the filter state (shared with
 * its column-header filters), this only renders it.
 */
export default function FilterMenu({ fields, onChange, onClear, tourId }: {
  fields: FilterField[]
  onChange: (key: string, value: string) => void
  /** Resets every field to its default. */
  onClear: () => void
  tourId?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const active = fields.filter((f) => f.value !== (f.defaultValue ?? '')).length

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (btnRef.current?.contains(t) || boxRef.current?.contains(t)) return
      // A dropdown list opened from inside the panel is portaled to <body>.
      if (t.closest?.('.ui-select-list')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.ui-select-list')) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-tour={tourId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...(active ? { borderColor: '#ff7a45', color: '#c2410c' } : {}) }}
      >
        <FunnelSimple size={15} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
        Filter
        {active > 0 && (
          <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ff7a45', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{active}</span>
        )}
      </button>
      <AnchoredPopover anchorRef={btnRef} open={open} align="right" minWidth={300} maxHeight={520} boxRef={boxRef}>
        <div role="dialog" aria-label="Filters" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f) => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#57534e' }}>
              {f.label}
              <SearchableSelect
                value={f.value}
                onChange={(v) => onChange(f.key, v)}
                options={[{ value: f.defaultValue ?? '', label: f.allLabel ?? 'All' }, ...f.options]}
                ariaLabel={f.label}
              />
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClear} disabled={!active} style={{ ...secondaryBtnStyle, opacity: active ? 1 : 0.5 }}>Clear filters</button>
            <button type="button" onClick={() => setOpen(false)} style={secondaryBtnStyle}>Done</button>
          </div>
        </div>
      </AnchoredPopover>
    </>
  )
}
