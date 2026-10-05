'use client'

import DocTypeSettings from '@/components/store/DocTypeSettings'

export default function StoreEntryTypesPage() {
  return (
    <DocTypeSettings
      kind="stock_entry"
      title="Stock Entry Types"
      noun="entry type"
      intro="Types offered on Stock → Record Stock Entry. Each one either adds to or removes from on-hand stock — chosen once, when the type is created."
    />
  )
}
