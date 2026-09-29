'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { usersApi, modulesApi, organizationApi } from '@/lib/api'
import { User, ModuleMeta, BranchUserAssignment, Branch, Department, UserSession, UserActivity, UserDocument, PermissionRegistry } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadField from '@/components/shared/FileUploadField'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const valueStyle: React.CSSProperties = { fontSize: 14, color: TEXT.body, marginBottom: 16 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, border: `1px solid ${BORDER.normal}`,
  background: '#fff', fontSize: 13, outline: 'none', color: TEXT.body,
}
const fieldLabelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, marginBottom: 5, display: 'block' }
const cardRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff',
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={fieldLabelStyle}>{label}</label>{children}</div>
}

const TABS = ['User Details', 'Assignments', 'User Permissions', 'Permission Matrix', 'Permission History', 'Login History', 'User Activity', 'User Documents'] as const

export default function UserDetailPage() {
  const { user: currentUser, isAuthorized, isLoading } = useRequireAdmin()
  const params = useParams()
  const router = useRouter()
  const userId = Number(params.id)

  const [user, setUser] = useState<User | null>(null)
  const [apps, setApps] = useState<{ id: string; label: string }[]>([])
  const [assignments, setAssignments] = useState<BranchUserAssignment[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [activity, setActivity] = useState<UserActivity[]>([])
  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [registry, setRegistry] = useState<PermissionRegistry | null>(null)
  const [permissionHistory, setPermissionHistory] = useState<UserActivity[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('User Details')

  const load = () => {
    setError('')
    Promise.all([
      usersApi.getUser(userId),
      modulesApi.list(),
      usersApi.listUserAssignments(userId),
      organizationApi.listBranches(),
      organizationApi.listDepartments(),
      usersApi.listUserSessions(userId),
      usersApi.listUserActivity(userId),
      usersApi.listUserDocuments(userId),
      usersApi.getPermissionRegistry(),
      usersApi.listPermissionHistory(userId),
    ])
      .then(([u, mods, a, b, d, s, act, docs, reg, permHist]) => {
        setUser(u)
        setApps((mods as ModuleMeta[]).map((m) => ({ id: m.key, label: m.label })))
        setAssignments(a); setBranches(b); setDepartments(d); setSessions(s); setActivity(act); setDocuments(docs)
        setRegistry(reg); setPermissionHistory(permHist)
      })
      .catch(() => setError('Failed to load user.'))
  }

  useEffect(() => {
    if (isAuthorized && userId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, userId])

  if (isLoading || !isAuthorized) return null

  if (error) {
    return (
      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
        {error}
      </div>
    )
  }

  if (!user) return null

  const isSelf = user.id === currentUser?.id

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{user.name}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: user.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.1)', color: user.is_active ? '#047857' : '#b91c1c' }}>
              {user.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p style={{ fontSize: 12, color: TEXT.secondary, margin: '8px 0 0 0' }}>{user.email}</p>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/users')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px', marginRight: 16, border: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
              background: 'transparent', borderBottom: tab === t ? `2px solid ${BRAND.primary}` : '2px solid transparent',
              color: tab === t ? BRAND.primary : TEXT.secondary, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'User Details' && <UserDetailsTab user={user} isSelf={isSelf} onRefresh={load} />}
      {tab === 'Assignments' && <AssignmentsTab user={user} assignments={assignments} branches={branches} departments={departments} onRefresh={load} />}
      {tab === 'User Permissions' && <UserPermissionsTab user={user} apps={apps} onRefresh={load} />}
      {tab === 'Permission Matrix' && registry && <PermissionMatrixTab user={user} registry={registry} onRefresh={load} />}
      {tab === 'Permission History' && <PermissionHistoryTab history={permissionHistory} />}
      {tab === 'Login History' && <LoginHistoryTab sessions={sessions} />}
      {tab === 'User Activity' && <UserActivityTab activity={activity} />}
      {tab === 'User Documents' && <UserDocumentsTab userId={userId} documents={documents} onRefresh={load} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Details
// ---------------------------------------------------------------------------

function UserDetailsTab({ user, isSelf, onRefresh }: { user: User; isSelf: boolean; onRefresh: () => void }) {
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState(false)

  const toggleActive = async () => {
    setToggling(true)
    try {
      if (user.is_active) await usersApi.deactivate(user.id)
      else await usersApi.activate(user.id)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to update user status.').join(' '))
    } finally {
      setToggling(false)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', margin: 0 }}>User Details</h2>
        <button
          onClick={toggleActive}
          disabled={isSelf || toggling}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '9px 16px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', color: user.is_active ? '#b91c1c' : '#047857', cursor: isSelf ? 'not-allowed' : 'pointer', opacity: isSelf ? 0.5 : 1 }}
        >
          {user.is_active ? 'Deactivate User' : 'Activate User'}
        </button>
      </div>
      <MessageDialog open={!!error} variant="error" title="User Error" message={error} onClose={() => setError('')} />
      <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '0 0 16px' }}>Name, email, designation, department, and office location are synced from Azure AD and aren&apos;t editable here.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div><div style={labelStyle}>Full Name</div><div style={valueStyle}>{user.name}</div></div>
        <div><div style={labelStyle}>Email</div><div style={valueStyle}>{user.email}</div></div>
        <div><div style={labelStyle}>Designation</div><div style={valueStyle}>{user.designation || '—'}</div></div>
        <div><div style={labelStyle}>Department</div><div style={valueStyle}>{user.department || '—'}</div></div>
        <div><div style={labelStyle}>Office Location</div><div style={valueStyle}>{user.office_location || '—'}</div></div>
        <div><div style={labelStyle}>Branch</div><div style={valueStyle}>{user.branch_name || '—'}</div></div>
        <div><div style={labelStyle}>Reporting Manager</div><div style={valueStyle}>{user.reporting_manager_name || '—'}</div></div>
        <div><div style={labelStyle}>Phone</div><div style={valueStyle}>{user.phone || '—'}</div></div>
        <div><div style={labelStyle}>Role</div><div style={{ ...valueStyle, textTransform: 'capitalize' }}>{user.role}</div></div>
        <div><div style={labelStyle}>Date of Joining</div><div style={valueStyle}>{user.date_of_joining || '—'}</div></div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

function emptyAssignment() {
  return { branch_id: '', employee_id: '', department_id: '', designation: '', role: '', access_level: '', is_primary_branch: false, effective_from: '', effective_to: '', status: 'active' }
}

function AssignmentsTab({ user, assignments, branches, departments, onRefresh }: {
  user: User; assignments: BranchUserAssignment[]; branches: Branch[]; departments: Department[]; onRefresh: () => void
}) {
  const [editing, setEditing] = useState<BranchUserAssignment | null>(null)
  const [form, setForm] = useState(emptyAssignment())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchUserAssignment | null>(null)

  const startEdit = (a: BranchUserAssignment) => {
    setEditing(a)
    setForm({
      branch_id: String(a.branch_id), employee_id: a.employee_id || '', department_id: a.department_id ? String(a.department_id) : '',
      designation: a.designation || '', role: a.role || '', access_level: a.access_level || '',
      is_primary_branch: a.is_primary_branch, effective_from: a.effective_from || '', effective_to: a.effective_to || '', status: a.status,
    })
  }
  const cancel = () => { setEditing(null); setForm(emptyAssignment()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.branch_id) { setError('Branch is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        user_id: user.id,
        department_id: form.department_id ? Number(form.department_id) : null,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
      }
      if (editing) await organizationApi.updateBranchUserAssignment(editing.branch_id, editing.id, payload)
      else await organizationApi.createBranchUserAssignment(Number(form.branch_id), payload)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save assignment.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteBranchUserAssignment(deleteTarget.branch_id, deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete assignment.').join(' '))
      setDeleteTarget(null)
    }
  }

  const departmentsForBranch = form.branch_id ? departments.filter((d) => d.branch_id === Number(form.branch_id)) : departments

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editing ? 'Edit Assignment' : 'Add Assignment'}</h2>
        {editing && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Assignment Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Remove this assignment?" message={`Remove this branch assignment for "${user.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Branch *">
          <select style={inputStyle} value={form.branch_id} onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))} disabled={!!editing}>
            <option value="">— Select —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Employee ID"><input style={inputStyle} value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} /></Field>
        <Field label="Department">
          <select style={inputStyle} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
            <option value="">— Select —</option>
            {departmentsForBranch.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Designation"><input style={inputStyle} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} /></Field>
        <Field label="Role"><input style={inputStyle} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} /></Field>
        <Field label="Access Level">
          <select style={inputStyle} value={form.access_level} onChange={(e) => setForm((f) => ({ ...f, access_level: e.target.value }))}>
            <option value="">— Select —</option>
            <option value="view">View</option>
            <option value="edit">Edit</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Effective From"><input type="date" style={inputStyle} value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} /></Field>
        <Field label="Effective To"><input type="date" style={inputStyle} value={form.effective_to} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}><input type="checkbox" checked={form.is_primary_branch} onChange={(e) => setForm((f) => ({ ...f, is_primary_branch: e.target.checked }))} /> Primary Branch</label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Assignment'}</button>
        </div>
      </form>

      {assignments.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No branch assignments yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assignments.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{branches.find((b) => b.id === a.branch_id)?.name || `Branch #${a.branch_id}`}</span>
                    {a.role && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{a.role}</span>}
                    {a.is_primary_branch && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[a.designation, a.department_name, a.access_level, a.employee_id].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Permissions
// ---------------------------------------------------------------------------

const ERP_PERMISSION_GROUPS: { label: string; icon: string; perms: { id: string; label: string }[] }[] = [
  { label: 'Projects', icon: '📁', perms: [{ id: 'project_view', label: 'View' }, { id: 'project_create', label: 'Create' }, { id: 'project_edit', label: 'Edit' }, { id: 'project_delete', label: 'Delete' }] },
  { label: 'Service Requests', icon: '🔧', perms: [{ id: 'sr_view', label: 'View' }, { id: 'sr_create', label: 'Create' }, { id: 'sr_edit', label: 'Edit' }, { id: 'sr_delete', label: 'Delete' }] },
]

const P2P_PERMISSION_GROUPS: { label: string; icon: string; perms: { id: string; label: string }[] }[] = [
  { label: 'Purchase Requisition', icon: '📝', perms: [{ id: 'pr_create', label: 'Create' }] },
  { label: 'Approval', icon: '✅', perms: [{ id: 'approval_view', label: 'View' }, { id: 'approval_action', label: 'Action' }] },
  { label: 'RFQ', icon: '📄', perms: [{ id: 'rfq_view', label: 'View' }, { id: 'rfq_action', label: 'Action' }] },
  { label: 'GRN', icon: '📦', perms: [{ id: 'grn_view', label: 'View' }, { id: 'grn_action', label: 'Action' }] },
]

function UserPermissionsTab({ user, apps, onRefresh }: { user: User; apps: { id: string; label: string }[]; onRefresh: () => void }) {
  const isAdminRole = user.role === 'admin'
  const [selected, setSelected] = useState<string[]>(user.assigned_apps || [])
  const [erpPerms, setErpPerms] = useState<string[]>(user.erp_permissions || [])
  const [isPurchaseHead, setIsPurchaseHead] = useState(!!user.is_purchase_head)
  const [isDirector, setIsDirector] = useState(!!user.is_director)
  const [isMd, setIsMd] = useState(!!user.is_md)
  const [isFinanceManager, setIsFinanceManager] = useState(!!user.is_finance_manager)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = (app: string) => setSelected((prev) => (prev.includes(app) ? prev.filter((a) => a !== app) : [...prev, app]))
  const togglePerm = (perm: string) => setErpPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await usersApi.updateModuleAccess(user.id, selected, erpPerms, isPurchaseHead, isDirector, isMd, isFinanceManager)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save module access.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px' }}>User Permissions</h2>
      <MessageDialog open={!!error} variant="error" title="Cannot Save Module Access" message={error} onClose={() => setError('')} />

      <p style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 10px' }}>Module Access</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {apps.map((a) => (
          <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, opacity: isAdminRole ? 0.5 : 1, fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
            <Checkbox disabled={isAdminRole} checked={isAdminRole || selected.includes(a.id)} onChange={() => toggle(a.id)} />
            {a.label}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '10px 0 0' }}>Admins have access to all modules automatically.</p>

      <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.5)' }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 10px' }}>Approval Roles</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: isPurchaseHead ? '1px solid #c2410c' : `1px solid ${BORDER.normal}`, background: isPurchaseHead ? 'rgba(234,88,12,0.06)' : '#fff', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
            <Checkbox checked={isPurchaseHead} onChange={() => setIsPurchaseHead((v) => !v)} />
            Purchase Head
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: isDirector ? '1px solid #7c3aed' : `1px solid ${BORDER.normal}`, background: isDirector ? 'rgba(124,58,237,0.06)' : '#fff', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
            <Checkbox checked={isDirector} onChange={() => setIsDirector((v) => !v)} />
            Director
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: isMd ? '1px solid #be123c' : `1px solid ${BORDER.normal}`, background: isMd ? 'rgba(190,18,60,0.06)' : '#fff', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
            <Checkbox checked={isMd} onChange={() => setIsMd((v) => !v)} />
            MD
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: isFinanceManager ? '1px solid #0f766e' : `1px solid ${BORDER.normal}`, background: isFinanceManager ? 'rgba(15,118,110,0.06)' : '#fff', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
            <Checkbox checked={isFinanceManager} onChange={() => setIsFinanceManager((v) => !v)} />
            Finance Manager
          </span>
        </div>
      </div>

      {!isAdminRole && selected.includes('erp') && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.5)' }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }}>ERP Permissions</p>
          {ERP_PERMISSION_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading, margin: '0 0 6px' }}>{group.icon} {group.label}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {group.perms.map((p) => (
                  <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: erpPerms.includes(p.id) ? '1px solid #FF7A45' : `1px solid ${BORDER.normal}`, background: erpPerms.includes(p.id) ? 'rgba(244,113,59,0.05)' : '#fff', color: erpPerms.includes(p.id) ? '#FF7A45' : TEXT.heading, fontSize: 12.5, fontWeight: 600 }}>
                    <Checkbox checked={erpPerms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isAdminRole && selected.includes('p2p') && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.5)' }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }}>Procure-to-Pay Permissions</p>
          {P2P_PERMISSION_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading, margin: '0 0 6px' }}>{group.icon} {group.label}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {group.perms.map((p) => (
                  <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: erpPerms.includes(p.id) ? '1px solid #FF7A45' : `1px solid ${BORDER.normal}`, background: erpPerms.includes(p.id) ? 'rgba(244,113,59,0.05)' : '#fff', color: erpPerms.includes(p.id) ? '#FF7A45' : TEXT.heading, fontSize: 12.5, fontWeight: 600 }}>
                    <Checkbox checked={erpPerms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, padding: '10px 24px', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Permissions'}</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Permission Matrix
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve',
  reject: 'Reject', export: 'Export', print: 'Print', import: 'Import',
}
const SCOPE_LABELS: Record<string, string> = {
  own: 'Own Records', department: 'Department', branch: 'Branch', company: 'Company-wide', all: 'All',
}

function PermissionMatrixTab({ user, registry, onRefresh }: { user: User; registry: PermissionRegistry; onRefresh: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(user.granular_permissions || []))
  const [scopes, setScopes] = useState<Record<string, string>>(user.data_access_scopes || {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllForRow = (ids: string[]) => {
    const allOn = ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await usersApi.updatePermissions(user.id, Array.from(selected), scopes)
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save permission matrix.')
    } finally {
      setSaving(false)
    }
  }

  const moduleCount = Object.keys(registry.modules).filter((mk) => Array.from(selected).some((id) => id.startsWith(`${mk}:`))).length

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Permission Matrix</h2>
        <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Matrix'}</button>
      </div>
      <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '0 0 16px' }}>
        {selected.size} action permission(s) granted across {moduleCount} module(s). Additive to the Module Access checklist on the User Permissions tab — nothing outside this admin screen reads these grants yet.
      </p>
      <MessageDialog open={!!error} variant="error" title="Permission Matrix Error" message={error} onClose={() => setError('')} />

      {Object.entries(registry.modules).map(([moduleKey, mod]) => {
        const subtabEntries = Object.keys(mod.subtabs).length > 0 ? Object.entries(mod.subtabs) : [['', mod.label] as [string, string]]
        return (
          <div key={moduleKey} style={{ marginBottom: 18, borderRadius: 12, border: `1px solid ${BORDER.normal}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(244,113,59,0.06)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{mod.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: TEXT.muted }}>Data Access Scope</span>
                <select
                  style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
                  value={scopes[moduleKey] || ''}
                  onChange={(e) => setScopes((s) => ({ ...s, [moduleKey]: e.target.value }))}
                >
                  <option value="">— Default —</option>
                  {registry.scopes.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s] || s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase' }}>Section</th>
                    {registry.actions.map((a) => (
                      <th key={a} style={{ padding: '8px 6px', fontSize: 10.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', textAlign: 'center' }}>{ACTION_LABELS[a] || a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subtabEntries.map(([subtabKey, subtabLabel]) => {
                    const rowIds = registry.actions.map((a) => `${moduleKey}:${subtabKey}:${a}`)
                    return (
                      <tr key={subtabKey} style={{ borderTop: `1px solid ${BORDER.normal}` }}>
                        <td style={{ padding: '8px 14px', fontSize: 12.5, color: TEXT.body }}>
                          <span style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => toggleAllForRow(rowIds)} title="Toggle all actions in this row">{subtabLabel}</span>
                        </td>
                        {registry.actions.map((a) => {
                          const id = `${moduleKey}:${subtabKey}:${a}`
                          return (
                            <td key={a} style={{ padding: '6px', textAlign: 'center' }}>
                              <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, padding: '10px 24px', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Matrix'}</button>
      </div>
    </div>
  )
}

function PermissionHistoryTab({ history }: { history: UserActivity[] }) {
  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Permission History</h2>
      {history.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No permission changes recorded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.map((h) => (
            <div key={h.id} style={cardRowStyle}>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{h.summary || h.action}</span>
              <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{new Date(h.performed_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Login History / User Activity (read-only)
// ---------------------------------------------------------------------------

function LoginHistoryTab({ sessions }: { sessions: UserSession[] }) {
  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Login History</h2>
      {sessions.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No sessions recorded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map((s) => (
            <div key={s.id} style={cardRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{new Date(s.created_at).toLocaleString()}</span>
                {s.revoked_at && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>REVOKED</span>}
              </div>
              <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Last used {new Date(s.last_used_at).toLocaleString()} · Expires {new Date(s.expires_at).toLocaleString()}{s.user_agent ? ` · ${s.user_agent}` : ''}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserActivityTab({ activity }: { activity: UserActivity[] }) {
  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>User Activity</h2>
      {activity.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No activity recorded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activity.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{a.action}</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{a.entity_type}</span>
              </div>
              <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{a.summary || '—'} · {new Date(a.performed_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Documents
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES = ['ID Proof', 'Offer Letter', 'Certificate', 'Agreement', 'Other']
const CONFIDENTIALITY_LEVELS = ['Public', 'Internal', 'Confidential']

function emptyDocumentMeta() {
  return { document_type: 'Other', document_name: '', document_number: '', issue_date: '', expiry_date: '', issuing_authority: '', confidentiality: 'Confidential', tags: '', remarks: '' }
}

function UserDocumentsTab({ userId, documents, onRefresh }: { userId: number; documents: UserDocument[]; onRefresh: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState(emptyDocumentMeta())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<UserDocument | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Select a file to upload'); return }
    if (!meta.document_name.trim()) { setError('Document Name is required'); return }
    setSaving(true)
    setError('')
    try {
      await usersApi.uploadUserDocument(userId, file, meta)
      setFile(null)
      setMeta(emptyDocumentMeta())
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to upload document.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await usersApi.deleteUserDocument(userId, deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete document.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Add User Document</h2>

      <MessageDialog open={!!error} variant="error" title="Document Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this document?" message={`Delete "${deleteTarget?.document_name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Document File *"><FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} /></Field></div>
        <Field label="Document Type *">
          <select style={inputStyle} value={meta.document_type} onChange={(e) => setMeta((m) => ({ ...m, document_type: e.target.value }))}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Document Name *"><input style={inputStyle} value={meta.document_name} onChange={(e) => setMeta((m) => ({ ...m, document_name: e.target.value }))} /></Field>
        <Field label="Document Number"><input style={inputStyle} value={meta.document_number} onChange={(e) => setMeta((m) => ({ ...m, document_number: e.target.value }))} /></Field>
        <Field label="Issue Date"><input type="date" style={inputStyle} value={meta.issue_date} onChange={(e) => setMeta((m) => ({ ...m, issue_date: e.target.value }))} /></Field>
        <Field label="Expiry Date"><input type="date" style={inputStyle} value={meta.expiry_date} onChange={(e) => setMeta((m) => ({ ...m, expiry_date: e.target.value }))} /></Field>
        <Field label="Issuing Authority"><input style={inputStyle} value={meta.issuing_authority} onChange={(e) => setMeta((m) => ({ ...m, issuing_authority: e.target.value }))} /></Field>
        <Field label="Confidentiality">
          <select style={inputStyle} value={meta.confidentiality} onChange={(e) => setMeta((m) => ({ ...m, confidentiality: e.target.value }))}>
            {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tags (comma separated)"><input style={inputStyle} value={meta.tags} onChange={(e) => setMeta((m) => ({ ...m, tags: e.target.value }))} /></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Remarks"><input style={inputStyle} value={meta.remarks} onChange={(e) => setMeta((m) => ({ ...m, remarks: e.target.value }))} /></Field></div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Uploading…' : 'Save Document'}</button>
        </div>
      </form>

      {documents.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No documents uploaded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((d) => (
            <div key={d.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.document_name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{d.document_type}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{d.filename}{d.expiry_date ? ` · Expires ${d.expiry_date}` : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {d.sharepoint_url && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(d)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
