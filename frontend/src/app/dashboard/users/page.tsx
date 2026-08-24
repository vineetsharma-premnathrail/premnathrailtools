'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireAdmin } from '@/hooks/useAuth'
import { usersApi, modulesApi } from '@/lib/api'
import { User, ModuleMeta } from '@/types'
import FeedbackBell from '@/components/FeedbackBell'

export default function UsersRolesPage() {
  const { user: currentUser, isAuthorized, isLoading } = useRequireAdmin()
  const [users, setUsers] = useState<User[]>([])
  // Assignable-apps checklist — driven by the modules registry (data change,
  // not a frontend code change, to add a new department). See
  // docs/product/ADMIN_MODULE_EXTENSION_PLAN.md Phase 1.
  const [APPS, setAPPS] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await usersApi.list()
      setUsers(data)
    } catch {
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
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, search])

  const handleSaveAccess = async (userId: number, apps: string[], erpPermissions: string[], isDepartmentHead: boolean) => {
    const updated = await usersApi.updateModuleAccess(userId, apps, erpPermissions, isDepartmentHead)
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)))
    setEditingUser(null)
  }

  const handleToggleActive = async (u: User) => {
    const updated = u.is_active ? await usersApi.deactivate(u.id) : await usersApi.activate(u.id)
    setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
  }

  const handleSyncAzure = async () => {
    setSyncing(true)
    setError('')
    try {
      const data = await usersApi.syncAzure()
      setUsers(data)
    } catch {
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

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Total Users" value={stats.total} color="#3b82f6" icon={<UsersIcon />} />
        <StatCard label="Active" value={stats.active} color="#10b981" icon={<CheckIcon />} />
        <StatCard label="Inactive" value={stats.inactive} color="#ef4444" icon={<XIcon />} />
        <StatCard label="Admins" value={stats.admins} color="#fa9b9b" icon={<ShieldIcon />} />
      </div>

      {/* Search */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
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
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: syncing ? '#fca87a' : '#fa9b9b',
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
      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['User', 'Email', 'Designation', 'Department', 'Role', 'Apps', 'Status', 'Actions'].map((h) => (
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
          <tbody>
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
            {filtered.map((u) => {
              const isSelf = u.id === currentUser?.id
              const isAdminRole = u.role === 'admin'
              return (
                <tr key={u.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
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
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(250,155,155,0.15)', color: '#fa9b9b', textTransform: 'uppercase' }}>Head</span>
                    )}
                  </td>
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
                      onClick={() => setEditingUser(u)}
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

      {editingUser && (
        <EditUserModal
          user={editingUser}
          isSelf={editingUser.id === currentUser?.id}
          apps={APPS}
          onClose={() => setEditingUser(null)}
          onSave={handleSaveAccess}
          onToggleActive={handleToggleActive}
        />
      )}
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

const ERP_PERMISSION_GROUPS: { label: string; icon: string; perms: { id: string; label: string }[] }[] = [
  {
    label: 'Projects', icon: '📁',
    perms: [
      { id: 'project_view', label: 'View' },
      { id: 'project_create', label: 'Create' },
      { id: 'project_edit', label: 'Edit' },
      { id: 'project_delete', label: 'Delete' },
    ],
  },
  {
    label: 'Service Requests', icon: '🔧',
    perms: [
      { id: 'sr_view', label: 'View' },
      { id: 'sr_create', label: 'Create' },
      { id: 'sr_edit', label: 'Edit' },
      { id: 'sr_delete', label: 'Delete' },
    ],
  },
]

const P2P_PERMISSION_GROUPS: { label: string; icon: string; perms: { id: string; label: string }[] }[] = [
  {
    label: 'Purchase Requisition', icon: '📝',
    perms: [
      { id: 'pr_create', label: 'Create' },
    ],
  },
  {
    label: 'Approval', icon: '✅',
    perms: [
      { id: 'approval_view', label: 'View' },
      { id: 'approval_action', label: 'Action' },
    ],
  },
  {
    label: 'RFQ', icon: '📄',
    perms: [
      { id: 'rfq_view', label: 'View' },
      { id: 'rfq_action', label: 'Action' },
    ],
  },
  {
    label: 'GRN', icon: '📦',
    perms: [
      { id: 'grn_view', label: 'View' },
      { id: 'grn_action', label: 'Action' },
    ],
  },
]

function EditUserModal({
  user,
  isSelf,
  apps,
  onClose,
  onSave,
  onToggleActive,
}: {
  user: User
  isSelf: boolean
  apps: { id: string; label: string }[]
  onClose: () => void
  onSave: (id: number, apps: string[], erpPermissions: string[], isDepartmentHead: boolean) => Promise<void>
  onToggleActive: (u: User) => Promise<void>
}) {
  const isAdminRole = user.role === 'admin'
  const [selected, setSelected] = useState<string[]>(user.assigned_apps || [])
  const [erpPerms, setErpPerms] = useState<string[]>(user.erp_permissions || [])
  const [isDepartmentHead, setIsDepartmentHead] = useState(!!user.is_department_head)
  const [saving, setSaving] = useState(false)

  const toggle = (app: string) => {
    setSelected((prev) => (prev.includes(app) ? prev.filter((a) => a !== app) : [...prev, app]))
  }

  const togglePerm = (perm: string) => {
    setErpPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]))
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(user.id, selected, erpPerms, isDepartmentHead)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1f1108', margin: 0 }}>Module Access — {user.name}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#a8a29e', fontSize: 18 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 16, borderRadius: 14, background: '#faf9f7', marginBottom: 20 }}>
            <Field label="Full Name" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field label="Designation" value={user.designation || '—'} />
            <Field label="Department" value={user.department || '—'} />
            <Field label="Phone" value={user.phone || '—'} />
            <Field label="Role" value={user.role.replace('_', ' ')} capitalize />
          </div>

          <p style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 10px' }}>
            Module Access
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {apps.map((a) => (
              <label
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.1)',
                  cursor: isAdminRole ? 'not-allowed' : 'pointer',
                  opacity: isAdminRole ? 0.5 : 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1f1108',
                }}
              >
                <input
                  type="checkbox"
                  disabled={isAdminRole}
                  checked={isAdminRole || selected.includes(a.id)}
                  onChange={() => toggle(a.id)}
                />
                {a.label}
              </label>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '10px 0 0' }}>Admins have access to all modules automatically.</p>

          <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: '#faf9f7' }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 10px' }}>
              Department Head
            </p>
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10,
                border: isDepartmentHead ? '1px solid #fa9b9b' : '1px solid rgba(0,0,0,0.1)',
                background: isDepartmentHead ? 'rgba(244,113,59,0.05)' : '#fff',
                cursor: !user.department ? 'not-allowed' : 'pointer',
                opacity: !user.department ? 0.5 : 1,
                fontSize: 13, fontWeight: 600, color: '#1f1108', width: 'fit-content',
              }}
            >
              <input
                type="checkbox"
                disabled={!user.department}
                checked={isDepartmentHead}
                onChange={() => setIsDepartmentHead((v) => !v)}
              />
              Head of {user.department || 'department'}
            </label>
            <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '10px 0 0' }}>
              {user.department
                ? `Any P2P request raised by someone in "${user.department}" will be routed to this user for approval/rejection.`
                : 'Set a department for this user (from the HR profile) before making them a department head.'}
            </p>
          </div>

          {!isAdminRole && selected.includes('erp') && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: '#faf9f7' }}>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 12px' }}>
                ERP Permissions
              </p>
              {ERP_PERMISSION_GROUPS.map((group, i) => (
                <div key={group.label} style={{ marginBottom: i < ERP_PERMISSION_GROUPS.length - 1 ? 12 : 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: '0 0 6px' }}>{group.icon} {group.label}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {group.perms.map((p) => (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                          border: erpPerms.includes(p.id) ? '1px solid #fa9b9b' : '1px solid rgba(0,0,0,0.1)',
                          background: erpPerms.includes(p.id) ? 'rgba(244,113,59,0.05)' : '#fff',
                          color: erpPerms.includes(p.id) ? '#fa9b9b' : '#1f1108',
                          cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                        }}
                      >
                        <input type="checkbox" checked={erpPerms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isAdminRole && selected.includes('p2p') && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: '#faf9f7' }}>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 12px' }}>
                P2P Permissions
              </p>
              {P2P_PERMISSION_GROUPS.map((group, i) => (
                <div key={group.label} style={{ marginBottom: i < P2P_PERMISSION_GROUPS.length - 1 ? 12 : 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: '0 0 6px' }}>{group.icon} {group.label}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {group.perms.map((p) => (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                          border: erpPerms.includes(p.id) ? '1px solid #fa9b9b' : '1px solid rgba(0,0,0,0.1)',
                          background: erpPerms.includes(p.id) ? 'rgba(244,113,59,0.05)' : '#fff',
                          color: erpPerms.includes(p.id) ? '#fa9b9b' : '#1f1108',
                          cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                        }}
                      >
                        <input type="checkbox" checked={erpPerms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 24px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <button
            onClick={() => onToggleActive(user)}
            disabled={isSelf}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: '9px 16px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.1)',
              background: '#fff',
              color: user.is_active ? '#b91c1c' : '#047857',
              cursor: isSelf ? 'not-allowed' : 'pointer',
              opacity: isSelf ? 0.5 : 1,
            }}
          >
            {user.is_active ? 'Deactivate User' : 'Activate User'}
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{ fontSize: 13, fontWeight: 600, padding: '10px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || isAdminRole}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 20px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)',
                color: '#fff',
                cursor: saving || isAdminRole ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Access'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, fontWeight: 600, color: '#1f1108', margin: 0, textTransform: capitalize ? 'capitalize' : 'none' }}>{value}</p>
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
