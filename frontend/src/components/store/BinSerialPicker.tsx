'use client'

// Line-level WM bin + serial number picker for outbound documents (issue,
// transfer). The bin list is the store's bins; serial numbers are the item's
// units In stock at that store (and in the picked bin) — the server re-checks
// both (services/bins.py, services/serials.py).

import { useEffect, useState } from 'react'
import { storeApi, storeSerialsApi } from '@/lib/api'
import { TEXT, BORDER } from '@/lib/theme'
import Select from '@/components/shared/Select'
import { pillStyle } from '@/components/shared/ui'

type Bin = { id: number; code: string; name?: string | null; is_active?: boolean }

const cache = new Map<number, Promise<Bin[]>>()
function binsOf(locationId: number) {
  if (!cache.has(locationId)) cache.set(locationId, storeApi.listBins(locationId).then((b: Bin[]) => b.filter((x) => x.is_active !== false)).catch(() => []))
  return cache.get(locationId)!
}

export default function BinSerialPicker({
  locationId, itemId, serialised, quantity, binId, serials, onChange,
}: {
  locationId: number
  itemId: number
  serialised: boolean
  quantity: number
  binId: string
  serials: string[]
  onChange: (patch: { binId?: string; serials?: string[] }) => void
}) {
  const [bins, setBins] = useState<Bin[]>([])
  const [units, setUnits] = useState<{ id: number; serial_no: string }[]>([])
  useEffect(() => { binsOf(locationId).then(setBins) }, [locationId])
  useEffect(() => {
    if (!serialised) { setUnits([]); return }
    storeSerialsApi.available({ item_id: itemId, location_id: locationId, bin_id: binId ? Number(binId) : undefined })
      .then(setUnits).catch(() => setUnits([]))
  }, [serialised, itemId, locationId, binId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {bins.length > 0 && (
        <Select value={binId} onChange={(e) => onChange({ binId: e.target.value, serials: [] })}
          style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${BORDER.normal}`, fontSize: 12.5, background: 'rgba(255,255,255,.7)' }}>
          <option value="">Bin: unassigned</option>
          {bins.map((b) => <option key={b.id} value={b.id}>Bin {b.code}{b.name ? ` — ${b.name}` : ''}</option>)}
        </Select>
      )}
      {serialised && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: serials.length === quantity ? '#15803d' : '#b45309' }}>
            Serial no. — pick {quantity || 0} ({serials.length} picked)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, maxWidth: 260 }}>
            {units.length === 0 && <span style={{ fontSize: 11.5, color: TEXT.muted }}>No units in stock here</span>}
            {units.map((u) => {
              const on = serials.includes(u.serial_no)
              return (
                <button type="button" key={u.id} aria-pressed={on} onClick={() => onChange({ serials: on ? serials.filter((s) => s !== u.serial_no) : [...serials, u.serial_no] })}
                  style={{ ...pillStyle(on ? '#15803d' : '#57534e'), border: 'none', cursor: 'pointer' }}>
                  {u.serial_no}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
