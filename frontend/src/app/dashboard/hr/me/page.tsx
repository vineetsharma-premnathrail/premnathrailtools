'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrApi } from '@/lib/api'
import { HrEmployeeProfile } from '@/types'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import EmployeeProfileView from '@/components/hr/employee/EmployeeProfileView'
import EmployeeDocumentsTab from '@/components/hr/employee/EmployeeDocumentsTab'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { sectionStyle, linkActionStyle, ErrorBanner, Avatar, StatusPill, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_HEX } from '@/components/hr/masters/masterUi'

const PERSONAL_FIELDS = [
  'personal_email', 'personal_phone', 'current_address', 'permanent_address',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'blood_group', 'marital_status',
] as const
type PersonalKey = (typeof PERSONAL_FIELDS)[number]
type PersonalForm = Record<PersonalKey, string>

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const MARITAL = [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['other', 'Other']]

function toPersonal(p: HrEmployeeProfile): PersonalForm {
  const f = {} as PersonalForm
  for (const k of PERSONAL_FIELDS) f[k] = (p[k] as string | null | undefined) || ''
  return f
}

export default function MyHrProfilePage() {
  // Self-service: any logged-in user.
  const { user, isLoading } = useAuth()
  // Self-service: My HR create / edit (hr:me:*), not the HR-team tabs.
  const { can } = useCan()
  const [me, setMe] = useState<HrEmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PersonalForm | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    hrApi.getMyProfile()
      .then((p) => { setMe(p); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load your profile.")))
      .finally(() => setLoading(false))
  }, [user])

  const startEdit = () => {
    if (!me) return
    setForm(toPersonal(me))
    setFormErrors([])
    setEditing(true)
  }

  const save = async () => {
    if (!form || !me) return
    const problems: string[] = []
    if (form.personal_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.personal_email.trim())) problems.push('Personal email is not a valid email address (e.g. name@gmail.com).')
    for (const [k, label] of [['personal_phone', 'Personal phone'], ['emergency_contact_phone', 'Emergency contact phone']] as const) {
      if (form[k] && !/^\+?[0-9][0-9\s-]{6,18}$/.test(form[k].trim())) problems.push(`${label} should contain digits only, optionally starting with + and the country code.`)
    }
    if (problems.length) { setFormErrors(problems); return }
    const initial = toPersonal(me)
    const payload: Record<string, unknown> = {}
    for (const k of PERSONAL_FIELDS) if (form[k] !== initial[k]) payload[k] = form[k].trim() || null
    if (!Object.keys(payload).length) { setEditing(false); return }
    setSaving(true)
    setFormErrors([])
    try {
      setMe(await hrApi.updateMyProfile(payload))
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setFormErrors(extractErrorMessages(err, "Couldn't save your details."))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !user) return null

  const inp = (k: PersonalKey) => ({ value: form?.[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f)) })
  const row: React.CSSProperties = { display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }
  const statusKey = me?.employment_status || ''

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <MessageDialog open={saved} variant="success" title="Details Updated" message="Your personal details were saved. HR sees the change straight away." onClose={() => setSaved(false)} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {me && <Avatar name={me.name} url={me.profile_photo_url} id={me.user_id ?? undefined} size={52} />}
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              HR &amp; Administration · My HR
            </p>
            <h1 data-tour="hr-me-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {me?.name || user.name}
              {me?.has_profile && statusKey && <StatusPill label={EMPLOYMENT_STATUS_LABELS[statusKey] || statusKey} hex={EMPLOYMENT_STATUS_HEX[statusKey] || '#64748B'} />}
            </h1>
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
              {me ? [me.designation_name, me.department_name, me.branch_name].filter(Boolean).join(' · ') || 'Your employee details, manager, documents and emergency contact.' : 'Your employee details, manager, documents and emergency contact.'}
            </p>
          </div>
        </div>
        {me && !editing && can('hr', 'me', 'edit') && <button type="button" data-tour="hr-me-edit-btn" style={primaryBtnStyle} onClick={startEdit}>Edit My Details</button>}
      </div>

      <ErrorBanner errors={error} />
      {loading && <div style={sectionStyle}><p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading your profile…</p></div>}

      {me && (
        <>
          {!me.has_profile && (
            <div style={{ ...sectionStyle, padding: '14px 18px' }}>
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
                HR hasn&apos;t completed your employee record yet, so only the details from your Microsoft account are shown. You can still add your personal and emergency-contact details below; for anything else (employee code, department, manager, IDs) contact HR.
              </p>
            </div>
          )}

          {editing && form && (
            <FormSheet width={960} tour="hr-me-edit-sheet" icon="edit" title="Edit My Details"
              subtitle="For department, designation, manager, joining date or ID numbers, ask HR."
              onClose={() => setEditing(false)} busy={saving}
              footer={<>
                <button type="button" data-tour="hr-me-cancel-btn" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" data-tour="hr-me-save-btn" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={save}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save My Details'}</button>
              </>}>
              <SheetColumns
                left={<>
                  <ErrorBanner errors={formErrors} />
                  <SheetSection icon="user" title="Personal">
                    <div style={row}>
                      <div data-tour="hr-me-personal-email" style={{ flex: '1 1 240px', maxWidth: 320 }}><label style={sheetLabel}>Personal Email</label><input style={sheetInput} {...inp('personal_email')} placeholder="name@gmail.com" /></div>
                      <div data-tour="hr-me-personal-phone" style={{ flex: '0 1 190px', minWidth: 170 }}><label style={sheetLabel}>Personal Phone</label><input style={sheetInput} {...inp('personal_phone')} placeholder="+91 98765 43210" /></div>
                    </div>
                    <div style={{ ...row, marginBottom: 0 }}>
                      <div data-tour="hr-me-blood-group" style={{ flex: '0 1 120px', minWidth: 110 }}>
                        <label style={sheetLabel}>Blood Group</label>
                        <Select style={sheetInput} {...inp('blood_group')}>
                          <option value="">—</option>
                          {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </Select>
                      </div>
                      <div data-tour="hr-me-marital" style={{ flex: '0 1 160px', minWidth: 140 }}>
                        <label style={sheetLabel}>Marital Status</label>
                        <Select style={sheetInput} {...inp('marital_status')}>
                          <option value="">—</option>
                          {MARITAL.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                      </div>
                    </div>
                  </SheetSection>
                  <SheetSection icon="building" title="Addresses">
                    <div data-tour="hr-me-current-address" style={{ marginBottom: 14 }}><label style={sheetLabel}>Current Address</label><textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} {...inp('current_address')} /></div>
                    <div data-tour="hr-me-permanent-address">
                      <label style={{ ...sheetLabel, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Permanent Address</span>
                        <button type="button" data-tour="hr-me-same-as-current" style={{ ...linkActionStyle, fontSize: 11.5 }} onClick={() => setForm({ ...form, permanent_address: form.current_address })}>Same as current</button>
                      </label>
                      <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} {...inp('permanent_address')} />
                    </div>
                  </SheetSection>
                </>}
                right={<>
                  <SheetSection icon="alert" title="Emergency Contact">
                    <div data-tour="hr-me-emg-name" style={{ marginBottom: 14 }}><label style={sheetLabel}>Name</label><input style={sheetInput} {...inp('emergency_contact_name')} /></div>
                    <div data-tour="hr-me-emg-relation" style={{ marginBottom: 14 }}><label style={sheetLabel}>Relation</label><input style={sheetInput} {...inp('emergency_contact_relation')} placeholder="Spouse / Father" /></div>
                    <div data-tour="hr-me-emg-phone"><label style={sheetLabel}>Emergency Phone</label><input style={sheetInput} {...inp('emergency_contact_phone')} /></div>
                  </SheetSection>
                  <p style={{ ...sheetHint, margin: 0 }}>HR sees the change straight away.</p>
                </>}
              />
            </FormSheet>
          )}

          <EmployeeProfileView
            p={me}
            audience="self"
            personalAction={!editing && can('hr', 'me', 'edit') ? <button type="button" data-tour="hr-me-card-edit" style={linkActionStyle} onClick={startEdit}>Edit</button> : undefined}
          />

          <EmployeeDocumentsTab userId={me.user_id ?? 0} mode="self" />
        </>
      )}
    </div>
  )
}
