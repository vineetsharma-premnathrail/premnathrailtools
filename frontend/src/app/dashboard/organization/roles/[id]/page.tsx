'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { approvalsApi, organizationApi, rolesApi, usersApi } from '@/lib/api'
import { ApprovesInRow, DirectoryUser, PermissionRegistry, Role } from '@/types'
import { BRAND } from '@/lib/theme'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import OrganizationNav from '@/components/organization/OrganizationNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import PermissionMatrixEditor, { expandGrants } from '@/components/organization/PermissionMatrixEditor'
import RoleNotificationsEditor, { NotificationEventCatalog } from '@/components/organization/RoleNotificationsEditor'
import Checkbox from '@/components/Checkbox'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import TourButton from '@/components/tour/TourButton'
import ApprovesInPanel from '@/components/organization/ApprovesInPanel'
import { extractErrorMessages } from '@/lib/validation'

// One role: its name/flags, its Permission Matrix (module › tab › action) and
// who holds it. `/roles/new` is the same page in create mode.

type Tab = 'Permissions' | 'Data access' | 'Notifications' | 'Users' | 'Approves in'

export default function RoleDetailPage() {
  const params = useParams()
  const isNew = params.id === 'new'
  // /roles/new is a create form — a viewer without Create never lands on it.
  const { isAuthorized, isLoading } = useRequireOrgTab('roles', isNew ? 'create' : 'view')
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()
  const { id: resolvedRoleId, error: linkError } = useRecordId(isNew ? null : (params.id as string))
  const roleId = isNew ? null : resolvedRoleId

  const [catalog, setCatalog] = useState<PermissionRegistry | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isDefault, setIsDefault] = useState(false)
  const [permissions, setPermissions] = useState<string[]>([])
  const [dataScopes, setDataScopes] = useState<Record<string, string>>({})
  const [notifyEvents, setNotifyEvents] = useState<Record<string, string[]>>({})
  const [assigneeRules, setAssigneeRules] = useState<NonNullable<Role['assignee_rules']>>({})
  // Options for the "Assign to" rule popup (departments / roles / people).
  const [deptOptions, setDeptOptions] = useState<{ id: number; label: string; sub?: string | null }[]>([])
  const [roleOptions, setRoleOptions] = useState<{ id: number; label: string }[]>([])
  const [eventCatalog, setEventCatalog] = useState<NotificationEventCatalog | null>(null)
  const [tab, setTab] = useState<Tab>('Permissions')
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [memberIds, setMemberIds] = useState<number[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const [askCopy, setAskCopy] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  // Where to go once an error message is closed (role created, users not added).
  const [afterError, setAfterError] = useState('')
  // Workflow stages this role approves in (read-only; set up in Approval Workflows).
  const [approvesIn, setApprovesIn] = useState<ApprovesInRow[] | null>(null)
  const [approvesErr, setApprovesErr] = useState('')
  // Confirm before a change that leaves a workflow stage without its approvers.
  const [askDeactivate, setAskDeactivate] = useState(false)
  const [askEmptyMembers, setAskEmptyMembers] = useState(false)

  const applyRole = (r: Role) => {
    setRole(r); setName(r.name); setDescription(r.description || ''); setIsActive(r.is_active)
    setIsDefault(r.is_default); setPermissions(r.permissions); setDataScopes(r.data_scopes || {}); setNotifyEvents(r.notification_events || {}); setAssigneeRules(r.assignee_rules || {}); setMemberIds((r.users || []).map((u) => u.id))
  }

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([rolesApi.catalog(), roleId ? rolesApi.get(roleId) : Promise.resolve(null), usersApi.directory()])
      .then(([cat, r, dir]) => { setCatalog(cat); if (r) applyRole(r); setDirectory(dir) })
      .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load this role. It may have been deleted — go back to the role list and reload.').join(' ')))
  }, [isAuthorized, roleId])

  // Departments and roles for the "Assign to" rule popup — load on their own; the popup works without them.
  useEffect(() => {
    if (!isAuthorized) return
    organizationApi.listDepartments()
      .then((ds: { id: number; name: string; branch_name?: string | null }[]) => setDeptOptions(ds.map((d) => ({ id: d.id, label: d.name, sub: d.branch_name || null }))))
      .catch(() => setDeptOptions([]))
    rolesApi.list().then((rs) => setRoleOptions(rs.map((r) => ({ id: r.id, label: r.name })))).catch(() => setRoleOptions([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || !roleId) return
    approvalsApi.approvesInRole(roleId).then(setApprovesIn)
      .catch((err) => setApprovesErr(extractErrorMessages(err, 'Could not load the approvals this role takes part in.').join(' ')))
  }, [isAuthorized, roleId])

  // The notifiable-event list loads on its own so the rest of the page never waits on it.
  const [eventError, setEventError] = useState('')
  useEffect(() => {
    if (!isAuthorized) return
    rolesApi.notificationEvents().then(setEventCatalog)
      .catch((err) => setEventError(extractErrorMessages(err, 'Could not load the list of notification events. Reload the page; if it persists, the backend may not be updated yet.').join(' ')))
  }, [isAuthorized])

  const readOnly = !!role?.is_system
  const grantCount = useMemo(() => (catalog ? expandGrants(catalog, permissions).size : 0), [catalog, permissions])
  const moduleCount = useMemo(() => new Set(Array.from(catalog ? expandGrants(catalog, permissions) : []).map((g) => g.split(':')[0])).size, [catalog, permissions])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><OrganizationNav /><InvalidRecordLink message={linkError} listHref="/dashboard/organization/roles" listLabel="Back to roles" /></div>)
  if (!isNew && !roleId) return <div><OrganizationNav /></div>

  const payload = () => ({ name: name.trim(), description: description.trim() || null, permissions, data_scopes: dataScopes, notification_events: notifyEvents, assignee_rules: assigneeRules, is_default: isDefault, is_active: isActive })
  // Modules this role opens — only those can carry a data scope.
  const grantedModules = catalog
    ? Array.from(new Set(Array.from(expandGrants(catalog, permissions)).map((g) => g.split(':')[0])))
        .filter((mk) => mk !== 'organization' && catalog.modules[mk])
        .sort((a, b) => catalog.modules[a].label.localeCompare(catalog.modules[b].label))
    : []
  const scopeLabels = catalog?.scope_labels || {}
  // What a module with no data access set falls back to (server setting).
  const defaultScope = catalog?.default_scope || 'assigned'

  // Stages that name this role directly — they lose their approvers if the role goes.
  const roleStages = (approvesIn || []).filter((r) => r.kind === 'approver' && r.how.startsWith('Holders of this role'))
  const stageList = (rows: ApprovesInRow[]) => rows.map((r) => `${r.module_label} › ${r.document} (stage ${r.stage_sequence} “${r.stage_name}”)`).join('; ')

  const save = async (confirmed = false) => {
    if (name.trim().length < 2) { setError('Give the role a name (at least 2 characters), e.g. "Store Keeper".'); return }
    if (!confirmed && !isNew && role?.is_active && !isActive && (approvesIn || []).some((r) => r.kind !== 'escalation')) { setAskDeactivate(true); return }
    setAskDeactivate(false)
    setSaving(true); setError('')
    try {
      if (isNew) {
        const created = await rolesApi.create(payload())
        const path = recordPath('/dashboard/organization/roles', created)
        // Users picked while creating are saved with the role, in one click.
        if (!isDefault && memberIds.length > 0) {
          try {
            await rolesApi.setUsers(created.id, memberIds)
          } catch (err) {
            // The role exists now — open it after the message so users can be retried from its Users tab.
            setAfterError(path)
            setError(`The role “${created.name}” was created, but its users couldn't be added: ${extractErrorMessages(err, 'unknown error').join(' ')} Add them again from the Users tab.`)
            return
          }
        }
        router.replace(path)
        return
      }
      const updated = await rolesApi.update(roleId!, payload())
      applyRole(updated)
      setNotice('Role saved. Users holding it get the new access on their next page load.')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the role.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const saveMembers = async (confirmed = false) => {
    if (!roleId) return
    if (!confirmed && memberIds.length === 0 && roleStages.length > 0) { setAskEmptyMembers(true); return }
    setAskEmptyMembers(false)
    setSaving(true); setError('')
    try {
      applyRole(await rolesApi.setUsers(roleId, memberIds))
      setNotice('Users updated.')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not update who holds this role.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const doCopy = async (newName: string) => {
    setAskCopy(false)
    try {
      const copy = await rolesApi.copy(roleId!, newName.trim())
      router.push(recordPath('/dashboard/organization/roles', copy))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not copy the role.').join(' '))
    }
  }

  const doDelete = async () => {
    setAskDelete(false)
    try {
      await rolesApi.remove(roleId!)
      router.push('/dashboard/organization/roles')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not delete the role.').join(' '))
    }
  }

  const membersChanged = role && JSON.stringify([...memberIds].sort()) !== JSON.stringify((role.users || []).map((u) => u.id).sort())
  const members = memberIds.map((id) => directory.find((u) => u.id === id) || role?.users?.find((u) => u.id === id)).filter(Boolean) as { id: number; name: string; email: string; department?: string | null }[]
  const q = memberSearch.trim().toLowerCase()
  const candidates = q ? directory.filter((u) => !memberIds.includes(u.id) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 8) : []

  const canSave = isNew ? can('organization', 'roles', 'create') : can('organization', 'roles', 'edit')
  // Data access / Notifications / Users tabs are features (core/features/organization.py).
  const canEditMembers = canFeature('organization', 'roles', 'members', 'edit')
  const seeRoleTab = (t: Tab) => (t === 'Data access' ? canFeature('organization', 'roles', 'data_access', 'view')
    : t === 'Notifications' ? canFeature('organization', 'roles', 'notifications', 'view')
      : t === 'Users' ? canFeature('organization', 'roles', 'members', 'view')
        : t === 'Approves in' ? !isNew : true)
  const view: Tab = seeRoleTab(tab) ? tab : 'Permissions'
  const locked = readOnly || !canSave
  const saveLabel = saving ? 'Saving…' : isNew ? 'Create Role' : 'Save Role'
  const tabBtn = (t: Tab): React.CSSProperties => ({
    padding: '10px 6px', marginRight: 16, border: 'none', background: 'transparent', cursor: 'pointer',
    borderBottom: tab === t ? `2px solid ${BRAND.primary}` : '2px solid transparent', opacity: 1,
    color: tab === t ? BRAND.primary : SHEET.MUTED, fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
  })
  const subtitle = `${grantCount} permission(s) across ${moduleCount} module(s)${role && !role.is_default ? ` · held by ${role.user_count} user(s)` : ''}${role?.is_default ? ' · applies to everyone' : ''}`

  return (
    <FormPage nav={<OrganizationNav />} icon="shield" title={isNew ? 'New Role' : role?.name || 'Role'} subtitle={subtitle}
      onBack={() => router.push('/dashboard/organization/roles')} backTour="org-role-back"
      footer={<>
        <div style={{ display: 'flex', gap: 10, marginRight: 'auto', flexWrap: 'wrap' }}>
          {!isNew && can('organization', 'roles', 'create') && (
            <button type="button" data-tour="org-role-copy" onClick={() => setAskCopy(true)} style={sheetBtn('secondary')}><SheetIcon name="doc" size={15} />Copy</button>
          )}
          {!isNew && !readOnly && canDelete('organization', 'roles') && (
            <button type="button" data-tour="org-role-delete" onClick={() => setAskDelete(true)} style={{ ...sheetBtn('secondary'), color: '#b91c1c', borderColor: 'rgba(220,38,38,0.3)' }}><SheetIcon name="trash" size={15} />Delete</button>
          )}
        </div>
        {view === 'Users' && !isNew && role && !role.is_default && canEditMembers && (
          <button type="button" onClick={() => saveMembers()} disabled={saving || !membersChanged} data-tour="org-role-users-save" style={sheetBtn('primary', SHEET.BLUE, saving || !membersChanged)}>
            <SheetIcon name="users" size={16} />{saving ? 'Saving…' : 'Save Users'}
          </button>
        )}
        {(view !== 'Users' || isNew) && !readOnly && canSave && (
          <button type="button" onClick={() => save()} disabled={saving} data-tour="org-role-save" style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="check" size={16} />{saveLabel}
          </button>
        )}
      </>}>
      <MessageDialog open={!!error} variant="error" title="Role & Permissions" message={error}
        onClose={() => { setError(''); if (afterError) { setAfterError(''); router.replace(afterError) } }} />
      <MessageDialog open={!!notice} variant="success" title="Saved" message={notice} onClose={() => setNotice('')} />
      <PromptDialog open={askCopy} title="Copy role" message={`Name for the new editable copy of “${role?.name}”:`} placeholder="e.g. Store Keeper – Plant 2"
        confirmLabel="Create copy" requireValue onConfirm={doCopy} onCancel={() => setAskCopy(false)} />
      <ConfirmDialog open={askDelete} danger title="Delete role" confirmLabel="Delete"
        message={`Delete “${role?.name}”? This can't be undone. A role still held by users can't be deleted — remove it from them first, or mark it inactive.${roleStages.length ? ` It is the approver of: ${stageList(roleStages)}. Pick another approver for those stages in Organization › Approval Workflows first, or documents there will be refused on submit.` : ''}`}
        onConfirm={doDelete} onCancel={() => setAskDelete(false)} />
      <ConfirmDialog open={askDeactivate} title="Deactivate a role that approves?" confirmLabel="Deactivate anyway"
        message={`“${role?.name}” takes part in approvals: ${stageList((approvesIn || []).filter((r) => r.kind !== 'escalation'))}. Once inactive it gives nobody anything — stages that rely on it find no approver and those documents are refused on submit. Documents already waiting keep their approvers. Change those stages in Organization › Approval Workflows first, or deactivate anyway.`}
        onConfirm={() => save(true)} onCancel={() => setAskDeactivate(false)} />
      <ConfirmDialog open={askEmptyMembers} title="Remove every holder?" confirmLabel="Save anyway"
        message={`Nobody would hold “${role?.name}”, but it is the approver of: ${stageList(roleStages)}. Those documents would be refused on submit until someone holds the role again or the stages get another approver in Organization › Approval Workflows.`}
        onConfirm={() => saveMembers(true)} onCancel={() => setAskEmptyMembers(false)} />

      <div style={{ padding: '20px 24px' }}>
        {loadError && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>{loadError}</div>}
        {readOnly && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 12.5, marginBottom: 14 }}>
            Built-in preset — you can assign it to users but not change it.{can('organization', 'roles', 'create') ? <> Click <b>Copy</b> to make an editable role from it.</> : null}
          </div>
        )}
        {!readOnly && !canSave && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(100,116,139,0.07)', border: `1px solid ${SHEET.LINE}`, color: SHEET.BODY, fontSize: 12.5, marginBottom: 14 }}>
            You can view this role; changing it needs Organization › Role &amp; Permissions › Edit.
          </div>
        )}

        <div data-tour="org-role-details">
          <SheetSection icon="tag" title="Role details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
                <label style={sheetLabel}>Role name <Req /></label>
                <input value={name} disabled={locked} onChange={(e) => setName(e.target.value)} placeholder="e.g. Store Keeper" style={sheetInput} />
              </div>
              <div style={{ flex: '2 1 320px', maxWidth: 620 }}>
                <label style={sheetLabel}>Description <Optional /></label>
                <input value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} placeholder="Who this role is for and what it allows" style={sheetInput} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 22, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.INK }}>
                <Checkbox checked={isActive} disabled={locked} onChange={() => setIsActive((v) => !v)} /> Active
                <span style={{ fontSize: 11.5, color: SHEET.MUTED }}>(an inactive role gives nobody anything)</span>
              </span>
              <span data-tour="org-role-everyone" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.INK }}>
                <Checkbox checked={isDefault} disabled={locked} onChange={() => setIsDefault((v) => !v)} /> Applies to everyone
                <span style={{ fontSize: 11.5, color: SHEET.MUTED }}>(every user gets it without being assigned — e.g. Employee self-service)</span>
              </span>
            </div>
          </SheetSection>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, borderBottom: `1px solid ${SHEET.LINE}` }}>
          <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
            {(['Permissions', 'Data access', 'Notifications', 'Users', 'Approves in'] as Tab[]).filter(seeRoleTab).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} data-tour={`org-role-tab-${t.toLowerCase()}`}
                style={tabBtn(t)}>
                {t === 'Users' && (role || isNew) ? `Users (${isDefault ? 'everyone' : memberIds.length})` : t === 'Approves in' && approvesIn ? `Approves in (${approvesIn.length})` : t}
              </button>
            ))}
          </div>
          <TourButton variant="icon" />
        </div>

        {view === 'Permissions' && catalog && (
          <div data-tour="org-role-matrix">
            <SheetSection icon="list" title="Permission matrix">
              <p style={{ ...sheetHint, margin: '0 0 12px' }}>
                Pick a preset per module, then fine-tune tabs and actions. A dash (—) means that action doesn&apos;t exist on that tab.
                Ticking any action also ticks View; unticking View clears the row.
              </p>
              <PermissionMatrixEditor registry={catalog} value={permissions} onChange={setPermissions} readOnly={locked}
                assigneeRules={assigneeRules} onAssigneeRulesChange={locked ? undefined : setAssigneeRules}
                assigneeOptions={{ departments: deptOptions, roles: roleOptions, users: directory.map((u) => ({ id: u.id, label: u.name || u.email, sub: u.department || null })) }} />
            </SheetSection>
          </div>
        )}

        {view === 'Data access' && catalog && (
          <div data-tour="org-role-scopes">
            <SheetSection icon="building" title="Data access">
              <p style={{ ...sheetHint, margin: '0 0 12px' }}>
                Permissions say <b>what</b> holders can do; data access says <b>which records</b> they see in each module.
                Own = records they created or requested · Own + assigned = also records assigned to them · Department = records of
                people in their department (same plant) · Plant = their plant · Multiple plants = every plant assigned to them in
                Branches · Entire organization = everything. Not set = {scopeLabels[defaultScope] || defaultScope}. Anyone always sees records they must approve. When a user holds several
                roles, the widest access wins; a personal override on the user page beats all roles.
              </p>
              {grantedModules.length === 0 ? (
                <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>This role doesn&apos;t open any module yet — tick permissions first.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
                  {grantedModules.map((mk) => (
                    <div key={mk} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: SHEET.INK, fontWeight: 600 }}>{catalog.modules[mk].label}</span>
                      <select value={dataScopes[mk] || defaultScope} disabled={locked || !canFeature('organization', 'roles', 'data_access', 'edit')} style={{ ...sheetInput, width: 220 }}
                        onChange={(e) => setDataScopes((s) => {
                          const next = { ...s }
                          if (e.target.value === defaultScope) delete next[mk]
                          else next[mk] = e.target.value
                          return next
                        })}>
                        {(catalog.scope_levels || []).map((lv) => <option key={lv} value={lv}>{scopeLabels[lv] || lv}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </SheetSection>
          </div>
        )}

        {view === 'Notifications' && catalog && (
          <div>
            <SheetSection icon="send" title="Notifications">
              <p style={{ ...sheetHint, margin: '0 0 12px' }}>
                Pick the events this role&apos;s members are told about, and how (portal bell, email, Microsoft Teams). A member only
                gets an event for a record they can open — they need the permission shown under the event and data access to that
                record — and nobody is notified of what they did themselves. The people named in each module&apos;s own
                Settings › Notifications still get those notices too.
              </p>
              {eventError ? <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{eventError}</p> : eventCatalog
                ? <RoleNotificationsEditor catalog={eventCatalog} registry={catalog} permissions={permissions} value={notifyEvents} onChange={setNotifyEvents} readOnly={locked || !canFeature('organization', 'roles', 'notifications', 'edit')} />
                : <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading the event list…</p>}
            </SheetSection>
          </div>
        )}

        {view === 'Approves in' && role && (
          <div data-tour="org-role-approves-in">
            <SheetSection icon="flag" title="Approves in">
              <p style={{ ...sheetHint, margin: '0 0 12px' }}>
                The approval stages this role&apos;s holders take part in. Read-only — approvals are set up per document in
                Organization › Approval Workflows, which is the only place that decides who approves.
              </p>
              <ApprovesInPanel rows={approvesIn} error={approvesErr} empty="This role isn't an approver in any workflow." />
            </SheetSection>
          </div>
        )}

        {view === 'Users' && (role || isNew) && (
          <div data-tour="org-role-users">
            <SheetSection icon="users" title="Who holds this role">
              {(isNew ? isDefault : role?.is_default) ? (
                <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0 }}>This role applies to every user automatically — untick “Applies to everyone”{isNew ? '' : ' and save'} to assign it to specific people instead.</p>
              ) : (
                <>
                  {isNew && <p style={{ ...sheetHint, margin: '0 0 10px' }}>The people you add here get the role when you click Create Role.</p>}
                  {canEditMembers && (
                    <div style={{ position: 'relative', maxWidth: 420, marginBottom: 14 }}>
                      <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Add a user — type a name or email…" style={sheetInput} />
                      {candidates.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, marginTop: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.12)' }}>
                          {candidates.map((u) => (
                            <button key={u.id} type="button" onClick={() => { setMemberIds((ids) => [...ids, u.id]); setMemberSearch('') }}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: SHEET.BODY }}>
                              {u.name} <span style={{ color: SHEET.MUTED, fontSize: 11.5 }}>{u.email}{u.department ? ` · ${u.department}` : ''}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {members.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED }}>Nobody holds this role yet.</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {members.map((u) => (
                      <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff' }}>
                        <span style={{ fontSize: 13, color: SHEET.INK, cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/users', u))}>
                          {u.name} <span style={{ color: SHEET.MUTED, fontSize: 11.5 }}>{u.email}{u.department ? ` · ${u.department}` : ''}</span>
                        </span>
                        {canEditMembers && (
                          <button type="button" onClick={() => setMemberIds((ids) => ids.filter((x) => x !== u.id))} style={{ fontSize: 11.5, fontWeight: 600, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </SheetSection>
          </div>
        )}
      </div>
    </FormPage>
  )
}
