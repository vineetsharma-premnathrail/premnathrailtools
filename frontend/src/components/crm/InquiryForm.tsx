'use client'

import Select from '@/components/shared/Select'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { crmApi, usersApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Inquiry, InquiryLineItem, Organization, OrgContact, Tender, DirectoryUser } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import PhoneField, { isPhoneValid } from '@/components/erp/PhoneField'
import { RAILWAY_ZONES, LEAD_SOURCES, inquiryStatusOptions, priorityOptions, priorityLabel } from './constants'
import { Row, ComboBox, handleEnterAsTab, InfoRow, XIcon } from './ui'
import { AddMoreButton, RemoveValueButton, ValueRow, canAddMore } from '@/components/shared/MoreValuesButtons'
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
  delivery_location: string
  requirement_desc: string
  project_details: string
  inspection_req: string
  warranty_req: string
  priority: string
}

function toFormState(initial?: Inquiry, defaultOrgId?: number): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '',
    org_contact_id: initial?.org_contact_id ? String(initial.org_contact_id) : '',
    railway_zone: initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? 'Other' : initial?.railway_zone || '',
    division: initial?.division || '',
    lead_source: initial?.lead_source || '',
    bd_owner: initial?.bd_owner || '',
    bd_owner_id: initial?.bd_owner_id ? String(initial.bd_owner_id) : '',
    sales_engineer_id: initial?.sales_engineer_id ? String(initial.sales_engineer_id) : '',
    expected_value: initial?.expected_value != null ? String(initial.expected_value) : '',
    probability: initial?.probability != null ? String(initial.probability) : '',
    expected_order_date: initial?.expected_order_date || '',
    status: initial?.status || 'Requirement Received',
    current_status_note: initial?.current_status_note || '',
    product: initial?.product || '',
    product_category: initial?.product_category || '',
    product_spec: initial?.product_spec || '',
    quantity: initial?.quantity != null ? String(initial.quantity) : '',
    required_delivery_date: initial?.required_delivery_date || '',
    delivery_location: initial?.delivery_location || '',
    requirement_desc: initial?.requirement_desc || '',
    project_details: initial?.project_details || '',
    inspection_req: initial?.inspection_req || '',
    warranty_req: initial?.warranty_req || '',
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
  // Inquiries & Tenders › Prices & margins: without it the value is hidden (and the server ignores it on save).
  const seePrices = useCan().canFeature('crm', 'inquiries_tenders', 'prices', 'view')
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const bdOwnerName = initial?.bd_owner || user?.name || ''
  const orgLocked = !!defaultOrgId
  const [form, setForm] = useState<FormState>(() => toFormState(initial, defaultOrgId))
  // Secondary requirement fields stay folded unless the record already has one filled.
  const [showMore, setShowMore] = useState(() => !!(initial?.delivery_location || initial?.inspection_req || initial?.warranty_req))
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])

  useEffect(() => {
    // Owner / sales engineer pickers (users, not free text).
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])
  // The role's "Assign to" rules narrow both pickers; whoever is set today stays listed (and owning it yourself is always allowed).
  const allowBdOwner = useAssigneeFilter('crm:inquiries_tenders.bd_owner')
  const allowEngineer = useAssigneeFilter('crm:inquiries_tenders.sales_engineer')
  const bdOwnerUsers = directoryUsers.filter((u) => allowBdOwner(u.id) || u.id === user?.id || u.id === initial?.bd_owner_id)
  const engineerUsers = directoryUsers.filter((u) => allowEngineer(u.id) || u.id === initial?.sales_engineer_id)
  const [railwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [productCategories, setProductCategories] = useState<{ id: number; name: string }[]>([])
  const [products, setProducts] = useState<{ id: number; name: string; category?: string | null }[]>([])
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
    crmApi.listProductCategories().then(setProductCategories).catch(() => {})
    crmApi.listProducts().then(setProducts).catch(() => {})
  }, [])

  // Typing a brand-new category/product persists it to the shared catalog
  // (crm_product_categories / crm_products) so it shows up as a real option
  // for every future inquiry, instead of a one-off "Other" value that only
  // applied to this single inquiry.
  const createCategory = async (query: string) => {
    const name = query.trim()
    if (!name) return
    const created = await crmApi.createProductCategory({ name })
    setProductCategories((list) => (list.some((c) => c.id === created.id) ? list : [...list, created]))
    set('product_category', created.name)
  }

  const createProduct = async (query: string) => {
    const name = query.trim()
    if (!name) return
    const created = await crmApi.createProduct({ name, category: form.product_category || undefined })
    setProducts((list) => (list.some((p) => p.id === created.id) ? list : [...list, created]))
    set('product', created.name)
  }

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
        bd_owner: isAdmin ? (form.bd_owner || bdOwnerName) : bdOwnerName,
        // The owner is a user (the name above follows it on the server). A non-admin
        // creating an inquiry owns it; editing keeps the recorded owner.
        bd_owner_id: isAdmin ? (form.bd_owner_id ? Number(form.bd_owner_id) : (initial ? undefined : user?.id)) : (initial ? undefined : user?.id),
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
      <SheetSection icon="list" title="Basic Information">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 130px', minWidth: 130 }}>
            <F label="Inquiry Number" tourId="inq-number">
              <input
                value={initial?.universal_id || previewNumber || 'Auto-generated on save'}
                disabled
                style={{ ...inputStyle, background: '#eff6ff', color: SHEET.BLUE, fontWeight: 600 }}
              />
            </F>
          </div>
          <div style={{ flex: '1 1 100px', minWidth: 100 }}>
            <F label="Inquiry Date">
              <input
                value={initial?.created_at ? formatDate(initial.created_at) : formatDate(new Date())}
                disabled
                style={{ ...inputStyle, background: SHEET.SOFT, color: SHEET.MUTED }}
              />
            </F>
          </div>
          <div style={{ flex: '1 1 130px', minWidth: 130 }}>
            <F label={<>Lead Source <Req /></>} tourId="inq-lead-source">
              <Select value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)} style={inputStyle}>
                <option value="">-- Select Source --</option>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
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
          <div style={{ flex: '1 1 130px', minWidth: 130 }}>
            <F label={<>Status <Req /></>} tourId="inq-status">
              <Select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                {inquiryStatusOptions(form.status).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </F>
          </div>
          <div style={{ flex: '1 1 110px', minWidth: 110 }}>
            <F label="BD Owner" tourId="inq-bd-owner">
              {isAdmin ? (
                <SearchableSelect
                  value={form.bd_owner_id || String(directoryUsers.find((u) => u.name === (form.bd_owner || bdOwnerName))?.id || '')}
                  onChange={(v) => { set('bd_owner_id', v); set('bd_owner', directoryUsers.find((u) => String(u.id) === v)?.name || '') }}
                  options={bdOwnerUsers.map((u) => ({ value: String(u.id), label: u.name }))}
                  placeholder="Select BD Owner..."
                />
              ) : (
                <input value={bdOwnerName} disabled style={{ ...inputStyle, background: SHEET.SOFT, color: SHEET.MUTED }} />
              )}
            </F>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
        <F label="Current Status" tourId="inq-current-status-note">
          <textarea value={form.current_status_note} onChange={(e) => set('current_status_note', e.target.value)} rows={2} placeholder="e.g. Waiting for client confirmation" style={{ ...inputStyle, resize: 'vertical' }} />
        </F>
        </div>
      </SheetSection>
      <SheetSection icon="rupee" title="Opportunity">
        <div data-tour="inq-opportunity" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {seePrices && <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <F label="Expected Value (₹)"><input type="number" min={0} value={form.expected_value} onChange={(e) => set('expected_value', e.target.value)} style={inputStyle} /></F>
          </div>}
          <div style={{ flex: '0 1 110px', minWidth: 100 }}>
            <F label="Win Probability %"><input type="number" min={0} max={100} value={form.probability} onChange={(e) => set('probability', e.target.value)} style={inputStyle} /></F>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <F label="Expected Order Date"><DateField value={form.expected_order_date} onChange={(v) => set('expected_order_date', v)} /></F>
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 300 }}>
            <F label="Sales Engineer">
              <SearchableSelect value={form.sales_engineer_id} onChange={(v) => set('sales_engineer_id', v)}
                options={[{ value: '', label: '— None —' }, ...engineerUsers.map((u) => ({ value: String(u.id), label: u.name }))]} placeholder="Select sales engineer..." />
            </F>
          </div>
        </div>
      </SheetSection>
      <SheetSection
        icon="box"
        title="Product Requirement"
        extra={<span style={{ marginLeft: 'auto' }}>
          <button type="button" data-tour="inq-more-details" onClick={() => setShowMore((v) => !v)} style={{ background: 'none', border: `1px dashed ${SHEET.LINE}`, borderRadius: 8, color: SHEET.BODY, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 12px' }}>
            {showMore ? 'Hide more details ▴' : <>+ More details <span style={{ fontWeight: 400, color: '#a8a29e' }}>(delivery location, inspection, warranty)</span></>}
          </button>
        </span>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 200px', minWidth: 170 }}>
            <F label="Category" tourId="inq-product-category">
              <ComboBox
                value={form.product_category}
                onChange={(v) => set('product_category', v)}
                onPick={(o) => set('product_category', o.label)}
                onCreateNew={createCategory}
                createLabel="New Category"
                options={productCategories.map((c) => ({ key: String(c.id), label: c.name }))}
                placeholder="Select or type a category"
              />
            </F>
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <F label={<>Product <Req /></>} tourId="inq-product">
              <ComboBox
                value={form.product}
                onChange={(v) => set('product', v)}
                onPick={(o) => { const p = products.find((pr) => String(pr.id) === o.key); if (p) { set('product', p.name); if (p.category) set('product_category', p.category) } }}
                onCreateNew={createProduct}
                createLabel="New Product"
                options={products.map((p) => ({ key: String(p.id), label: p.name, sublabel: p.category || undefined }))}
                placeholder="RRV System"
              />
              {isDuplicateProductRow(form.product_category, form.product) && (
                <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>⚠ This product/category is already added below.</p>
              )}
            </F>
          </div>
          <div style={{ flex: '0 1 90px', minWidth: 80 }}>
            <F label="Quantity" tourId="inq-quantity"><input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="e.g. 2" style={inputStyle} /></F>
          </div>
          <div style={{ flex: '0 1 175px', minWidth: 175 }}>
            <F label="Required Delivery Date" tourId="inq-delivery-date"><DateField value={form.required_delivery_date} onChange={(v) => set('required_delivery_date', v)} /></F>
          </div>
        </div>
        <F label="Product Specification" tourId="inq-product-spec"><textarea value={form.product_spec} onChange={(e) => set('product_spec', e.target.value)} rows={2} placeholder="e.g. High Speed Self Propelled, 1676mm BG, hydraulic braking, anti-climber arrangement..." style={{ ...inputStyle, resize: 'vertical' }} /></F>
        <F label="Requirement Description" tourId="inq-requirement-desc"><textarea value={form.requirement_desc} onChange={(e) => set('requirement_desc', e.target.value)} rows={2} placeholder="Brief summary of the requirement..." style={{ ...inputStyle, resize: 'vertical' }} /></F>

        {extraProducts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {extraProducts.map((row, i) => {
              const isDup = isDuplicateProductRow(row.product_category, row.product)
              return (
                <div key={i} style={{ padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                      <F label="Category">
                        <ComboBox
                          value={row.product_category}
                          onChange={(v) => setExtraProduct(i, 'product_category', v)}
                          onPick={(o) => setExtraProduct(i, 'product_category', o.label)}
                          onCreateNew={createCategory}
                          createLabel="New Category"
                          options={productCategories.map((c) => ({ key: String(c.id), label: c.name }))}
                          placeholder="Select or type a category"
                        />
                      </F>
                    </div>
                    <div style={{ flex: '1 1 180px', minWidth: 160 }}>
                      <F label="Product">
                        <ComboBox
                          value={row.product}
                          onChange={(v) => setExtraProduct(i, 'product', v)}
                          onPick={(o) => { const p = products.find((pr) => String(pr.id) === o.key); if (p) { setExtraProduct(i, 'product', p.name); if (p.category) setExtraProduct(i, 'product_category', p.category) } }}
                          onCreateNew={createProduct}
                          createLabel="New Product"
                          options={products.map((p) => ({ key: String(p.id), label: p.name, sublabel: p.category || undefined }))}
                          placeholder="RRV System"
                        />
                      </F>
                    </div>
                    <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                      <F label="Quantity"><input type="number" value={row.quantity} onChange={(e) => setExtraProduct(i, 'quantity', e.target.value)} placeholder="e.g. 2" style={inputStyle} /></F>
                    </div>
                    <button type="button" onClick={() => removeExtraProduct(i)} style={{ ...sheetBtn('ghost', '#DC2626'), marginTop: 22 }}><XIcon /></button>
                  </div>
                  <F label="Product Specification"><textarea value={row.product_spec} onChange={(e) => setExtraProduct(i, 'product_spec', e.target.value)} rows={2} placeholder="Optional spec for this product" style={{ ...inputStyle, resize: 'vertical' }} /></F>
                  {isDup && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: 0 }}>⚠ This product/category is already added elsewhere in this inquiry.</p>}
                </div>
              )
            })}
          </div>
        )}

        {showMore && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ flex: '1 1 170px', minWidth: 150 }}>
              <F label="Delivery Location" tourId="inq-delivery-location"><input value={form.delivery_location} onChange={(e) => set('delivery_location', e.target.value)} placeholder="e.g. Allahabad, UP" style={inputStyle} /></F>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <F label="Inspection Requirement" tourId="inq-inspection"><input value={form.inspection_req} onChange={(e) => set('inspection_req', e.target.value)} placeholder="e.g. RDSO inspection, third party QA" style={inputStyle} /></F>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <F label="Warranty Requirement" tourId="inq-warranty"><input value={form.warranty_req} onChange={(e) => set('warranty_req', e.target.value)} placeholder="e.g. 12 months from commissioning" style={inputStyle} /></F>
            </div>
          </div>
        )}
        <F label="Project Details" tourId="inq-project-details"><textarea value={form.project_details} onChange={(e) => set('project_details', e.target.value)} rows={3} placeholder="Project background, scope, timeline..." style={{ ...inputStyle, resize: 'vertical' }} /></F>
        </div>
      </SheetSection>
        </>}
        right={<>
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
                <ValueRow button={<AddMoreButton onClick={addNewContactMobile} label="Add another mobile" extras={newContact.additionalMobiles} />}>
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
                <ValueRow button={<AddMoreButton onClick={addNewContactEmail} label="Add another email" extras={newContact.additionalEmails} />}>
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
        </>}
      />
    </form>
    </FormPage>
  )
}
