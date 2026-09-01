'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireAdmin } from '@/hooks/useAuth'
import { usersApi, modulesApi } from '@/lib/api'
import { User, ModuleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'

const APPROVAL_ROLE_FLAGS: { key: keyof User; label: string }[] = [
  { key: 'is_department_head', label: 'Dept Head' },
  { key: 'is_project_head', label: 'Project Head' },
  { key: 'is_plant_head', label: 'Plant Head' },
  { key: 'is_purchase_head', label: 'Purchase Head' },
  { key: 'is_director', label: 'Director' },
  { key: 'is_md', label: 'MD' },
]

// Read-only: this tab only shows who has what module access and approval
// roles — actually granting/changing them happens in Organization > Role &
// Permissions (reuses the existing Users & Roles edit screen), not here.
export default function OrganizationUsersPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [users, setUsers] = useState<User[]>([])
  const [apps, setApps] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    Promise.all([usersApi.list(), modulesApi.list()])
      .then(([u, m]: [User[], ModuleMeta[]]) => {
        setUsers(u)
        setApps(m.map((mm) => ({ id: mm.key, label: mm.label })))
      })
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Organization
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Users</h1>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        View-only — module access and approval roles are granted from Organization &gt; Role &amp; Permissions.
      </p>

      <OrganizationNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email..."
        style={{ width: '100%', maxWidth: 320, padding: '10px 14px', marginBottom: 16, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }}
      />

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['User', 'Email', 'Department', 'Branch', 'Role', 'Modules', 'Approval Roles', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No users match your search.</td></tr>
            )}
            {filtered.map((u) => {
              const isAdminRole = u.role === 'admin'
              const approvalRoles = APPROVAL_ROLE_FLAGS.filter((f) => u[f.key])
              return (
                <tr key={u.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{u.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{u.department || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{u.branch_name || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8, textTransform: 'capitalize', whiteSpace: 'nowrap', background: 'rgba(59,130,246,0.08)', color: '#2563eb' }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {isAdminRole ? (
                      <span style={{ fontSize: 12, color: TEXT.muted }}>All</span>
                    ) : u.apps.length === 0 ? (
                      <span style={{ fontSize: 12, color: TEXT.muted }}>None</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {u.apps.map((a) => (
                          <span key={a} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', color: '#2563eb', textTransform: 'uppercase' }}>
                            {apps.find((app) => app.id === a)?.label || a}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {approvalRoles.length === 0 ? (
                      <span style={{ fontSize: 12, color: TEXT.muted }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {approvalRoles.map((f) => (
                          <span key={String(f.key)} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,122,69,0.14)', color: BRAND.primaryActive, textTransform: 'uppercase' }}>
                            {f.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, whiteSpace: 'nowrap', color: u.is_active ? '#047857' : '#b91c1c', background: u.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.1)' }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
