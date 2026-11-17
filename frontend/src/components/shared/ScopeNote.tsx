'use client'

// "Why is my list short / empty?" (owner, 2026-11-14). A role that ticks View
// but sets no Data access gets "Own + assigned", so lists look broken. Put this
// line above (or in the empty state of) every list that the backend narrows
// with apply_scope. It shows nothing for organization-wide access.

import { useAuthStore } from '@/store/authStore'
import { SCOPE_LABELS, viewScope } from '@/lib/permissions'

export default function ScopeNote({ module, empty = false, style }: {
  /** Permission module key (store, crm, p2p, accounts, …). */
  module: string
  /** True when the list came back empty — the note then explains it more plainly. */
  empty?: boolean
  style?: React.CSSProperties
}) {
  const user = useAuthStore((s) => s.user)
  const level = viewScope(user, module)
  if (!user || level === 'organization') return null
  const label = SCOPE_LABELS[level] || level
  return (
    <div role="note" data-tour="scope-note" style={{
      fontSize: 12, color: '#64748b', padding: '6px 10px', borderRadius: 8,
      background: 'rgba(100,116,139,0.08)', margin: '0 0 10px', lineHeight: 1.45, ...style,
    }}>
      {empty ? 'Nothing here within your data access' : 'Showing records within your data access'}: <strong>{label}</strong>.
      {' '}Need to see more? Ask an admin to widen the Data access of your role in Organization › Role &amp; Permissions.
    </div>
  )
}
