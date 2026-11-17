'use client'

// Why is the Store dropdown empty? (owner, 2026-11-14). Store pickers list the
// stores of the plants the user's Store data access covers
// (backend store/services/plant_access.py). A user with no plant set — or a
// plant with no store yet — gets an empty list; say so right under the field
// instead of leaving a blank dropdown.

import { useAuthStore } from '@/store/authStore'
import { viewScope } from '@/lib/permissions'

export default function StorePlantNote({ count, loading = false, style }: {
  /** How many stores the dropdown offers. The note shows only when it is 0. */
  count: number
  /** True while the store list is still loading — nothing is shown yet. */
  loading?: boolean
  style?: React.CSSProperties
}) {
  const user = useAuthStore((s) => s.user)
  if (!user || loading || count > 0 || viewScope(user, 'store') === 'organization') return null
  const text = !user.branch_id
    ? 'No store to pick: your user has no plant — ask an admin to set it in Organization › Users.'
    : 'No store to pick: your plant has no store set up yet, or your Store data access does not cover one — ask an admin '
      + '(Store › Settings › Stores, or the Data access of your role in Organization › Role & Permissions).'
  return (
    <p role="note" data-tour="store-plant-note" style={{ fontSize: 11.5, color: '#b45309', margin: '4px 0 0', lineHeight: 1.4, ...style }}>
      {text}
    </p>
  )
}
