'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmNote, Inquiry, Organization, OrgContact, Tender } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PhoneField from '@/components/erp/PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'
import { RELATED_MODULES } from './constants'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'

export default function NoteForm({
  initial,
  defaultOrgId,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: CrmNote
  defaultOrgId?: number
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const editing = !!initial
  const [orgId, setOrgId] = useState(initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '')
  const [orgContactId, setOrgContactId] = useState(initial?.org_contact_id ? String(initial.org_contact_id) : '')
  const [relatedModule, setRelatedModule] = useState(initial?.related_module || '')
  const [relatedId, setRelatedId] = useState(initial?.related_id ? String(initial.related_id) : '')
  const [note, setNote] = useState(initial?.note || '')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', department: '', mobile: '', email: '' })
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [tenders, setTenders] = useState<Tender[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) crmApi.listOrganizations().then(setOrganizations)
  }, [editing])

  useEffect(() => {
    if (editing || !orgId) {
      setContacts([])
      return
    }
    crmApi.listOrgContacts(Number(orgId)).then(setContacts)
  }, [editing, orgId])

  useEffect(() => {
    if (editing || !orgId || relatedModule !== 'inquiry') {
      setInquiries([])
      return
    }
    crmApi.listInquiries({ org_id: Number(orgId) }).then(setInquiries)
  }, [editing, orgId, relatedModule])

  useEffect(() => {
    if (editing || !orgId || relatedModule !== 'tender') {
      setTenders([])
      return
    }
    crmApi.listTenders({ org_id: Number(orgId) }).then(setTenders)
  }, [editing, orgId, relatedModule])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing && orgContactId === '__new__' && !orgId) {
      setError('Please select an organization before adding a new contact.')
      return
    }
    if (!editing && orgContactId === '__new__' && !newContact.name.trim()) {
      setError('Please enter a name for the new contact, or select an existing one.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = { note }
      if (!editing) {
        if (orgId) payload.org_id = Number(orgId)

        let resolvedContactId: number | undefined = orgContactId && orgContactId !== '__new__' ? Number(orgContactId) : undefined
        if (orgContactId === '__new__') {
          const nameLower = newContact.name.trim().toLowerCase()
          const existing = contacts.find((c) => c.name.trim().toLowerCase() === nameLower)
          if (existing) {
            resolvedContactId = existing.id
          } else {
            const created = await crmApi.createOrgContact(Number(orgId), {
              name: newContact.name,
              designation: newContact.designation || undefined,
              department: newContact.department || undefined,
              mobile: newContact.mobile || undefined,
              email: newContact.email || undefined,
            })
            resolvedContactId = created.id
          }
        }
        if (resolvedContactId) payload.org_contact_id = resolvedContactId

        if (relatedModule) {
          payload.related_module = relatedModule
          if (relatedModule === 'organization') {
            payload.related_id = orgId ? Number(orgId) : undefined
            payload.universal_id = organizations.find((o) => String(o.id) === orgId)?.name
          } else if (relatedId) {
            payload.related_id = Number(relatedId)
            if (relatedModule === 'inquiry') payload.universal_id = inquiries.find((i) => String(i.id) === relatedId)?.universal_id
            if (relatedModule === 'tender') payload.universal_id = tenders.find((t) => String(t.id) === relatedId)?.universal_id
          }
        }
      }
      await onSubmit(payload)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save note.')
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

      <Section title="Note">
        {!editing && (
          <>
            <Field label="Organization">
              <SearchableSelect
                value={orgId}
                onChange={(v) => { setOrgId(v); setOrgContactId(''); setRelatedId('') }}
                options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
                placeholder="Type to search organization…"
              />
            </Field>

            <Row>
              <Field label="Contact Person">
                <select value={orgContactId} onChange={(e) => setOrgContactId(e.target.value)} style={inputStyle}>
                  <option value="">Select contact</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ Add New Contact</option>
                </select>
              </Field>
              <Field label="Related Module">
                <select value={relatedModule} onChange={(e) => { setRelatedModule(e.target.value); setRelatedId('') }} style={inputStyle}>
                  {RELATED_MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
            </Row>

            {orgContactId === '__new__' && (
              <div style={{ padding: 14, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Row>
                  <Field label="Name *"><input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} placeholder="Contact name" style={inputStyle} /></Field>
                  <Field label="Designation"><input value={newContact.designation} onChange={(e) => setNewContact((c) => ({ ...c, designation: e.target.value }))} placeholder="e.g. DEN" style={inputStyle} /></Field>
                </Row>
                <Row>
                  <Field label="Department"><input value={newContact.department} onChange={(e) => setNewContact((c) => ({ ...c, department: e.target.value }))} placeholder="Dept." style={inputStyle} /></Field>
                  <Field label="Mobile"><PhoneField value={newContact.mobile} onChange={(v) => setNewContact((c) => ({ ...c, mobile: v }))} style={inputStyle} /></Field>
                </Row>
                <Field label="Email"><ValidatedInput type="email" value={newContact.email} onChange={(v) => setNewContact((c) => ({ ...c, email: v }))} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="email" style={inputStyle} /></Field>
              </div>
            )}

            {relatedModule === 'inquiry' && (
              <Field label="Related Inquiry">
                <select value={relatedId} onChange={(e) => setRelatedId(e.target.value)} style={inputStyle} disabled={!orgId}>
                  <option value="">{orgId ? 'Select inquiry' : 'Select an organization first'}</option>
                  {inquiries.map((i) => (
                    <option key={i.id} value={i.id}>{i.universal_id} — {i.product || i.requirement_desc || 'Inquiry'}</option>
                  ))}
                </select>
              </Field>
            )}
            {relatedModule === 'tender' && (
              <Field label="Related Tender">
                <select value={relatedId} onChange={(e) => setRelatedId(e.target.value)} style={inputStyle} disabled={!orgId}>
                  <option value="">{orgId ? 'Select tender' : 'Select an organization first'}</option>
                  {tenders.map((t) => (
                    <option key={t.id} value={t.id}>{t.universal_id} — {t.tender_name || 'Tender'}</option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}
        <Field label="Note *">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} required rows={10} placeholder="Write your note here…" style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
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
