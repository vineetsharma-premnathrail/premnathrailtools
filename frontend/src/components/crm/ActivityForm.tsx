'use client'

import { useEffect, useRef, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmActivity, MomItem, Organization, OrgContact } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'
import { ACTIVITY_TYPES, RELATED_MODULES } from './constants'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'
import NumberedTextarea from './NumberedTextarea'

type FormState = {
  org_id: string
  related_module: string
  universal_id: string
  activity_type: string
  status: string
  activity_date: string
  next_followup: string
  assigned_to: string
  remarks: string
  action_plan: string
}

const NUMBERED_LINE = /^\d+\.\s(.*)$/

// Splits a Word-style numbered-list textarea value ("1. foo\n2. bar") into
// individual points. Falls back to the whole text as a single point when no
// numbering was used, so plain single-line activities still work as before.
function parseNumberedPoints(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const numbered = lines.map((l) => l.match(NUMBERED_LINE)?.[1]).filter((v): v is string => !!v)
  if (numbered.length) return numbered
  return text.trim() ? [text.trim()] : []
}

// Reconstructs a numbered-list textarea value from saved mom_items, so
// re-opening an activity for edit shows the same "1. .. 2. .." text back.
function momItemsToNumberedText(items: MomItem[] | undefined, field: keyof MomItem): string {
  if (!items?.length) return ''
  const values = items.map((it) => it[field] || '')
  if (values.every((v) => !v)) return ''
  return values.map((v, i) => `${i + 1}. ${v}`).join('\n')
}

function toFormState(initial?: Partial<CrmActivity>, defaultOrgId?: number): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '',
    related_module: initial?.related_module || '',
    universal_id: initial?.universal_id || '',
    activity_type: initial?.activity_type || ACTIVITY_TYPES[0],
    status: initial?.status || 'Open',
    activity_date: initial?.activity_date || '',
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
  const [form, setForm] = useState<FormState>(() => toFormState(initial, defaultOrgId))
  const [stagedPhotos, setStagedPhotos] = useState<File[]>([])
  const [existingAttachments, setExistingAttachments] = useState<CrmActivity['attachments']>(initial?.attachments || [])
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null)
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>(() => {
    if (initial?.contact_ids?.length) return initial.contact_ids
    return initial?.org_contact_id ? [initial.org_contact_id] : []
  })
  const [addingContact, setAddingContact] = useState(false)
  const [activityTypeOptions, setActivityTypeOptions] = useState<string[]>(() => {
    const base = ACTIVITY_TYPES.filter((t) => t !== 'Other')
    return initial?.activity_type && !base.includes(initial.activity_type) ? [...base, initial.activity_type] : base
  })
  const [addingActivityType, setAddingActivityType] = useState(false)
  const [customActivityType, setCustomActivityType] = useState('')
  const [responsibilityText, setResponsibilityText] = useState(() => momItemsToNumberedText(initial?.mom_items, 'responsibility'))
  const [targetDateText, setTargetDateText] = useState(() => momItemsToNumberedText(initial?.mom_items, 'target_date'))
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [relatedOptions, setRelatedOptions] = useState<{ value: string; label: string }[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', department: '', mobile: '', email: '' })
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

  // Once an org + a linkable related module (Inquiry/Tender) is picked, offer
  // that org's records so Universal ID is chosen from a list instead of typed
  // by hand — free typing was error-prone since it has to exactly match the
  // record's universal_id to actually link.
  useEffect(() => {
    if (!form.org_id || (form.related_module !== 'inquiry' && form.related_module !== 'tender')) {
      setRelatedOptions([])
      return
    }
    const orgId = Number(form.org_id)
    const load = form.related_module === 'inquiry'
      ? crmApi.listInquiries({ org_id: orgId })
      : crmApi.listTenders({ org_id: orgId })
    load.then((records: any[]) => {
      setRelatedOptions(
        records.map((r) => ({
          value: r.universal_id,
          label: `${r.universal_id} — ${form.related_module === 'inquiry' ? (r.product || r.requirement_desc || 'Untitled') : (r.tender_name || r.tender_number || 'Untitled')}`,
        }))
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.org_id, form.related_module])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const toggleContact = (id: number) =>
    setSelectedContactIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const handleActivityTypeChange = (value: string) => {
    if (value === '__add__') {
      setAddingActivityType(true)
      setCustomActivityType('')
      return
    }
    set('activity_type', value)
  }

  const confirmCustomActivityType = () => {
    const trimmed = customActivityType.trim()
    if (!trimmed) {
      setAddingActivityType(false)
      return
    }
    setActivityTypeOptions((opts) => (opts.includes(trimmed) ? opts : [...opts, trimmed]))
    set('activity_type', trimmed)
    setAddingActivityType(false)
    setCustomActivityType('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (addingContact && !form.org_id) {
      setError('Please select an organization before adding a new contact.')
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
      if (addingContact) {
        const nameLower = newContact.name.trim().toLowerCase()
        const existing = contacts.find((c) => c.name.trim().toLowerCase() === nameLower)
        if (existing) {
          if (!contactIds.includes(existing.id)) contactIds.push(existing.id)
        } else {
          const created = await crmApi.createOrgContact(Number(form.org_id), {
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

      // Numbered points in Observation/Action Plan/Responsibility/Target Date
      // expand this one activity into multiple MOM rows automatically;
      // single-point text stays a single row (handled by the legacy
      // remarks/action_plan fallback server-side), so we only send
      // mom_items when there's real numbering.
      const obsPoints = parseNumberedPoints(form.remarks)
      const planPoints = parseNumberedPoints(form.action_plan)
      const responsibilityPoints = parseNumberedPoints(responsibilityText)
      const targetDatePoints = parseNumberedPoints(targetDateText)
      const rowCount = Math.max(obsPoints.length, planPoints.length, responsibilityPoints.length, targetDatePoints.length)
      const cleanMomItems = rowCount > 1
        ? Array.from({ length: rowCount }, (_, i) => ({
            observation: obsPoints[i] || undefined,
            action_plan: planPoints[i] || undefined,
            responsibility: responsibilityPoints[i] || form.assigned_to || undefined,
            target_date: targetDatePoints[i] || form.next_followup || undefined,
          }))
        : []

      const payload: Record<string, unknown> = {
        ...form,
        org_id: form.org_id ? Number(form.org_id) : undefined,
        org_contact_id: orgContactId,
        contact_ids: contactIds.length ? contactIds : undefined,
        mom_items: cleanMomItems.length ? cleanMomItems : undefined,
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

  const stagePhotos = (files: FileList | null) => {
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

      <Section title="Activity Details">
        <Field label="Organization">
          <SearchableSelect
            value={form.org_id}
            onChange={(v) => set('org_id', v)}
            options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
            placeholder="Type to search organization…"
          />
        </Field>
        <Field label="Contact Person(s)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {contacts.length === 0 && <span style={{ fontSize: 12.5, color: '#a8a29e' }}>Select an organization first.</span>}
            {contacts.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: selectedContactIds.includes(c.id) ? 'rgba(244,113,59,0.1)' : '#f9fafb', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedContactIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
                {c.name}
              </label>
            ))}
            <button type="button" onClick={() => setAddingContact((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: addingContact ? 'rgba(244,113,59,0.1)' : '#fff', color: '#78716c', cursor: 'pointer' }}>
              + Add New Contact
            </button>
          </div>
        </Field>
        <Row>
          <Field label="Related Module">
            <select
              value={form.related_module}
              onChange={(e) => setForm((f) => ({ ...f, related_module: e.target.value, universal_id: '' }))}
              style={inputStyle}
            >
              {RELATED_MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        </Row>

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
          <Field label={form.related_module === 'inquiry' ? 'Inquiry' : form.related_module === 'tender' ? 'Tender' : 'Universal ID'}>
            {form.related_module === 'inquiry' || form.related_module === 'tender' ? (
              <SearchableSelect
                value={form.universal_id}
                onChange={(v) => set('universal_id', v)}
                options={relatedOptions}
                placeholder={form.org_id ? `Select ${form.related_module}…` : 'Select an organization first…'}
              />
            ) : (
              <input value={form.universal_id} onChange={(e) => set('universal_id', e.target.value)} placeholder="e.g. INQ-2024-001" style={inputStyle} />
            )}
          </Field>
          <Field label="Activity Type">
            {addingActivityType ? (
              <input
                autoFocus
                value={customActivityType}
                onChange={(e) => setCustomActivityType(e.target.value)}
                onBlur={confirmCustomActivityType}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCustomActivityType() } }}
                placeholder="Type new activity type…"
                style={inputStyle}
              />
            ) : (
              <select value={form.activity_type} onChange={(e) => handleActivityTypeChange(e.target.value)} style={inputStyle}>
                {activityTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="__add__">+ Add New…</option>
              </select>
            )}
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
          <Field label="Activity Date"><DateField value={form.activity_date} onChange={(v) => set('activity_date', v)} /></Field>
        </Row>
        <Row>
          <Field label="Next Follow-up Date"><DateField value={form.next_followup} onChange={(v) => set('next_followup', v)} /></Field>
          <Field label="Assigned To"><input value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Assignee name" style={inputStyle} /></Field>
        </Row>
        <Field label="Observation / Remarks">
          <NumberedTextarea value={form.remarks} onChange={(v) => set('remarks', v)} rows={4} placeholder="What was discussed or observed — click 1.2.3. to list multiple points" />
        </Field>
        <Field label="Action Plan">
          <NumberedTextarea value={form.action_plan} onChange={(v) => set('action_plan', v)} rows={4} placeholder="What needs to be done next — click 1.2.3. to list multiple points" />
        </Field>
        <Row>
          <Field label="Responsibility (per row)">
            <NumberedTextarea value={responsibilityText} onChange={setResponsibilityText} rows={4} placeholder="Who owns each point — click 1.2.3., defaults to Assigned To if left blank" />
          </Field>
          <Field label="Target Date (per row)">
            <NumberedTextarea value={targetDateText} onChange={setTargetDateText} rows={4} placeholder="Target date for each point — click 1.2.3., defaults to Next Follow-up if left blank" />
          </Field>
        </Row>
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
  onStage: (files: FileList | null) => void
  onRemoveStaged: (index: number) => void
  existingAttachments: CrmActivity['attachments']
  onDeleteExisting: (attachmentId: number) => void
  deletingAttachmentId: number | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const previews = stagedPhotos.map((f) => URL.createObjectURL(f))
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  return (
    <Section title="Photos">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div
          onClick={() => cameraRef.current?.click()}
          style={{ flex: '1 1 160px', padding: '14px 12px', borderRadius: 10, border: '2px dashed rgba(0,0,0,0.15)', background: '#faf9f7', textAlign: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onStage(e.target.files); e.target.value = '' }} />
          <span style={{ fontSize: 16 }}>📷</span>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1108', margin: 0 }}>Take photo</p>
        </div>
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onStage(e.dataTransfer.files) }}
          style={{ flex: '2 1 220px', padding: '14px 12px', borderRadius: 10, border: `2px dashed ${dragOver ? '#fa9b9b' : 'rgba(0,0,0,0.15)'}`, background: dragOver ? 'rgba(244,113,59,0.05)' : '#faf9f7', textAlign: 'center', cursor: 'pointer' }}
        >
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onStage(e.target.files); e.target.value = '' }} />
          <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1108', margin: 0 }}>Drag &amp; drop photos, or click to browse (JPG/PNG)</p>
        </div>
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
