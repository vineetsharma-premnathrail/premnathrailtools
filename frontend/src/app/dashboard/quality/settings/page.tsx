'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityMasterValue } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner, Pill } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

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
    if (!label) return
    setError('')
    try {
      await qualityApi.createMasterValue({ list_key: listKey, value: label, label })
      setNewValue({ ...newValue, [listKey]: '' })
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to add the value.'))
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
    if (!roleForm.user_id) return setError('Pick the user.')
    setError('')
    try {
      const r = await qualityApi.assignQualityRole(Number(roleForm.user_id), roleForm.role)
      setSaved(r.added?.length ? `Granted ${r.added.length} permission(s).` : 'The user already had every permission of this role.')
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to grant the role.'))
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

      {groups.map((g) => (
        <Section key={g.key} title={g.label} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {specs.filter((sp) => sp.group === g.key).map((sp) => (
              <div key={sp.key} style={{ flex: '1 1 240px', maxWidth: 320 }} title={sp.help || ''}>
                <Field label={sp.label}>
                  {sp.type === 'choice' ? (
                    <select style={inputStyle} disabled={!canEdit} value={values[sp.key] || ''} onChange={(e) => setValues({ ...values, [sp.key]: e.target.value })}>
                      {(sp.choices || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
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
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={inputStyle} placeholder="New value" value={newValue[l.key] || ''} onChange={(e) => setNewValue({ ...newValue, [l.key]: e.target.value })} />
                  <button type="button" style={secondaryBtnStyle} onClick={() => addValue(l.key)}>Add</button>
                </div>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <Field label="User">
                <select style={inputStyle} value={roleForm.user_id} onChange={(e) => setRoleForm({ ...roleForm, user_id: e.target.value })}>
                  <option value="">Select user…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: '0 1 220px' }}>
              <Field label="Role">
                <select style={inputStyle} value={roleForm.role} onChange={(e) => setRoleForm({ ...roleForm, role: e.target.value })}>
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </Field>
            </div>
            <button type="button" style={primaryBtnStyle} onClick={assign}>Grant role</button>
          </div>
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
    </div>
  )
}
