'use client'

import { useEffect, useState } from 'react'
import { Organization, OrgContact } from '@/types'
import { crmApi } from '@/lib/api'
import PhoneField, { isPhoneValid } from '@/components/erp/PhoneField'
import { isValidEmail, isValidGST, isValidWebsite } from './validators'
import { extractErrorMessages } from '@/lib/validation'
import MessageDialog from '@/components/erp/MessageDialog'
import { ORG_TYPES, ORG_TYPE_LABELS, RAILWAY_ZONES, COUNTRIES } from './constants'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from './ui'

type FormState = {
  name: string
  org_type: string
  parent_org: string
  railway_zone: string
  division_workshop: string
  address: string
  country: string
  state: string
  city: string
  pin_code: string
  gst_number: string
  official_phone: string
  official_email: string
  website: string
}

type ContactRow = {
  id?: number
  name: string
  designation: string
  department: string
  mobile: string
  email: string
  additionalMobiles: string[]
  additionalEmails: string[]
}

function toFormState(initial?: Organization): FormState {
  return {
    name: initial?.name || '',
    org_type: initial?.org_type && !ORG_TYPES.includes(initial.org_type) ? 'Other' : initial?.org_type || '',
    parent_org: initial?.parent_org || '',
    railway_zone: initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? 'Other' : initial?.railway_zone || '',
    division_workshop: initial?.division_workshop || '',
    address: initial?.address || '',
    country: initial?.country && !COUNTRIES.includes(initial.country) ? 'Other' : initial?.country || 'India',
    state: initial?.state || '',
    city: initial?.city || '',
    pin_code: initial?.pin_code || '',
    gst_number: initial?.gst_number || '',
    official_phone: initial?.official_phone || '',
    official_email: initial?.official_email || '',
    website: initial?.website || '',
  }
}

function toContactRow(c: OrgContact): ContactRow {
  return {
    id: c.id,
    name: c.name,
    designation: c.designation || '',
    department: c.department || '',
    mobile: c.mobile || '',
    email: c.email || '',
    additionalMobiles: c.additional_mobiles?.length ? c.additional_mobiles : [],
    additionalEmails: c.additional_emails?.length ? c.additional_emails : [],
  }
}

const emptyContact = (): ContactRow => ({ name: '', designation: '', department: '', mobile: '', email: '', additionalMobiles: [], additionalEmails: [] })

const TABS = ['Information Details'] as const

// inputStyle's border is a translucent white meant for the orange-tinted glass
// section cards — invisible against the plain white contact-entry card below,
// so these need their own visible border/background.
const contactInputStyle: React.CSSProperties = { ...inputStyle, background: '#faf9f7', border: '1px solid rgba(0,0,0,0.12)' }

const normEmail = (v: string) => v.trim().toLowerCase()
const normPhone = (v: string) => v.replace(/\D/g, '')

// Returns the set of normalized values that appear 2+ times in the list, so
// callers can flag every occurrence of a duplicate as it's typed rather than
// only warning once at submit time.
function duplicateKeys(values: string[], normalize: (v: string) => string): Set<string> {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (!v) continue
    const key = normalize(v)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k))
}

const dupFieldStyle = (isDup: boolean): React.CSSProperties => (isDup ? { borderColor: '#f59e0b', background: '#fffbeb' } : {})

export default function OrganizationForm({
  initial,
  title,
  breadcrumb,
  submitLabel,
  onCancel,
  onSubmit,
  onSaved,
}: {
  initial?: Organization
  title: string
  breadcrumb: React.ReactNode
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<Organization>
  onSaved: (org: Organization) => void
}) {
  const [tab, setTab] = useState<typeof TABS[number]>('Information Details')
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [orgTypeCustom, setOrgTypeCustom] = useState(
    initial?.org_type && !ORG_TYPES.includes(initial.org_type) ? initial.org_type : ''
  )
  const [railwayZoneCustom, setRailwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [countryCustom, setCountryCustom] = useState(
    initial?.country && !COUNTRIES.includes(initial.country) ? initial.country : ''
  )
  const [extraPhones, setExtraPhones] = useState<string[]>(initial?.additional_phones?.length ? initial.additional_phones : [])
  const [extraEmails, setExtraEmails] = useState<string[]>(initial?.additional_emails?.length ? initial.additional_emails : [])
  const [contacts, setContacts] = useState<ContactRow[]>([emptyContact()])
  const [contactsLoading, setContactsLoading] = useState(!!initial?.id)
  const [removedContactIds, setRemovedContactIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<{ variant: 'success' | 'error'; title: string; message: string | string[] } | null>(null)
  const [savedOrg, setSavedOrg] = useState<Organization | null>(null)

  const showRailwayFields = form.org_type === 'Railway' || form.org_type === 'Govt Department'

  // Real-time duplicate detection — recomputed on every render so the user sees the
  // warning the moment a repeated value is typed, not just at submit. Checked across
  // ALL phone/email fields on the form together (org's own + every contact's), not
  // per-group — otherwise the org's Official Phone and a Contact Person's Mobile could
  // hold the identical number with no warning shown anywhere.
  const dupOrgPhones = duplicateKeys([form.official_phone, ...extraPhones, ...contacts.flatMap((r) => [r.mobile, ...r.additionalMobiles])], normPhone)
  const dupOrgEmails = duplicateKeys([form.official_email, ...extraEmails, ...contacts.flatMap((r) => [r.email, ...r.additionalEmails])], normEmail)
  const dupContactMobiles = dupOrgPhones
  const dupContactEmails = dupOrgEmails

  const hasAnyDuplicates = dupOrgPhones.size > 0 || dupOrgEmails.size > 0

  useEffect(() => {
    if (initial?.id) {
      setContactsLoading(true)
      crmApi.listOrgContacts(initial.id).then((existing: OrgContact[]) => {
        setContacts(existing.length ? existing.map(toContactRow) : [emptyContact()])
        setContactsLoading(false)
      })
    }
  }, [initial?.id])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const setOrgType = (value: string) => {
    const showsZone = value === 'Railway' || value === 'Govt Department'
    setForm((f) => ({
      ...f,
      org_type: value,
      railway_zone: showsZone ? f.railway_zone : '',
      division_workshop: showsZone ? f.division_workshop : '',
    }))
    if (!showsZone) setRailwayZoneCustom('')
  }

  const setContact = (index: number, field: 'name' | 'designation' | 'department' | 'mobile' | 'email', value: string) => {
    setContacts((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const addContact = () => setContacts((rows) => [...rows, emptyContact()])

  const addExtraPhone = () => setExtraPhones((rows) => [...rows, ''])
  const setExtraPhone = (index: number, value: string) => setExtraPhones((rows) => rows.map((r, i) => (i === index ? value : r)))
  const removeExtraPhone = (index: number) => setExtraPhones((rows) => rows.filter((_, i) => i !== index))

  const addExtraEmail = () => setExtraEmails((rows) => [...rows, ''])
  const setExtraEmail = (index: number, value: string) => setExtraEmails((rows) => rows.map((r, i) => (i === index ? value : r)))
  const removeExtraEmail = (index: number) => setExtraEmails((rows) => rows.filter((_, i) => i !== index))

  const removeContact = (index: number) => {
    setContacts((rows) => {
      const row = rows[index]
      if (row.id) setRemovedContactIds((ids) => [...ids, row.id!])
      return rows.filter((_, i) => i !== index)
    })
  }

  const addContactMobile = (rowIdx: number) => setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalMobiles: [...r.additionalMobiles, ''] } : r)))
  const setContactMobile = (rowIdx: number, subIdx: number, value: string) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalMobiles: r.additionalMobiles.map((m, j) => (j === subIdx ? value : m)) } : r)))
  const removeContactMobile = (rowIdx: number, subIdx: number) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalMobiles: r.additionalMobiles.filter((_, j) => j !== subIdx) } : r)))

  const addContactEmail = (rowIdx: number) => setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalEmails: [...r.additionalEmails, ''] } : r)))
  const setContactEmail = (rowIdx: number, subIdx: number, value: string) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalEmails: r.additionalEmails.map((m, j) => (j === subIdx ? value : m)) } : r)))
  const removeContactEmail = (rowIdx: number, subIdx: number) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalEmails: r.additionalEmails.filter((_, j) => j !== subIdx) } : r)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Organization name is required.' })
      return
    }
    if (!form.org_type) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Organization Type is required.' })
      return
    }
    if (form.org_type === 'Other' && !orgTypeCustom.trim()) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please specify the organization type.' })
      return
    }
    if (!isPhoneValid(form.official_phone)) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid phone number before saving.' })
      return
    }
    if (!isValidGST(form.gst_number)) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid GST number before saving.' })
      return
    }
    if (!isValidWebsite(form.website)) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid website address before saving.' })
      return
    }
    if (!isValidEmail(form.official_email)) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid official email before saving.' })
      return
    }
    if (extraPhones.some((p) => p && !isPhoneValid(p))) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid additional phone number before saving.' })
      return
    }
    if (extraEmails.some((e) => e && !isValidEmail(e))) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid additional email before saving.' })
      return
    }
    if (contacts.some((c) => c.email && !isValidEmail(c.email))) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid email for each contact before saving.' })
      return
    }
    if (contacts.some((c) => c.additionalEmails.some((e) => e && !isValidEmail(e)))) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid email for each contact before saving.' })
      return
    }
    if (contacts.some((c) => c.additionalMobiles.some((m) => m && !isPhoneValid(m)))) {
      setDialog({ variant: 'error', title: 'Cannot Save', message: 'Please enter a valid mobile number for each contact before saving.' })
      return
    }
    if (hasAnyDuplicates) {
      setDialog({ variant: 'error', title: 'Duplicate Values Found', message: 'Remove the duplicate phone numbers / email addresses highlighted in the form before saving.' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        ...form,
        org_type: form.org_type === 'Other' ? orgTypeCustom : form.org_type,
        railway_zone: form.railway_zone === 'Other' ? railwayZoneCustom : form.railway_zone,
        country: form.country === 'Other' ? countryCustom : form.country,
        additional_phones: extraPhones.map((p) => p.trim()).filter(Boolean),
        additional_emails: extraEmails.map((e) => e.trim()).filter(Boolean),
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '') delete payload[k]
      })
      const saved = await onSubmit(payload)

      const orgId = initial?.id || saved?.id
      if (orgId) {
        for (const id of removedContactIds) {
          await crmApi.deleteOrgContact(orgId, id)
        }
        for (const row of contacts) {
          if (!row.name.trim()) continue
          const body = {
            name: row.name,
            designation: row.designation || undefined,
            department: row.department || undefined,
            mobile: row.mobile || undefined,
            email: row.email || undefined,
            additional_mobiles: row.additionalMobiles.map((m) => m.trim()).filter(Boolean),
            additional_emails: row.additionalEmails.map((e) => e.trim()).filter(Boolean),
          }
          if (row.id) await crmApi.updateOrgContact(orgId, row.id, body)
          else await crmApi.createOrgContact(orgId, body)
        }
      }
      setSavedOrg(saved)
      setDialog({ variant: 'success', title: 'Organization Saved', message: `Organization "${saved.name}" saved successfully.` })
    } catch (err: any) {
      setDialog({ variant: 'error', title: 'Failed to Save', message: extractErrorMessages(err, 'Failed to save organization.') })
    } finally {
      setSaving(false)
    }
  }

  const closeDialog = () => {
    const wasSuccess = dialog?.variant === 'success'
    setDialog(null)
    if (wasSuccess && savedOrg) onSaved(savedOrg)
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <MessageDialog
        open={!!dialog}
        variant={dialog?.variant || 'error'}
        title={dialog?.title || ''}
        message={dialog?.message || ''}
        onClose={closeDialog}
      />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: '#a8a29e', margin: '0 0 6px' }}>{breadcrumb}</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: 0 }}>{title}</h1>
        </div>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>
          ← Back
        </button>
      </div>

      {tab === 'Information Details' && (
        <Section title="Organization Details">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '2 1 260px', minWidth: 220 }}>
              <Field label="Organization Name *">
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Northern Railway HQ" style={inputStyle} />
              </Field>
            </div>
            <div style={{ flex: '1 1 190px', minWidth: 170 }}>
              <Field label="Organization Type *">
                <select value={form.org_type} onChange={(e) => setOrgType(e.target.value)} style={inputStyle}>
                  <option value="">-- Select Type --</option>
                  {ORG_TYPES.map((o) => <option key={o} value={o}>{ORG_TYPE_LABELS[o] || o}</option>)}
                </select>
                {form.org_type === 'Other' && (
                  <input value={orgTypeCustom} onChange={(e) => setOrgTypeCustom(e.target.value)} placeholder="Specify organization type" style={{ ...inputStyle, marginTop: 8 }} />
                )}
              </Field>
            </div>
            <div style={{ flex: '2 1 220px', minWidth: 200 }}>
              <Field label="Parent Organization"><input value={form.parent_org} onChange={(e) => set('parent_org', e.target.value)} placeholder="Optional parent org" style={inputStyle} /></Field>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', margin: '4px 0' }} />

          {showRailwayFields && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                <Field label="Railway Zone">
                  <select value={form.railway_zone} onChange={(e) => set('railway_zone', e.target.value)} style={inputStyle}>
                    <option value="">-- Select Zone --</option>
                    {RAILWAY_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                  {form.railway_zone === 'Other' && (
                    <input value={railwayZoneCustom} onChange={(e) => setRailwayZoneCustom(e.target.value)} placeholder="Specify railway zone" style={{ ...inputStyle, marginTop: 8 }} />
                  )}
                </Field>
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 180 }}>
                <Field label="Division / Workshop"><input value={form.division_workshop} onChange={(e) => set('division_workshop', e.target.value)} placeholder="e.g. Agra Division" style={inputStyle} /></Field>
              </div>
            </div>
          )}
          <Field label="Address"><textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} placeholder="Street / locality" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 160px', minWidth: 140 }}>
              <Field label="Country">
                <select value={form.country} onChange={(e) => set('country', e.target.value)} style={inputStyle}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {form.country === 'Other' && (
                  <input value={countryCustom} onChange={(e) => setCountryCustom(e.target.value)} placeholder="Specify country" style={{ ...inputStyle, marginTop: 8 }} />
                )}
              </Field>
            </div>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <Field label="State / UT"><input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Delhi" style={inputStyle} /></Field>
            </div>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. New Delhi" style={inputStyle} /></Field>
            </div>
            <div style={{ flex: '1 1 120px', minWidth: 110 }}>
              <Field label="PIN Code"><input value={form.pin_code} onChange={(e) => set('pin_code', e.target.value)} maxLength={6} placeholder="110001" style={inputStyle} /></Field>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', margin: '4px 0' }} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 200px', minWidth: 180 }}>
              <Field label="Official Phone">
                <PhoneField value={form.official_phone} onChange={(v) => set('official_phone', v)} placeholder="+91 XXXXX XXXXX" style={{ ...inputStyle, ...dupFieldStyle(dupOrgPhones.has(normPhone(form.official_phone))) }} />
              </Field>
              {dupOrgPhones.has(normPhone(form.official_phone)) && (
                <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>
              )}
              {extraPhones.map((p, i) => {
                const isDup = dupOrgPhones.has(normPhone(p))
                return (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <PhoneField value={p} onChange={(v) => setExtraPhone(i, v)} placeholder="+91 XXXXX XXXXX" style={{ ...inputStyle, ...(p && !isPhoneValid(p) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }} />
                      <button type="button" onClick={() => removeExtraPhone(i)} style={{ ...dangerBtnStyle, padding: '5px 10px', fontSize: 11.5 }}>✕</button>
                    </div>
                    {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>}
                  </div>
                )
              })}
              <button type="button" onClick={addExtraPhone} style={{ ...secondaryBtnStyle, marginTop: 6, padding: '4px 10px', fontSize: 11.5 }}>+ Add phone</button>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <Field label="Official Email">
                <input
                  type="email"
                  value={form.official_email}
                  onChange={(e) => set('official_email', e.target.value)}
                  placeholder="contact@org.gov.in"
                  style={{ ...inputStyle, ...(form.official_email && !isValidEmail(form.official_email) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(dupOrgEmails.has(normEmail(form.official_email))) }}
                />
                {form.official_email && !isValidEmail(form.official_email) && (
                  <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>Enter a valid email address.</p>
                )}
                {dupOrgEmails.has(normEmail(form.official_email)) && (
                  <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate email address.</p>
                )}
              </Field>
              {extraEmails.map((e, i) => {
                const isDup = dupOrgEmails.has(normEmail(e))
                return (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="email"
                        value={e}
                        onChange={(ev) => setExtraEmail(i, ev.target.value)}
                        placeholder="another@org.gov.in"
                        style={{ ...inputStyle, ...(e && !isValidEmail(e) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }}
                      />
                      <button type="button" onClick={() => removeExtraEmail(i)} style={{ ...dangerBtnStyle, padding: '5px 10px', fontSize: 11.5 }}>✕</button>
                    </div>
                    {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate email address.</p>}
                  </div>
                )
              })}
              <button type="button" onClick={addExtraEmail} style={{ ...secondaryBtnStyle, marginTop: 6, padding: '4px 10px', fontSize: 11.5 }}>+ Add email</button>
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <Field label="GST Number">
                <input
                  value={form.gst_number}
                  onChange={(e) => set('gst_number', e.target.value.toUpperCase())}
                  maxLength={15}
                  placeholder="27AAAAA0000A1Z5"
                  style={{ ...inputStyle, ...(form.gst_number && !isValidGST(form.gst_number) ? { borderColor: '#f87171' } : {}) }}
                />
                {form.gst_number && !isValidGST(form.gst_number) && (
                  <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>Enter a valid 15-character GSTIN (e.g. 07AABCU9603R1ZW).</p>
                )}
              </Field>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <Field label="Website">
                <input
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                  placeholder="https://"
                  style={{ ...inputStyle, ...(form.website && !isValidWebsite(form.website) ? { borderColor: '#f87171' } : {}) }}
                />
                {form.website && !isValidWebsite(form.website) && (
                  <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>Enter a valid website address.</p>
                )}
              </Field>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', margin: '4px 0' }} />

          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: 0 }}>Contact Persons</p>
          {contactsLoading ? (
            <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>Loading contacts…</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
                {contacts.map((row, i) => (
                  <div key={i} style={{ padding: 12, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ flex: '1 1 150px', minWidth: 130 }}>
                        <Field label="Name *"><input value={row.name} onChange={(e) => setContact(i, 'name', e.target.value)} placeholder="Contact name" style={contactInputStyle} /></Field>
                      </div>
                      <div style={{ flex: '1 1 120px', minWidth: 100 }}>
                        <Field label="Designation"><input value={row.designation} onChange={(e) => setContact(i, 'designation', e.target.value)} placeholder="e.g. DEN" style={contactInputStyle} /></Field>
                      </div>
                      <div style={{ flex: '1 1 100px', minWidth: 90 }}>
                        <Field label="Department"><input value={row.department} onChange={(e) => setContact(i, 'department', e.target.value)} placeholder="Dept." style={contactInputStyle} /></Field>
                      </div>
                      <div style={{ flex: '1 1 140px', minWidth: 120 }}>
                        <Field label="Mobile">
                          <PhoneField value={row.mobile} onChange={(v) => setContact(i, 'mobile', v)} placeholder="+91..." style={{ ...contactInputStyle, ...dupFieldStyle(dupContactMobiles.has(normPhone(row.mobile))) }} />
                        </Field>
                        {dupContactMobiles.has(normPhone(row.mobile)) && (
                          <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate mobile number.</p>
                        )}
                        {row.additionalMobiles.map((m, j) => {
                          const isDup = dupContactMobiles.has(normPhone(m))
                          return (
                            <div key={j} style={{ marginTop: 6 }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <PhoneField value={m} onChange={(v) => setContactMobile(i, j, v)} placeholder="+91..." style={{ ...contactInputStyle, ...(m && !isPhoneValid(m) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }} />
                                <button type="button" onClick={() => removeContactMobile(i, j)} style={{ ...dangerBtnStyle, padding: '5px 8px', fontSize: 11 }}>✕</button>
                              </div>
                              {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate mobile number.</p>}
                            </div>
                          )
                        })}
                        <button type="button" onClick={() => addContactMobile(i)} style={{ ...secondaryBtnStyle, marginTop: 6, padding: '3px 8px', fontSize: 11 }}>+ Add phone</button>
                      </div>
                      <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                        <Field label="Email">
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => setContact(i, 'email', e.target.value)}
                            placeholder="email"
                            style={{ ...contactInputStyle, ...(row.email && !isValidEmail(row.email) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(dupContactEmails.has(normEmail(row.email))) }}
                          />
                          {row.email && !isValidEmail(row.email) && (
                            <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>Enter a valid email address.</p>
                          )}
                          {dupContactEmails.has(normEmail(row.email)) && (
                            <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate email address.</p>
                          )}
                        </Field>
                        {row.additionalEmails.map((em, j) => {
                          const isDup = dupContactEmails.has(normEmail(em))
                          return (
                            <div key={j} style={{ marginTop: 6 }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                  type="email"
                                  value={em}
                                  onChange={(ev) => setContactEmail(i, j, ev.target.value)}
                                  placeholder="email"
                                  style={{ ...contactInputStyle, ...(em && !isValidEmail(em) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }}
                                />
                                <button type="button" onClick={() => removeContactEmail(i, j)} style={{ ...dangerBtnStyle, padding: '5px 8px', fontSize: 11 }}>✕</button>
                              </div>
                              {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate email address.</p>}
                            </div>
                          )
                        })}
                        <button type="button" onClick={() => addContactEmail(i)} style={{ ...secondaryBtnStyle, marginTop: 6, padding: '3px 8px', fontSize: 11 }}>+ Add email</button>
                      </div>
                    </div>
                    {contacts.length > 1 && (
                      <button type="button" onClick={() => removeContact(i)} style={{ ...dangerBtnStyle, alignSelf: 'flex-end', padding: '5px 12px', fontSize: 11.5 }}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <button type="button" onClick={addContact} style={{ ...secondaryBtnStyle, alignSelf: 'flex-start' }}>+ Add Contact</button>
                <p style={{ fontSize: 12, color: '#a8a29e', margin: '8px 0 0' }}>Add key contacts for this organization</p>
              </div>
            </>
          )}
        </Section>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
        <button type="submit" disabled={saving || contactsLoading} style={{ ...primaryBtnStyle, opacity: saving || contactsLoading ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
