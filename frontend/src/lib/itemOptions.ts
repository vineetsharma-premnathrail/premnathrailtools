/** Second line shown under an Item Master item in a dropdown, so the right
 *  item can be told apart (many share a name) before it is picked. Category
 *  leads it, then each unit's own name, so "category name technical-details"
 *  (or a unit's name) can be typed in one go. */
export function itemOptionDetail(i: {
  category?: string | null
  unit_names?: { name: string; unit?: string | null }[] | null
  make?: string | null
  part_number?: string | null
  manufacturer_part_number?: string | null
  specification?: string | null
  description?: string | null
}): string | undefined {
  const parts = [
    i.category || '',
    ...(i.unit_names || []).map((u) => `${u.unit || 'Unit'}: ${u.name}`),
    i.make ? `Make: ${i.make}` : '',
    i.part_number || i.manufacturer_part_number ? `Part no.: ${i.part_number || i.manufacturer_part_number}` : '',
    i.specification || i.description || '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
