'use client'

import { useState } from 'react'
import { DirectoryUser } from '@/types'
import { BORDER, TEXT } from '@/lib/theme'
import { inputStyle } from '@/components/shared/ui'

/** Multi-select users by search, shown as removable chips (same UX as the P2P approver picker). */
export default function UserChipsPicker({ users, value, onChange, disabled, placeholder = 'Add a user — type a name or email…', max }: {
  users: DirectoryUser[]
  value: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
  placeholder?: string
  max?: number
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const matches = q
    ? users.filter((u) => !value.includes(u.id) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 8)
    : []
  const full = max !== undefined && value.length >= max
  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {value.map((id) => {
            const u = users.find((x) => x.id === id)
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '4px 10px', borderRadius: 9999, background: 'rgba(255,106,42,0.1)', color: '#c2410c', fontWeight: 600 }}>
                {u ? u.name : `User #${id}`}
                {!disabled && <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => onChange(value.filter((x) => x !== id))}>×</span>}
              </span>
            )
          })}
        </div>
      )}
      {!disabled && !full && (
        <div style={{ position: 'relative' }}>
          <input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} />
          {matches.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: `1px solid ${BORDER.normal}`, borderRadius: 10, marginTop: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.12)' }}>
              {matches.map((u) => (
                <button key={u.id} type="button" onClick={() => { onChange([...value, u.id]); setSearch('') }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: TEXT.body }}>
                  {u.name} <span style={{ color: TEXT.muted, fontSize: 11.5 }}>{u.email}{u.department ? ` · ${u.department}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
