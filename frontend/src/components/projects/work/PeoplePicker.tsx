'use client'

import { useEffect, useMemo, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { DirectoryUser, PmDepartmentPerson } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle } from './pmUi'

export type PickPerson = { id: number; name: string; sub?: string; inDept?: boolean }

/** Everyone who can be put on a milestone team: the department's people
 * first (heads on top), then every other active user — R&D often pulls in
 * someone from Purchase or Electrical. */
export function useTeamCandidates(departmentId?: number | null, withDepartment = true) {
  const [all, setAll] = useState<DirectoryUser[]>([])
  // Keyed by department so a stale list never shows after switching.
  const [loaded, setLoaded] = useState<{ deptId: number; people: PmDepartmentPerson[] } | null>(null)
  useEffect(() => { usersApi.directory().then(setAll).catch(() => setAll([])) }, [])
  useEffect(() => {
    if (!departmentId || !withDepartment) return
    projectsApi.departmentPeople(departmentId)
      .then((people: PmDepartmentPerson[]) => setLoaded({ deptId: departmentId, people }))
      .catch(() => setLoaded({ deptId: departmentId, people: [] }))
  }, [departmentId, withDepartment])
  const dept = useMemo(() => (withDepartment && loaded && loaded.deptId === departmentId ? loaded.people : []), [loaded, departmentId, withDepartment])
  return useMemo<PickPerson[]>(() => {
    const seen = new Set(dept.map((d) => d.id))
    return [
      ...dept.map((d) => ({ id: d.id, name: d.name, sub: d.is_head ? 'Department head' : d.designation || 'In department', inDept: true })),
      ...all.filter((u) => !seen.has(u.id)).map((u) => ({ id: u.id, name: u.name, sub: u.designation || u.department || '', inDept: false })),
    ]
  }, [all, dept])
}

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '3px 10px',
  borderRadius: 9999, background: 'rgba(99,102,241,0.1)', color: '#4338ca',
}

/** Multi-select by search with removable chips (same UX as the P2P approver
 * picker). The list only opens while something is typed. */
export default function PeoplePicker({ people, value, onChange, exclude = [], placeholder = 'Type a name…' }: {
  people: PickPerson[]
  value: number[]
  onChange: (ids: number[]) => void
  exclude?: number[]
  placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const q = search.trim().toLowerCase()
  const matches = q ? people.filter((p) => !value.includes(p.id) && !exclude.includes(p.id) && p.name.toLowerCase().includes(q)).slice(0, 8) : []
  return (
    <div style={{ position: 'relative' }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {value.map((id) => (
            <span key={id} style={chip}>
              {byId.get(id)?.name || `User #${id}`}
              <span role="button" onClick={() => onChange(value.filter((x) => x !== id))} style={{ cursor: 'pointer', fontWeight: 800 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} />
      {matches.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, marginTop: 4, background: '#fff', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          {matches.map((p) => (
            <div key={p.id} onClick={() => { onChange([...value, p.id]); setSearch('') }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
              <span style={{ fontWeight: 600, color: TEXT.heading }}>{p.name}</span>
              {p.sub && <span style={{ fontSize: 11.5, color: p.inDept ? '#0f766e' : TEXT.muted, marginLeft: 8 }}>{p.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
