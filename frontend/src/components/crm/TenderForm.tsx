'use client'

import Select from '@/components/shared/Select'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useCan } from '@/lib/permissions'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { crmApi } from '@/lib/api'
import { Tender, Organization, OrgContact } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import PhoneField from '@/components/erp/PhoneField'
import { normalizePriority } from '@/lib/priority'
import { RAILWAY_ZONES, TENDER_PORTALS, TENDER_TYPES, CURRENCIES, TENDER_STATUSES, priorityOptions, priorityLabel } from './constants'
import { handleEnterAsTab } from './ui'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
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
  tender_number: string
  tender_name: string
  tender_authority: string
  tender_portal: string
  tender_type: string
  tender_category: string
  tender_value: string
  currency: string
  status: string
  current_status_note: string
  tender_details: string
  tender_date: string
  lead_source: string
  priority: string
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
  closing_date: string
  closing_time: string
  participate: string
  decision_by: string
  decision_date: string
  reason_no_participate: string
  awarded_to: string
  loi_number: string
  contract_value: string
  loss_reason: string
}

/** Today as YYYY-MM-DD in local time (DateField's value format). */
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Still awaited / cancelled = nothing more to fill; any other status means the tender is
// published, so its number, name, publish date and closing date & time are required
// (owner, 2026-10-29; the server checks the same).
const NO_DETAILS_STATUSES = ['Waiting for Future Tender', 'Tender Cancelled']

function toFormState(initial?: Tender, defaultOrgId?: number): FormState {
  return {
    org_id: initial?.org_id ? String(initial.org_id) : defaultOrgId ? String(defaultOrgId) : '',
    org_contact_id: initial?.org_contact_id ? String(initial.org_contact_id) : '',
    tender_number: initial?.tender_number || '',
    tender_name: initial?.tender_name || '',
    tender_authority: initial?.tender_authority || '',
    tender_portal: initial?.tender_portal && !TENDER_PORTALS.includes(initial.tender_portal) ? 'Other' : initial?.tender_portal || '',
    tender_type: initial?.tender_type || '',
    tender_category: initial?.tender_category || '',
    tender_value: initial?.tender_value != null ? String(initial.tender_value) : '',
    currency: initial?.currency || 'INR',
    status: initial?.status || 'Waiting for Future Tender',
    current_status_note: initial?.current_status_note || '',
    tender_details: initial?.tender_details || '',
    // Document date: when the tender was taken up. Older records fall back to the day they were entered.
    tender_date: initial?.tender_date || (initial?.created_at ? initial.created_at.slice(0, 10) : todayISO()),
    // Not asked on the form any more; an existing value is kept as it is.
    lead_source: initial?.lead_source || '',
    priority: normalizePriority(initial?.priority),
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
    // closing_at is wall-clock "YYYY-MM-DDTHH:MM[:SS]" — split for the date and time pickers.
    closing_date: initial?.closing_at ? initial.closing_at.slice(0, 10) : '',
    closing_time: initial?.closing_at ? initial.closing_at.slice(11, 16) : '00:00', // default 12:00 AM
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
  title,
  subtitle,
  nav,
  onBack,
}: {
  initial?: Tender
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
  const orgLocked = !!defaultOrgId
  const [form, setForm] = useState<FormState>(() => toFormState(initial, defaultOrgId))
  const [railwayZoneCustom] = useState(
    initial?.railway_zone && !RAILWAY_ZONES.includes(initial.railway_zone) ? initial.railway_zone : ''
  )
  const [tenderPortalCustom, setTenderPortalCustom] = useState(
    initial?.tender_portal && !TENDER_PORTALS.includes(initial.tender_portal) ? initial.tender_portal : ''
  )
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [newContact, setNewContact] = useState({ name: '', designation: '', mobile: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [previewNumber, setPreviewNumber] = useState('')
  const errorRef = useRef<HTMLDivElement>(null)
  // The banner sits at the top of a long form — bring it into view when it appears.
  useEffect(() => { if (error && (!Array.isArray(error) || error.length)) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))
  // A new tender's typed data survives a refresh / network failure (lib/formDraft.ts).
  const draft = useFormDraft(initial ? null : 'crm-tender-new', { form, tenderPortalCustom, newContact },
    (d) => { setForm(d.form); setTenderPortalCustom(d.tenderPortalCustom || ''); if (d.newContact) setNewContact(d.newContact) })

  useEffect(() => { crmApi.listOrganizations({ picker: true }).then(setOrganizations) }, [])

  useEffect(() => {
    if (initial) return
    crmApi.listTenders().then((all: Tender[]) => {
      const today = new Date()
      const y = today.getFullYear()
      const m = String(today.getMonth() + 1).padStart(2, '0')
      const d = String(today.getDate()).padStart(2, '0')
      const seq = String(all.length + 1).padStart(4, '0')
      setPreviewNumber(`TND-${y}${m}${d}-${seq}`)
    }).catch(() => {})
  }, [initial])

  useEffect(() => {
    if (!form.org_id) {
      // Deferred so the effect itself sets no state.
      Promise.resolve().then(() => setContacts([]))
      return
    }
    const orgId = Number(form.org_id)
    crmApi.listOrgContacts(orgId).then(setContacts)
    // Fetched regardless of `initial` (not just on create) so a locked/pre-selected
    // organization (defaultOrgId) always resolves to its name in the SearchableSelect,
    // even before the full organizations list has finished loading.
    crmApi.getOrganization(orgId).then((org: Organization) => {
      setOrganizations((list) => (list.some((o) => o.id === org.id) ? list : [org, ...list]))
      if (!initial) {
        if (org.railway_zone) set('railway_zone', org.railway_zone)
        if (org.division_workshop) set('division', org.division_workshop)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.org_id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.org_id) {
      setError('Please select a customer organization.')
      return
    }
    if (!NO_DETAILS_STATUSES.includes(form.status)) {
      const missing = [
        !form.tender_number.trim() && 'Tender Number',
        !form.tender_name.trim() && 'Tender Name',
        !form.publish_date && 'Publish Date',
        !form.closing_date && 'Tender Closing Date',
      ].filter(Boolean)
      if (missing.length) {
        setError(`A tender with status "${form.status}" needs ${missing.join(', ')}. Fill these in, or set the status to "Waiting for Future Tender" until the tender is published.`)
        return
      }
    }
    if (!form.tender_date) {
      setError('Please pick the Created Date — the day this tender was taken up.')
      return
    }
    if (form.tender_date > todayISO()) {
      setError('Created Date cannot be in the future. Pick the day the tender was actually taken up (today or earlier).')
      return
    }
    if (!form.priority) {
      setError('Please select a Priority (Standard or Urgent).')
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

      const { closing_date, closing_time, ...rest } = form
      const payload: Record<string, unknown> = {
        ...rest,
        // No time given = 12:00 AM of that day.
        closing_at: closing_date ? `${closing_date}T${closing_time || '00:00'}:00` : (initial?.closing_at ? null : undefined),
        org_id: Number(form.org_id),
        org_contact_id: orgContactId,
        // BD owner = whoever logs the tender, set by the server; never sent from the form.
        bd_owner: undefined,
        tender_value: form.tender_value ? Number(form.tender_value) : undefined,
        railway_zone: form.railway_zone === 'Other' ? railwayZoneCustom : form.railway_zone,
        tender_portal: form.tender_portal === 'Other' ? tenderPortalCustom : form.tender_portal,
        participate: form.participate === '' ? undefined : form.participate === 'yes',
        contract_value: form.contract_value ? Number(form.contract_value) : undefined,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k]
      })
      await onSubmit(payload)
      draft.clear()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save tender.'))
    } finally {
      setSaving(false)
    }
  }

  const needDetails = !NO_DETAILS_STATUSES.includes(form.status)
  const formId = initial ? `tender-form-${initial.id}` : 'tender-form-new'
  const hasError = !!error && (!Array.isArray(error) || error.length > 0)
  return (
    <FormPage nav={nav} onBack={onBack} backTour="tnd-form-back-btn" tour="tnd-form" icon={initial ? 'edit' : 'flag'}
      title={title || (initial ? `Edit Tender ${initial.universal_id || ''}`.trim() : 'New Tender')}
      subtitle={subtitle || (initial ? 'Change the tender — the change is recorded in its timeline.' : 'A published tender we may bid for: who floated it, its number and its key dates.')}
      footer={<>
        <button type="button" onClick={onCancel} disabled={saving} data-tour="tnd-cancel-btn" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="submit" form={formId} data-tour="tnd-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
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
      <div ref={errorRef} style={{ padding: hasError ? '16px 24px 0' : 0 }}><SheetError error={error} /></div>
      {draft.restored && <div style={{ padding: '16px 24px 0' }}><DraftBanner draft={draft} style={{ marginBottom: 0 }} /></div>}

      <SheetColumns
        left={<>
          <SheetSection icon="doc" title="Tender Information">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 160px', minWidth: 140, maxWidth: 220 }}>
                <F label={<>Tender Number {needDetails && <Req />}</>} tourId="tnd-number"><input value={form.tender_number} onChange={(e) => set('tender_number', e.target.value)} style={inputStyle} /></F>
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 160, maxWidth: 320 }}>
                <F label={<>Tender Name {needDetails && <Req />}</>} tourId="tnd-name"><input value={form.tender_name} onChange={(e) => set('tender_name', e.target.value)} style={inputStyle} /></F>
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 140, maxWidth: 240 }}>
                <F label="Tender Authority" tourId="tnd-authority"><input value={form.tender_authority} onChange={(e) => set('tender_authority', e.target.value)} style={inputStyle} /></F>
              </div>
              <div style={{ flex: '0 1 160px', minWidth: 130 }}>
                <F label="Tender Portal" tourId="tnd-portal">
                  <Select value={form.tender_portal} onChange={(e) => set('tender_portal', e.target.value)} style={inputStyle}>
                    <option value="">-- Select Portal --</option>
                    {TENDER_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                  {form.tender_portal === 'Other' && (
                    <input value={tenderPortalCustom} onChange={(e) => setTenderPortalCustom(e.target.value)} placeholder="Specify portal" style={{ ...inputStyle, marginTop: 8 }} />
                  )}
                </F>
              </div>
              <div style={{ flex: '0 1 150px', minWidth: 120 }}>
                <F label="Tender Type" tourId="tnd-type">
                  <Select value={form.tender_type} onChange={(e) => set('tender_type', e.target.value)} style={inputStyle}>
                    <option value="">-- Select Type --</option>
                    {TENDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </F>
              </div>
              {seePrices && <div style={{ flex: '0 1 130px', minWidth: 100 }}>
                <F label="Tender Value" tourId="tnd-value"><input type="number" value={form.tender_value} onChange={(e) => set('tender_value', e.target.value)} style={inputStyle} /></F>
              </div>}
              <div style={{ flex: '0 1 100px', minWidth: 80 }}>
                <F label="Currency" tourId="tnd-currency">
                  <Select value={form.currency} onChange={(e) => set('currency', e.target.value)} style={inputStyle}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </F>
              </div>
              <div style={{ flex: '0 1 170px', minWidth: 140 }}>
                <F label="Status" tourId="tnd-status">
                  <Select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                    {TENDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </F>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <F label="Tender Details" tourId="tnd-details">
                <textarea value={form.tender_details} onChange={(e) => set('tender_details', e.target.value)} rows={3} placeholder="e.g. Supply of 2 rail grinding machines with 2 years AMC; eligibility: 3 similar supplies in last 5 years" style={{ ...inputStyle, resize: 'vertical' }} />
              </F>
            </div>
            <div style={{ marginTop: 14 }}>
              <F label="Current Status" tourId="tnd-current-status-note">
                <textarea value={form.current_status_note} onChange={(e) => set('current_status_note', e.target.value)} rows={2} placeholder="e.g. Waiting for client confirmation" style={{ ...inputStyle, resize: 'vertical' }} />
              </F>
            </div>
          </SheetSection>

          <SheetSection icon="calendar" title="Key Dates">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 165px', minWidth: 150 }}>
                <F label={<>Publish Date {needDetails && <Req />}</>} tourId="tnd-publish-date"><DateField value={form.publish_date} onChange={(v) => set('publish_date', v)} /></F>
              </div>
              <div style={{ flex: '0 1 190px', minWidth: 170 }}>
                <F label="Document Download Date" tourId="tnd-doc-download-date"><DateField value={form.doc_download_date} onChange={(v) => set('doc_download_date', v)} /></F>
              </div>
              <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                <F label="Submission Date" tourId="tnd-submission-date"><DateField value={form.submission_date} onChange={(v) => set('submission_date', v)} /></F>
              </div>
              <div style={{ flex: '0 1 300px', minWidth: 290 }}>
                <F label={<>Tender Closing Date & Time {needDetails && <Req />}</>} tourId="tnd-closing">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: '1 1 150px' }}><DateField value={form.closing_date} onChange={(v) => set('closing_date', v)} /></div>
                    <input type="time" aria-label="Tender closing time" value={form.closing_time} onChange={(e) => set('closing_time', e.target.value)} style={{ ...inputStyle, flex: '0 0 130px', width: 130, minWidth: 130 }} />
                  </div>
                </F>
              </div>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title="Basic Information">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 140px' }}>
                <F label="Internal Tender ID">
                  <input value={initial?.universal_id || previewNumber || 'Auto-generated on save'} disabled style={{ ...inputStyle, background: '#eff6ff', color: SHEET.BLUE, fontWeight: 600 }} />
                </F>
              </div>
              <div style={{ flex: '1 1 150px', minWidth: 150 }}>
                <F label={<>Created Date <Req /></>} tourId="tnd-date">
                  <DateField value={form.tender_date} onChange={(v) => set('tender_date', v)} />
                </F>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <F label={<>Priority <Req /></>} tourId="tnd-priority">
                  <Select value={form.priority} onChange={(e) => set('priority', e.target.value)} style={inputStyle}>
                    {priorityOptions(initial?.priority).map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                  </Select>
                </F>
              </div>
            </div>
          </SheetSection>

          <SheetSection icon="building" title="Customer Organization & Contact">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <F label={<>Customer Organization <Req /></>} tourId="tnd-org">
                <SearchableSelect
                  value={form.org_id}
                  onChange={(v) => set('org_id', v)}
                  options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
                  placeholder="Search existing customer organization…"
                  disabled={orgLocked}
                />
              </F>
              <F label={<>Contact Person <Optional /></>} tourId="tnd-contact">
                <Select value={form.org_contact_id} onChange={(e) => set('org_contact_id', e.target.value)} disabled={!form.org_id} style={inputStyle}>
                  <option value="">-- Select Contact --</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ Add New Contact</option>
                </Select>
              </F>
              {form.org_contact_id === '__new__' && (
                <div style={{ padding: 14, borderRadius: 10, background: '#fff', border: `1px solid ${SHEET.LINE}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <F label={<>Name <Req /></>}><input value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} placeholder="Rajesh Kumar" style={inputStyle} /></F>
                  <F label="Designation"><input value={newContact.designation} onChange={(e) => setNewContact((c) => ({ ...c, designation: e.target.value }))} placeholder="Purchase Head / DGM" style={inputStyle} /></F>
                  <F label="Mobile"><PhoneField value={newContact.mobile} onChange={(v) => setNewContact((c) => ({ ...c, mobile: v }))} style={inputStyle} /></F>
                  <F label="Email"><ValidatedInput type="email" value={newContact.email} onChange={(v) => setNewContact((c) => ({ ...c, email: v }))} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="email@company.com" style={inputStyle} /></F>
                  <p style={{ fontSize: 12, color: SHEET.MUTED, margin: 0 }}>Saved to the customer organization together with the tender.</p>
                </div>
              )}
            </div>
          </SheetSection>
        </>}
      />
    </form>
    </FormPage>
  )
}
