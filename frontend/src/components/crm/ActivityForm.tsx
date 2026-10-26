'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useRef, useState } from 'react'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { CaretDown } from '@phosphor-icons/react'
import { useAuth } from '@/hooks/useAuth'
import { useAttachmentBlobUrl, openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { crmApi } from '@/lib/api'
import { CrmActivity, OrgContact } from '@/types'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES, extractErrorMessages } from '@/lib/validation'
import { ACTIVITY_TYPES, FOLLOW_UP_STATUSES } from './constants'
import { XIcon } from './ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import CameraCapture from '@/components/CameraCapture'
import RichTextEditor from '@/components/RichTextEditor'
import Checkbox from '@/components/Checkbox'

type FormState = {
  activity_type: string
  subject: string
  activity_date: string
  next_followup: string
  assigned_to: string
  status: string
  remarks: string
  action_plan: string
}

function toFormState(initial?: Partial<CrmActivity>, defaultAssignedTo?: string): FormState {
  return {
    // Legacy records can carry a type we no longer offer — fall back to a valid one.
    activity_type: initial?.activity_type && ACTIVITY_TYPES.includes(initial.activity_type)
      ? initial.activity_type
      : ACTIVITY_TYPES[0],
    subject: initial?.subject || '',
    activity_date: initial?.activity_date || new Date().toLocaleDateString('en-CA'), // local date, not UTC
    next_followup: initial?.next_followup || '',
    assigned_to: initial?.assigned_to || defaultAssignedTo || '',
    status: initial?.status || FOLLOW_UP_STATUSES[0],
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
  const contactsPopRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', department: '', mobile: '', email: '' })
  const [savingContact, setSavingContact] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const inputStyle = sheetInput

  const saveNewContact = async () => {
    if (!orgId) {
      setError('No customer organization is associated with this record.')
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
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save contact.'))
    } finally {
      setSavingContact(false)
    }
  }

  useEffect(() => {
    if (!orgId) return
    crmApi.listOrgContacts(orgId).then(setContacts)
  }, [orgId])

  useEffect(() => {
    if (!contactsOpen) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (contactsRef.current && !contactsRef.current.contains(t) && !contactsPopRef.current?.contains(t)) {
        setContactsOpen(false)
        setContactSearch('')
        setAddingContact(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [contactsOpen])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const toggleContact = (id: number) =>
    setSelectedContactIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (addingContact && !orgId) {
      setError('No customer organization is associated with this record.')
      return
    }
    if (addingContact && !newContact.name.trim()) {
      setError('Please enter a name for the new contact, or select an existing one.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const contactIds = [...selectedContactIds]
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
        // Defaults to the signed-in user when the record has no assignee yet.
        assigned_to: form.assigned_to || user?.name || '',
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
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save activity.'))
    } finally {
      setSaving(false)
    }
  }

  const stagePhotos = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    setStagedPhotos((prev) => [...prev, ...Array.from(files)])
  }

  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<number | null>(null)

  const deleteExistingPhoto = async (attachmentId: number) => {
    if (!initial?.id) return
    setDeletingAttachmentId(attachmentId)
    try {
      const updated = await crmApi.deleteActivityAttachment(initial.id, attachmentId)
      setExistingAttachments(updated.attachments || [])
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  const isEdit = !!initial?.id
  return (
    <FormSheet tour="activity-form" icon={isEdit ? 'edit' : 'chat'} title={isEdit ? 'Edit Follow Up' : 'Add Follow Up'}
      subtitle={isEdit ? 'Change this follow-up — remarks, action plan, next date or status.' : 'Log a meeting, call or visit with the customer and set when to follow up next.'}
      onClose={onCancel} busy={saving}
      footer={<>
        <button type="button" onClick={onCancel} disabled={saving} data-tour="activity-cancel-btn" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="submit" form="crm-activity-form" data-tour="activity-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name={isEdit ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
        </button>
      </>}>
      <form id="crm-activity-form" onSubmit={handleSubmit}>
        <SheetColumns
          left={<>
            <SheetError error={error} />
            <SheetSection icon="list" title="Follow Up Details">
              <div data-tour="activity-subject">
                <label style={sheetLabel}>Subject</label>
                <input value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Brief subject of this activity" style={inputStyle} autoFocus />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="activity-type" style={{ flex: '1 1 150px', minWidth: 140 }}>
                  <label style={sheetLabel}>Activity Type</label>
                  <Select value={form.activity_type} onChange={(e) => set('activity_type', e.target.value)} style={inputStyle}>
                    {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div data-tour="activity-next-followup" style={{ flex: '1 1 150px', minWidth: 140 }}>
                  <label style={sheetLabel}>Next Follow-up Date</label>
                  <DateField value={form.next_followup} onChange={(v) => set('next_followup', v)} />
                </div>
                <div data-tour="activity-status" style={{ flex: '1 1 120px', minWidth: 120 }}>
                  <label style={sheetLabel}>Status</label>
                  <Select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                    {FOLLOW_UP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Observation / Remarks">
              <div data-tour="activity-remarks">
                <RichTextEditor value={form.remarks} onChange={(v) => set('remarks', v)} placeholder="What was discussed or observed" tourId="activity-remarks" />
              </div>
            </SheetSection>
            <SheetSection icon="flag" title="Action Plan">
              <div data-tour="activity-action-plan">
                <RichTextEditor value={form.action_plan} onChange={(v) => set('action_plan', v)} placeholder="What needs to be done next" tourId="activity-action-plan" />
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="users" title="Contact Person(s)" extra={<Optional />}>
              <div ref={contactsRef} data-tour="activity-contacts" style={{ position: 'relative' }}>
                <div
                  onClick={() => setContactsOpen((v) => !v)}
                  style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 20, cursor: 'pointer' }}
                >
                  {selectedContactIds.length === 0 && <span style={{ color: SHEET.MUTED }}>Select contacts…</span>}
                  {selectedContactIds.map((id) => {
                    const c = contacts.find((x) => x.id === id)
                    if (!c) return null
                    return (
                      <span key={id} onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '3px 6px 3px 10px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: SHEET.BLUE }}>
                        {c.name}
                        <span onClick={() => toggleContact(id)} style={{ cursor: 'pointer', fontWeight: 700 }}>×</span>
                      </span>
                    )
                  })}
                  <CaretDown size={14} color="#94a3b8" style={{ flex: 'none', marginLeft: 'auto' }} />
                </div>

                {/* Portaled so the sheet's scroll body can't clip it; flips up near the screen bottom. */}
                <AnchoredPopover anchorRef={contactsRef} open={contactsOpen} maxHeight={440} style={{ borderRadius: 12, border: `1px solid ${SHEET.LINE}`, boxShadow: '0 16px 36px rgba(0,0,0,0.14)' }}>
                  <div ref={contactsPopRef} style={{ display: 'flex', flexDirection: 'column' }}>
                    {addingContact ? (
                      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div><label style={sheetLabel}>Name <Req /></label><input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} placeholder="Contact name" style={inputStyle} /></div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 120px' }}><label style={sheetLabel}>Designation</label><input value={newContact.designation} onChange={(e) => setNewContact((c) => ({ ...c, designation: e.target.value }))} placeholder="e.g. DEN" style={inputStyle} /></div>
                          <div style={{ flex: '1 1 120px' }}><label style={sheetLabel}>Department</label><input value={newContact.department} onChange={(e) => setNewContact((c) => ({ ...c, department: e.target.value }))} placeholder="Dept." style={inputStyle} /></div>
                        </div>
                        <div><label style={sheetLabel}>Mobile <Req /></label><PhoneField value={newContact.mobile} onChange={(v) => setNewContact((c) => ({ ...c, mobile: v }))} style={inputStyle} /></div>
                        <div><label style={sheetLabel}>Email</label><ValidatedInput type="email" value={newContact.email} onChange={(v) => setNewContact((c) => ({ ...c, email: v }))} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="email" style={inputStyle} /></div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button type="button" onClick={() => { setAddingContact(false); setNewContact({ name: '', designation: '', department: '', mobile: '', email: '' }) }} style={sheetBtn('secondary', SHEET.INK)}>
                            Cancel
                          </button>
                          <button type="button" onClick={saveNewContact} disabled={savingContact} style={sheetBtn('primary', SHEET.BLUE, savingContact)}>
                            {savingContact ? 'Saving…' : 'Save Contact'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ padding: 8, borderBottom: `1px solid ${SHEET.LINE}` }}>
                          <input autoFocus value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Search contacts…" style={{ ...inputStyle, padding: '8px 10px' }} />
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                          {contacts.filter((c) => c.name.toLowerCase().includes(contactSearch.trim().toLowerCase())).length === 0 ? (
                            <p style={{ fontSize: 12.5, color: SHEET.MUTED, padding: '10px 14px', margin: 0 }}>No matches.</p>
                          ) : (
                            contacts
                              .filter((c) => c.name.toLowerCase().includes(contactSearch.trim().toLowerCase()))
                              .map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => toggleContact(c.id)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: selectedContactIds.includes(c.id) ? '#eff6ff' : 'transparent', color: selectedContactIds.includes(c.id) ? SHEET.BLUE : SHEET.INK }}
                                >
                                  <span style={{ pointerEvents: 'none' }}>
                                    <Checkbox checked={selectedContactIds.includes(c.id)} onChange={() => {}} />
                                  </span>
                                  {c.name}
                                </div>
                              ))
                          )}
                        </div>
                        <div
                          onClick={() => setAddingContact(true)}
                          style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: SHEET.BLUE, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }}
                        >
                          + Add New Contact
                        </div>
                      </>
                    )}
                  </div>
                </AnchoredPopover>
              </div>
              <p style={sheetHint}>People of this customer organization who took part. Add a new contact here if they are not saved yet.</p>
            </SheetSection>

            <SheetSection icon="clip" title="Photos" extra={<Optional />}>
              <div data-tour="activity-attachment" style={{ display: 'flex', gap: 8 }}>
                {showCamera && <CameraCapture onCapture={(file) => stagePhotos([file])} onClose={() => setShowCamera(false)} />}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { stagePhotos(e.target.files); e.target.value = '' }} />
                <button type="button" onClick={() => setShowCamera(true)} aria-label="Take photo" title="Take photo" style={sheetBtn('secondary', SHEET.INK)}>
                  📷 Take Photo
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} style={sheetBtn('secondary', SHEET.INK)}>
                  <SheetIcon name="plus" size={15} />Add Photo
                </button>
              </div>
              {(!!existingAttachments?.length || stagedPhotos.length > 0) && (
                <div style={{ marginTop: 12 }}>
                  <PhotoThumbnails
                    activityId={initial?.id}
                    stagedPhotos={stagedPhotos}
                    onRemoveStaged={(i) => setStagedPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    existingAttachments={existingAttachments}
                    onDeleteExisting={(id) => setConfirmDeletePhotoId(id)}
                    deletingAttachmentId={deletingAttachmentId}
                  />
                </div>
              )}
              <ConfirmDialog
                open={confirmDeletePhotoId != null}
                title="Delete Photo"
                message="Delete this photo? This cannot be undone."
                confirmLabel="Delete"
                onConfirm={() => { const id = confirmDeletePhotoId; setConfirmDeletePhotoId(null); if (id != null) deleteExistingPhoto(id) }}
                onCancel={() => setConfirmDeletePhotoId(null)}
              />
            </SheetSection>
          </>}
        />
      </form>
    </FormSheet>
  )
}

function PhotoThumbnails({
  activityId,
  stagedPhotos,
  onRemoveStaged,
  existingAttachments,
  onDeleteExisting,
  deletingAttachmentId,
}: {
  activityId: number | undefined
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
              <ActivityPhotoThumb activityId={activityId} attachment={a} />
              {/* ui-audit-ignore-next-line custom-button — 18px round remove badge overlaid on an attachment thumbnail, not a pill */}
              <button
                type="button"
                onClick={() => onDeleteExisting(a.id)}
                disabled={deletingAttachmentId === a.id}
                aria-label={`Delete ${a.filename}`}
                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
              ><XIcon size={9} /></button>
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
              {/* ui-audit-ignore-next-line custom-button — 18px round remove badge overlaid on an attachment thumbnail, not a pill */}
              <button
                type="button"
                onClick={() => onRemoveStaged(i)}
                aria-label={`Remove ${f.name}`}
                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
              ><XIcon size={9} /></button>
            </div>
          ))}
        </div>
      )}

    </>
  )
}

function ActivityPhotoThumb({ activityId, attachment }: { activityId: number | undefined; attachment: { id: number; filename: string } }) {
  const fetchBlob = useMemo(
    () => (activityId ? () => crmApi.getActivityAttachmentBlob(activityId, attachment.id) : null),
    [activityId, attachment.id]
  )
  const src = useAttachmentBlobUrl(fetchBlob)
  return (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); if (fetchBlob) openAttachmentBlob(fetchBlob) }}
      style={{ display: 'block', width: 56, height: 56 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={attachment.filename} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />}
    </a>
  )
}
