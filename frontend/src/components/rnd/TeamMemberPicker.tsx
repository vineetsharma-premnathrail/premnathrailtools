'use client'

import { useState } from 'react'
import { DirectoryUser } from '@/types'
import { UserPlus } from '@phosphor-icons/react'
import { TEXT, BORDER } from '@/lib/theme'
import { ValueRow, squareBtn } from '@/components/shared/MoreValuesButtons'

// Search-to-add chip multi-select, same UX as the P2P approver / department
// member pickers — shared by the R&D project new + detail pages.
export default function TeamMemberPicker({
  users, value, onChange, excludeId, excludeIds = [], selfId, placeholder = 'Search name or email to add a team member…',
}: {
  users: DirectoryUser[]
  value: number[]
  onChange: (ids: number[]) => void
  excludeId?: number | null
  // People already picked elsewhere (e.g. project leads) — hidden from the results.
  excludeIds?: number[]
  // The signed-in user; shows an "Add me" button beside the search while they aren't picked.
  selfId?: number | null
  placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const selected = value.map((id) => users.find((u) => u.id === id)).filter(Boolean) as DirectoryUser[]
  const matches = q
    ? users
        .filter((u) => !value.includes(u.id) && u.id !== excludeId && !excludeIds.includes(u.id))
        .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        .slice(0, 8)
    : []

  const canAddSelf = !!selfId && !value.includes(selfId) && !excludeIds.includes(selfId) && selfId !== excludeId
  const input = (
    <input
      style={{ width: '100%', boxSizing: 'border-box', height: 38, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body }}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder={placeholder}
    />
  )
  // "Add me" sits in the search row (a link under the field broke the layout);
  // it stays in place, greyed out, once the user is picked so the box keeps its width.
  const selfTip = canAddSelf ? 'Add me' : 'You are already added here'

  return (
    <div>
      {selfId ? (
        <ValueRow button={
          <button type="button" onClick={canAddSelf ? () => onChange([...value, selfId]) : undefined} disabled={!canAddSelf}
            title={selfTip} aria-label={selfTip} style={squareBtn('#c2410c', !canAddSelf)}>
            <UserPlus size={16} />
          </button>
        }>{input}</ValueRow>
      ) : input}
      {matches.length > 0 && (
        <div style={{ marginTop: 4, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          {matches.map((u) => (
            <div
              key={u.id}
              onClick={() => { onChange([...value, u.id]); setSearch('') }}
              style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.04)' }}
            >
              <span style={{ fontWeight: 600 }}>{u.name}</span> · {u.email}
            </div>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {selected.map((u) => (
            <span
              key={u.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, background: 'rgba(255,106,42,0.1)', color: '#c2410c', fontSize: 12, fontWeight: 600 }}
            >
              {u.name}
              <span onClick={() => onChange(value.filter((id) => id !== u.id))} style={{ cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
