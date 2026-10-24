'use client'

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { Organization, OrgContact } from '@/types'
import { crmApi } from '@/lib/api'
import PhoneField, { isPhoneValid } from '@/components/erp/PhoneField'
import { isValidEmail, isValidGST, isValidWebsite } from './validators'
import { extractErrorMessages } from '@/lib/validation'
import MessageDialog from '@/components/erp/MessageDialog'
import { ORG_TYPES, ORG_TYPE_LABELS, RAILWAY_ZONES, COUNTRIES, orgTypeHasRailwayFields } from './constants'
import { AddMoreButton, RemoveValueButton, ValueRow, canAddMore } from '@/components/shared/MoreValuesButtons'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'

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
  pan: string
  gst_state_code: string
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
    pan: initial?.pan || '',
    gst_state_code: initial?.gst_state_code || '',
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

const inputStyle = sheetInput

/** Labelled field in the sheet style (keeps the tour target on the wrapper). */
function Field({ label, tourId, children }: { label: React.ReactNode; tourId?: string; children: React.ReactNode }) {
  return (
    <div {...(tourId ? { 'data-tour': tourId } : {})}>
      <label style={sheetLabel}>{label}</label>
      {children}
    </div>
  )
}
const withAdd = (field: React.ReactNode, onAdd: () => void, label: string, extras: string[]) => (
  <ValueRow button={<AddMoreButton onClick={onAdd} label={label} extras={extras} />}>{field}</ValueRow>
)

const contactInputStyle: React.CSSProperties = inputStyle

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
  nav,
}: {
  initial?: Organization
  title: string
  breadcrumb: React.ReactNode
  /** Module sub-nav, rendered above the breadcrumb and the form header. */
  nav?: React.ReactNode
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<Organization>
  onSaved: (org: Organization) => void
}) {
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
  // Rows the user removed that already exist on the server. Kept as whole rows
  // (not just ids) so a row whose delete is refused (409 — still used on an
  // inquiry/tender/activity) can be put back into the list.
  const [removedContacts, setRemovedContacts] = useState<ContactRow[]>([])
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<{ variant: 'success' | 'error'; title: string; message: string | string[] } | null>(null)
  const [savedOrg, setSavedOrg] = useState<Organization | null>(null)
  // Errors show in the banner at the top of the form; the dialog is only the "saved" notice.
  const [error, setError] = useState<string | string[]>('')
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (error && (!Array.isArray(error) || error.length)) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])
  const fail = (message: string | string[]) => setError(message)

  const showRailwayFields = orgTypeHasRailwayFields(form.org_type)

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
    // `contactsLoading` already starts true when editing.
    if (initial?.id) {
      crmApi.listOrgContacts(initial.id).then((existing: OrgContact[]) => {
        setContacts(existing.length ? existing.map(toContactRow) : [emptyContact()])
        setContactsLoading(false)
      })
    }
  }, [initial?.id])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const setOrgType = (value: string) => {
    const showsZone = orgTypeHasRailwayFields(value)
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

  const addExtraPhone = () => setExtraPhones((rows) => (canAddMore(rows) ? [...rows, ''] : rows))
  const setExtraPhone = (index: number, value: string) => setExtraPhones((rows) => rows.map((r, i) => (i === index ? value : r)))
  const removeExtraPhone = (index: number) => setExtraPhones((rows) => rows.filter((_, i) => i !== index))

  const addExtraEmail = () => setExtraEmails((rows) => (canAddMore(rows) ? [...rows, ''] : rows))
  const setExtraEmail = (index: number, value: string) => setExtraEmails((rows) => rows.map((r, i) => (i === index ? value : r)))
  const removeExtraEmail = (index: number) => setExtraEmails((rows) => rows.filter((_, i) => i !== index))

  const removeContact = (index: number) => {
    setContacts((rows) => {
      const row = rows[index]
      if (row.id) setRemovedContacts((removed) => [...removed, row])
      return rows.filter((_, i) => i !== index)
    })
  }

  const addContactMobile = (rowIdx: number) => setContacts((rows) => rows.map((r, i) => (i === rowIdx && canAddMore(r.additionalMobiles) ? { ...r, additionalMobiles: [...r.additionalMobiles, ''] } : r)))
  const setContactMobile = (rowIdx: number, subIdx: number, value: string) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalMobiles: r.additionalMobiles.map((m, j) => (j === subIdx ? value : m)) } : r)))
  const removeContactMobile = (rowIdx: number, subIdx: number) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalMobiles: r.additionalMobiles.filter((_, j) => j !== subIdx) } : r)))

  const addContactEmail = (rowIdx: number) => setContacts((rows) => rows.map((r, i) => (i === rowIdx && canAddMore(r.additionalEmails) ? { ...r, additionalEmails: [...r.additionalEmails, ''] } : r)))
  const setContactEmail = (rowIdx: number, subIdx: number, value: string) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalEmails: r.additionalEmails.map((m, j) => (j === subIdx ? value : m)) } : r)))
  const removeContactEmail = (rowIdx: number, subIdx: number) =>
    setContacts((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, additionalEmails: r.additionalEmails.filter((_, j) => j !== subIdx) } : r)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) {
      fail('Customer Organization name is required.')
      return
    }
    if (!form.org_type) {
      fail('Customer Organization Type is required.')
      return
    }
    if (form.org_type === 'Other' && !orgTypeCustom.trim()) {
      fail('Please specify the customer organization type.')
      return
    }
    if (!isPhoneValid(form.official_phone)) {
      fail('Please enter a valid phone number before saving.')
      return
    }
    if (!isValidGST(form.gst_number)) {
      fail('Please enter a valid GST number before saving.')
      return
    }
    if (!isValidWebsite(form.website)) {
      fail('Please enter a valid website address before saving.')
      return
    }
    if (!isValidEmail(form.official_email)) {
      fail('Please enter a valid official email before saving.')
      return
    }
    if (extraPhones.some((p) => p && !isPhoneValid(p))) {
      fail('Please enter a valid additional phone number before saving.')
      return
    }
    if (extraEmails.some((e) => e && !isValidEmail(e))) {
      fail('Please enter a valid additional email before saving.')
      return
    }
    if (contacts.some((c) => c.email && !isValidEmail(c.email))) {
      fail('Please enter a valid email for each contact before saving.')
      return
    }
    if (contacts.some((c) => c.additionalEmails.some((e) => e && !isValidEmail(e)))) {
      fail('Please enter a valid email for each contact before saving.')
      return
    }
    if (contacts.some((c) => c.additionalMobiles.some((m) => m && !isPhoneValid(m)))) {
      fail('Please enter a valid mobile number for each contact before saving.')
      return
    }
    if (hasAnyDuplicates) {
      fail('Remove the duplicate phone numbers / email addresses highlighted in the form before saving.')
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
        // Blank = derived on the server from the GSTIN (PAN = chars 3-12, state = chars 1-2).
        pan: form.pan.trim().toUpperCase() || null,
        gst_state_code: form.gst_state_code.trim() || null,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '') delete payload[k]
      })
      const saved = await onSubmit(payload)

      const orgId = initial?.id || saved?.id
      // Each removal is tried on its own: a refused delete (e.g. 409, contact
      // still used on an inquiry) must not stop the other contact edits.
      const notRemoved: { row: ContactRow; reason: string }[] = []
      let savedRows = contacts
      if (orgId) {
        for (const row of removedContacts) {
          try {
            await crmApi.deleteOrgContact(orgId, row.id!)
          } catch (err) {
            notRemoved.push({ row, reason: extractErrorMessages(err, `Contact "${row.name}" could not be removed.`).join(' ') })
          }
        }
        savedRows = []
        for (const row of contacts) {
          if (!row.name.trim()) { savedRows.push(row); continue }
          const body = {
            name: row.name,
            designation: row.designation || undefined,
            department: row.department || undefined,
            mobile: row.mobile || undefined,
            email: row.email || undefined,
            additional_mobiles: row.additionalMobiles.map((m) => m.trim()).filter(Boolean),
            additional_emails: row.additionalEmails.map((e) => e.trim()).filter(Boolean),
          }
          if (row.id) {
            await crmApi.updateOrgContact(orgId, row.id, body)
            savedRows.push(row)
          } else {
            const created = await crmApi.createOrgContact(orgId, body)
            // Keep the new id so a second Save updates it instead of creating a duplicate.
            savedRows.push({ ...row, id: created?.id })
          }
        }
      }
      if (notRemoved.length) {
        // The organization and every other contact change were saved. Put the
        // contacts that could not be removed back into the list and stay on the form.
        setContacts([...savedRows, ...notRemoved.map((n) => n.row)])
        setRemovedContacts([])
        fail([
            `Customer Organization "${saved.name}" and the other contact changes were saved, but ${notRemoved.length === 1 ? 'this contact was' : 'these contacts were'} kept:`,
            ...notRemoved.map((n) => `${n.row.name}: ${n.reason}`),
            'Re-link or close the records that use them, then remove them again.',
        ])
        return
      }
      setSavedOrg(saved)
      setDialog({ variant: 'success', title: 'Customer Organization Saved', message: `Customer Organization "${saved.name}" saved successfully.` })
    } catch (err) {
      fail(extractErrorMessages(err, 'Failed to save customer organization.'))
    } finally {
      setSaving(false)
    }
  }

  const closeDialog = () => {
    const wasSuccess = dialog?.variant === 'success'
    setDialog(null)
    if (wasSuccess && savedOrg) onSaved(savedOrg)
  }

  const formId = initial ? `org-form-${initial.id}` : 'org-form-new'
  const busy = saving || contactsLoading
  return (
    <FormPage
      nav={<>{nav}<p style={{ fontSize: 11.5, fontWeight: 600, color: SHEET.MUTED, margin: '0 0 10px' }}>{breadcrumb}</p></>}
      onBack={onCancel} backTour="org-form-back-btn" tour="org-form" icon={initial ? 'edit' : 'building'} title={title}
      subtitle={initial ? 'Change the customer record and its contact persons.' : 'A customer, railway unit or partner we deal with, with its contact persons.'}
      footer={<>
        <button type="button" onClick={onCancel} data-tour="org-form-cancel-btn" disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="submit" form={formId} data-tour="org-save" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>
          <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
        </button>
      </>}>
    <form id={formId} onSubmit={handleSubmit}>
      <MessageDialog
        open={!!dialog}
        variant={dialog?.variant || 'error'}
        title={dialog?.title || ''}
        message={dialog?.message || ''}
        onClose={closeDialog}
      />
      <div ref={errorRef} style={{ padding: error && (!Array.isArray(error) || error.length) ? '16px 24px 0' : 0 }}><SheetError error={error} /></div>
      <SheetColumns
        left={<>
        <SheetSection icon="building" title="Customer Organization Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '2 1 260px', minWidth: 220 }}>
              <Field label={<>Customer Organization Name <Req /></>} tourId="org-name">
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Northern Railway HQ" style={inputStyle} />
              </Field>
            </div>
            <div style={{ flex: '1 1 190px', minWidth: 170 }}>
              <Field label={<>Customer Organization Type <Req /></>} tourId="org-type">
                <Select value={form.org_type} onChange={(e) => setOrgType(e.target.value)} style={inputStyle}>
                  <option value="">-- Select Type --</option>
                  {ORG_TYPES.map((o) => <option key={o} value={o}>{ORG_TYPE_LABELS[o] || o}</option>)}
                </Select>
                {form.org_type === 'Other' && (
                  <input value={orgTypeCustom} onChange={(e) => setOrgTypeCustom(e.target.value)} placeholder="Specify customer organization type" style={{ ...inputStyle, marginTop: 8 }} />
                )}
              </Field>
            </div>
          </div>

          {showRailwayFields && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                <Field label="Railway Zone" tourId="org-railway-zone">
                  <Select value={form.railway_zone} onChange={(e) => set('railway_zone', e.target.value)} style={inputStyle}>
                    <option value="">-- Select Zone --</option>
                    {RAILWAY_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                  </Select>
                  {form.railway_zone === 'Other' && (
                    <input value={railwayZoneCustom} onChange={(e) => setRailwayZoneCustom(e.target.value)} placeholder="Specify railway zone" style={{ ...inputStyle, marginTop: 8 }} />
                  )}
                </Field>
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 180 }}>
                <Field label="Division / Workshop" tourId="org-division"><input value={form.division_workshop} onChange={(e) => set('division_workshop', e.target.value)} placeholder="e.g. Agra Division" style={inputStyle} /></Field>
              </div>
            </div>
          )}
          </div>
        </SheetSection>
        <SheetSection icon="truck" title="Address">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Address" tourId="org-address"><textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} placeholder="Street / locality" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 160px', minWidth: 140 }}>
              <Field label="Country" tourId="org-country">
                <Select value={form.country} onChange={(e) => set('country', e.target.value)} style={inputStyle}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                {form.country === 'Other' && (
                  <input value={countryCustom} onChange={(e) => setCountryCustom(e.target.value)} placeholder="Specify country" style={{ ...inputStyle, marginTop: 8 }} />
                )}
              </Field>
            </div>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <Field label="State / UT" tourId="org-state"><input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Delhi" style={inputStyle} /></Field>
            </div>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <Field label="City" tourId="org-city"><input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. New Delhi" style={inputStyle} /></Field>
            </div>
            <div style={{ flex: '1 1 120px', minWidth: 110 }}>
              <Field label="PIN Code" tourId="org-pin"><input value={form.pin_code} onChange={(e) => set('pin_code', e.target.value)} maxLength={6} placeholder="110001" style={inputStyle} /></Field>
            </div>
          </div>
          </div>
        </SheetSection>
        <SheetSection icon="rupee" title="Contact & Registration">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 200px', minWidth: 180 }}>
              <Field label="Official Phone" tourId="org-phone">
                {withAdd(<PhoneField value={form.official_phone} onChange={(v) => set('official_phone', v)} placeholder="+91 XXXXX XXXXX" style={{ ...inputStyle, ...dupFieldStyle(dupOrgPhones.has(normPhone(form.official_phone))) }} />, addExtraPhone, 'Add another phone', extraPhones)}
              </Field>
              {dupOrgPhones.has(normPhone(form.official_phone)) && (
                <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>
              )}
              {extraPhones.map((p, i) => {
                const isDup = dupOrgPhones.has(normPhone(p))
                return (
                  <div key={i} style={{ marginTop: 6 }}>
                    <ValueRow button={<RemoveValueButton onClick={() => removeExtraPhone(i)} label="Remove this phone" />}>
                      <PhoneField value={p} onChange={(v) => setExtraPhone(i, v)} placeholder="+91 XXXXX XXXXX" style={{ ...inputStyle, ...(p && !isPhoneValid(p) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }} />
                    </ValueRow>
                    {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>}
                  </div>
                )
              })}
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <Field label="Official Email" tourId="org-email">
                {withAdd(<input
                  type="email"
                  value={form.official_email}
                  onChange={(e) => set('official_email', e.target.value)}
                  placeholder="contact@org.gov.in"
                  style={{ ...inputStyle, ...(form.official_email && !isValidEmail(form.official_email) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(dupOrgEmails.has(normEmail(form.official_email))) }}
                />, addExtraEmail, 'Add another email', extraEmails)}
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
                    <ValueRow button={<RemoveValueButton onClick={() => removeExtraEmail(i)} label="Remove this email" />}>
                      <input
                        type="email"
                        value={e}
                        onChange={(ev) => setExtraEmail(i, ev.target.value)}
                        placeholder="another@org.gov.in"
                        style={{ ...inputStyle, ...(e && !isValidEmail(e) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }}
                      />
                    </ValueRow>
                    {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate email address.</p>}
                  </div>
                )
              })}
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <Field label="GST Number" tourId="org-gst">
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
            <div style={{ flex: '0 1 150px', minWidth: 130 }}>
              <Field label="PAN" tourId="org-pan">
                <input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10}
                  placeholder="from GSTIN" style={inputStyle} />
              </Field>
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <Field label="GST State Code" tourId="org-gst-state">
                <input value={form.gst_state_code} onChange={(e) => set('gst_state_code', e.target.value.replace(/\D/g, ''))} maxLength={2}
                  placeholder="from GSTIN" title="Default place of supply on this customer's sales orders and invoices" style={inputStyle} />
              </Field>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <Field label="Website" tourId="org-website">
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
          <p style={sheetHint}>PAN and GST State Code are taken from the GSTIN when left blank. The state code is the default place of supply on this customer&apos;s sales orders and invoices.</p>
        </SheetSection>
        </>}
        right={
        <SheetSection icon="users" title="Contact Persons">
          {contactsLoading ? (
            <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>Loading contacts…</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
                {contacts.map((row, i) => (
                  <div key={i} style={{ padding: 12, borderRadius: 12, background: '#fff', border: `1px solid ${SHEET.LINE}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ flex: '1 1 150px', minWidth: 130 }}>
                        <Field label={<>Name <Req /></>} tourId={i === 0 ? 'contact-name' : undefined}><input value={row.name} onChange={(e) => setContact(i, 'name', e.target.value)} placeholder="Contact name" style={contactInputStyle} /></Field>
                      </div>
                      <div style={{ flex: '1 1 120px', minWidth: 100 }}>
                        <Field label="Designation" tourId={i === 0 ? 'contact-designation' : undefined}><input value={row.designation} onChange={(e) => setContact(i, 'designation', e.target.value)} placeholder="e.g. DEN" style={contactInputStyle} /></Field>
                      </div>
                      <div style={{ flex: '1 1 100px', minWidth: 90 }}>
                        <Field label="Department" tourId={i === 0 ? 'contact-department' : undefined}><input value={row.department} onChange={(e) => setContact(i, 'department', e.target.value)} placeholder="Dept." style={contactInputStyle} /></Field>
                      </div>
                      <div style={{ flex: '1 1 140px', minWidth: 120 }}>
                        <Field label="Mobile" tourId={i === 0 ? 'contact-mobile' : undefined}>
                          {withAdd(<PhoneField value={row.mobile} onChange={(v) => setContact(i, 'mobile', v)} placeholder="+91..." style={{ ...contactInputStyle, ...dupFieldStyle(dupContactMobiles.has(normPhone(row.mobile))) }} />, () => addContactMobile(i), 'Add another mobile', row.additionalMobiles)}
                        </Field>
                        {dupContactMobiles.has(normPhone(row.mobile)) && (
                          <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate mobile number.</p>
                        )}
                        {row.additionalMobiles.map((m, j) => {
                          const isDup = dupContactMobiles.has(normPhone(m))
                          return (
                            <div key={j} style={{ marginTop: 6 }}>
                              <ValueRow button={<RemoveValueButton onClick={() => removeContactMobile(i, j)} label="Remove this mobile" />}>
                                <PhoneField value={m} onChange={(v) => setContactMobile(i, j, v)} placeholder="+91..." style={{ ...contactInputStyle, ...(m && !isPhoneValid(m) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }} />
                              </ValueRow>
                              {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate mobile number.</p>}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                        <Field label="Email" tourId={i === 0 ? 'contact-email' : undefined}>
                          {withAdd(<input
                            type="email"
                            value={row.email}
                            onChange={(e) => setContact(i, 'email', e.target.value)}
                            placeholder="email"
                            style={{ ...contactInputStyle, ...(row.email && !isValidEmail(row.email) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(dupContactEmails.has(normEmail(row.email))) }}
                          />, () => addContactEmail(i), 'Add another email', row.additionalEmails)}
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
                              <ValueRow button={<RemoveValueButton onClick={() => removeContactEmail(i, j)} label="Remove this email" />}>
                                <input
                                  type="email"
                                  value={em}
                                  onChange={(ev) => setContactEmail(i, j, ev.target.value)}
                                  placeholder="email"
                                  style={{ ...contactInputStyle, ...(em && !isValidEmail(em) ? { borderColor: '#f87171' } : {}), ...dupFieldStyle(isDup) }}
                                />
                              </ValueRow>
                              {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate email address.</p>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {contacts.length > 1 && (
                      <button type="button" onClick={() => removeContact(i)} style={{ ...sheetBtn('ghost', '#DC2626'), alignSelf: 'flex-end' }}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={addContact} data-tour="org-add-contact" style={sheetBtn('secondary', SHEET.INK)}><SheetIcon name="plus" size={15} />Add Contact</button>
                <p style={sheetHint}>Add key contacts for this customer organization.</p>
              </div>
            </>
          )}
        </SheetSection>
        }
      />
    </form>
    </FormPage>
  )
}
