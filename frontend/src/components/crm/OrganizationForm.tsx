'use client'

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { Organization, OrgContact } from '@/types'
import { crmApi } from '@/lib/api'
import { isPhoneValid, sanitizePhone } from '@/components/erp/PhoneField'
import { isValidEmail, isValidGST, isValidWebsite } from './validators'
import { extractErrorMessages } from '@/lib/validation'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { segmentBtnStyle } from '@/components/shared/ui'
import { orgTypesFor, ORG_TYPE_LABELS, RAILWAY_ZONES, COUNTRIES, INDIA_STATES, orgTypeHasRailwayFields, dialCodeFor, phoneOrBlank } from './constants'
import { AddMoreButton, RemoveValueButton, ValueRow, canAddMore } from '@/components/shared/MoreValuesButtons'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'

type Scope = 'domestic' | 'international' | ''

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const TAX_ID_RE = /^[A-Za-z0-9 ./-]{2,50}$/

type FormState = {
  org_scope: Scope
  tax_vat_id: string
  company_registration_no: string
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

const scopeOf = (i?: Organization): Scope => (i ? (i.org_scope === 'international' ? 'international' : 'domestic') : '')
/** Saved type shown as itself when it is in the scope's list, otherwise as Other + the saved text. */
const typeInScope = (i?: Organization) => !!i?.org_type && orgTypesFor(scopeOf(i)).includes(i.org_type)
/** Domestic is always India; International keeps the saved country (blank on a new record). */
const countryInList = (i?: Organization) => !!i?.country && COUNTRIES.includes(i.country)
const phonePlaceholder = (code: string) => `${code || '+00'} 98765 43210`

function toFormState(initial?: Organization): FormState {
  return {
    // Create starts with no scope: the requester must choose. Edit shows the saved value.
    org_scope: scopeOf(initial),
    tax_vat_id: initial?.tax_vat_id || '',
    company_registration_no: initial?.company_registration_no || '',
    name: initial?.name || '',
    org_type: initial?.org_type && !typeInScope(initial) ? 'Other' : initial?.org_type || '',
    parent_org: initial?.parent_org || '',
    railway_zone: initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? 'Other' : initial?.railway_zone || '',
    division_workshop: initial?.division_workshop || '',
    address: initial?.address || '',
    // Domestic = India (fixed). International = a country the user picks (blank on a new record).
    country: initial ? (scopeOf(initial) === 'domestic' ? 'India' : initial.country && !countryInList(initial) ? 'Other' : initial.country || '') : '',
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

const emptyContact = (code = ''): ContactRow => ({ name: '', designation: '', department: '', mobile: code, email: '', additionalMobiles: [], additionalEmails: [] })

const inputStyle = sheetInput

/** Phone input that tolerates a bare dialling code (pre-filled from the country): the code alone counts as empty. */
function PhoneInput({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder: string; style?: React.CSSProperties }) {
  const real = phoneOrBlank(value)
  const bad = !!real && !isPhoneValid(real)
  return (
    <div>
      <input value={value} maxLength={20} inputMode="tel" onChange={(e) => onChange(sanitizePhone(e.target.value))} placeholder={placeholder} style={{ ...style, ...(bad ? { borderColor: '#f87171' } : {}) }} />
      {bad && <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>Enter a valid phone number (7-15 digits, with the country code).</p>}
    </div>
  )
}

/** Labelled field in the sheet style (keeps the tour target on the wrapper). */
function Field({ label, tourId, children }: { label: React.ReactNode; tourId?: string; children: React.ReactNode }) {
  return (
    <div {...(tourId ? { 'data-tour': tourId } : {})}>
      <label style={sheetLabel}>{label}</label>
      {children}
    </div>
  )
}
const withAdd = (field: React.ReactNode, onAdd: () => void, label: string, extras: string[], primary?: string | null) => (
  <ValueRow button={<AddMoreButton onClick={onAdd} label={label} extras={extras} primary={primary} />}>{field}</ValueRow>
)

const contactInputStyle: React.CSSProperties = inputStyle

const normEmail = (v: string) => v.trim().toLowerCase()
const normPhone = (v: string) => phoneOrBlank(v).replace(/\D/g, '')

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

const errBorder: React.CSSProperties = { borderColor: '#f87171' }
const errText: React.CSSProperties = { fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }

/** Fields that depend on the scope stay disabled (and dimmed) until it is chosen. */
function Gate({ open, children }: { open: boolean; children: React.ReactNode }) {
  return <fieldset disabled={!open} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, opacity: open ? 1 : 0.55 }}>{children}</fieldset>
}

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
    initial?.org_type && !typeInScope(initial) ? initial.org_type : ''
  )
  const [railwayZoneCustom, setRailwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [countryCustom, setCountryCustom] = useState(
    scopeOf(initial) === 'international' && initial?.country && !countryInList(initial) ? initial.country : ''
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

  // Scope switching. Only the OTHER scope's tax fields are cleared (after a confirm if they hold
  // values); country and state are never touched here, and changing country never touches scope.
  const [pendingScope, setPendingScope] = useState<Scope>('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const scopeChosen = form.org_scope !== ''
  const isDomestic = form.org_scope === 'domestic'
  const isInternational = form.org_scope === 'international'
  // International country the user picked, kept while the form is on Domestic so switching back restores it.
  const intlStash = useRef<{ country: string; custom: string } | null>(
    scopeOf(initial) === 'international' ? { country: toFormState(initial).country, custom: countryCustom } : null
  )
  const countryValue = isDomestic ? 'India' : form.country
  // The dialling code follows the country. A phone that is empty, or still only the previous
  // auto code, takes the new code; a number the user typed is never touched. The code stays editable text.
  const retargetPhones = (prevCountry: string, nextCountry: string) => {
    const prev = dialCodeFor(prevCountry)
    const next = dialCodeFor(nextCountry)
    if (prev === next) return
    const swap = (v: string) => (v.trim() === '' || v.trim() === prev ? next : v)
    setForm((f) => ({ ...f, official_phone: swap(f.official_phone) }))
    setExtraPhones((rows) => rows.map(swap))
    setContacts((rows) => rows.map((r) => ({ ...r, mobile: swap(r.mobile), additionalMobiles: r.additionalMobiles.map(swap) })))
  }
  const dialNow = dialCodeFor(countryValue === 'Other' ? '' : countryValue)
  const changeCountry = (next: string) => {
    if (next === countryValue) return
    setForm((f) => ({ ...f, country: next, state: '' }))
    retargetPhones(countryValue, next)
  }
  const applyScope = (next: Scope) => {
    setFieldErrors({})
    const prevCountry = countryValue
    let nextCountry = 'India'
    if (next === 'international') {
      nextCountry = intlStash.current?.country || ''
      setCountryCustom(intlStash.current?.custom || '')
    } else if (form.org_scope === 'international') {
      intlStash.current = { country: form.country, custom: countryCustom }
    }
    // The type must belong to the new scope's list; Other (with its text) always stays.
    const keepType = !form.org_type || form.org_type === 'Other' || orgTypesFor(next).includes(form.org_type)
    const showsZone = keepType && orgTypeHasRailwayFields(form.org_type)
    setForm((f) => ({
      ...f,
      org_scope: next,
      country: nextCountry,
      ...(nextCountry !== prevCountry ? { state: '' } : {}),
      ...(keepType ? {} : { org_type: '' }),
      ...(showsZone ? {} : { railway_zone: '', division_workshop: '' }),
      ...(next === 'international'
        ? { gst_number: '', pan: '', gst_state_code: '' }
        : { tax_vat_id: '', company_registration_no: '' }),
    }))
    if (!showsZone) setRailwayZoneCustom('')
    retargetPhones(prevCountry, nextCountry)
  }
  const chooseScope = (next: Scope) => {
    if (next === form.org_scope) return
    const hasOther = next === 'international'
      ? !!(form.gst_number || form.pan)
      : !!(form.tax_vat_id || form.company_registration_no)
    if (hasOther) setPendingScope(next)
    else applyScope(next)
  }
  const setGstin = (raw: string) => {
    const gst = raw.toUpperCase()
    // A full valid GSTIN fills the PAN (characters 3-12). The state code is derived by the server.
    setForm((f) => (isValidGST(gst) && gst.length === 15
      ? { ...f, gst_number: gst, pan: gst.slice(2, 12) }
      : { ...f, gst_number: gst }))
  }
  const err = (k: string) => (fieldErrors[k] ? <p role="alert" style={errText}>{fieldErrors[k]}</p> : null)

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

  // Fill the contacts above before adding another — never a second empty card.
  const contactsFilled = contacts.every((r) => r.name.trim())
  const addContact = () => setContacts((rows) => (rows.every((r) => r.name.trim()) ? [...rows, emptyContact(dialNow)] : rows))

  const addExtraPhone = () => setExtraPhones((rows) => (canAddMore(rows.map(phoneOrBlank)) ? [...rows, dialNow] : rows))
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

  const addContactMobile = (rowIdx: number) => setContacts((rows) => rows.map((r, i) => (i === rowIdx && canAddMore(r.additionalMobiles.map(phoneOrBlank)) ? { ...r, additionalMobiles: [...r.additionalMobiles, dialNow] } : r)))
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
    // Field-level checks mirror the server; every problem is listed, nothing is sent until all pass.
    const fe: Record<string, string> = {}
    if (!form.org_scope) fe.org_scope = 'Choose Domestic or International. This decides which tax details are asked.'
    if (!form.org_type) fe.org_type = 'Customer Organization Type is required. Pick one from the list.'
    else if (form.org_type === 'Other' && !orgTypeCustom.trim()) fe.org_type = 'Please specify the customer organization type.'
    if (!form.name.trim()) fe.name = 'Customer Organization name is required.'
    if (isDomestic) {
      const gst = form.gst_number.trim().toUpperCase()
      const pan = form.pan.trim().toUpperCase()
      if (gst && !isValidGST(gst)) fe.gst_number = 'GSTIN must be 15 characters in the standard format, e.g. 07AABCU9603R1ZW.'
      if (pan && !PAN_RE.test(pan)) fe.pan = 'PAN must be 10 characters like AABCU9603R (5 letters, 4 digits, 1 letter).'
      if (gst && isValidGST(gst)) {
        if (pan && PAN_RE.test(pan) && pan !== gst.slice(2, 12)) fe.pan = `PAN must match characters 3 to 12 of the GSTIN (${gst.slice(2, 12)}). Correct it or clear it to fill from the GSTIN.`
      }
    }
    if (isInternational) {
      if (form.tax_vat_id.trim() && !TAX_ID_RE.test(form.tax_vat_id.trim())) fe.tax_vat_id = 'Tax / VAT ID must be 2 to 50 characters: letters, digits, spaces, - . /'
      if (form.company_registration_no.trim() && !TAX_ID_RE.test(form.company_registration_no.trim())) fe.company_registration_no = 'Company Registration Number must be 2 to 50 characters: letters, digits, spaces, - . /'
      if (!countryValue || (countryValue === 'Other' && !countryCustom.trim())) fe.country = 'Choose the country of this international organization.'
    }
    if (Object.keys(fe).length) {
      setFieldErrors(fe)
      fail(Object.values(fe))
      return
    }
    setFieldErrors({})
    if (!isPhoneValid(phoneOrBlank(form.official_phone))) {
      fail('Please enter a valid phone number before saving.')
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
    if (extraPhones.some((p) => phoneOrBlank(p) && !isPhoneValid(phoneOrBlank(p)))) {
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
    if (contacts.some((c) => c.additionalMobiles.some((m) => phoneOrBlank(m) && !isPhoneValid(phoneOrBlank(m))))) {
      fail('Please enter a valid phone number for each contact before saving.')
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
        country: countryValue === 'Other' ? countryCustom : countryValue,
        additional_phones: extraPhones.map((p) => phoneOrBlank(p).trim()).filter(Boolean),
        official_phone: phoneOrBlank(form.official_phone).trim(),
        additional_emails: extraEmails.map((e) => e.trim()).filter(Boolean),
      }
      if (isDomestic) {
        // Blank = derived on the server from the GSTIN (PAN = chars 3-12, state = chars 1-2).
        payload.pan = form.pan.trim().toUpperCase() || null
        // GST State Code is not asked on the form; the server derives it from the GSTIN.
        delete payload.gst_state_code
        delete payload.tax_vat_id
        delete payload.company_registration_no
      } else {
        // The server rejects GSTIN / PAN / state code on an international organization.
        delete payload.gst_number
        delete payload.pan
        delete payload.gst_state_code
        payload.tax_vat_id = form.tax_vat_id.trim() || null
        payload.company_registration_no = form.company_registration_no.trim() || null
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
            mobile: phoneOrBlank(row.mobile) || undefined,
            email: row.email || undefined,
            additional_mobiles: row.additionalMobiles.map((m) => phoneOrBlank(m).trim()).filter(Boolean),
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
      <ConfirmDialog
        open={!!pendingScope}
        title={`Switch to ${pendingScope === 'international' ? 'International' : 'Domestic'}?`}
        message={pendingScope === 'international'
          ? 'Switching to International clears GSTIN and PAN. Continue?'
          : 'Switching to Domestic clears Tax / VAT ID and Company Registration Number. Continue?'}
        confirmLabel="Switch and clear"
        danger={false}
        onConfirm={() => { applyScope(pendingScope); setPendingScope('') }}
        onCancel={() => setPendingScope('')}
      />
      <div ref={errorRef} style={{ padding: error && (!Array.isArray(error) || error.length) ? '16px 24px 0' : 0 }}><SheetError error={error} /></div>
      <SheetColumns
        left={<>
        <SheetSection icon="building" title="Customer Organization Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={<>Organization Scope <Req /></>} tourId="org-scope">
            <div role="radiogroup" aria-label="Organization Scope" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([['domestic', 'Domestic'], ['international', 'International']] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={form.org_scope === v} onClick={() => chooseScope(v)}
                  style={{ ...segmentBtnStyle(form.org_scope === v), flex: '1 1 140px', minWidth: 120, ...(fieldErrors.org_scope ? errBorder : {}) }}>{label}</button>
              ))}
            </div>
            {!scopeChosen && <p style={sheetHint}>Choose Domestic or International first. The fields below unlock once you do.</p>}
            {err('org_scope')}
          </Field>
          <Gate open={scopeChosen}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 190px', minWidth: 170 }}>
              <Field label={<>Customer Organization Type <Req /></>} tourId="org-type">
                <Select value={form.org_type} onChange={(e) => setOrgType(e.target.value)} disabled={!scopeChosen} style={{ ...inputStyle, ...(fieldErrors.org_type ? errBorder : {}) }}>
                  <option value="">-- Select Type --</option>
                  {orgTypesFor(form.org_scope).map((o) => <option key={o} value={o}>{ORG_TYPE_LABELS[o] || o}</option>)}
                </Select>
                {form.org_type === 'Other' && (
                  <input value={orgTypeCustom} onChange={(e) => setOrgTypeCustom(e.target.value)} placeholder="Specify customer organization type" style={{ ...inputStyle, marginTop: 8 }} />
                )}
                {err('org_type')}
              </Field>
            </div>
            <div style={{ flex: '2 1 260px', minWidth: 220 }}>
              <Field label={<>Customer Organization Name <Req /></>} tourId="org-name">
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Northern Railway HQ" style={{ ...inputStyle, ...(fieldErrors.name ? errBorder : {}) }} />
                {err('name')}
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

          {isDomestic && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <Field label="GSTIN" tourId="org-gst">
                  <input value={form.gst_number} onChange={(e) => setGstin(e.target.value)} maxLength={15} placeholder="15 characters, e.g. 07AABCU9603R1ZW"
                    style={{ ...inputStyle, ...((form.gst_number && !isValidGST(form.gst_number)) || fieldErrors.gst_number ? errBorder : {}) }} />
                  {form.gst_number && !isValidGST(form.gst_number) && !fieldErrors.gst_number && <p style={errText}>Enter a valid 15-character GSTIN (e.g. 07AABCU9603R1ZW).</p>}
                  {err('gst_number')}
                </Field>
              </div>
              <div style={{ flex: '1 1 150px', minWidth: 130 }}>
                <Field label="PAN" tourId="org-pan">
                  <input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} placeholder="10 characters, from GSTIN"
                    style={{ ...inputStyle, ...((form.pan && !PAN_RE.test(form.pan) && form.pan.length === 10) || fieldErrors.pan ? errBorder : {}) }} />
                  {err('pan')}
                </Field>
              </div>
            </div>
          )}
          {isInternational && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <Field label="Tax / VAT ID" tourId="org-tax-vat">
                  <input value={form.tax_vat_id} onChange={(e) => set('tax_vat_id', e.target.value)} maxLength={50} placeholder="e.g. GB123456789"
                    style={{ ...inputStyle, ...((form.tax_vat_id.trim() && !TAX_ID_RE.test(form.tax_vat_id.trim())) || fieldErrors.tax_vat_id ? errBorder : {}) }} />
                  {err('tax_vat_id')}
                </Field>
              </div>
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <Field label="Company Registration Number" tourId="org-company-reg">
                  <input value={form.company_registration_no} onChange={(e) => set('company_registration_no', e.target.value)} maxLength={50} placeholder="e.g. 01234567"
                    style={{ ...inputStyle, ...((form.company_registration_no.trim() && !TAX_ID_RE.test(form.company_registration_no.trim())) || fieldErrors.company_registration_no ? errBorder : {}) }} />
                  {err('company_registration_no')}
                </Field>
              </div>
            </div>
          )}
          </div>
          </Gate>
          </div>
        </SheetSection>
        <Gate open={scopeChosen}>
        <SheetSection icon="location" title="Address">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Address" tourId="org-address"><textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} placeholder="Street / locality" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 160px', minWidth: 140 }}>
              <Field label="Country" tourId="org-country">
                {/* Independent of the scope. Switching country clears the state (India's list and a typed foreign state don't mix); it never touches the scope. */}
                <Select value={countryValue} searchable disabled={isDomestic} title={isDomestic ? 'Domestic organizations are always in India' : undefined} onChange={(e) => changeCountry(e.target.value)} style={{ ...inputStyle, ...(fieldErrors.country ? errBorder : {}) }}>
                  {!isDomestic && <option value="">-- Select Country --</option>}
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                {countryValue === 'Other' && (
                  <input value={countryCustom} onChange={(e) => setCountryCustom(e.target.value)} placeholder="Specify country" style={{ ...inputStyle, marginTop: 8 }} />
                )}
                {err('country')}
              </Field>
            </div>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              {countryValue === 'India' ? (
                <Field label="State / UT" tourId="org-state">
                  <Select value={form.state} onChange={(e) => set('state', e.target.value)} style={inputStyle}>
                    <option value="">-- Select State / UT --</option>
                    {/* An older record's typed state that isn't on the list stays selectable. */}
                    {(form.state && !INDIA_STATES.includes(form.state) ? [...INDIA_STATES, form.state] : INDIA_STATES).map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
              ) : (
                <Field label="State / Province" tourId="org-state"><input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Dubai" style={inputStyle} /></Field>
              )}
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
        <SheetSection icon="idcard" title="Contact & Registration">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 200px', minWidth: 180 }}>
              <Field label="Official Phone" tourId="org-phone">
                {withAdd(<PhoneInput value={form.official_phone} onChange={(v) => set('official_phone', v)} placeholder={phonePlaceholder(dialNow)} style={{ ...inputStyle, ...dupFieldStyle(dupOrgPhones.has(normPhone(form.official_phone))) }} />, addExtraPhone, 'Add another phone', extraPhones.map(phoneOrBlank), phoneOrBlank(form.official_phone))}
              </Field>
              {dupOrgPhones.has(normPhone(form.official_phone)) && (
                <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>
              )}
              {extraPhones.map((p, i) => {
                const isDup = dupOrgPhones.has(normPhone(p))
                return (
                  <div key={i} style={{ marginTop: 6 }}>
                    <ValueRow button={<RemoveValueButton onClick={() => removeExtraPhone(i)} label="Remove this phone" />}>
                      <PhoneInput value={p} onChange={(v) => setExtraPhone(i, v)} placeholder={phonePlaceholder(dialNow)} style={{ ...inputStyle, ...dupFieldStyle(isDup) }} />
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
                />, addExtraEmail, 'Add another email', extraEmails, form.official_email)}
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
        </SheetSection>
        </Gate>
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
                        <Field label="Phone" tourId={i === 0 ? 'contact-mobile' : undefined}>
                          {withAdd(<PhoneInput value={row.mobile} onChange={(v) => setContact(i, 'mobile', v)} placeholder={phonePlaceholder(dialNow)} style={{ ...contactInputStyle, ...dupFieldStyle(dupContactMobiles.has(normPhone(row.mobile))) }} />, () => addContactMobile(i), 'Add another phone', row.additionalMobiles.map(phoneOrBlank), phoneOrBlank(row.mobile))}
                        </Field>
                        {dupContactMobiles.has(normPhone(row.mobile)) && (
                          <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>
                        )}
                        {row.additionalMobiles.map((m, j) => {
                          const isDup = dupContactMobiles.has(normPhone(m))
                          return (
                            <div key={j} style={{ marginTop: 6 }}>
                              <ValueRow button={<RemoveValueButton onClick={() => removeContactMobile(i, j)} label="Remove this phone" />}>
                                <PhoneInput value={m} onChange={(v) => setContactMobile(i, j, v)} placeholder={phonePlaceholder(dialNow)} style={{ ...contactInputStyle, ...dupFieldStyle(isDup) }} />
                              </ValueRow>
                              {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Duplicate phone number.</p>}
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
                          />, () => addContactEmail(i), 'Add another email', row.additionalEmails, row.email)}
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
                <button type="button" onClick={addContact} disabled={!contactsFilled} title={contactsFilled ? 'Add another contact' : 'Fill in the Name of the contact above first.'} data-tour="org-add-contact" style={sheetBtn('secondary', SHEET.INK, !contactsFilled)}><SheetIcon name="plus" size={15} />Add Contact</button>
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
