'use client'

import { useState } from 'react'
import { DirectoryUser } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'

// Search-to-add chip multi-select, same UX as the P2P approver / department
// member pickers — shared by the R&D project new + detail pages.
export default function TeamMemberPicker({
  users, value, onChange, excludeId,
}: {
  users: DirectoryUser[]
  value: number[]
  onChange: (ids: number[]) => void
  excludeId?: number | null
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const selected = value.map((id) => users.find((u) => u.id === id)).filter(Boolean) as DirectoryUser[]
  const matches = q
    ? users
        .filter((u) => !value.includes(u.id) && u.id !== excludeId)
        .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        .slice(0, 8)
    : []

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
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
      <input
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body }}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or email to add a team member…"
      />
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
    </div>
  )
}
