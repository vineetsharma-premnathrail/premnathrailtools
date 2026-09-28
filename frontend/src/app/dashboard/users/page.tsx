'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { usersApi, modulesApi } from '@/lib/api'
import { User, ModuleMeta } from '@/types'
import { TEXT, BRAND, BORDER } from '@/lib/theme'
import FeedbackBell from '@/components/FeedbackBell'
import MessageDialog from '@/components/erp/MessageDialog'

const STATUS_TABS = ['All Users', 'Active Users', 'Inactive Users'] as const

export default function UsersRolesPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  // Assignable-apps checklist — driven by the modules registry (data change,
  // not a frontend code change, to add a new department). See
  // docs/product/ADMIN_MODULE_EXTENSION_PLAN.md Phase 1.
  const [APPS, setAPPS] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorTitle, setErrorTitle] = useState('')

  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState<typeof STATUS_TABS[number]>('All Users')
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    setErrorTitle('')
    try {
      const data = await usersApi.list()
      setUsers(data)
    } catch {
      setErrorTitle('Failed to Load Users')
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    modulesApi.list()
      .then((data: ModuleMeta[]) => setAPPS(data.map((m) => ({ id: m.key, label: m.label }))))
      .catch(() => {})
  }, [isAuthorized])

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.is_active).length,
      inactive: users.filter((u) => !u.is_active).length,
      admins: users.filter((u) => u.role === 'admin').length,
    }),
    [users]
  )

  const filtered = useMemo(() => {
    let list = users
    if (statusTab === 'Active Users') list = list.filter((u) => u.is_active)
    else if (statusTab === 'Inactive Users') list = list.filter((u) => !u.is_active)
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, search, statusTab])

  const handleSyncAzure = async () => {
    setSyncing(true)
    setError('')
    setErrorTitle('')
    try {
      const data = await usersApi.syncAzure()
      setUsers(data)
    } catch {
      setErrorTitle('Azure Sync Failed')
      setError('Azure sync failed. Check that the app has directory-read permission in Azure AD.')
    } finally {
      setSyncing(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Users &amp; Roles</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>
            Manage portal users, roles, and module access
          </p>
        </div>
        <FeedbackBell />
      </div>

      <MessageDialog
        open={!!error}
        variant="error"
        title={errorTitle || 'Failed to Load Users'}
        message={error}
        onClose={() => setError('')}
      />

      {/* Stat cards */}
      <div data-tour="org-roles-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Total Users" value={stats.total} color="#3b82f6" icon={<UsersIcon />} />
        <StatCard label="Active" value={stats.active} color="#10b981" icon={<CheckIcon />} />
        <StatCard label="Inactive" value={stats.inactive} color="#ef4444" icon={<XIcon />} />
        <StatCard label="Admins" value={stats.admins} color="#FF7A45" icon={<ShieldIcon />} />
      </div>

      {/* Status tabs */}
      <div data-tour="org-roles-status-tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setStatusTab(t)}
            style={{
              padding: '10px 6px', marginRight: 16, border: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
              background: 'transparent', borderBottom: statusTab === t ? `2px solid ${BRAND.primary}` : '2px solid transparent',
              color: statusTab === t ? BRAND.primary : TEXT.secondary, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          data-tour="org-roles-search"
          style={{
            flex: '1 1 260px',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.1)',
            background: '#fff',
            fontSize: 13.5,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSyncAzure}
          disabled={syncing}
          data-tour="org-roles-sync-btn"
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: syncing ? '#fca87a' : '#FF7A45',
            color: '#fff',
            fontSize: 13.5,
            fontWeight: 600,
            cursor: syncing ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {syncing ? 'Syncing…' : 'Sync from Azure AD'}
        </button>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['User', 'Email', 'Designation', 'Department', 'Office Location', 'Role', 'Apps', 'Status', 'Actions'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '.05em',
                    textTransform: 'uppercase',
                    color: '#a8a29e',
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    top: 0,
                    background: '#fdf1e6',
                    zIndex: 1,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-tour="org-roles-table-rows">
            {loading && (
              <tr>
                <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                  Loading users…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                  No users match your filters.
                </td>
              </tr>
            )}
            {filtered.map((u, idx) => {
              const isAdminRole = u.role === 'admin'
              return (
                <tr
                  key={u.id}
                  onClick={() => router.push(`/dashboard/users/${u.id}`)}
                  style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          flex: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 11,
                          background: 'linear-gradient(135deg,#3b82f6,#60a5fa)',
                        }}
                      >
                        {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', whiteSpace: 'nowrap' }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{u.designation || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>
                    {u.department || '—'}
                    {u.is_department_head && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(250,155,155,0.15)', color: '#FF7A45', textTransform: 'uppercase' }}>Dept Head</span>
                    )}
                    {u.is_project_head && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(59,130,246,0.12)', color: '#2563eb', textTransform: 'uppercase' }}>Project Head</span>
                    )}
                    {u.is_plant_head && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(16,185,129,0.12)', color: '#047857', textTransform: 'uppercase' }}>Plant Head</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{u.office_location || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 8,
                        textTransform: 'capitalize',
                        whiteSpace: 'nowrap',
                        background: 'rgba(59,130,246,0.08)',
                        color: '#2563eb',
                      }}
                    >
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {isAdminRole ? (
                      <span style={{ fontSize: 12, color: '#a8a29e' }}>All</span>
                    ) : u.apps.length === 0 ? (
                      <span style={{ fontSize: 12, color: '#a8a29e' }}>None</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {u.apps.map((a) => (
                          <span
                            key={a}
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: 'rgba(59,130,246,0.1)',
                              color: '#2563eb',
                              textTransform: 'uppercase',
                            }}
                          >
                            {APPS.find((app) => app.id === a)?.label || a}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 9999,
                        whiteSpace: 'nowrap',
                        color: u.is_active ? '#047857' : '#b91c1c',
                        background: u.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.1)',
                      }}
                    >
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => router.push(`/dashboard/users/${u.id}`)}
                      data-tour={idx === 0 ? 'org-roles-edit-btn' : undefined}
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        padding: '6px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'linear-gradient(135deg,#3b82f6,#60a5fa)',
                        color: '#fff',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

    </div>
  )
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${color}1a`, color }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 2px' }}>{label}</p>
        <p style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: 0 }}>{value}</p>
      </div>
    </div>
  )
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  )
}
function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
