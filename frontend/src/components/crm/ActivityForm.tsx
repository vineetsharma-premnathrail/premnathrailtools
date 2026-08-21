'use client'

import { useEffect, useRef, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmActivity, OrgContact } from '@/types'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'
import { ACTIVITY_TYPES } from './constants'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'
import CameraCapture from '@/components/CameraCapture'

type FormState = {
  activity_type: string
  activity_date: string
  next_followup: string
  assigned_to: string
  remarks: string
  action_plan: string
}

function toFormState(initial?: Partial<CrmActivity>): FormState {
  return {
    activity_type: initial?.activity_type || ACTIVITY_TYPES[0],
    activity_date: initial?.activity_date || new Date().toISOString().slice(0, 10),
    next_followup: initial?.next_followup || '',
    assigned_to: initial?.assigned_to || '',
    remarks: initial?.remarks || '',
    action_plan: initial?.action_plan || '',
  }
}

export default function ActivityForm({
  initial,
  defaultOrgId,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: Partial<CrmActivity>
  defaultOrgId?: number
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>, photos: File[]) => Promise<void>
}) {
  const orgId = initial?.org_id ?? defaultOrgId
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [stagedPhotos, setStagedPhotos] = useState<File[]>([])
  const [existingAttachments, setExistingAttachments] = useState<CrmActivity['attachments']>(initial?.attachments || [])
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null)
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>(() => {
    if (initial?.contact_ids?.length) return initial.contact_ids
    return initial?.org_contact_id ? [initial.org_contact_id] : []
  })
  const [addingContact, setAddingContact] = useState(false)
  const activityTypeOptions = initial?.activity_type && !ACTIVITY_TYPES.includes(initial.activity_type)
    ? [...ACTIVITY_TYPES, initial.activity_type]
    : ACTIVITY_TYPES
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', department: '', mobile: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orgId) {
      setContacts([])
      return
    }
    crmApi.listOrgContacts(orgId).then(setContacts)
  }, [orgId])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const toggleContact = (id: number) =>
    setSelectedContactIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (addingContact && !orgId) {
      setError('No organization is associated with this record.')
      return
    }
    if (addingContact && !newContact.name.trim()) {
      setError('Please enter a name for the new contact, or select an existing one.')
      return
    }
    setSaving(true)
    setError('')
    try {
      let contactIds = [...selectedContactIds]
      if (addingContact && orgId) {
        const nameLower = newContact.name.trim().toLowerCase()
        const existing = contacts.find((c) => c.name.trim().toLowerCase() === nameLower)
        if (existing) {
          if (!contactIds.includes(existing.id)) contactIds.push(existing.id)
        } else {
          const created = await crmApi.createOrgContact(orgId, {
            name: newContact.name,
            designation: newContact.designation || undefined,
            department: newContact.department || undefined,
            mobile: newContact.mobile || undefined,
            email: newContact.email || undefined,
          })
          contactIds.push(created.id)
        }
      }
      const orgContactId: number | undefined = contactIds[0]

      const payload: Record<string, unknown> = {
        ...form,
        org_id: orgId,
        related_module: initial?.related_module,
        related_id: initial?.related_id,
        universal_id: initial?.universal_id,
        org_contact_id: orgContactId,
        contact_ids: contactIds.length ? contactIds : undefined,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      await onSubmit(payload, stagedPhotos)
      setStagedPhotos([])
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save activity.')
    } finally {
      setSaving(false)
    }
  }

  const stagePhotos = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    setStagedPhotos((prev) => [...prev, ...Array.from(files)])
  }

  const deleteExistingPhoto = async (attachmentId: number) => {
    if (!initial?.id) return
    if (!window.confirm('Delete this photo?')) return
    setDeletingAttachmentId(attachmentId)
    try {
      const updated = await crmApi.deleteActivityAttachment(initial.id, attachmentId)
      setExistingAttachments(updated.attachments || [])
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Follow Up Details">
        <Field label="Contact Person(s)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {contacts.length === 0 && <span style={{ fontSize: 12.5, color: '#a8a29e' }}>No contacts found for this organization.</span>}
            {contacts.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: selectedContactIds.includes(c.id) ? 'rgba(244,113,59,0.1)' : '#f9fafb', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedContactIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
                {c.name}
              </label>
            ))}
            <button type="button" onClick={() => setAddingContact((v) => !v)} style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: addingContact ? 'rgba(244,113,59,0.1)' : '#fff', color: '#78716c', cursor: 'pointer' }}>
              + Add New Contact
            </button>
          </div>
        </Field>

        {addingContact && (
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

        <Row>
          <Field label="Activity Type">
            <select value={form.activity_type} onChange={(e) => set('activity_type', e.target.value)} style={inputStyle}>
              {activityTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Next Follow-up Date"><DateField value={form.next_followup} onChange={(v) => set('next_followup', v)} /></Field>
          <Field label="Assigned To"><input value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Assignee name" style={inputStyle} /></Field>
        </Row>
        <Field label="Observation / Remarks">
          <textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} rows={4} placeholder="What was discussed or observed" style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="Action Plan">
          <textarea value={form.action_plan} onChange={(e) => set('action_plan', e.target.value)} rows={4} placeholder="What needs to be done next" style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </Section>

      <PhotoSection
        stagedPhotos={stagedPhotos}
        onStage={stagePhotos}
        onRemoveStaged={(i) => setStagedPhotos((prev) => prev.filter((_, idx) => idx !== i))}
        existingAttachments={existingAttachments}
        onDeleteExisting={deleteExistingPhoto}
        deletingAttachmentId={deletingAttachmentId}
      />

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={onCancel} style={{ ...secondaryBtnStyle, flex: 1 }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, flex: 1, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function PhotoSection({
  stagedPhotos,
  onStage,
  onRemoveStaged,
  existingAttachments,
  onDeleteExisting,
  deletingAttachmentId,
}: {
  stagedPhotos: File[]
  onStage: (files: FileList | File[] | null) => void
  onRemoveStaged: (index: number) => void
  existingAttachments: CrmActivity['attachments']
  onDeleteExisting: (attachmentId: number) => void
  deletingAttachmentId: number | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const previews = stagedPhotos.map((f) => URL.createObjectURL(f))
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  return (
    <Section title="Photos">
      {showCamera && (
        <CameraCapture onCapture={(file) => onStage([file])} onClose={() => setShowCamera(false)} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          aria-label="Take photo"
          title="Take photo"
          style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', background: '#faf9f7', fontSize: 19, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          📷
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onStage(e.dataTransfer.files) }}
          aria-label="Browse photos"
          title="Browse photos, or drag &amp; drop here"
          style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, border: `1px solid ${dragOver ? '#fa9b9b' : 'rgba(0,0,0,0.1)'}`, background: dragOver ? 'rgba(244,113,59,0.08)' : '#faf9f7', fontSize: 19, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          🖼️
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onStage(e.target.files); e.target.value = '' }} />
        <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0 }}>Take a photo, or browse / drag &amp; drop (JPG/PNG)</p>
      </div>

      {!!existingAttachments?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {existingAttachments.map((a) => (
            <div key={a.id} style={{ position: 'relative', width: 56, height: 56, flex: 'none' }}>
              <a href={a.sharepoint_url || '#'} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.sharepoint_url} alt={a.filename} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />
              </a>
              <button
                type="button"
                onClick={() => onDeleteExisting(a.id)}
                disabled={deletingAttachmentId === a.id}
                aria-label={`Delete ${a.filename}`}
                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer', padding: 0 }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {stagedPhotos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {stagedPhotos.map((f, i) => (
            <div key={i} style={{ position: 'relative', width: 56, height: 56, flex: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[i]} alt={f.name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />
              <button
                type="button"
                onClick={() => onRemoveStaged(i)}
                aria-label={`Remove ${f.name}`}
                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer', padding: 0 }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {!existingAttachments?.length && stagedPhotos.length === 0 && (
        <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>No photos added yet.</p>
      )}
    </Section>
  )
}
