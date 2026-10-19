import { redirect } from 'next/navigation'

// Stock Entry Types are no longer configurable (2026-10-12): Record Stock
// Entry was removed, so the list only names old entries. Old links land on
// Store Settings.
export default function OldStockEntryTypesLink() {
  redirect('/dashboard/store/settings')
}
