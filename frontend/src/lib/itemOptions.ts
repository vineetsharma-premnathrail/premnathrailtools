/** Second line shown under an Item Master item in a dropdown, so the right
 *  item can be told apart (many share a name) before it is picked. */
export function itemOptionDetail(i: {
  make?: string | null
  part_number?: string | null
  manufacturer_part_number?: string | null
  specification?: string | null
  description?: string | null
}): string | undefined {
  const parts = [
    i.make ? `Make: ${i.make}` : '',
    i.part_number || i.manufacturer_part_number ? `Part no.: ${i.part_number || i.manufacturer_part_number}` : '',
    i.specification || i.description || '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
