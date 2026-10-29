'use client'

import Select from '@/components/shared/Select'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { crmApi } from '@/lib/api'
import { Inquiry, InquiryLineItem, Organization, OrgContact, Tender } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import PhoneField, { isPhoneValid } from '@/components/erp/PhoneField'
import { RAILWAY_ZONES, leadSourceOptions, inquiryStatusOptions, priorityOptions, priorityLabel } from './constants'
import { Row, handleEnterAsTab, InfoRow, XIcon } from './ui'
import { AddMoreButton, RemoveValueButton, ValueRow, canAddMore, squareBtn } from '@/components/shared/MoreValuesButtons'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES, extractErrorMessages } from '@/lib/validation'

const inputStyle = sheetInput

/** Labelled field in the sheet style (keeps the tour target on the wrapper). */
function F({ label, tourId, children }: { label: React.ReactNode; tourId?: string; children: React.ReactNode }) {
  return (
    <div {...(tourId ? { 'data-tour': tourId } : {})}>
      <label style={sheetLabel}>{label}</label>
      {children}
    </div>
  )
}

type FormState = {
  org_id: string
  org_contact_id: string
  inquiry_date: string
  railway_zone: string
  division: string
  lead_source: string
  bd_owner: string
  bd_owner_id: string
  sales_engineer_id: string
  expected_value: string
  probability: string
  expected_order_date: string
  status: string
  current_status_note: string
  product: string
  product_category: string
  product_spec: string
  quantity: string
  required_delivery_date: string
  project_details: string
  priority: string
}

/** Today as YYYY-MM-DD in local time (DateField's value format). */
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toFormState(initial?: Inquiry, defaultOrgId?: number): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '',
    org_contact_id: initial?.org_contact_id ? String(initial.org_contact_id) : '',
    // Document date: when the customer raised it. Older records fall back to the day they were entered.
    inquiry_date: initial?.inquiry_date || (initial?.created_at ? initial.created_at.slice(0, 10) : todayISO()),
    railway_zone: initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? 'Other' : initial?.railway_zone || '',
    division: initial?.division || '',
    lead_source: initial?.lead_source || '',
    bd_owner: initial?.bd_owner || '',
    bd_owner_id: initial?.bd_owner_id ? String(initial.bd_owner_id) : '',
    sales_engineer_id: initial?.sales_engineer_id ? String(initial.sales_engineer_id) : '',
    expected_value: initial?.expected_value != null ? String(initial.expected_value) : '',
    probability: initial?.probability != null ? String(initial.probability) : '',
    expected_order_date: initial?.expected_order_date || '',
    status: initial?.status || 'Lead',
    current_status_note: initial?.current_status_note || '',
    product: initial?.product || '',
    product_category: initial?.product_category || '',
    product_spec: initial?.product_spec || '',
    quantity: initial?.quantity != null ? String(initial.quantity) : '',
    required_delivery_date: initial?.required_delivery_date || '',
    project_details: initial?.project_details || '',
    priority: initial?.priority || 'Medium',
  }
}

export default function InquiryForm({
  initial,
  defaultOrgId,
  submitLabel,
  onCancel,
  onSubmit,
  title,
  subtitle,
  nav,
  onBack,
}: {
  initial?: Inquiry
  defaultOrgId?: number
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  title?: string
  subtitle?: string
  /** Module sub-nav (and anything else) rendered above the form header. */
  nav?: React.ReactNode
  /** Shows the "← Back" pill in the header. */
  onBack?: () => void
}) {
  const orgLocked = !!defaultOrgId
  const [form, setForm] = useState<FormState>(() => toFormState(initial, defaultOrgId))
  // Client first: the inquiry is about a customer, so its other fields open only
  // once the client company and a saved contact person are chosen.
  const clientChosen = !!form.org_id && !!form.org_contact_id && form.org_contact_id !== '__new__'
  const gatedStyle: React.CSSProperties = clientChosen ? {} : { opacity: 0.45, pointerEvents: 'none', userSelect: 'none' }
  // Secondary requirement fields stay folded unless the record already has one filled.
  const [railwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const emptyNewContact = () => ({ name: '', designation: '', mobile: '', email: '', additionalMobiles: [] as string[], additionalEmails: [] as string[] })
  const [newContact, setNewContact] = useState(emptyNewContact())
  const [savingContact, setSavingContact] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [previewNumber, setPreviewNumber] = useState('')
  const errorRef = useRef<HTMLDivElement>(null)
  // The banner sits at the top of a long form — bring it into view when it appears.
  useEffect(() => { if (error && (!Array.isArray(error) || error.length)) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])

  type ExtraProductRow = { product_category: string; product: string; product_spec: string; quantity: string }
  const [extraProducts, setExtraProducts] = useState<ExtraProductRow[]>(
    (initial?.additional_items || []).map((it: InquiryLineItem) => ({
      product_category: it.product_category || '',
      product: it.product || '',
      product_spec: it.product_spec || '',
      quantity: it.quantity != null ? String(it.quantity) : '',
    }))
  )
  // "+" beside Product adds one more Product + Customer Requirement pair; only when every
  // product typed so far is filled, so no empty rows pile up (owner, 2026-10-29).
  const canAddProduct = !!form.product.trim() && extraProducts.every((r) => r.product.trim())
  const addExtraProduct = () => setExtraProducts((rows) => [...rows, { product_category: '', product: '', product_spec: '', quantity: '' }])
  const removeExtraProduct = (i: number) => setExtraProducts((rows) => rows.filter((_, j) => j !== i))
  const setExtraProduct = (i: number, field: keyof ExtraProductRow, value: string) =>
    setExtraProducts((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)))

  // Same product+category combo entered twice (primary or any additional row) is
  // almost certainly a mistake — flag every occurrence as it's typed, same idea as
  // the contact-person duplicate check above.
  const productComboKey = (category: string, product: string) => `${category.trim().toLowerCase()}|${product.trim().toLowerCase()}`
  const allProductCombos = [
    productComboKey(form.product_category, form.product),
    ...extraProducts.map((r) => productComboKey(r.product_category, r.product)),
  ]
  const duplicateProductCombos = new Set(
    allProductCombos.filter((key, idx) => key !== '|' && allProductCombos.indexOf(key) !== idx)
  )
  const isDuplicateProductRow = (category: string, product: string) =>
    productComboKey(category, product) !== '|' && duplicateProductCombos.has(productComboKey(category, product))

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const addNewContactMobile = () => setNewContact((c) => (canAddMore(c.additionalMobiles) ? { ...c, additionalMobiles: [...c.additionalMobiles, ''] } : c))
  const setNewContactMobile = (i: number, value: string) => setNewContact((c) => ({ ...c, additionalMobiles: c.additionalMobiles.map((m, j) => (j === i ? value : m)) }))
  const removeNewContactMobile = (i: number) => setNewContact((c) => ({ ...c, additionalMobiles: c.additionalMobiles.filter((_, j) => j !== i) }))

  const addNewContactEmail = () => setNewContact((c) => (canAddMore(c.additionalEmails) ? { ...c, additionalEmails: [...c.additionalEmails, ''] } : c))
  const setNewContactEmail = (i: number, value: string) => setNewContact((c) => ({ ...c, additionalEmails: c.additionalEmails.map((m, j) => (j === i ? value : m)) }))
  const removeNewContactEmail = (i: number) => setNewContact((c) => ({ ...c, additionalEmails: c.additionalEmails.filter((_, j) => j !== i) }))

  // Live check while typing a brand-new contact: flag when it matches an
  // existing contact on this organization by name, mobile, or email, so the
  // user knows before saving that it'll reuse the existing record instead of
  // silently creating a duplicate.
  const nameMatch = newContact.name.trim() ? contacts.find((c) => c.name.trim().toLowerCase() === newContact.name.trim().toLowerCase()) : undefined
  const mobileMatch = newContact.mobile.trim() ? contacts.find((c) => (c.mobile || '').trim() === newContact.mobile.trim()) : undefined
  const emailMatch = newContact.email.trim() ? contacts.find((c) => (c.email || '').trim().toLowerCase() === newContact.email.trim().toLowerCase()) : undefined
  const matchedContact = nameMatch || mobileMatch || emailMatch

  const selectedContact = form.org_contact_id && form.org_contact_id !== '__new__' ? contacts.find((c) => String(c.id) === form.org_contact_id) : undefined

  const saveNewContact = async () => {
    if (!newContact.name.trim()) {
      setError('Please enter a name for the new contact.')
      return
    }
    if (newContact.email && !isValidEmail(newContact.email)) {
      setError('Please enter a valid email for the new contact.')
      return
    }
    if (newContact.mobile && !isPhoneValid(newContact.mobile)) {
      setError('Please enter a valid mobile number for the new contact.')
      return
    }
    if (newContact.additionalEmails.some((e) => e && !isValidEmail(e)) || newContact.additionalMobiles.some((m) => m && !isPhoneValid(m))) {
      setError('Please enter valid additional mobile numbers / emails for the new contact.')
      return
    }
    setSavingContact(true)
    setError('')
    try {
      let saved: OrgContact
      if (matchedContact) {
        saved = matchedContact
      } else {
        saved = await crmApi.createOrgContact(Number(form.org_id), {
          name: newContact.name,
          designation: newContact.designation || undefined,
          mobile: newContact.mobile || undefined,
          email: newContact.email || undefined,
          additional_mobiles: newContact.additionalMobiles.map((m) => m.trim()).filter(Boolean),
          additional_emails: newContact.additionalEmails.map((e) => e.trim()).filter(Boolean),
        })
      }
      setContacts((list) => (list.some((c) => c.id === saved.id) ? list : [...list, saved]))
      set('org_contact_id', String(saved.id))
      setNewContact(emptyNewContact())
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save contact.'))
    } finally {
      setSavingContact(false)
    }
  }

  useEffect(() => {
    crmApi.listOrganizations({ picker: true }).then(setOrganizations)
  }, [])


  useEffect(() => {
    if (initial) return
    crmApi.listInquiries().then((all: Inquiry[]) => {
      const today = new Date()
      const y = today.getFullYear()
      const m = String(today.getMonth() + 1).padStart(2, '0')
      const d = String(today.getDate()).padStart(2, '0')
      const seq = String(all.length + 1).padStart(4, '0')
      setPreviewNumber(`INQ-${y}${m}${d}-${seq}`)
    }).catch(() => {})
  }, [initial])

  useEffect(() => {
    if (!form.org_id) {
      // Deferred so the effect itself sets no state.
      Promise.resolve().then(() => { setContacts([]); setDuplicateWarning('') })
      return
    }
    const orgId = Number(form.org_id)
    crmApi.listOrgContacts(orgId).then(setContacts)
    crmApi.getOrganization(orgId).then((org: Organization) => {
      // Convenience defaults from the organization record — only when creating a
      // fresh inquiry, so editing an existing inquiry never overwrites its own values.
      if (!initial) {
        if (org.railway_zone) set('railway_zone', org.railway_zone)
        if (org.division_workshop) set('division', org.division_workshop)
      }
    })
    if (!initial) {
      Promise.all([
        crmApi.listInquiries({ org_id: orgId }),
        crmApi.listTenders({ org_id: orgId }),
      ]).then(([inquiries, tenders]) => {
        const openInquiries = inquiries.filter((i: Inquiry) => !i.status.startsWith('Closed'))
        const openTenders = tenders.filter((t: Tender) => !t.status.startsWith('Closed') && t.status !== 'Tender Cancelled')
        if (openInquiries.length || openTenders.length) {
          const parts: string[] = []
          if (openInquiries.length) parts.push(`${openInquiries.length} open inquiry (${openInquiries.map((i: Inquiry) => i.universal_id).join(', ')})`)
          if (openTenders.length) parts.push(`${openTenders.length} open tender (${openTenders.map((t: Tender) => t.universal_id).join(', ')})`)
          setDuplicateWarning(`This customer organization already has ${parts.join(' and ')}. Make sure you're not creating a duplicate.`)
        } else {
          setDuplicateWarning('')
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.org_id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.org_id) {
      setError('Please select a customer organization.')
      return
    }
    if (!form.inquiry_date) {
      setError('Please pick the Inquiry Date — the day the customer raised this requirement.')
      return
    }
    if (form.inquiry_date > todayISO()) {
      setError('Inquiry Date cannot be in the future. Pick the day the customer actually raised it (today or earlier).')
      return
    }
    if (!form.lead_source) {
      setError('Please select a lead source.')
      return
    }
    if (!form.priority) {
      setError('Please select the Customer Requirement Priority (High, Medium or Low).')
      return
    }
    if (!form.status) {
      setError('Please select a status.')
      return
    }
    if (!form.product.trim()) {
      setError('Please enter the product.')
      return
    }
    if (!form.org_contact_id || form.org_contact_id === '__new__') {
      setError('Please select a contact person, or save the new contact you are adding.')
      return
    }
    const filledExtraProducts = extraProducts.filter((r) => r.product_category.trim() || r.product.trim() || r.quantity || r.product_spec.trim())
    if (filledExtraProducts.some((r) => !r.product.trim())) {
      setError('Please enter a Product for every additional product row, or remove the empty row.')
      return
    }
    if (duplicateProductCombos.size > 0) {
      setError('The same Category/Product combination is added more than once. Remove the duplicate before saving.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        ...form,
        org_id: Number(form.org_id),
        org_contact_id: Number(form.org_contact_id),
        railway_zone: form.railway_zone === 'Other' ? railwayZoneCustom : form.railway_zone,
        product_category: form.product_category,
        // BD owner = whoever logs the inquiry, set by the server; never sent from the form.
        bd_owner: undefined,
        bd_owner_id: undefined,
        sales_engineer_id: form.sales_engineer_id ? Number(form.sales_engineer_id) : (initial?.sales_engineer_id ? null : undefined),
        expected_value: form.expected_value ? Number(form.expected_value) : undefined,
        probability: form.probability ? Number(form.probability) : undefined,
        expected_order_date: form.expected_order_date || undefined,
        quantity: form.quantity ? Number(form.quantity) : undefined,
        additional_items: filledExtraProducts.map((r) => ({
          product_category: r.product_category || undefined,
          product: r.product,
          product_spec: r.product_spec || undefined,
          quantity: r.quantity ? Number(r.quantity) : undefined,
        })),
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      await onSubmit(payload)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save inquiry.'))
    } finally {
      setSaving(false)
    }
  }

  const formId = initial ? `inquiry-form-${initial.id}` : 'inquiry-form-new'
  return (
    <FormPage nav={nav} onBack={onBack} backTour="inq-form-back-btn" tour="inq-form" icon={initial ? 'edit' : 'doc'}
      title={title || (initial ? `Edit Inquiry ${initial.universal_id || ''}`.trim() : 'New Inquiry')}
      subtitle={subtitle || (initial ? 'Change the inquiry — the change is recorded in its timeline.' : 'A customer requirement: who asked, for what, and by when.')}
      footer={<>
        <button type="button" onClick={onCancel} disabled={saving} data-tour="inq-cancel-btn" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="submit" form={formId} data-tour="inq-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
        </button>
      </>}>
    <form id={formId} onSubmit={handleSubmit} onKeyDown={handleEnterAsTab} style={{ position: 'relative' }}>
      {saving && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(2px)' }}>
          <div className="loader" />
        </div>,
        document.body,
      )}
      <div ref={errorRef} style={{ padding: error && (!Array.isArray(error) || error.length) ? '16px 24px 0' : 0 }}><SheetError error={error} /></div>

      <SheetColumns
        left={<>
      <SheetSection icon="building" title="Company Information">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <F label={<>Client Company <Req /></>} tourId="inq-org">
            <SearchableSelect
              value={form.org_id}
              onChange={(v) => set('org_id', v)}
              options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
              placeholder="Search existing customer organization…"
              disabled={orgLocked}
            />
          </F>
          <F label={<>Contact Person <Req /></>} tourId="inq-contact">
            <Select value={form.org_contact_id} onChange={(e) => set('org_contact_id', e.target.value)} disabled={!form.org_id} style={inputStyle}>
              <option value="">-- Select Contact --</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">+ Add New Contact</option>
            </Select>
          </F>
        </div>
        {selectedContact && (
          <div style={{ padding: 14, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
            <InfoRow label="Name" value={selectedContact.name} />
            <InfoRow label="Designation" value={selectedContact.designation || '—'} />
            <InfoRow label="Mobile" value={[selectedContact.mobile, ...(selectedContact.additional_mobiles || [])].filter(Boolean).join(', ') || '—'} />
            <InfoRow label="Email" value={[selectedContact.email, ...(selectedContact.additional_emails || [])].filter(Boolean).join(', ') || '—'} />
          </div>
        )}

        {form.org_contact_id === '__new__' && (
          <div style={{ padding: 14, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <Row>
              <F label={<>Name <Req /></>}><input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} placeholder="Rajesh Kumar" style={{ ...inputStyle, ...(nameMatch ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}) }} /></F>
              <F label="Designation"><input value={newContact.designation} onChange={(e) => setNewContact((c) => ({ ...c, designation: e.target.value }))} placeholder="Purchase Head / DGM" style={inputStyle} /></F>
            </Row>
            <Row>
              <F label="Mobile">
                <ValueRow button={<AddMoreButton onClick={addNewContactMobile} label="Add another mobile" extras={newContact.additionalMobiles} primary={newContact.mobile} />}>
                  <PhoneField value={newContact.mobile} onChange={(v) => setNewContact((c) => ({ ...c, mobile: v }))} style={{ ...inputStyle, ...(mobileMatch ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}) }} />
                </ValueRow>
                {newContact.additionalMobiles.map((m, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <ValueRow button={<RemoveValueButton onClick={() => removeNewContactMobile(i)} label="Remove this mobile" />}>
                      <PhoneField value={m} onChange={(v) => setNewContactMobile(i, v)} style={inputStyle} />
                    </ValueRow>
                  </div>
                ))}
              </F>
              <F label="Email">
                <ValueRow button={<AddMoreButton onClick={addNewContactEmail} label="Add another email" extras={newContact.additionalEmails} primary={newContact.email} />}>
                  <ValidatedInput type="email" value={newContact.email} onChange={(v) => setNewContact((c) => ({ ...c, email: v }))} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="email@company.com" style={{ ...inputStyle, ...(emailMatch ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}) }} />
                </ValueRow>
                {newContact.additionalEmails.map((em, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <ValueRow button={<RemoveValueButton onClick={() => removeNewContactEmail(i)} label="Remove this email" />}>
                      <input type="email" value={em} onChange={(e) => setNewContactEmail(i, e.target.value)} placeholder="email@company.com" style={inputStyle} />
                    </ValueRow>
                  </div>
                ))}
              </F>
            </Row>
            {matchedContact && (
              <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#b45309', fontSize: 12 }}>
                ⚠ This matches the existing contact &quot;{matchedContact.name}&quot;
                {mobileMatch ? ' (same mobile number)' : emailMatch ? ' (same email address)' : ''}.
                Saving will link to that existing contact instead of creating a new one.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => { setNewContact(emptyNewContact()); set('org_contact_id', '') }} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
              <button type="button" onClick={saveNewContact} disabled={savingContact} style={sheetBtn('primary', SHEET.BLUE, savingContact)}>
                {savingContact ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          </div>
        )}

        {duplicateWarning && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#a16207', fontSize: 12.5, display: 'flex', gap: 8, marginTop: 12 }}>
            <span>⚠</span>
            <span>{duplicateWarning}</span>
          </div>
        )}
      </SheetSection>
      {!clientChosen && (
        <p style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: 12.5 }}>
          Pick the <b>Client Company</b> and <b>Contact Person</b> first — the rest of the inquiry opens once the client is chosen.
        </p>
      )}
      <div inert={!clientChosen} style={gatedStyle}>
      <SheetSection icon="list" title="Basic Information">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 160px', minWidth: 160 }}>
            <F label="Inquiry Number" tourId="inq-number">
              <input
                value={initial?.universal_id || previewNumber || 'Auto-generated on save'}
                disabled
                style={{ ...inputStyle, background: '#eff6ff', color: SHEET.BLUE, fontWeight: 600 }}
              />
            </F>
          </div>
          <div style={{ flex: '1 1 150px', minWidth: 150 }}>
            <F label={<>Inquiry Date <Req /></>} tourId="inq-date">
              <DateField value={form.inquiry_date} onChange={(v) => set('inquiry_date', v)} />
            </F>
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 160 }}>
            <F label={<>Lead Source <Req /></>} tourId="inq-lead-source">
              <Select value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)} style={inputStyle}>
                <option value="">-- Select Source --</option>
                {leadSourceOptions(form.lead_source).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </F>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <F label={<>Customer Requirement Priority <Req /></>} tourId="inq-priority">
              <Select value={form.priority} onChange={(e) => set('priority', e.target.value)} style={inputStyle}>
                {priorityOptions(initial?.priority).map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
              </Select>
            </F>
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 190 }}>
            <F label={<>Status <Req /></>} tourId="inq-status">
              <Select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                {inquiryStatusOptions(form.status, initial?.status).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </F>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
        <F label="Current Status" tourId="inq-current-status-note">
          <textarea value={form.current_status_note} onChange={(e) => set('current_status_note', e.target.value)} rows={2} placeholder="e.g. Waiting for client confirmation" style={{ ...inputStyle, resize: 'vertical' }} />
        </F>
        </div>
      </SheetSection>
      </div>
        </>}
        right={<>
      <div inert={!clientChosen} style={gatedStyle}>
      <SheetSection
        icon="box"
        title="Product Requirement"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <F label={<>Product <Req /></>} tourId="inq-product">
              {/* Free text: the customer's requirement in their words (2026-10-28). The exact
                  product is picked from the Product master on the quotation line. */}
              <ValueRow button={
                <button type="button" onClick={canAddProduct ? addExtraProduct : undefined} disabled={!canAddProduct} data-tour="inq-add-product"
                  title={canAddProduct ? 'Add another product' : 'Fill in the product first.'} aria-label={canAddProduct ? 'Add another product' : 'Fill in the product first.'}
                  style={squareBtn(SHEET.BLUE, !canAddProduct)}><SheetIcon name="plus" size={15} /></button>
              }>
                <input style={inputStyle} value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="e.g. RRV for OHE maintenance, 1676 mm BG" />
              </ValueRow>
              {isDuplicateProductRow(form.product_category, form.product) && (
                <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>⚠ This product is already added below.</p>
              )}
            </F>
          </div>
        </div>
        <F label="Customer Requirement" tourId="inq-product-spec"><textarea value={form.product_spec} onChange={(e) => set('product_spec', e.target.value)} rows={2} placeholder="e.g. High Speed Self Propelled, 1676mm BG, hydraulic braking, anti-climber arrangement..." style={{ ...inputStyle, resize: 'vertical' }} /></F>

        {extraProducts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {extraProducts.map((row, i) => {
              const isDup = isDuplicateProductRow(row.product_category, row.product)
              return (
                <div key={i} style={{ padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 180px', minWidth: 160 }}>
                      <F label={`Product ${i + 2}`}>
                        <input style={inputStyle} value={row.product} onChange={(e) => setExtraProduct(i, 'product', e.target.value)} placeholder="e.g. Rail welding plant transporter" />
                      </F>
                    </div>
                    <button type="button" onClick={() => removeExtraProduct(i)} style={{ ...sheetBtn('ghost', '#DC2626'), marginTop: 22 }}><XIcon /></button>
                  </div>
                  <F label="Customer Requirement"><textarea value={row.product_spec} onChange={(e) => setExtraProduct(i, 'product_spec', e.target.value)} rows={2} placeholder="What the customer needs for this product" style={{ ...inputStyle, resize: 'vertical' }} /></F>
                  {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: 0 }}>⚠ This product is already added elsewhere in this inquiry.</p>}
                </div>
              )
            })}
          </div>
        )}

        </div>
      </SheetSection>
      <SheetSection icon="doc" title="Project Details">
        <F label="Project Details" tourId="inq-project-details"><textarea value={form.project_details} onChange={(e) => set('project_details', e.target.value)} rows={3} placeholder="Project background, scope, timeline..." style={{ ...inputStyle, resize: 'vertical' }} /></F>
      </SheetSection>
      </div>
        </>}
      />
    </form>
    </FormPage>
  )
}
