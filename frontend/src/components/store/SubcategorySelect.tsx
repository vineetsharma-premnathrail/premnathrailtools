'use client'

import SearchableSelect from '@/components/erp/SearchableSelect'
import { StoreItemCategory } from '@/types'

/** Subcategory dropdown for the picked category — pick only. Subcategories
 *  are managed under Store → Settings → Categories. Items store the
 *  subcategory by name, so value/onChange are names. */
export default function SubcategorySelect({
  category,
  value,
  onChange,
  categories,
}: {
  category: StoreItemCategory | undefined
  value: string
  onChange: (v: string) => void
  categories: StoreItemCategory[]
}) {
  if (!category) {
    return <SearchableSelect value="" onChange={() => {}} options={[]} placeholder="Pick a category first" disabled />
  }

  const subs = categories.filter((c) => c.parent_id === category.id)
  const options = [{ value: '', label: '— None —' }, ...subs.map((c) => ({ value: c.name, label: c.name }))]
  if (value && !subs.some((c) => c.name === value)) options.push({ value, label: `${value} (not in list)` })

  return <SearchableSelect value={value} onChange={onChange} options={options}
    placeholder={subs.length ? 'Select subcategory…' : 'No subcategories — add one in Settings'} />
}
