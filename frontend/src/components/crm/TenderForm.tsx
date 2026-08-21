'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { Tender, Organization, OrgContact } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import { RAILWAY_ZONES, TENDER_PORTALS, TENDER_TYPES, CURRENCIES, TENDER_STATUSES } from './constants'
import { Field, Section, Row, Row3, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'

const TABS = ['Tender Information'] as const

type FormState = {
  org_id: string
  org_contact_id: string
  tender_number: string
  tender_name: string
  tender_authority: string
  tender_portal: string
  tender_type: string
  tender_category: string
  tender_value: string
  currency: string
  status: string
  railway_zone: string
  division: string
  workshop: string
  publish_date: string
  doc_download_date: string
  pre_bid_meeting_date: string
  query_submission_date: string
  submission_date: string
  opening_date: string
  financial_opening_date: string
  expected_award_date: string
  participate: string
  decision_by: string
  decision_date: string
  reason_no_participate: string
  awarded_to: string
  loi_number: string
  contract_value: string
  loss_reason: string
}

function toFormState(initial?: Tender, defaultOrgId?: number): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '',
    org_contact_id: initial?.org_contact_id ? String(initial.org_contact_id) : '',
    tender_number: initial?.tender_number || '',
    tender_name: initial?.tender_name || '',
    tender_authority: initial?.tender_authority || '',
    tender_portal: initial?.tender_portal || '',
    tender_type: initial?.tender_type || '',
    tender_category: initial?.tender_category || '',
    tender_value: initial?.tender_value != null ? String(initial.tender_value) : '',
    currency: initial?.currency || 'INR',
    status: initial?.status || 'Active',
    railway_zone: initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? 'Other' : initial?.railway_zone || '',
    division: initial?.division || '',
    workshop: initial?.workshop || '',
    publish_date: initial?.publish_date || '',
    doc_download_date: initial?.doc_download_date || '',
    pre_bid_meeting_date: initial?.pre_bid_meeting_date || '',
    query_submission_date: initial?.query_submission_date || '',
    submission_date: initial?.submission_date || '',
    opening_date: initial?.opening_date || '',
    financial_opening_date: initial?.financial_opening_date || '',
    expected_award_date: initial?.expected_award_date || '',
    participate: initial?.participate == null ? '' : initial.participate ? 'yes' : 'no',
    decision_by: initial?.decision_by || '',
    decision_date: initial?.decision_date || '',
    reason_no_participate: initial?.reason_no_participate || '',
    awarded_to: initial?.awarded_to || '',
    loi_number: initial?.loi_number || '',
    contract_value: initial?.contract_value != null ? String(initial.contract_value) : '',
    loss_reason: initial?.loss_reason || '',
  }
}

export default function TenderForm({
  initial,
  defaultOrgId,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: Tender
  defaultOrgId?: number
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [tab, setTab] = useState<typeof TABS[number]>('Tender Information')
  const [form, setForm] = useState<FormState>(() => toFormState(initial, defaultOrgId))
  const [railwayZoneCustom, setRailwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', mobile: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { crmApi.listOrganizations().then(setOrganizations) }, [])
  useEffect(() => {
    if (form.org_id) crmApi.listOrgContacts(Number(form.org_id)).then(setContacts)
    else setContacts([])
  }, [form.org_id])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

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
        tender_value: form.tender_value ? Number(form.tender_value) : undefined,
        railway_zone: form.railway_zone === 'Other' ? railwayZoneCustom : form.railway_zone,
        participate: form.participate === '' ? undefined : form.participate === 'yes',
        contract_value: form.contract_value ? Number(form.contract_value) : undefined,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      await onSubmit(payload)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save tender.')
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#a8a29e' }}>Tender Number</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8, background: 'rgba(244,113,59,0.08)', color: '#fa9b9b' }}>
          {initial?.universal_id || 'Auto-generated on save'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px', marginRight: 16, border: 'none', background: 'transparent',
              borderBottom: tab === t ? '2px solid #fa9b9b' : '2px solid transparent',
              color: tab === t ? '#fa9b9b' : '#78716c', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Tender Information' && (
      <>
        <Section title="Organization">
          <Row>
            <Field label="Organization">
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
          </Row>

          {form.org_contact_id === '__new__' && (
            <div style={{ padding: 14, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        </Section>

      <Section title="Railway / Org Details">
        <Row3>
          <Field label="Railway Zone">
            <select value={form.railway_zone} onChange={(e) => set('railway_zone', e.target.value)} style={inputStyle}>
              <option value="">-- Select Zone --</option>
              {RAILWAY_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            {form.railway_zone === 'Other' && (
              <input value={railwayZoneCustom} onChange={(e) => setRailwayZoneCustom(e.target.value)} placeholder="Specify railway zone" style={{ ...inputStyle, marginTop: 8 }} />
            )}
          </Field>
          <Field label="Division"><input value={form.division} onChange={(e) => set('division', e.target.value)} style={inputStyle} /></Field>
          <Field label="Workshop"><input value={form.workshop} onChange={(e) => set('workshop', e.target.value)} style={inputStyle} /></Field>
        </Row3>
      </Section>

      <Section title="Tender Details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Field label="Tender Number"><input value={form.tender_number} onChange={(e) => set('tender_number', e.target.value)} style={inputStyle} /></Field>
          <Field label="Tender Name"><input value={form.tender_name} onChange={(e) => set('tender_name', e.target.value)} style={inputStyle} /></Field>
          <Field label="Tender Authority"><input value={form.tender_authority} onChange={(e) => set('tender_authority', e.target.value)} style={inputStyle} /></Field>
          <Field label="Tender Portal">
            <select value={form.tender_portal} onChange={(e) => set('tender_portal', e.target.value)} style={inputStyle}>
              <option value="">-- Select Portal --</option>
              {TENDER_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Tender Type">
            <select value={form.tender_type} onChange={(e) => set('tender_type', e.target.value)} style={inputStyle}>
              <option value="">-- Select Type --</option>
              {TENDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Category"><input value={form.tender_category} onChange={(e) => set('tender_category', e.target.value)} style={inputStyle} /></Field>
          <Field label="Tender Value"><input type="number" value={form.tender_value} onChange={(e) => set('tender_value', e.target.value)} style={inputStyle} /></Field>
          <Field label="Currency">
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} style={inputStyle}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
              {TENDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Key Dates">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Field label="Publish Date"><DateField value={form.publish_date} onChange={(v) => set('publish_date', v)} /></Field>
          <Field label="Document Download Date"><DateField value={form.doc_download_date} onChange={(v) => set('doc_download_date', v)} /></Field>
          <Field label="Pre-Bid Meeting Date"><DateField value={form.pre_bid_meeting_date} onChange={(v) => set('pre_bid_meeting_date', v)} /></Field>
          <Field label="Query Submission Date"><DateField value={form.query_submission_date} onChange={(v) => set('query_submission_date', v)} /></Field>
          <Field label="Submission Date"><DateField value={form.submission_date} onChange={(v) => set('submission_date', v)} /></Field>
          <Field label="Technical Opening Date"><DateField value={form.opening_date} onChange={(v) => set('opening_date', v)} /></Field>
          <Field label="Financial Opening Date"><DateField value={form.financial_opening_date} onChange={(v) => set('financial_opening_date', v)} /></Field>
          <Field label="Expected Award Date"><DateField value={form.expected_award_date} onChange={(v) => set('expected_award_date', v)} /></Field>
        </div>
      </Section>

      <Section title="Participation Decision">
        <Row3>
          <Field label="Participate?">
            <select value={form.participate} onChange={(e) => set('participate', e.target.value)} style={inputStyle}>
              <option value="">-- Select --</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field label="Decision By"><input value={form.decision_by} onChange={(e) => set('decision_by', e.target.value)} style={inputStyle} /></Field>
          <Field label="Decision Date"><DateField value={form.decision_date} onChange={(v) => set('decision_date', v)} /></Field>
        </Row3>
        {form.participate === 'no' && (
          <Field label="Reason (if Not Participating)">
            <textarea value={form.reason_no_participate} onChange={(e) => set('reason_no_participate', e.target.value)} rows={2} placeholder="Reason for not participating…" style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        )}
      </Section>

      <Section title="Outcome">
        <Row3>
          <Field label="Awarded To"><input value={form.awarded_to} onChange={(e) => set('awarded_to', e.target.value)} style={inputStyle} /></Field>
          <Field label="LOI Number"><input value={form.loi_number} onChange={(e) => set('loi_number', e.target.value)} style={inputStyle} /></Field>
          <Field label="Contract Value"><input type="number" value={form.contract_value} onChange={(e) => set('contract_value', e.target.value)} style={inputStyle} /></Field>
        </Row3>
        <Field label="Loss Reason"><textarea value={form.loss_reason} onChange={(e) => set('loss_reason', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
      </Section>
      </>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
