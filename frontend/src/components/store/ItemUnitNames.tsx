'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { StoreItemUnitName } from '@/types'
import { Optional, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

type Unit = { id: number; name: string; code: string }

/** Item Master: the item's own name at each unit / plant (owner, 2026-11-07).
 *  Item Name is the name as on the vendor's invoice; here each unit keeps what
 *  it calls the item inside. One box per unit, blanks are not saved. */
export default function ItemUnitNames({ value, onChange, disabled = false }: {
  value: StoreItemUnitName[]
  onChange: (next: StoreItemUnitName[]) => void
  disabled?: boolean
}) {
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    apiClient.get('/store/items/units')
      .then(({ data }) => setUnits(data))
      .catch(() => { setUnits([]); setLoadError('The unit list could not be loaded — refresh the page to enter unit-wise names.') })
  }, [])

  const nameAt = (id: number) => value.find((u) => u.branch_id === id)?.name ?? ''
  const setNameAt = (id: number, name: string) =>
    onChange([...value.filter((u) => u.branch_id !== id), { branch_id: id, name }].sort((a, b) => a.branch_id - b.branch_id))

  if (units === null) return null
  if (!units.length) {
    return loadError ? <p style={sheetHint}>{loadError}</p> : null
  }
  return (
    <div data-tour="item-unit-names" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
      {units.map((u) => (
        <div key={u.id} style={{ flex: '1 1 200px', minWidth: 180 }}>
          <label style={sheetLabel} htmlFor={`item-unit-name-${u.id}`}>Name at {u.name} <Optional /></label>
          <input id={`item-unit-name-${u.id}`} style={sheetInput} value={nameAt(u.id)} maxLength={200} disabled={disabled}
            onChange={(e) => setNameAt(u.id, e.target.value)} placeholder={`What ${u.name} calls this item`} />
        </div>
      ))}
      <p style={{ ...sheetHint, flexBasis: '100%', margin: 0 }}>
        Item Name above is the name as on the vendor&apos;s invoice. Each unit can keep its own name — both can be typed in any item search.
      </p>
    </div>
  )
}
