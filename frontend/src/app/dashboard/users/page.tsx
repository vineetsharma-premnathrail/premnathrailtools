'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { usersApi, modulesApi } from '@/lib/api'
import { User, ModuleMeta } from '@/types'
import { TEXT, BRAND, BORDER } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { secondaryBtnStyle, RowCount } from '@/components/shared/ui'

const STATUS_TABS = ['All Users', 'Active Users', 'Inactive Users'] as const

export default function UsersRolesPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('users')
  const { can } = useCan()
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
  const [confirmSync, setConfirmSync] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    setErrorTitle('')
    try {
      const data = await usersApi.list()
      setUsers(data)
    } catch (err) {
      setErrorTitle('Failed to Load Users')
      setError(extractErrorMessages(err, 'Could not load users — check your connection and reload; if it persists your account may lack access to this module.').join(' '))
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
    } catch (err) {
      setErrorTitle('Microsoft sync failed')
      setError(extractErrorMessages(err, 'The Microsoft (Entra ID) sync failed — check the app has directory-read permission in Entra and try again.').join(' '))
    } finally {
      setSyncing(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Users</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>
            Manage portal users, roles, and module access
          </p>
        </div>
      </div>

      <MessageDialog
        open={!!error}
        variant="error"
        title={errorTitle || 'Failed to Load Users'}
        message={error}
        onClose={() => setError('')}
      />

      <ConfirmDialog
        open={confirmSync}
        danger={false}
        title="Sync users from Microsoft (Entra ID)?"
        message="This pulls the latest names, emails, designations and departments from Microsoft Entra ID and adds new joiners. New people get no module access until you give them a role."
        confirmLabel="Sync now"
        onConfirm={() => { setConfirmSync(false); handleSyncAzure() }}
        onCancel={() => setConfirmSync(false)}
      />

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
            {t} ({t === 'All Users' ? stats.total : t === 'Active Users' ? stats.active : stats.inactive})
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
        {can('organization', 'users', 'create') && <button
          type="button"
          onClick={() => setConfirmSync(true)}
          disabled={syncing}
          data-tour="org-roles-sync-btn"
          style={{ ...secondaryBtnStyle, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1 }}
        >
          {syncing ? 'Syncing…' : 'Sync from Microsoft (Entra ID)'}
        </button>}
      </div>

      {/* Table */}
      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['User', 'Email', 'Designation', 'Department', 'Office Location', 'Role', 'Apps', 'Status'].map((h, hi) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: '#57534e',
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    top: 0,
                    background: '#fdf1e6',
                    zIndex: 1,
                  }}
                >
                  {h}{hi === 0 && <RowCount count={filtered.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-tour="org-roles-table-rows">
            {loading && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                  Loading users…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                  No users match your filters.
                </td>
              </tr>
            )}
            {filtered.map((u, idx) => {
              const isAdminRole = u.role === 'admin'
              return (
                <tr
                  key={u.id}
                  onClick={() => router.push(recordPath('/dashboard/users', u))}
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
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{u.office_location || '—'}</td>
                  <td style={{ padding: '12px 16px' }} data-tour={idx === 0 ? 'org-roles-role-badge' : undefined}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 8,
                        whiteSpace: 'nowrap',
                        background: 'rgba(59,130,246,0.08)',
                        color: u.role === 'admin' || (u.role_names && u.role_names.length) ? '#1d4ed8' : '#57534e',
                      }}
                    >
                      {u.role === 'admin' ? 'Admin' : (u.role_names && u.role_names.length ? u.role_names.join(', ') : 'No extra role')}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }} data-tour={idx === 0 ? 'org-roles-apps-cell' : undefined}>
                    {isAdminRole ? (
                      <span style={{ fontSize: 12, color: '#57534e' }}>All</span>
                    ) : u.apps.length === 0 ? (
                      <span style={{ fontSize: 12, color: '#57534e' }}>None</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {u.apps.map((a) => (
                          <span
                            key={a}
                            style={{
                              fontSize: 12,
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
                  <td style={{ padding: '12px 16px' }} data-tour={idx === 0 ? 'org-roles-status-badge' : undefined}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 9999,
                        whiteSpace: 'nowrap',
                        color: u.is_active ? '#047857' : '#64748B',
                        background: u.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)',
                      }}
                    >
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

    </div>
  )
}
