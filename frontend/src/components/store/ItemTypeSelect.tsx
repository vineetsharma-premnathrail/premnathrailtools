'use client'

import SearchableSelect from '@/components/erp/SearchableSelect'

export interface ItemTypeOption { value: string; label: string; prefix: string }

/** Item Type dropdown — pick only. Item types are master data, added/edited
 *  under Store → Settings → Item Types, not from the item form. */
export default function ItemTypeSelect({
  value,
  onChange,
  types,
}: {
  value: string
  onChange: (v: string) => void
  types: ItemTypeOption[]
}) {
  const options = types.map((t) => ({ value: t.value, label: t.label }))
  if (value && !types.some((t) => t.value === value)) options.push({ value, label: value })

  return <SearchableSelect value={value} onChange={onChange} options={options} placeholder="Select item type…" />
}
