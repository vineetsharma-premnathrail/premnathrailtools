'use client'

import SearchableSelect from '@/components/erp/SearchableSelect'
import { StoreItemCategory } from '@/types'

/** Category dropdown for the picked item type — pick only. Categories are
 *  master data, managed under Store → Settings → Categories. Items store the
 *  category by name. */
export default function CategorySelect({
  itemType,
  value,
  onChange,
  categories,
}: {
  itemType: string
  value: string
  onChange: (v: string) => void
  categories: StoreItemCategory[]
}) {
  if (!itemType) {
    return <SearchableSelect value="" onChange={() => {}} options={[]} placeholder="Pick an item type first" disabled />
  }

  const cats = categories.filter((c) => !c.parent_id && c.item_type === itemType)
  const options = [{ value: '', label: '— None —' }, ...cats.map((c) => ({ value: c.name, label: c.name }))]
  if (value && !cats.some((c) => c.name === value)) options.push({ value, label: value })

  return <SearchableSelect value={value} onChange={onChange} options={options}
    placeholder={cats.length ? 'Select category…' : 'No categories for this type — add one in Settings'} />
}
