'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Inquiry, Organization, OrgContact, Tender } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import { RAILWAY_ZONES, LEAD_SOURCES, PRODUCT_CATEGORIES, PRIORITIES, INQUIRY_STATUSES, ORG_TYPES, ORG_TYPE_LABELS, COUNTRIES, INDIA_STATES } from './constants'
import { Field, Section, Row, Row3, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'

type FormState = {
  org_id: string
  org_contact_id: string
  railway_zone: string
  division: string
  lead_source: string
  bd_owner: string
  status: string
  product: string
  product_category: string
  product_spec: string
  quantity: string
  unit: string
  required_delivery_date: string
  delivery_location: string
  requirement_desc: string
  detailed_requirement: string
  inspection_req: string
  warranty_req: string
  priority: string
  next_followup_date: string
  followup_priority: string
  followup_assigned_to: string
  followup_remarks: string
}

function toFormState(initial?: Inquiry, defaultOrgId?: number): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '',
    org_contact_id: initial?.org_contact_id ? String(initial.org_contact_id) : '',
    railway_zone: initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? 'Other' : initial?.railway_zone || '',
    division: initial?.division || '',
    lead_source: initial?.lead_source || '',
    bd_owner: initial?.bd_owner || '',
    status: initial?.status || 'Requirement Received',
    product: initial?.product || '',
    product_category: initial?.product_category || '',
    product_spec: initial?.product_spec || '',
    quantity: initial?.quantity != null ? String(initial.quantity) : '',
    unit: initial?.unit || '',
    required_delivery_date: initial?.required_delivery_date || '',
    delivery_location: initial?.delivery_location || '',
    requirement_desc: initial?.requirement_desc || '',
    detailed_requirement: initial?.detailed_requirement || '',
    inspection_req: initial?.inspection_req || '',
    warranty_req: initial?.warranty_req || '',
    priority: initial?.priority || 'Medium',
    next_followup_date: initial?.next_followup_date || '',
    followup_priority: initial?.followup_priority || '',
    followup_assigned_to: initial?.followup_assigned_to || '',
    followup_remarks: initial?.followup_remarks || '',
  }
}

export default function InquiryForm({
  initial,
  defaultOrgId,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: Inquiry
  defaultOrgId?: number
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const { user } = useAuth()
  const bdOwnerName = initial?.bd_owner || user?.name || ''
  const [form, setForm] = useState<FormState>(() => ({
    ...toFormState(initial, defaultOrgId),
    followup_assigned_to: initial?.followup_assigned_to || user?.name || '',
  }))
  const [railwayZoneCustom, setRailwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  // Read-only-ish mirror of the selected organization's own record. Legacy shows
  // these as editable inputs but never actually submits them with the inquiry —
  // they're a convenience preview only, so they live outside FormState/payload.
  const [orgMirror, setOrgMirror] = useState({
    client_type: '', gst: '', address: '', country: 'India', state: '', city: '', pin: '',
    office_phone: '', office_email: '', website: '', web_email: '',
  })
  const [newContact, setNewContact] = useState({ name: '', designation: '', mobile: '', email: '' })
  const [duplicateWarning, setDuplicateWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [previewNumber, setPreviewNumber] = useState('')

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))
  const setMirror = (field: keyof typeof orgMirror, value: string) => setOrgMirror((m) => ({ ...m, [field]: value }))

  useEffect(() => {
    crmApi.listOrganizations().then(setOrganizations)
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
      setContacts([])
      setDuplicateWarning('')
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
      // These mirror fields are never persisted on the inquiry itself, so there's
      // nothing of "its own" to protect — always refresh them from the org record.
      setOrgMirror({
        client_type: org.org_type || '',
        gst: org.gst_number || '',
        address: org.address || '',
        country: org.country || 'India',
        state: org.state || '',
        city: org.city || '',
        pin: org.pin_code || '',
        office_phone: org.official_phone || '',
        office_email: org.official_email || '',
        website: org.website || '',
        web_email: '',
      })
    })
    if (!initial) {
      Promise.all([
        crmApi.listInquiries({ org_id: orgId }),
        crmApi.listTenders({ org_id: orgId }),
      ]).then(([inquiries, tenders]) => {
        const openInquiries = inquiries.filter((i: Inquiry) => !i.status.startsWith('Closed'))
        const openTenders = tenders.filter((t: Tender) => !['Won', 'Lost', 'Cancelled'].includes(t.status))
        if (openInquiries.length || openTenders.length) {
          const parts: string[] = []
          if (openInquiries.length) parts.push(`${openInquiries.length} open inquiry (${openInquiries.map((i: Inquiry) => i.universal_id).join(', ')})`)
          if (openTenders.length) parts.push(`${openTenders.length} open tender (${openTenders.map((t: Tender) => t.universal_id).join(', ')})`)
          setDuplicateWarning(`This organization already has ${parts.join(' and ')}. Make sure you're not creating a duplicate.`)
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
      setError('Please select an organization.')
      return
    }
    if (form.org_contact_id === '__new__' && !newContact.name.trim()) {
      setError('Please enter a name for the new contact, or select an existing one.')
      return
    }
    setSaving(true)
    setError('')
    try {
      let orgContactId: number | undefined = form.org_contact_id && form.org_contact_id !== '__new__' ? Number(form.org_contact_id) : undefined
      if (form.org_contact_id === '__new__') {
        const nameLower = newContact.name.trim().toLowerCase()
        const existing = contacts.find((c) => c.name.trim().toLowerCase() === nameLower)
        if (existing) {
          orgContactId = existing.id
        } else {
          const created = await crmApi.createOrgContact(Number(form.org_id), {
            name: newContact.name,
            designation: newContact.designation || undefined,
            mobile: newContact.mobile || undefined,
            email: newContact.email || undefined,
          })
          orgContactId = created.id
        }
      }

      const payload: Record<string, unknown> = {
        ...form,
        org_id: Number(form.org_id),
        org_contact_id: orgContactId,
        railway_zone: form.railway_zone === 'Other' ? railwayZoneCustom : form.railway_zone,
        bd_owner: bdOwnerName,
        quantity: form.quantity ? Number(form.quantity) : undefined,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      await onSubmit(payload)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save inquiry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Basic Information">
        <Row3>
          <Field label={initial?.universal_id ? 'Inquiry Number' : 'Inquiry Number (preview)'}>
            <input value={initial?.universal_id || previewNumber || 'Auto-generated on save'} disabled style={{ ...inputStyle, background: '#f5f5f4', color: initial?.universal_id ? '#fa9b9b' : '#a8a29e', fontWeight: 600 }} />
          </Field>
          <Field label="Inquiry Date">
            <input
              value={initial?.created_at ? new Date(initial.created_at).toLocaleDateString() : new Date().toLocaleDateString()}
              disabled
              style={{ ...inputStyle, background: '#f5f5f4', color: '#78716c' }}
            />
          </Field>
        </Row3>
        <Row3>
          <Field label="Lead Source">
            <select value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)} style={inputStyle}>
              <option value="">-- Select Source --</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={(e) => set('priority', e.target.value)} style={inputStyle}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
              {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </Row3>
        <Field label="BD Owner">
          <input value={bdOwnerName} disabled style={{ ...inputStyle, background: '#f5f5f4', color: '#78716c' }} />
        </Field>
      </Section>

      <Section title="Company Information">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Field label="Client Company *">
            <SearchableSelect
              value={form.org_id}
              onChange={(v) => set('org_id', v)}
              options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
              placeholder="Search existing organization…"
            />
          </Field>
          <Field label="Contact Person">
            <select value={form.org_contact_id} onChange={(e) => set('org_contact_id', e.target.value)} style={inputStyle}>
              <option value="">-- Select Contact --</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">+ Add New Contact</option>
            </select>
          </Field>
          <Field label="Client Type">
            <select value={orgMirror.client_type} onChange={(e) => setMirror('client_type', e.target.value)} style={inputStyle}>
              <option value="">-- Select --</option>
              {ORG_TYPES.map((o) => <option key={o} value={o}>{ORG_TYPE_LABELS[o] || o}</option>)}
            </select>
          </Field>
          <Field label="GST Number"><input value={orgMirror.gst} onChange={(e) => setMirror('gst', e.target.value.toUpperCase())} placeholder="e.g. 07AACCC1234M1ZX" style={inputStyle} /></Field>
          <Field label="Railway Zone">
            <select value={form.railway_zone} onChange={(e) => set('railway_zone', e.target.value)} style={inputStyle}>
              <option value="">-- Select Zone --</option>
              {RAILWAY_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            {form.railway_zone === 'Other' && (
              <input value={railwayZoneCustom} onChange={(e) => setRailwayZoneCustom(e.target.value)} placeholder="Specify railway zone" style={{ ...inputStyle, marginTop: 8 }} />
            )}
          </Field>
          <Field label="Division / Workshop"><input value={form.division} onChange={(e) => set('division', e.target.value)} placeholder="e.g. Delhi Division / Ghaziabad Workshop" style={inputStyle} /></Field>
          <Field label="Country">
            <select value={orgMirror.country} onChange={(e) => setMirror('country', e.target.value)} style={inputStyle}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="State / UT">
            <select value={orgMirror.state} onChange={(e) => setMirror('state', e.target.value)} style={inputStyle}>
              <option value="">-- Select State --</option>
              {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="City"><input value={orgMirror.city} onChange={(e) => setMirror('city', e.target.value)} placeholder="e.g. New Delhi" style={inputStyle} /></Field>
          <Field label="PIN / Postal Code"><input value={orgMirror.pin} onChange={(e) => setMirror('pin', e.target.value)} placeholder="e.g. 110001" style={inputStyle} /></Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Address"><input value={orgMirror.address} onChange={(e) => setMirror('address', e.target.value)} placeholder="Street / Office address" style={inputStyle} /></Field>
          </div>
        </div>

        {form.org_contact_id === '__new__' && (
          <div style={{ padding: 14, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <Row>
              <Field label="Name *"><input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} placeholder="Rajesh Kumar" style={inputStyle} /></Field>
              <Field label="Designation"><input value={newContact.designation} onChange={(e) => setNewContact((c) => ({ ...c, designation: e.target.value }))} placeholder="Purchase Head / DGM" style={inputStyle} /></Field>
            </Row>
            <Row>
              <Field label="Mobile"><PhoneField value={newContact.mobile} onChange={(v) => setNewContact((c) => ({ ...c, mobile: v }))} style={inputStyle} /></Field>
              <Field label="Email"><ValidatedInput type="email" value={newContact.email} onChange={(v) => setNewContact((c) => ({ ...c, email: v }))} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="email@company.com" style={inputStyle} /></Field>
            </Row>
          </div>
        )}

        {duplicateWarning && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#a16207', fontSize: 12.5, display: 'flex', gap: 8, marginTop: 12 }}>
            <span>⚠</span>
            <span>{duplicateWarning}</span>
          </div>
        )}
      </Section>

      <Section title="Communication">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Field label="Office Contact Number"><input value={orgMirror.office_phone} onChange={(e) => setMirror('office_phone', e.target.value)} placeholder="e.g. 011-XXXXXXXX / +91 XXXXX XXXXX" style={inputStyle} /></Field>
          <Field label="Office Email"><ValidatedInput value={orgMirror.office_email} onChange={(v) => setMirror('office_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="e.g. purchase@cwc.gov.in" style={inputStyle} /></Field>
          <Field label="Website"><input value={orgMirror.website} onChange={(e) => setMirror('website', e.target.value)} placeholder="e.g. www.cwc.gov.in" style={inputStyle} /></Field>
          <Field label="Email on Website"><ValidatedInput value={orgMirror.web_email} onChange={(v) => setMirror('web_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="e.g. info@cwc.gov.in" style={inputStyle} /></Field>
        </div>
      </Section>

      <Section title="Product Requirement">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Field label="Category *">
            <select value={form.product_category} onChange={(e) => set('product_category', e.target.value)} style={inputStyle}>
              <option value="">-- Select --</option>
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Product *"><input value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="RRV System" style={inputStyle} /></Field>
          <Field label="Quantity *"><input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="e.g. 2" style={inputStyle} /></Field>
          <Field label="Unit"><input value={form.unit} onChange={(e) => set('unit', e.target.value)} style={inputStyle} /></Field>
          <Field label="Required Delivery Date"><DateField value={form.required_delivery_date} onChange={(v) => set('required_delivery_date', v)} /></Field>
          <Field label="Delivery Location"><input value={form.delivery_location} onChange={(e) => set('delivery_location', e.target.value)} placeholder="e.g. Allahabad, UP" style={inputStyle} /></Field>
          <Field label="Inspection Requirement"><input value={form.inspection_req} onChange={(e) => set('inspection_req', e.target.value)} placeholder="e.g. RDSO inspection, third party QA" style={inputStyle} /></Field>
          <Field label="Warranty Requirement"><input value={form.warranty_req} onChange={(e) => set('warranty_req', e.target.value)} placeholder="e.g. 12 months from commissioning" style={inputStyle} /></Field>
        </div>
        <Field label="Product Specification"><textarea value={form.product_spec} onChange={(e) => set('product_spec', e.target.value)} rows={2} placeholder="e.g. High Speed Self Propelled, 1676mm BG, hydraulic braking, anti-climber arrangement..." style={{ ...inputStyle, resize: 'vertical' }} /></Field>
        <Field label="Requirement Description"><textarea value={form.requirement_desc} onChange={(e) => set('requirement_desc', e.target.value)} rows={2} placeholder="Brief summary of the requirement..." style={{ ...inputStyle, resize: 'vertical' }} /></Field>
        <Field label="Detailed Requirement"><textarea value={form.detailed_requirement} onChange={(e) => set('detailed_requirement', e.target.value)} rows={3} placeholder="Detailed technical specs, standards, testing requirements..." style={{ ...inputStyle, resize: 'vertical' }} /></Field>
      </Section>

      <Section title="Follow-up">
        <Row3>
          <Field label="Next Follow-up Date"><DateField value={form.next_followup_date} onChange={(v) => set('next_followup_date', v)} /></Field>
          <Field label="Priority">
            <select value={form.followup_priority} onChange={(e) => set('followup_priority', e.target.value)} style={inputStyle}>
              <option value="">-- Select --</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Assigned To">
            <input value={form.followup_assigned_to} onChange={(e) => set('followup_assigned_to', e.target.value)} placeholder="Person name" style={inputStyle} />
          </Field>
        </Row3>
        <Field label="Follow-up Remarks"><textarea value={form.followup_remarks} onChange={(e) => set('followup_remarks', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
      </Section>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
