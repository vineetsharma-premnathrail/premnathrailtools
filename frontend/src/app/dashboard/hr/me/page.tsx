'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrEmployeeProfile } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import EmployeeProfileView from '@/components/hr/employee/EmployeeProfileView'
import EmployeeDocumentsTab from '@/components/hr/employee/EmployeeDocumentsTab'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { sectionStyle, labelStyle, hintStyle, linkActionStyle, ErrorBanner, Avatar, StatusPill, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_HEX } from '@/components/hr/masters/masterUi'

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
    setTimeout(() => document.getElementById('my-personal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
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
          {me && <Avatar name={me.name} url={me.profile_photo_url} id={me.user_id} size={52} />}
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              HR &amp; Administration · My HR
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {me?.name || user.name}
              {me?.has_profile && statusKey && <StatusPill label={EMPLOYMENT_STATUS_LABELS[statusKey] || statusKey} hex={EMPLOYMENT_STATUS_HEX[statusKey] || '#64748B'} />}
            </h1>
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
              {me ? [me.designation_name, me.department_name, me.branch_name].filter(Boolean).join(' · ') || 'Your employee details, manager, documents and emergency contact.' : 'Your employee details, manager, documents and emergency contact.'}
            </p>
          </div>
        </div>
        {me && !editing && <button type="button" style={primaryBtnStyle} onClick={startEdit}>Edit My Details</button>}
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
            <div id="my-personal-form" style={sectionStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Edit My Details</h2>
              <p style={{ ...hintStyle, margin: '0 0 14px' }}>You can update your personal contact details, addresses, emergency contact, blood group and marital status. For department, designation, manager, joining date or ID numbers, ask HR.</p>
              <div style={row}>
                <div style={{ flex: '1 1 240px', maxWidth: 320 }}><label style={labelStyle}>Personal Email</label><input style={inputStyle} {...inp('personal_email')} placeholder="name@gmail.com" /></div>
                <div style={{ flex: '0 1 190px', minWidth: 170 }}><label style={labelStyle}>Personal Phone</label><input style={inputStyle} {...inp('personal_phone')} placeholder="+91 98765 43210" /></div>
                <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                  <label style={labelStyle}>Blood Group</label>
                  <select style={inputStyle} {...inp('blood_group')}>
                    <option value="">—</option>
                    {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 1 160px', minWidth: 140 }}>
                  <label style={labelStyle}>Marital Status</label>
                  <select style={inputStyle} {...inp('marital_status')}>
                    <option value="">—</option>
                    {MARITAL.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div style={row}>
                <div style={{ flex: '1 1 320px', maxWidth: 560 }}><label style={labelStyle}>Current Address</label><textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} {...inp('current_address')} /></div>
                <div style={{ flex: '1 1 320px', maxWidth: 560 }}>
                  <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Permanent Address</span>
                    <button type="button" style={{ ...linkActionStyle, fontSize: 11.5 }} onClick={() => setForm({ ...form, permanent_address: form.current_address })}>Same as current</button>
                  </label>
                  <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} {...inp('permanent_address')} />
                </div>
              </div>
              <div style={row}>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={labelStyle}>Emergency Contact Name</label><input style={inputStyle} {...inp('emergency_contact_name')} /></div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={labelStyle}>Relation</label><input style={inputStyle} {...inp('emergency_contact_relation')} placeholder="Spouse / Father" /></div>
                <div style={{ flex: '0 1 190px', minWidth: 170 }}><label style={labelStyle}>Emergency Phone</label><input style={inputStyle} {...inp('emergency_contact_phone')} /></div>
              </div>
              <ErrorBanner errors={formErrors} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" style={secondaryBtnStyle} disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save My Details'}</button>
              </div>
            </div>
          )}

          <EmployeeProfileView
            p={me}
            audience="self"
            personalAction={!editing ? <button type="button" style={linkActionStyle} onClick={startEdit}>Edit</button> : undefined}
          />

          <EmployeeDocumentsTab userId={me.user_id} mode="self" />
        </>
      )}
    </div>
  )
}
