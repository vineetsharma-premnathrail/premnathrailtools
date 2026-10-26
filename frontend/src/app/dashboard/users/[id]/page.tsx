'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { approvalsApi, usersApi, organizationApi, rolesApi, securityApi } from '@/lib/api'
import { User, BranchUserAssignment, Branch, Department, UserSession, UserActivity, UserDocument, PermissionRegistry, Role, EffectivePermissions, UserDataScopeRow, ApprovesInUser } from '@/types'
import PermissionMatrixEditor from '@/components/organization/PermissionMatrixEditor'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import OrgListItem, { orgEmptyStyle } from '@/components/organization/OrgListItem'
import Checkbox from '@/components/Checkbox'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadField from '@/components/shared/FileUploadField'
import TourButton from '@/components/tour/TourButton'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useSodGuard } from '@/components/organization/useSodGuard'
import AccessGovernancePanel from '@/components/organization/AccessGovernancePanel'
import { moduleWords } from '@/lib/permissionWords'
import ApprovesInPanel from '@/components/organization/ApprovesInPanel'
import { governedUsersApi } from '@/lib/basisApi'
import DateField from '@/components/erp/DateField'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { formatDate, formatDateTime } from '@/lib/format'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, border: `1px solid ${BORDER.normal}`,
  background: '#fff', fontSize: 13, outline: 'none', color: TEXT.body,
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }

const sheetErrBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }

/** A label + control cell inside a FormSheet row; `grow` cells share the leftover width. */
function SheetField({ label, req, tour, basis = 200, children }: { label: string; req?: boolean; tour?: string; basis?: number; children: React.ReactNode }) {
  return (
    <div data-tour={tour} style={{ flex: `1 1 ${basis}px`, minWidth: 0 }}>
      <label style={sheetLabel}>{label} {req ? <Req /> : <Optional />}</label>
      {children}
    </div>
  )
}
const sheetRow: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }

const TABS = ['User Details', 'Assignments', 'Roles & Permissions', 'Data Access', 'Permission History', 'Login History', 'User Activity', 'User Documents'] as const

export default function UserDetailPage() {
  const { user: currentUser, isAuthorized, isLoading } = useRequireOrgTab('users')
  const { can, canFeature } = useCan()
  // The permission registry / roles tab needs Organization › Role & Permissions 'View'.
  const canViewRoles = can('organization', 'roles', 'view')
  // User tabs are features (core/features/organization.py): users.assignments / documents /
  // login_history / activity, and roles.data_access for the Data Access tab.
  const seeTab = (t: typeof TABS[number]) => ({
    'User Details': true,
    Assignments: canFeature('organization', 'users', 'assignments', 'view'),
    'Roles & Permissions': canViewRoles,
    'Data Access': canFeature('organization', 'roles', 'data_access', 'view'),
    'Permission History': canFeature('organization', 'users', 'activity', 'view'),
    'Login History': canFeature('organization', 'users', 'login_history', 'view'),
    'User Activity': canFeature('organization', 'users', 'activity', 'view'),
    'User Documents': canFeature('organization', 'users', 'documents', 'view'),
  } as Record<typeof TABS[number], boolean>)[t]
  const params = useParams()
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(params.id as string)
  const userId = recordId ?? 0

  const [user, setUser] = useState<User | null>(null)
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
      seeTab('Assignments') ? usersApi.listUserAssignments(userId) : Promise.resolve([]),
      organizationApi.listBranches(),
      organizationApi.listDepartments(),
      seeTab('Login History') ? usersApi.listUserSessions(userId) : Promise.resolve([]),
      seeTab('User Activity') ? usersApi.listUserActivity(userId) : Promise.resolve([]),
      seeTab('User Documents') ? usersApi.listUserDocuments(userId) : Promise.resolve([]),
      canViewRoles ? usersApi.getPermissionRegistry() : Promise.resolve(null),
      seeTab('Permission History') ? usersApi.listPermissionHistory(userId) : Promise.resolve([]),
    ])
      .then(([u, a, b, d, s, act, docs, reg, permHist]) => {
        setUser(u)
        setAssignments(a); setBranches(b); setDepartments(d); setSessions(s); setActivity(act); setDocuments(docs)
        setRegistry(reg); setPermissionHistory(permHist)
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load this user (profile, sessions, activity, documents or permission matrix). Reload the page; if it keeps failing, check the user still exists in Users & Roles.').join(' ')))
  }

  useEffect(() => {
    if (isAuthorized && userId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, userId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return <InvalidRecordLink message={linkError} listHref="/dashboard/users" listLabel="Back to users" />

  if (error) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button type="button" onClick={() => router.push('/dashboard/users')} style={secondaryBtnStyle}>← Back</button>
        </div>
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      </div>
    )
  }

  if (!user) return null

  const isSelf = user.id === currentUser?.id

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Organization › Users</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{user.name}</h1>
            <span data-tour="org-user-status"><Pill label={user.is_active ? 'Active' : 'Inactive'} hex={user.is_active ? '#047857' : '#64748B'} /></span>
          </div>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '6px 0 0 0' }}>{[user.email, user.designation, user.department].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TourButton variant="icon" />
          <button type="button" data-tour="org-user-back" onClick={() => router.push('/dashboard/users')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
        {TABS.filter(seeTab).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-tour={`org-user-tab-${t.toLowerCase().replace(/ /g, '-')}`}
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

      {(tab === 'User Details' || !seeTab(tab)) && <UserDetailsTab user={user} isSelf={isSelf} onRefresh={load} />}
      {tab === 'Assignments' && seeTab(tab) && <AssignmentsTab user={user} assignments={assignments} branches={branches} departments={departments} onRefresh={load} />}
      {tab === 'Roles & Permissions' && registry && <RolesPermissionsTab user={user} registry={registry} onRefresh={load} />}
      {tab === 'Permission History' && seeTab(tab) && <PermissionHistoryTab history={permissionHistory} />}
      {tab === 'Data Access' && seeTab(tab) && <DataAccessTab userId={userId} />}
      {tab === 'Login History' && seeTab(tab) && <LoginHistoryTab userId={userId} sessions={sessions} onRefresh={load} />}
      {tab === 'User Activity' && seeTab(tab) && <UserActivityTab activity={activity} />}
      {tab === 'User Documents' && seeTab(tab) && <UserDocumentsTab userId={userId} documents={documents} onRefresh={load} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Details
// ---------------------------------------------------------------------------

function UserDetailsTab({ user, isSelf, onRefresh }: { user: User; isSelf: boolean; onRefresh: () => void }) {
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState(false)
  const { can } = useCan()
  // Approval stages this person takes part in (read-only; set up in Approval Workflows).
  const [approvesIn, setApprovesIn] = useState<ApprovesInUser | null>(null)
  const [approvesErr, setApprovesErr] = useState('')
  const [askDeactivate, setAskDeactivate] = useState(false)

  useEffect(() => {
    approvalsApi.approvesInUser(user.id).then(setApprovesIn)
      .catch((err) => setApprovesErr(extractErrorMessages(err, 'Could not load the approvals this person takes part in.').join(' ')))
  }, [user.id])

  // Deactivating someone who is the only approver of a stage, or who has
  // approvals waiting on them, leaves documents stuck — say so first.
  const soleStages = (approvesIn?.stages || []).filter((r) => r.sole && r.kind === 'approver' && r.workflow_active)
  const deactivateWarning = [
    soleStages.length ? `${user.name} is the only approver of: ${soleStages.map((r) => `${r.module_label} › ${r.document} (stage ${r.stage_sequence} “${r.stage_name}”)`).join('; ')} — those documents will be refused on submit until another approver is set in Organization › Approval Workflows.` : '',
    approvesIn?.pending_steps ? `${approvesIn.pending_steps} approval(s) are waiting on ${user.name} now. They stay with them until escalation or an admin acts — if they are leaving or moving, complete their exit / transfer in HR › Lifecycle first, which hands them to the handover person.` : '',
  ].filter(Boolean).join(' ')

  const toggleActive = async (confirmed = false) => {
    if (!confirmed && user.is_active && deactivateWarning) { setAskDeactivate(true); return }
    setAskDeactivate(false)
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
    <DetailCard>
      <MessageDialog open={!!error} variant="error" title="User Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={askDeactivate} title="Deactivate an approver?" confirmLabel="Deactivate anyway"
        message={deactivateWarning} onConfirm={() => toggleActive(true)} onCancel={() => setAskDeactivate(false)} />
      <DetailSummary
        title="Profile"
        text="Name, email, designation, department and office location are synced from Azure AD and aren't editable here."
        meta={<>
          <span>Portal role: {user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '—'}</span>
          {user.date_of_joining && <><span>·</span><span>Joined {formatDate(user.date_of_joining)}</span></>}
          {approvesIn?.pending_steps ? <><span>·</span><Pill label={`${approvesIn.pending_steps} approval(s) waiting`} hex="#b45309" /></> : null}
        </>}
        actions={can('organization', 'users', 'edit') ? <button
          onClick={() => toggleActive()}
          data-tour="org-user-toggle-active"
          disabled={isSelf || toggling}
          title={isSelf ? 'You cannot deactivate your own account' : undefined}
          style={{ ...secondaryBtnStyle, color: user.is_active ? '#b91c1c' : '#047857', cursor: isSelf ? 'not-allowed' : 'pointer', opacity: isSelf ? 0.5 : 1 }}
        >
          {user.is_active ? 'Deactivate User' : 'Activate User'}
        </button> : undefined}
      />
      <div data-tour="org-user-details-grid">
        <DetailGroup title="Work & contact">
          <DetailRow label="Designation">{user.designation}</DetailRow>
          <DetailRow label="Department">{user.department}</DetailRow>
          <DetailRow label="Office location">{user.office_location}</DetailRow>
          <DetailRow label="Branch">{user.branch_name}</DetailRow>
          <DetailRow label="Reporting manager">{user.reporting_manager_name}</DetailRow>
          <DetailRow label="Date of joining">{user.date_of_joining ? formatDate(user.date_of_joining) : null}</DetailRow>
          <DetailRow label="Phone">{user.phone}</DetailRow>
        </DetailGroup>
      </div>
      <DetailGroup title="Approves in" last>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 10px' }}>
          Read-only — the approval stages this person can decide, from Organization › Approval Workflows (the only place approvals are set up).
        </p>
        <ApprovesInPanel rows={approvesIn ? approvesIn.stages : null} error={approvesErr} empty="Not an approver in any workflow." />
      </DetailGroup>
    </DetailCard>
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
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyAssignment())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchUserAssignment | null>(null)
  const { canFeature } = useCan()
  // Same rule as the backend: User › Assignments 'Edit' or Plant › Users 'Edit' maintains plant assignments.
  const canEditAsg = canFeature('organization', 'users', 'assignments', 'edit') || canFeature('organization', 'branches', 'user_assignments', 'edit')

  const startAdd = () => { setEditing(null); setForm(emptyAssignment()); setFormError(''); setFormOpen(true) }
  const startEdit = (a: BranchUserAssignment) => {
    setEditing(a)
    setFormError('')
    setFormOpen(true)
    setForm({
      branch_id: String(a.branch_id), employee_id: a.employee_id || '', department_id: a.department_id ? String(a.department_id) : '',
      designation: a.designation || '', role: a.role || '', access_level: a.access_level || '',
      is_primary_branch: a.is_primary_branch, effective_from: a.effective_from || '', effective_to: a.effective_to || '', status: a.status,
    })
  }
  const cancel = () => { setEditing(null); setForm(emptyAssignment()); setFormOpen(false) }

  const submit = async () => {
    if (!form.branch_id) { setFormError('Branch is required'); return }
    setSaving(true)
    setFormError('')
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
      setFormError(detail || 'Failed to save assignment.')
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Assignments</h2>
        {canEditAsg && <button type="button" data-tour="org-user-asg-add" onClick={startAdd} style={primaryBtnStyle}>+ Add Assignment</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Assignment Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Remove this assignment?" message={`Remove this branch assignment for "${user.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {canEditAsg && formOpen && (
        <FormSheet width={640} icon="building" title={editing ? 'Edit Assignment' : 'Add Assignment'}
          subtitle={editing ? `${user.name} at ${branches.find((b) => b.id === editing.branch_id)?.name || `Branch #${editing.branch_id}`}` : `Post ${user.name} to a branch`}
          onClose={cancel} busy={saving}
          footer={<>
            <button type="button" data-tour="org-user-asg-cancel" onClick={cancel} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" data-tour="org-user-asg-save" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Assignment'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formError && <div style={sheetErrBox}>{formError}</div>}
            <SheetSection icon="building" title="Branch & post">
              <div style={sheetRow}>
                <SheetField label="Branch" req>
                  <Select data-tour="org-user-asg-branch" style={sheetInput} value={form.branch_id} onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))} disabled={!!editing}>
                    <option value="">— Select —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </SheetField>
                <SheetField label="Employee ID"><input data-tour="org-user-asg-empid" style={sheetInput} value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} /></SheetField>
              </div>
              {editing && <p style={{ ...sheetHint, margin: '-8px 0 14px' }}>Branch is locked while editing — remove and re-add to move someone to a different branch.</p>}
              <div style={sheetRow}>
                <SheetField label="Department">
                  <Select data-tour="org-user-asg-dept" style={sheetInput} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
                    <option value="">— Select —</option>
                    {departmentsForBranch.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </SheetField>
                <SheetField label="Designation"><input data-tour="org-user-asg-designation" style={sheetInput} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} /></SheetField>
              </div>
              <div style={{ ...sheetRow, marginBottom: 0 }}>
                <SheetField label="Role"><input data-tour="org-user-asg-role" style={sheetInput} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} /></SheetField>
                <SheetField label="Access Level">
                  <Select data-tour="org-user-asg-access" style={sheetInput} value={form.access_level} onChange={(e) => setForm((f) => ({ ...f, access_level: e.target.value }))}>
                    <option value="">— Select —</option>
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                    <option value="admin">Admin</option>
                  </Select>
                </SheetField>
              </div>
            </SheetSection>
            <SheetSection icon="calendar" title="Validity & status">
              <div style={sheetRow}>
                <SheetField label="Effective From" tour="org-user-asg-from" basis={160}><DateField value={form.effective_from} onChange={(v) => setForm((f) => ({ ...f, effective_from: v }))} /></SheetField>
                <SheetField label="Effective To" tour="org-user-asg-to" basis={160}><DateField value={form.effective_to} onChange={(v) => setForm((f) => ({ ...f, effective_to: v }))} /></SheetField>
                <SheetField label="Status" req basis={140}>
                  <Select data-tour="org-user-asg-status" style={sheetInput} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </SheetField>
              </div>
              <div data-tour="org-user-asg-primary">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY }}><input type="checkbox" checked={form.is_primary_branch} onChange={(e) => setForm((f) => ({ ...f, is_primary_branch: e.target.checked }))} /> Primary Branch</label>
                <p style={sheetHint}>Tick for the person&apos;s main branch (one per person). Leave Effective To blank if open-ended.</p>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {assignments.length === 0 ? <p style={orgEmptyStyle}>No branch assignments yet{canEditAsg ? ' — use + Add Assignment to post this person to a branch.' : '.'}</p> : (
        <div data-tour="org-user-asg-list">
          {assignments.map((a, i) => (
            <OrgListItem key={a.id} last={i === assignments.length - 1}
              title={branches.find((b) => b.id === a.branch_id)?.name || `Branch #${a.branch_id}`}
              sub={a.role || undefined}
              tags={<>{a.is_primary_branch && <Pill label="Primary branch" hex="#047857" />}{a.status && a.status !== 'active' && <Pill label="Inactive" hex="#64748b" />}</>}
              body={[a.designation, a.department_name, a.access_level ? `${a.access_level.charAt(0).toUpperCase()}${a.access_level.slice(1)} access` : '', a.employee_id ? `Emp. ID ${a.employee_id}` : '', a.effective_from ? `From ${formatDate(a.effective_from)}${a.effective_to ? ` to ${formatDate(a.effective_to)}` : ''}` : ''].filter(Boolean).join(' · ') || '—'}
              action={canEditAsg ? <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>
                <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Remove</button>
              </div> : null} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Roles & Permissions
// ---------------------------------------------------------------------------

// Approval-routing flags — who an approval goes to, not what a user may do
// (that comes from roles). Workflow stages pick approvers by these flags
// (Organization › Workflows, rule "Users with a flag"). Partner is set only in
// Company Info › Partners, so it is shown read-only below.
const APPROVAL_ROLE_FLAGS: { key: string; label: string; hex: string; hint: string }[] = [
  { key: 'is_director', label: 'Director', hex: '#7c3aed', hint: 'Director stages (e.g. large sales orders) and project management' },
  { key: 'is_department_head', label: 'Department Head', hex: '#0f766e', hint: 'Flag-based stages and Sales Head fallback. "Department head" stages use the heads set in Organization › Department' },
  { key: 'is_plant_head', label: 'Plant Head', hex: '#0f766e', hint: 'Flag-based stages. "Plant head" stages use the head set on the plant (Organization › Branches)' },
  { key: 'is_project_head', label: 'Project Head', hex: '#0f766e', hint: 'Flag-based approval stages' },
  { key: 'is_purchase_head', label: 'Purchase Head', hex: '#1d4ed8', hint: 'Purchase stage of NCR disposition and flag-based stages' },
  { key: 'is_finance_manager', label: 'Finance Manager', hex: '#1d4ed8', hint: 'Purchase-invoice variances, period close, depreciation and year-end close' },
  { key: 'is_purchase_manager', label: 'Purchase Manager', hex: '#1d4ed8', hint: 'Flag-based approval stages' },
  { key: 'is_store_manager', label: 'Store Manager', hex: '#1d4ed8', hint: 'Flag-based approval stages (store-specific approvals use the store location manager)' },
  { key: 'is_production_manager', label: 'Production Manager', hex: '#b45309', hint: 'RRV build sign-off and flag-based stages' },
  { key: 'is_design_manager', label: 'Design Manager', hex: '#b45309', hint: 'Flag-based approval stages' },
  { key: 'is_rnd_manager', label: 'R&D Manager', hex: '#b45309', hint: 'Flag-based approval stages' },
  { key: 'is_project_manager', label: 'Project Manager', hex: '#b45309', hint: 'Flag-based approval stages' },
]

function RolesPermissionsTab({ user, registry, onRefresh }: { user: User; registry: PermissionRegistry; onRefresh: () => void }) {
  const router = useRouter()
  const isAdminRole = user.role === 'admin'
  const { can, user: me } = useCan()
  // Mirrors the backend: nobody but an admin changes their own roles, extras or approval flags.
  const meIsAdmin = me?.role === 'admin' || !!(me as { is_azure_admin?: boolean } | null)?.is_azure_admin
  const selfLocked = !meIsAdmin && me?.id === user.id
  // Roles / Extra permissions are features of Role & Permissions (core/features/organization.py).
  const { canFeature } = useCan()
  const canEditRoles = canFeature('organization', 'roles', 'members', 'edit') && !selfLocked
  const canEditExtras = canFeature('organization', 'roles', 'extra_permissions', 'edit') && !selfLocked
  const seeExtras = canFeature('organization', 'roles', 'extra_permissions', 'view')
  const canEditFlags = can('organization', 'users', 'edit') && !selfLocked
  const [roles, setRoles] = useState<Role[]>([])
  const [effective, setEffective] = useState<EffectivePermissions | null>(null)
  const [roleIds, setRoleIds] = useState<number[]>(user.role_ids || [])
  const [extras, setExtras] = useState<string[]>(user.granular_permissions || [])
  const [roleFlags, setRoleFlags] = useState<Record<string, boolean>>(
    Object.fromEntries(APPROVAL_ROLE_FLAGS.map((f) => [f.key, !!(user as unknown as Record<string, boolean>)[f.key]]))
  )
  const [showExtras, setShowExtras] = useState((user.granular_permissions || []).length > 0)
  const [roleQuery, setRoleQuery] = useState('')
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // GRC: SoD conflict warning / mitigation reason before saving roles or extras.
  const sod = useSodGuard()

  const loadEffective = () => usersApi.getEffectivePermissions(user.id).then(setEffective)

  useEffect(() => {
    Promise.all([rolesApi.list(), usersApi.getEffectivePermissions(user.id)])
      .then(([r, eff]) => { setRoles(r); setEffective(eff) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load roles for this user. Reload the page.').join(' ')))
  }, [user.id])

  const run = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setSaving(what); setError('')
    try {
      await fn()
      await loadEffective()
      onRefresh()
      setNotice(ok)
    } catch (err) {
      setError(extractErrorMessages(err, `Could not save ${what}.`).join(' '))
    } finally {
      setSaving('')
    }
  }

  // Grants that come from roles (locked in the extras editor).
  const fromRoles = useMemo(() => {
    const out: Record<string, string[]> = {}
    Object.entries(effective?.grants || {}).forEach(([g, src]) => {
      const roleSrc = src.filter((x) => x !== 'Extra')
      if (roleSrc.length) out[g] = roleSrc
    })
    return out
  }, [effective])

  const assignable = roles.filter((r) => !r.is_default && (r.is_active || roleIds.includes(r.id)))
  const q = roleQuery.trim().toLowerCase()
  const shown = assignable.filter((r) => roleIds.includes(r.id) || !q || r.name.toLowerCase().includes(q))
  const everyone = roles.filter((r) => r.is_default && r.is_active)
  const rolesChanged = JSON.stringify([...roleIds].sort()) !== JSON.stringify([...(user.role_ids || [])].sort())
  const extrasChanged = JSON.stringify([...extras].sort()) !== JSON.stringify([...(user.granular_permissions || [])].sort())

  if (isAdminRole) {
    return (
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Roles &amp; Permissions</h2>
        <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{user.name} is an <b>Admin</b> — admins can see and do everything in every module, so roles don&apos;t apply. Change their role to User on the User Details tab to manage their access with roles.</p>
      </div>
    )
  }

  return (
    <div>
      <MessageDialog open={!!error} variant="error" title="Roles & Permissions" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Saved" message={notice} onClose={() => setNotice('')} />

      <div style={sectionStyle} data-tour="org-user-roles">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Roles</h2>
          <button type="button" onClick={() => router.push('/dashboard/organization/roles')} style={linkBtnStyle}>Manage roles →</button>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
          Tick the roles this person holds; their access is everything those roles allow.
          {everyone.length > 0 && <> Everyone also gets: <b>{everyone.map((r) => r.name).join(', ')}</b>.</>}
        </p>
        <input value={roleQuery} onChange={(e) => setRoleQuery(e.target.value)} placeholder="Search roles…" style={{ ...inputStyle, maxWidth: 280, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 260, overflowY: 'auto' }}>
          {shown.map((r) => {
            const on = roleIds.includes(r.id)
            return (
              <span key={r.id} title={r.description || undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 10, border: on ? `1px solid ${BRAND.primary}` : `1px solid ${BORDER.normal}`, background: on ? 'rgba(244,113,59,0.05)' : '#fff', fontSize: 12.5, fontWeight: 600, color: TEXT.heading, opacity: r.is_active ? 1 : 0.55 }}>
                <Checkbox checked={on} onChange={() => setRoleIds((ids) => (on ? ids.filter((x) => x !== r.id) : [...ids, r.id]))} />
                {r.name}{r.is_system && <span style={{ fontSize: 10, color: '#1d4ed8' }}>BUILT-IN</span>}
              </span>
            )
          })}
        </div>
        {selfLocked && <p style={{ fontSize: 12, color: '#b45309', margin: '10px 0 0' }}>This is your own account — only an admin can change your roles, extra permissions or approval flags.</p>}
        {canEditRoles && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" data-tour="org-user-roles-save" disabled={!!saving || !rolesChanged}
            onClick={() => run('roles', () => sod.guard(user.id, { role_ids: roleIds }, (reason) => governedUsersApi.updateRoles(user.id, roleIds, reason)), 'Roles saved — the user gets the new access on their next page load.')}
            style={{ ...primaryBtnStyle, opacity: saving || !rolesChanged ? 0.6 : 1 }}>
            {saving === 'roles' ? 'Saving…' : 'Save Roles'}
          </button>
        </div>}
      </div>

      <div style={sectionStyle} data-tour="org-user-perm-approval-roles">
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Approval Roles</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>
          Who approvals are routed to — not a permission. Approval workflows (Organization › Workflows) pick approvers by these flags; hover a flag to see where it is used. Partners are set in Company Info › Partners.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Partner is set only in Company Info › Partners (one place for top authority) — shown here read-only. */}
          <span data-tour="org-user-partner" title="Set in Organization › Info › Partners"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: user.is_partner ? '1px solid #b45309' : `1px solid ${BORDER.normal}`, background: user.is_partner ? 'rgba(180,83,9,0.06)' : '#fff', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
            {user.is_partner ? '✓ Partner' : 'Not a Partner'}
            <button type="button" onClick={() => router.push('/dashboard/organization/info')} style={{ ...linkBtnStyle, fontSize: 11 }}>change in Company Info →</button>
          </span>
          {APPROVAL_ROLE_FLAGS.map((f) => (
            <span key={f.key} title={f.hint} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: roleFlags[f.key] ? `1px solid ${f.hex}` : `1px solid ${BORDER.normal}`, background: roleFlags[f.key] ? `${f.hex}0f` : '#fff', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
              <Checkbox checked={!!roleFlags[f.key]} disabled={!canEditFlags} onChange={() => setRoleFlags((prev) => ({ ...prev, [f.key]: !prev[f.key] }))} />
              {f.label}
            </span>
          ))}
          {canEditFlags && <button type="button" disabled={!!saving}
            onClick={() => run('approval roles', () => usersApi.updateApprovalRoles(user.id, roleFlags), 'Approval roles saved.')}
            style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
            {saving === 'approval roles' ? 'Saving…' : 'Save'}
          </button>}
        </div>
      </div>

      {seeExtras && <div style={sectionStyle} data-tour="org-user-extras">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Extra permissions (this user only)</h2>
          <button type="button" onClick={() => setShowExtras((v) => !v)} style={linkBtnStyle}>{showExtras ? 'Hide' : `Show${extras.length ? ` (${extras.length})` : ''}`}</button>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>
          For a one-off exception on top of their roles. If several people need the same thing, make a role instead. Faded ticks come from roles.
        </p>
        {showExtras && (
          <div style={{ marginTop: 12 }}>
            <PermissionMatrixEditor registry={registry} value={extras} onChange={setExtras} inherited={fromRoles} />
            {canEditExtras && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" disabled={!!saving || !extrasChanged}
                onClick={() => run('extra permissions', () => sod.guard(user.id, { granular_permissions: extras }, (reason) => governedUsersApi.updatePermissions(user.id, extras, reason)), 'Extra permissions saved.')}
                style={{ ...primaryBtnStyle, opacity: saving || !extrasChanged ? 0.6 : 1 }}>
                {saving === 'extra permissions' ? 'Saving…' : 'Save Extra Permissions'}
              </button>
            </div>}
          </div>
        )}
      </div>}

      {sod.dialog}
      <AccessGovernancePanel userId={user.id} canEdit={canEditRoles} canViewTrace={can('organization', 'monitor', 'view')}
        roles={roles.filter((r) => (user.role_ids || []).includes(r.id)).map((r) => ({ id: r.id, name: r.name }))}
        extras={user.granular_permissions || []} />

      <div style={sectionStyle} data-tour="org-user-effective">
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Effective access</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
          Everything {user.name} can do right now (saved roles + extras). Hover a tick to see which role gives it.
          Modules: {effective ? (effective.apps.length ? effective.apps.map((a) => moduleWords(registry, a)).join(', ') : 'none') : '…'}
        </p>
        {effective && <PermissionMatrixEditor registry={registry} value={[]} inherited={effective.grants} readOnly onlyGranted />}
      </div>
    </div>
  )
}

function PermissionHistoryTab({ history }: { history: UserActivity[] }) {
  return (
    <div style={sectionStyle}>
      <h2 data-tour="org-user-perm-history" style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Permission History</h2>
      {history.length === 0 ? <p style={orgEmptyStyle}>No permission changes recorded yet — role, extra-permission and approval-flag changes will appear here.</p> : (
        <div>
          {history.map((h, i) => (
            <OrgListItem key={h.id} last={i === history.length - 1} title={h.summary || h.action} body={formatDateTime(h.performed_at)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Login History / User Activity (read-only)
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS: [string, string][] = [
  ['', 'Follow roles'], ['own', 'Own records'], ['assigned', 'Own + assigned'], ['department', 'Department'],
  ['plant', 'Plant / branch'], ['multi_plant', 'Multiple plants'], ['organization', 'Entire organization'],
]

/** Personal data-scope overrides — beat whatever the user's roles give for a module. */
function DataAccessTab({ userId }: { userId: number }) {
  const { canFeature } = useCan()
  const canEdit = canFeature('organization', 'roles', 'data_access', 'edit')
  const [rows, setRows] = useState<UserDataScopeRow[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    securityApi.userDataScopes(userId)
      .then((r) => { setRows(r); setDraft(Object.fromEntries(r.filter((x) => x.override).map((x) => [x.module_key, x.override as string]))) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load data access.').join(' ')))
  }, [userId])

  const save = async () => {
    try {
      const r = await securityApi.saveUserDataScopes(userId, draft)
      setRows(r)
      setNotice('Data access saved. It applies on the user\u2019s next page load.')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save data access.').join(' '))
    }
  }

  return (
    <div style={sectionStyle}>
      <MessageDialog open={!!error} variant="error" title="Data access" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Saved" message={notice} onClose={() => setNotice('')} />
      <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 6 }}>Data Access</h2>
      <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 12px' }}>
        Which records this person sees in each module. Normally it comes from their roles (widest wins); set a personal
        override only for exceptions. Modules they can&apos;t open at all are unaffected.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 680 }}>
        {rows.map((r) => (
          <div key={r.module_key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 200px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{r.module_label}</span>
            <Select style={{ ...inputStyle, width: 200 }} disabled={!canEdit} value={draft[r.module_key] || ''}
              onChange={(e) => setDraft((d) => { const n = { ...d }; if (e.target.value) n[r.module_key] = e.target.value; else delete n[r.module_key]; return n })}>
              {SCOPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <span style={{ width: 190, fontSize: 12, color: TEXT.muted }}>now: {r.effective_label}</span>
          </div>
        ))}
      </div>
      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" onClick={save} style={{ ...secondaryBtnStyle, borderColor: BRAND.primary, color: BRAND.primary }}>Save data access</button>
        </div>
      )}
    </div>
  )
}

const REVOKE_REASON: Record<string, string> = { logout: 'Signed out', admin: 'Signed out by admin', idle: 'Idle timeout', rotated: 'Renewed', limit: 'Device limit', deactivated: 'Deactivated' }

function LoginHistoryTab({ userId, sessions, onRefresh }: { userId: number; sessions: UserSession[]; onRefresh: () => void }) {
  const { can } = useCan()
  const [ask, setAsk] = useState(false)
  const [msg, setMsg] = useState('')
  const live = sessions.filter((s) => !s.revoked_at && new Date(s.expires_at) > new Date()).length
  const signOutAll = async () => {
    setAsk(false)
    try {
      const r = await securityApi.revokeAll(userId)
      setMsg(`Signed out of ${r.revoked} session(s).`)
      onRefresh()
    } catch (err) {
      setMsg(extractErrorMessages(err, 'Could not sign the user out.').join(' '))
    }
  }
  return (
    <div style={sectionStyle}>
      <ConfirmDialog open={ask} title="Sign out everywhere?" confirmLabel="Sign out" message="End every live session of this user? They will have to sign in again."
        onConfirm={signOutAll} onCancel={() => setAsk(false)} />
      <MessageDialog open={!!msg} variant="success" title="Sessions" message={msg} onClose={() => setMsg('')} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 data-tour="org-user-login-history" style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', margin: 0 }}>Login History · {live} live</h2>
        {live > 0 && can('organization', 'security', 'edit') && (
          <button type="button" style={secondaryBtnStyle} onClick={() => setAsk(true)}>Sign out everywhere</button>
        )}
      </div>
      {sessions.length === 0 ? <p style={orgEmptyStyle}>No sessions recorded yet — this person has not signed in.</p> : (
        <div>
          {sessions.map((s, i) => {
            const isLive = !s.revoked_at && new Date(s.expires_at) > new Date()
            return (
              <OrgListItem key={s.id} last={i === sessions.length - 1}
                title={`Signed in ${formatDateTime(s.created_at)}`}
                tags={s.revoked_at ? <Pill label={REVOKE_REASON[s.revoked_reason || ''] || 'Revoked'} hex="#b91c1c" /> : isLive ? <Pill label="Live" hex="#047857" /> : <Pill label="Expired" hex="#64748b" />}
                body={`Last used ${formatDateTime(s.last_used_at)} · Expires ${formatDateTime(s.expires_at)}${s.ip_address ? ` · IP ${s.ip_address}` : ''}${s.user_agent ? ` · ${s.user_agent}` : ''}`} />
            )
          })}
        </div>
      )}
    </div>
  )
}

function UserActivityTab({ activity }: { activity: UserActivity[] }) {
  return (
    <div style={sectionStyle}>
      <h2 data-tour="org-user-activity" style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>User Activity</h2>
      {activity.length === 0 ? <p style={orgEmptyStyle}>No activity recorded yet.</p> : (
        <div>
          {activity.map((a, i) => (
            <OrgListItem key={a.id} last={i === activity.length - 1}
              title={a.summary || a.action}
              tags={a.entity_type ? <Pill label={a.entity_type.replace(/_/g, ' ')} hex={BRAND.primary} /> : null}
              body={a.summary ? `${a.action} · ${formatDateTime(a.performed_at)}` : formatDateTime(a.performed_at)} />
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
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<UserDocument | null>(null)
  const { canFeature } = useCan()
  const canEditDocs = canFeature('organization', 'users', 'documents', 'create')
  const canDeleteDocs = canFeature('organization', 'users', 'documents', 'delete')
  const canOpenDocs = canFeature('organization', 'users', 'documents', 'export')

  const openAdd = () => { setFile(null); setMeta(emptyDocumentMeta()); setFormError(''); setFormOpen(true) }
  const submit = async () => {
    if (!file) { setFormError('Select a file to upload'); return }
    if (!meta.document_name.trim()) { setFormError('Document Name is required'); return }
    setSaving(true)
    setFormError('')
    try {
      await usersApi.uploadUserDocument(userId, file, meta)
      setFile(null)
      setMeta(emptyDocumentMeta())
      setFormOpen(false)
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail || 'Failed to upload document.')
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>User Documents</h2>
        {canEditDocs && <button type="button" data-tour="org-user-doc-add" onClick={openAdd} style={primaryBtnStyle}>+ Add Document</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Document Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this document?" message={`Delete "${deleteTarget?.document_name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {canEditDocs && formOpen && (
        <FormSheet width={640} icon="doc" title="Add User Document" subtitle="ID proof, offer letter, certificate or agreement — stored in SharePoint"
          onClose={() => setFormOpen(false)} busy={saving}
          footer={<>
            <button type="button" data-tour="org-user-doc-cancel" onClick={() => setFormOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" data-tour="org-user-doc-save" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="upload" size={16} />{saving ? 'Uploading…' : 'Save Document'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formError && <div style={sheetErrBox}>{formError}</div>}
            <SheetSection icon="clip" title="File">
              <div data-tour="org-user-doc-file">
                <label style={sheetLabel}>Document File <Req /></label>
                <FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} />
              </div>
            </SheetSection>
            <SheetSection icon="doc" title="Details">
              <div style={sheetRow}>
                <SheetField label="Document Type" req basis={160}>
                  <Select data-tour="org-user-doc-type" style={sheetInput} value={meta.document_type} onChange={(e) => setMeta((m) => ({ ...m, document_type: e.target.value }))}>
                    {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </SheetField>
                <SheetField label="Document Name" req basis={240}><input data-tour="org-user-doc-name" style={sheetInput} value={meta.document_name} onChange={(e) => setMeta((m) => ({ ...m, document_name: e.target.value }))} placeholder="e.g. PAN Card" /></SheetField>
              </div>
              <div style={sheetRow}>
                <SheetField label="Document Number"><input data-tour="org-user-doc-number" style={sheetInput} value={meta.document_number} onChange={(e) => setMeta((m) => ({ ...m, document_number: e.target.value }))} /></SheetField>
                <SheetField label="Issuing Authority"><input data-tour="org-user-doc-authority" style={sheetInput} value={meta.issuing_authority} onChange={(e) => setMeta((m) => ({ ...m, issuing_authority: e.target.value }))} /></SheetField>
              </div>
              <div style={{ ...sheetRow, marginBottom: 0 }}>
                <SheetField label="Issue Date" tour="org-user-doc-issue" basis={160}><DateField value={meta.issue_date} onChange={(v) => setMeta((m) => ({ ...m, issue_date: v }))} /></SheetField>
                <SheetField label="Expiry Date" tour="org-user-doc-expiry" basis={160}><DateField value={meta.expiry_date} onChange={(v) => setMeta((m) => ({ ...m, expiry_date: v }))} /></SheetField>
              </div>
              <p style={sheetHint}>Fill the expiry date for documents that expire (passport, licence) so renewals show in the list.</p>
            </SheetSection>
            <SheetSection icon="tag" title="Classification">
              <div style={sheetRow}>
                <SheetField label="Confidentiality" req basis={160}>
                  <Select data-tour="org-user-doc-confidentiality" style={sheetInput} value={meta.confidentiality} onChange={(e) => setMeta((m) => ({ ...m, confidentiality: e.target.value }))}>
                    {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </SheetField>
                <SheetField label="Tags (comma separated)" basis={240}><input data-tour="org-user-doc-tags" style={sheetInput} value={meta.tags} onChange={(e) => setMeta((m) => ({ ...m, tags: e.target.value }))} placeholder="e.g. kyc, joining" /></SheetField>
              </div>
              <SheetField label="Remarks"><input data-tour="org-user-doc-remarks" style={sheetInput} value={meta.remarks} onChange={(e) => setMeta((m) => ({ ...m, remarks: e.target.value }))} /></SheetField>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {documents.length === 0 ? <p style={orgEmptyStyle}>No documents uploaded yet{canEditDocs ? ' — use + Add Document to upload ID proof, offer letter or certificates.' : '.'}</p> : (
        <div data-tour="org-user-doc-list">
          {documents.map((d, i) => (
            <OrgListItem key={d.id} last={i === documents.length - 1}
              title={d.document_name}
              sub={d.document_type}
              body={`${d.filename}${d.expiry_date ? ` · Expires ${formatDate(d.expiry_date)}` : ''}`}
              action={<div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                {d.sharepoint_url && canOpenDocs && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                {canDeleteDocs && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(d)}>Delete</button>}
              </div>} />
          ))}
        </div>
      )}
    </div>
  )
}
