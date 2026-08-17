'use client'

import { useMemo, useState } from 'react'
import { DirectoryUser } from '@/types'

/** Bundles the 4 pieces of state a private-document share selection needs
 * (private flag + 3 independent OR-matched picks) so the three places that
 * render a SharePicker (upload staging, per-file "Manage access", the
 * project wizard) don't each hand-roll the same 4 useState calls + 3 toggle
 * functions + a reset. */
export function useShareSelection() {
  const [isPrivate, setIsPrivate] = useState(false)
  const [userIds, setUserIds] = useState<number[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [designations, setDesignations] = useState<string[]>([])

  const toggleUser = (id: number) => setUserIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleDepartment = (v: string) => setDepartments((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))
  const toggleDesignation = (v: string) => setDesignations((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))

  const setAll = (v: { isPrivate: boolean; userIds: number[]; departments: string[]; designations: string[] }) => {
    setIsPrivate(v.isPrivate)
    setUserIds(v.userIds)
    setDepartments(v.departments)
    setDesignations(v.designations)
  }

  const reset = () => setAll({ isPrivate: false, userIds: [], departments: [], designations: [] })

  return {
    isPrivate, setIsPrivate: (v: boolean) => { setIsPrivate(v); if (!v) { setUserIds([]); setDepartments([]); setDesignations([]) } },
    userIds, departments, designations,
    toggleUser, toggleDepartment, toggleDesignation,
    setAll, reset,
  }
}

function ChipMultiSelect({
  label, placeholder, options, selected, onToggle, disabled,
}: {
  label: string
  placeholder: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const filtered = options
    .filter((o) => o.toLowerCase().includes(search.trim().toLowerCase()))
    // Selected first, so picks stay visible instead of scrolling away in a long list.
    .sort((a, b) => {
      const aSel = selected.includes(a) ? 0 : 1
      const bSel = selected.includes(b) ? 0 : 1
      return aSel - bSel || a.localeCompare(b)
    })

  if (options.length === 0) return null

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: '#78716c', margin: '4px 0' }}>{label}</p>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
        {filtered.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            disabled={disabled}
            style={{
              fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${selected.includes(value) ? '#fa9b9b' : 'rgba(0,0,0,0.12)'}`,
              background: selected.includes(value) ? 'rgba(244,113,59,0.1)' : '#fff',
              color: selected.includes(value) ? '#fa9b9b' : '#57534e',
            }}
          >
            {selected.includes(value) ? '✓ ' : ''}{value}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Private-document "who can see this" control: a checkbox plus pickers for
 * individual people, whole departments, and whole designations (matched live
 * against each viewer's *current* Azure AD department/designation — not a
 * frozen list, so org changes take effect immediately). Shared by the
 * project-create/edit wizard and the Documents tab's upload + per-file
 * "Manage access" flows so all three stay identical. */
export default function SharePicker({
  directory, currentUserId, isPrivate, onTogglePrivate,
  selectedUserIds, onToggleUser,
  selectedDepartments, onToggleDepartment,
  selectedDesignations, onToggleDesignation,
  disabled,
}: {
  directory: DirectoryUser[]
  currentUserId?: number
  isPrivate: boolean
  onTogglePrivate: (v: boolean) => void
  selectedUserIds: number[]
  onToggleUser: (id: number) => void
  selectedDepartments: string[]
  onToggleDepartment: (value: string) => void
  selectedDesignations: string[]
  onToggleDesignation: (value: string) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')

  const departments = useMemo(
    () => Array.from(new Set(directory.map((d) => d.department).filter((v): v is string => !!v))).sort(),
    [directory]
  )
  const designations = useMemo(
    () => Array.from(new Set(directory.map((d) => d.designation).filter((v): v is string => !!v))).sort(),
    [directory]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#1f1108', cursor: 'pointer' }}>
        <input type="checkbox" checked={isPrivate} onChange={(e) => onTogglePrivate(e.target.checked)} disabled={disabled} />
        Make private (only you, admins, and people/departments/designations you choose can see this)
      </label>
      {isPrivate && (
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: '#78716c', margin: '4px 0' }}>Share with specific people</p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            disabled={disabled}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
            {directory
              .filter((d) => d.id !== currentUserId)
              .filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()))
              .sort((a, b) => {
                const aSel = selectedUserIds.includes(a.id) ? 0 : 1
                const bSel = selectedUserIds.includes(b.id) ? 0 : 1
                return aSel - bSel || a.name.localeCompare(b.name)
              })
              .map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onToggleUser(d.id)}
                  disabled={disabled}
                  style={{
                    fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${selectedUserIds.includes(d.id) ? '#fa9b9b' : 'rgba(0,0,0,0.12)'}`,
                    background: selectedUserIds.includes(d.id) ? 'rgba(244,113,59,0.1)' : '#fff',
                    color: selectedUserIds.includes(d.id) ? '#fa9b9b' : '#57534e',
                  }}
                >
                  {selectedUserIds.includes(d.id) ? '✓ ' : ''}{d.name}
                </button>
              ))}
          </div>

          <ChipMultiSelect
            label="Or share with entire department(s)"
            placeholder="Search departments…"
            options={departments}
            selected={selectedDepartments}
            onToggle={onToggleDepartment}
            disabled={disabled}
          />

          <ChipMultiSelect
            label="Or share with entire designation(s)"
            placeholder="Search designations…"
            options={designations}
            selected={selectedDesignations}
            onToggle={onToggleDesignation}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}
