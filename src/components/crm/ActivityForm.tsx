'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmActivity, Organization, OrgContact } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { ACTIVITY_TYPES } from './constants'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'

const RELATED_MODULES = [
  { value: '', label: '— None —' },
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'tender', label: 'Tender' },
  { value: 'organization', label: 'Organization' },
]

type FormState = {
  org_id: string
  org_contact_id: string
  related_module: string
  universal_id: string
  activity_type: string
  status: string
  next_followup: string
  assigned_to: string
  remarks: string
}

function toFormState(initial?: CrmActivity): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : '',
    org_contact_id: initial?.org_contact_id ? String(initial.org_contact_id) : '',
    related_module: initial?.related_module || '',
    universal_id: initial?.universal_id || '',
    activity_type: initial?.activity_type || ACTIVITY_TYPES[0],
    status: initial?.status || 'Open',
    next_followup: initial?.next_followup || '',
    assigned_to: initial?.assigned_to || '',
    remarks: initial?.remarks || '',
  }
}

export default function ActivityForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: CrmActivity
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    crmApi.listOrganizations().then(setOrganizations)
  }, [])

  useEffect(() => {
    if (!form.org_id) {
      setContacts([])
      return
    }
    crmApi.listOrgContacts(Number(form.org_id)).then(setContacts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.org_id])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        ...form,
        org_id: form.org_id ? Number(form.org_id) : undefined,
        org_contact_id: form.org_contact_id ? Number(form.org_contact_id) : undefined,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      await onSubmit(payload)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save activity.')
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

      <Section title="Activity Details">
        <Field label="Organization">
          <SearchableSelect
            value={form.org_id}
            onChange={(v) => set('org_id', v)}
            options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
            placeholder="Type to search organization…"
          />
        </Field>
        <Row>
          <Field label="Contact Person">
            <select value={form.org_contact_id} onChange={(e) => set('org_contact_id', e.target.value)} style={inputStyle}>
              <option value="">Select contact</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Related Module">
            <select value={form.related_module} onChange={(e) => set('related_module', e.target.value)} style={inputStyle}>
              {RELATED_MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Universal ID"><input value={form.universal_id} onChange={(e) => set('universal_id', e.target.value)} placeholder="e.g. INQ-2024-001" style={inputStyle} /></Field>
          <Field label="Activity Type">
            <select value={form.activity_type} onChange={(e) => set('activity_type', e.target.value)} style={inputStyle}>
              {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
              <option value="Open">Open</option>
              <option value="Done">Done</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Next Follow-up Date"><DateField value={form.next_followup} onChange={(v) => set('next_followup', v)} /></Field>
        </Row>
        <Field label="Assigned To"><input value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Assignee name" style={inputStyle} /></Field>
        <Field label="Remarks"><textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} rows={3} placeholder="Describe the activity outcome or notes" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
      </Section>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={onCancel} style={{ ...secondaryBtnStyle, flex: 1 }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, flex: 1, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
