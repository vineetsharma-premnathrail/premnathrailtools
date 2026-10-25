'use client'

import { useEffect, useMemo, useState } from 'react'
import Select from '@/components/shared/Select'
import { approvalsApi, rolesApi, securityApi, usersApi } from '@/lib/api'
import { governedUsersApi } from '@/lib/basisApi'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { ApprovesInRow, EffectivePermissions, PermissionRegistry, UserDataScopeRow } from '@/types'
import { SheetSection, SHEET, sheetBtn, sheetInput, sheetHint, SheetIcon } from '@/components/shared/FormSheet'
import PermissionMatrixEditor from '@/components/organization/PermissionMatrixEditor'
import RoleNotificationsEditor, { NotificationEventCatalog } from '@/components/organization/RoleNotificationsEditor'
import ApprovesInPanel from '@/components/organization/ApprovesInPanel'
import { useSodGuard } from '@/components/organization/useSodGuard'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

/**
 * Role editor › one holder picked in "Settings for": that user's real access on
 * the current tab, and changes that apply to that user only — the role itself
 * stays the same for its other holders.
 *   Permissions   → the user's extra permissions (role grants show faded, locked)
 *   Data access   → the user's personal data-scope overrides
 *   Notifications → the user's personal notification overrides
 *   Approves in   → read-only: approvers are decided in Approval Workflows only
 */
export type MemberTab = 'Permissions' | 'Data access' | 'Notifications' | 'Approves in'

/** Whether the signed-in user may open the "Approves in" tab: it reads another user's record (Organization › Users › View). */
export function useCanSeeApprovesIn() {
  const { can } = useCan()
  return can('organization', 'users', 'view')
}

export default function RoleMemberAccess({ tab, user, catalog, eventCatalog }: {
  tab: MemberTab
  user: { id: number; name: string }
  catalog: PermissionRegistry
  eventCatalog: NotificationEventCatalog | null
}) {
  const { user: me } = useAuth()
  const { canFeature, can } = useCan()
  const seeUsers = can('organization', 'users', 'view')
  const sod = useSodGuard()
  const meIsAdmin = me?.role === 'admin'
  // A non-admin never changes their own access (the server refuses it too).
  const selfLocked = !meIsAdmin && me?.id === user.id

  const [effective, setEffective] = useState<EffectivePermissions | null>(null)
  const [extras, setExtras] = useState<string[]>([])
  const [savedExtras, setSavedExtras] = useState<string[]>([])
  const [scopes, setScopes] = useState<UserDataScopeRow[] | null>(null)
  const [scopeEdit, setScopeEdit] = useState<Record<string, string>>({})
  const [notify, setNotify] = useState<Record<string, string[]>>({})
  const [savedNotify, setSavedNotify] = useState<Record<string, string[]>>({})
  const [roleNotify, setRoleNotify] = useState<Record<string, string[]>>({})
  const [approves, setApproves] = useState<ApprovesInRow[] | null>(null)
  const [approvesErr, setApprovesErr] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [userLoaded, setUserLoaded] = useState(false)
  const [userErr, setUserErr] = useState('')
  const [tick, setTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const seePerms = canFeature('organization', 'roles', 'extra_permissions', 'view')
  const editPerms = canFeature('organization', 'roles', 'extra_permissions', 'edit') && !selfLocked
  const seeScopes = canFeature('organization', 'roles', 'data_access', 'view')
  const editScopes = canFeature('organization', 'roles', 'data_access', 'edit') && !selfLocked
  const seeNotify = canFeature('organization', 'roles', 'notifications', 'view')
  const editNotify = canFeature('organization', 'roles', 'notifications', 'edit') && !selfLocked

  useEffect(() => {
    let alive = true
    // Fresh state per user: the page keys this component by the user's id.
    setLoadErr(''); setUserErr(''); setApprovesErr('')
    const fail = (what: string) => (err: unknown) => { if (alive) setLoadErr(extractErrorMessages(err, `Could not load ${user.name}'s ${what}. Check your connection and try again.`).join(' ')) }
    // Loaded separately: the user record needs Organization › Users › View, the access summary needs Role & Permissions › View.
    usersApi.getEffectivePermissions(user.id).then((eff) => { if (alive) setEffective(eff) }).catch(fail('access'))
    if (seeUsers) {
      usersApi.getUser(user.id).then((u) => {
        if (!alive) return
        setExtras(u.granular_permissions || []); setSavedExtras(u.granular_permissions || [])
        setUserLoaded(true)
        // What the user's roles (assigned + "applies to everyone") give per notification event.
        rolesApi.list().then((rs) => {
          if (!alive) return
          const mine = new Set<number>(u.role_ids || [])
          const out: Record<string, Set<string>> = {}
          rs.filter((r) => r.is_active && (r.is_default || mine.has(r.id))).forEach((r) => {
            Object.entries(r.notification_events || {}).forEach(([k, ch]) => { (out[k] ||= new Set()); ch.forEach((c) => out[k].add(c)) })
          })
          setRoleNotify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.from(v)])))
        }).catch(() => setRoleNotify({}))
      }).catch((err) => { if (alive) setUserErr(extractErrorMessages(err, `Could not load ${user.name}'s record. Check your connection and try again.`).join(' ')) })
    }
    if (seeScopes) securityApi.userDataScopes(user.id).then((rows) => { if (!alive) return; setScopes(rows); setScopeEdit(Object.fromEntries(rows.filter((r) => r.override).map((r) => [r.module_key, r.override as string]))) }).catch(fail('data access'))
    if (seeNotify) usersApi.getNotificationOverrides(user.id).then((o) => { if (!alive) return; setNotify(o); setSavedNotify(o) }).catch(fail('notification settings'))
    if (seeUsers) approvalsApi.approvesInUser(user.id).then((r) => { if (alive) setApproves(r.stages) })
      .catch((err) => { if (alive) setApprovesErr(extractErrorMessages(err, 'Could not load the approvals this user takes part in.').join(' ')) })
    return () => { alive = false }
  }, [user.id, user.name, seeScopes, seeNotify, seeUsers, tick])

  // Grants that come from the user's roles (shown faded and locked).
  const fromRoles = useMemo(() => {
    const out: Record<string, string[]> = {}
    Object.entries(effective?.grants || {}).forEach(([g, src]) => {
      const roleSrc = src.filter((x) => x !== 'Extra')
      if (roleSrc.length) out[g] = roleSrc
    })
    return out
  }, [effective])

  const run = async (fn: () => Promise<void>, done: string) => {
    setSaving(true); setError('')
    try { await fn(); setNotice(done) } catch (err) {
      setError(extractErrorMessages(err, `Could not save ${user.name}'s settings.`).join(' '))
    } finally { setSaving(false) }
  }

  const savePerms = () => run(async () => {
    await sod.guard(user.id, { granular_permissions: extras }, (reason) => governedUsersApi.updatePermissions(user.id, extras, reason))
    setSavedExtras(extras)
    setEffective(await usersApi.getEffectivePermissions(user.id))
  }, `Saved for ${user.name} only — the role is unchanged for its other holders. ${user.name} gets it on their next page load.`)

  const saveScopes = () => run(async () => {
    const rows = await securityApi.saveUserDataScopes(user.id, scopeEdit)
    setScopes(rows)
  }, `Data access saved for ${user.name} only.`)

  const saveNotify = () => run(async () => {
    const o = await usersApi.saveNotificationOverrides(user.id, notify)
    setNotify(o); setSavedNotify(o)
  }, `Notifications saved for ${user.name} only.`)

  const intro = (text: React.ReactNode) => (
    <p style={{ ...sheetHint, margin: '0 0 12px' }}>{text}</p>
  )
  const lockNote = selfLocked && tab !== 'Approves in' && (
    <p style={{ fontSize: 12.5, color: '#b45309', margin: '0 0 12px' }}>This is your own access — only an admin can change it.</p>
  )
  const noAccess = (what: string) => <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Seeing a user&apos;s {what} needs Organization › Role &amp; Permissions › {what}.</p>
  const saveBtn = (onClick: () => void, dirty: boolean, enabled: boolean) => enabled && (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
      <button type="button" onClick={onClick} disabled={saving || !dirty} style={sheetBtn('primary', SHEET.BLUE, saving || !dirty)}>
        <SheetIcon name="check" size={16} />{saving ? 'Saving…' : `Save for ${user.name}`}
      </button>
    </div>
  )

  return (
    <div data-tour="org-role-member-access">
      <MessageDialog open={!!error} variant="error" title="Role & Permissions" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Saved" message={notice} onClose={() => setNotice('')} />
      {sod.dialog}
      {(loadErr || userErr) && (
        <div role="alert" style={{ padding: '10px 14px', margin: '0 0 12px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>{[loadErr, userErr].filter(Boolean).join(' ')}</span>
          <button type="button" onClick={() => setTick((n) => n + 1)} style={sheetBtn('secondary', SHEET.INK)}>Try again</button>
        </div>
      )}

      {tab === 'Permissions' && (
        <SheetSection icon="list" title={`Permissions — ${user.name}`}>
          {!seePerms ? noAccess('Extra permissions') : !seeUsers ? <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Editing a user&apos;s extra permissions also needs Organization › Users › View, so the user&apos;s current extras can be shown first.</p> : !effective || !userLoaded ? <p style={{ fontSize: 13, color: SHEET.MUTED }}>{loadErr || userErr ? 'Could not load — see the message above.' : 'Loading…'}</p> : <>
            {intro(<>Faded, locked ticks come from <b>{user.name}</b>&apos;s roles. Tick more to give <b>only {user.name}</b> extra access — the role stays the same for everyone else. To take away something a role gives, change or remove that role.</>)}
            {lockNote}
            <PermissionMatrixEditor registry={catalog} value={extras} onChange={setExtras} readOnly={!editPerms} inherited={fromRoles} />
            {saveBtn(savePerms, JSON.stringify(extras) !== JSON.stringify(savedExtras), editPerms)}
          </>}
        </SheetSection>
      )}

      {tab === 'Data access' && (
        <SheetSection icon="building" title={`Data access — ${user.name}`}>
          {!seeScopes ? noAccess('Data access') : !scopes ? <p style={{ fontSize: 13, color: SHEET.MUTED }}>Loading…</p> : <>
            {intro(<>&ldquo;Follow roles&rdquo; = the widest access <b>{user.name}</b>&apos;s roles give. Pick a level to set it for <b>{user.name} only</b>; it beats every role.</>)}
            {lockNote}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 620 }}>
              {scopes.map((r) => (
                <div key={r.module_key} style={{ display: 'flex', alignItems: 'center', gap: 8, columnGap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: SHEET.INK, fontWeight: 600, flex: '1 1 160px', minWidth: 0 }}>{r.module_label}</span>
                  <Select value={scopeEdit[r.module_key] || ''} disabled={!editScopes} style={{ ...sheetInput, width: 280, maxWidth: '100%' }}
                    onChange={(e) => setScopeEdit((s) => {
                      const next = { ...s }
                      if (e.target.value) next[r.module_key] = e.target.value
                      else delete next[r.module_key]
                      return next
                    })}>
                    <option value="">{`Follow roles (${r.override ? 'roles decide' : r.effective_label})`}</option>
                    {(catalog.scope_levels || []).map((lv) => <option key={lv} value={lv}>{catalog.scope_labels?.[lv] || lv}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {saveBtn(saveScopes, JSON.stringify(scopeEdit) !== JSON.stringify(Object.fromEntries(scopes.filter((r) => r.override).map((r) => [r.module_key, r.override as string]))), editScopes)}
          </>}
        </SheetSection>
      )}

      {tab === 'Notifications' && (
        <SheetSection icon="send" title={`Notifications — ${user.name}`}>
          {!seeNotify ? noAccess('Notifications') : !eventCatalog || !effective ? <p style={{ fontSize: 13, color: SHEET.MUTED }}>{loadErr ? 'Could not load — see the message above.' : 'Loading…'}</p> : <>
            {intro(<>Faded ticks come from <b>{user.name}</b>&apos;s roles. Change an event to set it for <b>{user.name} only</b> (untick everything to switch it off for them); &ldquo;Follow roles&rdquo; undoes it.</>)}
            {lockNote}
            <RoleNotificationsEditor catalog={eventCatalog} registry={catalog} permissions={Object.keys(effective.grants || {})}
              value={notify} onChange={setNotify} readOnly={!editNotify} fromRoles={roleNotify} />
            {saveBtn(saveNotify, JSON.stringify(notify) !== JSON.stringify(savedNotify), editNotify)}
          </>}
        </SheetSection>
      )}

      {tab === 'Approves in' && (
        <SheetSection icon="flag" title={`Approves in — ${user.name}`}>
          {intro(<>Every approval stage <b>{user.name}</b> takes part in, from all their roles and permissions. Read-only — who approves is decided per document in Organization › Approval Workflows (that is where to make {user.name} an approver of a stage).</>)}
          {!seeUsers ? <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Seeing the approvals a user takes part in needs Organization › Users › View.</p> : <ApprovesInPanel rows={approves} error={approvesErr} empty={`${user.name} isn't an approver in any workflow.`} />}
        </SheetSection>
      )}
    </div>
  )
}
