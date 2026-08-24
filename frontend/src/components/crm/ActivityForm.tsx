'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmActivity, OrgContact } from '@/types'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'
import { ACTIVITY_TYPES } from './constants'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'
import CameraCapture from '@/components/CameraCapture'
import RichTextEditor from '@/components/RichTextEditor'

type FormState = {
  activity_type: string
  subject: string
  activity_date: string
  next_followup: string
  assigned_to: string
  remarks: string
  action_plan: string
}

function toFormState(initial?: Partial<CrmActivity>, defaultAssignedTo?: string): FormState {
  return {
    activity_type: initial?.activity_type || ACTIVITY_TYPES[0],
    subject: initial?.subject || '',
    activity_date: initial?.activity_date || new Date().toISOString().slice(0, 10),
    next_followup: initial?.next_followup || '',
    assigned_to: initial?.assigned_to || defaultAssignedTo || '',
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
  const { user } = useAuth()
  const [form, setForm] = useState<FormState>(() => toFormState(initial, user?.name))
  const [stagedPhotos, setStagedPhotos] = useState<File[]>([])
  const [existingAttachments, setExistingAttachments] = useState<CrmActivity['attachments']>(initial?.attachments || [])
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null)
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>(() => {
    if (initial?.contact_ids?.length) return initial.contact_ids
    return initial?.org_contact_id ? [initial.org_contact_id] : []
  })
  const [addingContact, setAddingContact] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactsOpen, setContactsOpen] = useState(false)
  const contactsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showCamera, setShowCamera] = useState(false)
  const activityTypeOptions = initial?.activity_type && !ACTIVITY_TYPES.includes(initial.activity_type)
    ? [...ACTIVITY_TYPES, initial.activity_type]
    : ACTIVITY_TYPES
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', department: '', mobile: '', email: '' })
  const [savingContact, setSavingContact] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const saveNewContact = async () => {
    if (!orgId) {
      setError('No organization is associated with this record.')
      return
    }
    if (!newContact.name.trim()) {
      setError('Please enter a name for the contact.')
      return
    }
    if (!newContact.mobile.trim()) {
      setError('Please enter a mobile number for the contact.')
      return
    }
    setSavingContact(true)
    setError('')
    try {
      const nameLower = newContact.name.trim().toLowerCase()
      const existing = contacts.find((c) => c.name.trim().toLowerCase() === nameLower)
      const contact = existing || await crmApi.createOrgContact(orgId, {
        name: newContact.name,
        designation: newContact.designation || undefined,
        department: newContact.department || undefined,
        mobile: newContact.mobile || undefined,
        email: newContact.email || undefined,
      })
      if (!existing) setContacts((prev) => [...prev, contact])
      setSelectedContactIds((ids) => (ids.includes(contact.id) ? ids : [...ids, contact.id]))
      setNewContact({ name: '', designation: '', department: '', mobile: '', email: '' })
      setAddingContact(false)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save contact.')
    } finally {
      setSavingContact(false)
    }
  }

  useEffect(() => {
    if (!orgId) {
      setContacts([])
      return
    }
    crmApi.listOrgContacts(orgId).then(setContacts)
  }, [orgId])

  useEffect(() => {
    if (!contactsOpen) return
    const onClick = (e: MouseEvent) => {
      if (contactsRef.current && !contactsRef.current.contains(e.target as Node)) {
        setContactsOpen(false)
        setContactSearch('')
        setAddingContact(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [contactsOpen])

  useEffect(() => {
    if (!initial?.assigned_to && user?.name) {
      setForm((f) => (f.assigned_to ? f : { ...f, assigned_to: user.name }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name])

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
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', flex: '1 1 480px' }}>
            <div style={{ flex: '2 1 200px', minWidth: 180 }}>
              <Field label="Subject">
                <input value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Brief subject of this activity" style={inputStyle} />
              </Field>
            </div>
            <div style={{ flex: '2 1 240px', minWidth: 220 }} ref={contactsRef}>
              <Field label="Contact Person(s)">
                <div style={{ position: 'relative' }}>
                  <div
                    onClick={() => setContactsOpen((v) => !v)}
                    style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 20, cursor: 'pointer' }}
                  >
                    {selectedContactIds.length === 0 && <span style={{ color: '#a8a29e' }}>Select contacts…</span>}
                    {selectedContactIds.map((id) => {
                      const c = contacts.find((x) => x.id === id)
                      if (!c) return null
                      return (
                        <span key={id} onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '3px 6px 3px 10px', borderRadius: 8, background: 'rgba(244,113,59,0.1)', border: '1px solid rgba(244,113,59,0.25)', color: '#c2410c' }}>
                          {c.name}
                          <span onClick={() => toggleContact(id)} style={{ cursor: 'pointer', fontWeight: 700 }}>×</span>
                        </span>
                      )
                    })}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', marginLeft: 'auto' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {contactsOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 50, background: '#fff', borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 16px 36px rgba(0,0,0,0.14)', display: 'flex', flexDirection: 'column' }}>
                      {addingContact ? (
                        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <Row>
                            <Field label="Name *"><input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} placeholder="Contact name" style={inputStyle} /></Field>
                            <Field label="Designation"><input value={newContact.designation} onChange={(e) => setNewContact((c) => ({ ...c, designation: e.target.value }))} placeholder="e.g. DEN" style={inputStyle} /></Field>
                          </Row>
                          <Row>
                            <Field label="Department"><input value={newContact.department} onChange={(e) => setNewContact((c) => ({ ...c, department: e.target.value }))} placeholder="Dept." style={inputStyle} /></Field>
                            <Field label="Mobile *"><PhoneField value={newContact.mobile} onChange={(v) => setNewContact((c) => ({ ...c, mobile: v }))} style={inputStyle} /></Field>
                          </Row>
                          <Field label="Email"><ValidatedInput type="email" value={newContact.email} onChange={(v) => setNewContact((c) => ({ ...c, email: v }))} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="email" style={inputStyle} /></Field>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <button type="button" onClick={() => { setAddingContact(false); setNewContact({ name: '', designation: '', department: '', mobile: '', email: '' }) }} style={secondaryBtnStyle}>
                              Cancel
                            </button>
                            <button type="button" onClick={saveNewContact} disabled={savingContact} style={{ ...primaryBtnStyle, opacity: savingContact ? 0.7 : 1 }}>
                              {savingContact ? 'Saving…' : 'Save Contact'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ padding: 8, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                            <input autoFocus value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Search contacts…" style={{ ...inputStyle, padding: '8px 10px' }} />
                          </div>
                          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                            {contacts.filter((c) => c.name.toLowerCase().includes(contactSearch.trim().toLowerCase())).length === 0 ? (
                              <p style={{ fontSize: 12.5, color: '#a8a29e', padding: '10px 14px', margin: 0 }}>No matches.</p>
                            ) : (
                              contacts
                                .filter((c) => c.name.toLowerCase().includes(contactSearch.trim().toLowerCase()))
                                .map((c) => (
                                  <div
                                    key={c.id}
                                    onClick={() => toggleContact(c.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: selectedContactIds.includes(c.id) ? 'rgba(244,113,59,0.08)' : 'transparent', color: selectedContactIds.includes(c.id) ? '#c2410c' : '#1f1108' }}
                                  >
                                    <input type="checkbox" checked={selectedContactIds.includes(c.id)} readOnly style={{ pointerEvents: 'none' }} />
                                    {c.name}
                                  </div>
                                ))
                            )}
                          </div>
                          <div
                            onClick={() => setAddingContact(true)}
                            style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: '#fa9b9b', cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.06)' }}
                          >
                            + Add New Contact
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Field>
            </div>

            <div style={{ flex: '1 1 150px', minWidth: 140 }}>
              <Field label="Activity Type">
                <select value={form.activity_type} onChange={(e) => set('activity_type', e.target.value)} style={inputStyle}>
                  {activityTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: '1 1 150px', minWidth: 140 }}>
              <Field label="Next Follow-up Date"><DateField value={form.next_followup} onChange={(v) => set('next_followup', v)} /></Field>
            </div>
          </div>

          <div style={{ flex: 'none' }}>
            <Field label="Attachment">
              <div style={{ display: 'flex', gap: 8 }}>
                {showCamera && <CameraCapture onCapture={(file) => stagePhotos([file])} onClose={() => setShowCamera(false)} />}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { stagePhotos(e.target.files); e.target.value = '' }} />
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  aria-label="Take photo"
                  title="Take photo"
                  style={{ width: 34, height: 34, flex: 'none', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  📷
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', color: '#78716c', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  + Add Photo
                </button>
              </div>
            </Field>
          </div>
        </div>

        <Field label="Observation / Remarks">
          <RichTextEditor value={form.remarks} onChange={(v) => set('remarks', v)} placeholder="What was discussed or observed" />
        </Field>
        <Field label="Action Plan">
          <RichTextEditor value={form.action_plan} onChange={(v) => set('action_plan', v)} placeholder="What needs to be done next" />
        </Field>

        {(!!existingAttachments?.length || stagedPhotos.length > 0) && (
          <Field label="Photos">
            <PhotoThumbnails
              stagedPhotos={stagedPhotos}
              onRemoveStaged={(i) => setStagedPhotos((prev) => prev.filter((_, idx) => idx !== i))}
              existingAttachments={existingAttachments}
              onDeleteExisting={deleteExistingPhoto}
              deletingAttachmentId={deletingAttachmentId}
            />
          </Field>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function PhotoThumbnails({
  stagedPhotos,
  onRemoveStaged,
  existingAttachments,
  onDeleteExisting,
  deletingAttachmentId,
}: {
  stagedPhotos: File[]
  onRemoveStaged: (index: number) => void
  existingAttachments: CrmActivity['attachments']
  onDeleteExisting: (attachmentId: number) => void
  deletingAttachmentId: number | null
}) {
  const previews = useMemo(() => stagedPhotos.map((f) => URL.createObjectURL(f)), [stagedPhotos])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  return (
    <>
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

    </>
  )
}
