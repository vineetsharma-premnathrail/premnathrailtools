import { useEffect, useState } from 'react'
import { storeApi } from '@/lib/api'

// Store item types — mirrors STORE_ITEM_TYPES / STORE_ITEM_TYPE_LABELS in
// backend/app/modules/store/models/item.py.
export const ITEM_TYPES = [
  { value: 'material', label: 'Material' },
  { value: 'service', label: 'Service' },
  { value: 'asset', label: 'Asset' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'tool_equipment', label: 'Tool & Equipment' },
] as const

export const ITEM_TYPE_LABELS: Record<string, string> = Object.fromEntries(ITEM_TYPES.map((t) => [t.value, t.label]))

/** Item types from the server (store_item_types master — users can add/rename
 *  them from the Item Type dropdown). Falls back to the standard list. */
export function useItemTypes(enabled = true) {
  const [types, setTypes] = useState<{ value: string; label: string }[]>([...ITEM_TYPES])
  useEffect(() => {
    if (!enabled) return
    storeApi.getItemMeta().then((m) => { if (m.item_types?.length) setTypes(m.item_types) }).catch(() => {})
  }, [enabled])
  const labels: Record<string, string> = Object.fromEntries(types.map((t) => [t.value, t.label]))
  return { types, labels }
}
