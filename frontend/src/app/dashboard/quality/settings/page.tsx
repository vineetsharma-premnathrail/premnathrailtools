'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityMasterValue } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner, Pill, ActionSheet, sheetGap } from '@/components/quality/QualityBits'
import { sheetInput, sheetLabel, sheetHint, Req } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

interface Spec { key: string; group: string; label: string; type: 'int' | 'float' | 'str' | 'choice'; help?: string; choices?: [string, string][]; min?: number; max?: number }
interface RoleUser { id: number; name: string; email: string; is_admin: boolean; is_partner: boolean; roles: string[] }

const LISTS: { key: string; label: string; note: string }[] = [
  { key: 'ncr_sources', label: 'NCR sources', note: 'Where a manual NCR can come from.' },
  { key: 'complaint_categories', label: 'Complaint categories', note: 'Used from Phase 3 (customer complaints).' },
  { key: 'audit_types', label: 'Audit types', note: 'Used from Phase 4 (audits).' },
  { key: 'inspection_agencies', label: 'Inspection agencies', note: 'Third-party inspection (RITES / RDSO / customer), Phase 2.' },
]

export default function QualitySettingsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('quality')
  const [specs, setSpecs] = useState<Spec[]>([])
  const [groups, setGroups] = useState<{ key: string; label: string }[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [canEdit, setCanEdit] = useState(false)
  const [lists, setLists] = useState<QualityMasterValue[]>([])
  const [newValue, setNewValue] = useState<Record<string, string>>({})
  const [roles, setRoles] = useState<{ key: string; label: string }[]>([])
  const [users, setUsers] = useState<RoleUser[]>([])
  const [roleForm, setRoleForm] = useState({ user_id: '', role: 'inspector' })
  const [granting, setGranting] = useState(false)
  const [addingList, setAddingList] = useState<string | null>(null)
  const [sheetError, setSheetError] = useState<string | string[]>('')
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    qualityApi.getSettings().then((d) => {
      setSpecs(d.specs || [])
      setGroups(d.groups || [])
      setCanEdit(!!d.can_edit)
      setValues(Object.fromEntries(Object.entries(d.values || {}).map(([k, v]) => [k, String(v)])))
    }).catch((e) => setError(extractErrorMessages(e, 'Failed to load Quality settings.')))
    qualityApi.listMasterValues({ include_inactive: true }).then(setLists).catch(() => setLists([]))
    qualityApi.listQualityRoles().then((d) => { setRoles(d.roles || []); setUsers(d.users || []) }).catch(() => {})
  }, [])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const sp of specs) payload[sp.key] = sp.type === 'int' || sp.type === 'float' ? Number(values[sp.key]) : values[sp.key]
      await qualityApi.saveSettings(payload)
      setSaved('Quality settings saved. The change is recorded in the audit log.')
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save settings.'))
    } finally {
      setBusy(false)
    }
  }

  const addValue = async (listKey: string) => {
    const label = (newValue[listKey] || '').trim()
    if (!label) return setSheetError('Type the value to add (e.g. the agency or category name).')
    setSheetError('')
    setBusy(true)
    try {
      await qualityApi.createMasterValue({ list_key: listKey, value: label, label })
      setNewValue({ ...newValue, [listKey]: '' })
      setAddingList(null)
      load()
    } catch (err) {
      setSheetError(extractErrorMessages(err, 'Failed to add the value.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleValue = async (v: QualityMasterValue) => {
    setError('')
    try {
      await qualityApi.updateMasterValue(v.id, { is_active: !v.is_active })
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to update the value.'))
    }
  }

  const assign = async () => {
    if (!roleForm.user_id) return setSheetError('Pick the user.')
    setSheetError('')
    setBusy(true)
    try {
      const r = await qualityApi.assignQualityRole(Number(roleForm.user_id), roleForm.role)
      setGranting(false)
      setSaved(r.added?.length ? `Granted ${r.added.length} permission(s).` : 'The user already had every permission of this role.')
      load()
    } catch (err) {
      setSheetError(extractErrorMessages(err, 'Failed to grant the role.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <MessageDialog open={!!saved} variant="success" title="Saved" message={saved} onClose={() => setSaved('')} />
      <PageHeader title="Quality Settings" />
      {!canEdit && <p style={{ fontSize: 13, color: '#b45309', margin: '-8px 0 14px' }}>Read-only — only a Quality head or an admin can change Quality settings.</p>}
      <ErrorBanner error={error} />
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
        Who approves — NCR dispositions (incl. the scrap value that needs a Partner), inspection plans, vendor blocks, CAPA D8 and
        complaint closure — is set in Organization › Approval Workflows, not here.
      </p>

      {groups.map((g) => (
        <Section key={g.key} title={g.label} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {specs.filter((sp) => sp.group === g.key).map((sp) => (
              <div key={sp.key} style={{ flex: '1 1 240px', maxWidth: 320 }} title={sp.help || ''}>
                <Field label={sp.label}>
                  {sp.type === 'choice' ? (
                    <Select style={inputStyle} disabled={!canEdit} value={values[sp.key] || ''} onChange={(e) => setValues({ ...values, [sp.key]: e.target.value })}>
                      {(sp.choices || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  ) : (
                    <input style={inputStyle} disabled={!canEdit} type={sp.type === 'str' ? 'text' : 'number'} min={sp.min} max={sp.max}
                      value={values[sp.key] ?? ''} onChange={(e) => setValues({ ...values, [sp.key]: e.target.value })} />
                  )}
                </Field>
                {sp.help && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }}>{sp.help}</p>}
              </div>
            ))}
          </div>
        </Section>
      ))}
      {canEdit && <div style={{ marginBottom: 24 }}><button type="button" disabled={busy} style={primaryBtnStyle} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button></div>}

      <Section title="Master lists" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Values are never deleted — retire them so old records keep their meaning. Defect and disposition codes, characteristics and the sampling table are under Quality → Masters.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {LISTS.map((l) => (
            <div key={l.key} style={{ flex: '1 1 260px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{l.label}</p>
              <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>{l.note}</p>
              {lists.filter((v) => v.list_key === l.key).map((v) => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, opacity: v.is_active ? 1 : 0.5 }}>
                  <span>{v.label}</span>
                  {canEdit && <span onClick={() => toggleValue(v)} style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', color: v.is_active ? '#DC2626' : '#16A34A' }}>{v.is_active ? 'Retire' : 'Reactivate'}</span>}
                </div>
              ))}
              {canEdit && (
                <div><button type="button" style={secondaryBtnStyle} onClick={() => { setSheetError(''); setAddingList(l.key) }}>+ Add value</button></div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Quality roles" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
          Roles are Permission Matrix sets. Usage decisions, plan approval, NCR disposition approvals and these settings need the role explicitly (admins always pass). Partner approval comes from Company Info → Partners; Design and Purchase approvals from module access.
        </p>
        {user?.role === 'admin' && (
          <div><button type="button" style={primaryBtnStyle} onClick={() => { setSheetError(''); setGranting(true) }}>+ Grant role</button></div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {users.map((u) => (
            <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <span style={{ minWidth: 180 }}>{u.name}</span>
              {u.is_admin && <Pill text="Admin" hex="#7C3AED" />}
              {u.is_partner && <Pill text="Partner" hex="#0891B2" />}
              {u.roles.map((r) => <Pill key={r} text={roles.find((x) => x.key === r)?.label || r} hex="#16A34A" />)}
              {!u.is_admin && u.roles.length === 0 && <span style={{ color: TEXT.muted, fontSize: 12 }}>No Quality role</span>}
            </div>
          ))}
        </div>
      </Section>

      {granting && user?.role === 'admin' && (
        <ActionSheet icon="shield" title="Grant Quality Role" subtitle="Adds the role's Permission Matrix grants to the user." onClose={() => setGranting(false)}
          onSubmit={assign} busy={busy} error={sheetError} submitLabel="Grant role" busyLabel="Granting…">
          <label style={sheetLabel}>User <Req /></label>
          <SearchableSelect value={roleForm.user_id} onChange={(v) => setRoleForm({ ...roleForm, user_id: v })} placeholder="Select user…"
            options={users.map((u) => ({ value: String(u.id), label: u.name }))} />
          <label style={{ ...sheetLabel, ...sheetGap }}>Role <Req /></label>
          <Select style={sheetInput} value={roleForm.role} onChange={(e) => setRoleForm({ ...roleForm, role: e.target.value })}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
          <p style={sheetHint}>The user gets every permission of this role; permissions they already hold are kept.</p>
        </ActionSheet>
      )}

      {addingList && canEdit && (
        <ActionSheet icon="plus" title="Add Value" subtitle={LISTS.find((l) => l.key === addingList)?.label || addingList} onClose={() => setAddingList(null)}
          onSubmit={() => addValue(addingList)} busy={busy} error={sheetError} submitLabel="Add">
          <label style={sheetLabel}>Value <Req /></label>
          <input style={sheetInput} autoFocus placeholder="New value" value={newValue[addingList] || ''} onChange={(e) => setNewValue({ ...newValue, [addingList]: e.target.value })} />
          <p style={sheetHint}>{LISTS.find((l) => l.key === addingList)?.note}</p>
        </ActionSheet>
      )}
    </div>
  )
}
