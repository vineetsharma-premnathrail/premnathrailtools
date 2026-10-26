'use client'

import { TEXT, BORDER } from '@/lib/theme'

/** Empty-state line used inside a DetailCard list (addresses, contacts, documents…). */
export const orgEmptyStyle: React.CSSProperties = { fontSize: 13, color: TEXT.muted, margin: '8px 0' }

/**
 * One entry of a list shown inside a DetailCard (an address, a contact, a
 * financial year, a document…): name + short sub-label + pills on the first
 * line, the details on the second, an optional action on the right. Entries
 * are separated by thin dividers instead of each being its own boxed card.
 */
export default function OrgListItem({ title, sub, tags, body, action, last }: {
  title: React.ReactNode
  sub?: React.ReactNode
  tags?: React.ReactNode
  body?: React.ReactNode
  action?: React.ReactNode
  last?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: last ? 'none' : `1px solid ${BORDER.normal}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{title}</span>
          {sub && <span style={{ fontSize: 12.5, color: TEXT.muted }}>{sub}</span>}
          {tags}
        </div>
        {body && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0, overflowWrap: 'anywhere' }}>{body}</p>}
      </div>
      {action}
    </div>
  )
}
