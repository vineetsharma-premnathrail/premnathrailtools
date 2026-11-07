/** Word-by-word search: every typed word (any order, extra spaces ignored)
 *  must appear somewhere in `text`. "bearing skf 6205" finds an item whose
 *  category is Bearing, make SKF and specification 6205 — same rule as the
 *  backend's item search (store/routes/items.py apply_item_search). */
export function matchesAllWords(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = text.toLowerCase()
  return words.every((w) => hay.includes(w))
}
