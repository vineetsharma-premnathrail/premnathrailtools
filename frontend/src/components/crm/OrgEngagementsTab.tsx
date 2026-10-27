'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmEngagement, OrganizationDetail } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { primaryBtnStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { RowCount, Pill } from '@/components/shared/ui'

// CRM › Customer Organizations › Engagements (2026-10-27): meetings, calls, visits and
// discussions with a contact of the organization, their outcome and the next follow-up.

const TYPES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'visit', label: 'Visit' },
  { value: 'general_discussion', label: 'General Discussion' },
]
const OUTCOMES = [
  { value: 'no_requirement', label: 'No Requirement' },
  { value: 'future_requirement', label: 'Future Requirement' },
  { value: 'feedback_received', label: 'Feedback Received' },
  { value: 'inquiry_required', label: 'Inquiry Required' },
]
const OUTCOME_HEX: Record<string, string> = {
  no_requirement: '#78716c', future_requirement: '#2563eb', feedback_received: '#7c3aed', inquiry_required: '#16a34a',
}

const today = () => new Date().toLocaleDateString('en-CA') // local date, not UTC
const emptyForm = () => ({ org_contact_id: '', engagement_date: today(), engagement_type: '', summary: '', outcome: '', next_followup_date: '' })

export default function OrgEngagementsTab({ org, canCreate, canEditOwn, canDeleteOwn }: {
  org: OrganizationDetail
  canCreate: boolean
  canEditOwn: boolean
  canDeleteOwn: boolean
}) {
  const [rows, setRows] = useState<CrmEngagement[] | null>(null)
  const [loadError, setLoadError] = useState<string | string[]>('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CrmEngagement | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [deleting, setDeleting] = useState<CrmEngagement | null>(null)

  const load = () => crmApi.listEngagements(org.id)
    .then((r) => { setRows(r); setLoadError('') })
    .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the engagements. Refresh the page; if it persists, check your connection.')))
  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id])

  const set = (k: keyof ReturnType<typeof emptyForm>, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const openNew = () => { setEditing(null); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (e: CrmEngagement) => {
    setEditing(e)
    setForm({ org_contact_id: String(e.org_contact_id), engagement_date: e.engagement_date, engagement_type: e.engagement_type, summary: e.summary,
      outcome: e.outcome, next_followup_date: e.next_followup_date || '' })
    setError('')
    setOpen(true)
  }

  const save = async () => {
    const missing: string[] = []
    if (!form.org_contact_id) missing.push('Pick the contact person you spoke to.')
    if (!form.engagement_date) missing.push('Engagement date is required.')
    if (!form.engagement_type) missing.push('Pick the engagement type.')
    if (!form.summary.trim()) missing.push('Write the discussion summary.')
    if (!form.outcome) missing.push('Pick the outcome.')
    if (form.next_followup_date && form.next_followup_date < form.engagement_date) missing.push('Next follow-up date is before the engagement date.')
    if (missing.length) { setError(missing); return }
    setSaving(true)
    setError('')
    const payload = { ...form, org_contact_id: Number(form.org_contact_id), summary: form.summary.trim(), next_followup_date: form.next_followup_date || null }
    try {
      if (editing) await crmApi.updateEngagement(editing.id, payload)
      else await crmApi.createEngagement(org.id, payload)
      setOpen(false)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the engagement.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await crmApi.deleteEngagement(deleting.id)
      setDeleting(null)
      load()
    } catch (err) {
      setDeleting(null)
      setLoadError(extractErrorMessages(err, 'Could not delete the engagement.'))
    }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fffaf5', zIndex: 1 }
  const td: React.CSSProperties = { padding: '10px 16px', color: '#57534e', verticalAlign: 'top' }
  const linkBtn: React.CSSProperties = { border: 'none', background: 'none', padding: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const noContacts = org.contacts.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canCreate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={openNew} disabled={noContacts} data-tour="orgdetail-add-engagement-btn" style={{ ...primaryBtnStyle, opacity: noContacts ? 0.6 : 1 }}>+ Add Engagement</button>
          {noContacts && <span style={{ fontSize: 12.5, color: '#78716c' }}>Add a contact person on the Contacts tab first — an engagement is with a person.</span>}
        </div>
      )}
      <SheetError error={loadError} />

      {rows === null ? <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p> : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No engagements logged with this customer organization yet{canCreate ? ' — use + Add Engagement after a meeting, call or visit.' : '.'}</p>
      ) : (
        <div data-tour="orgdetail-engagements-table" style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ background: '#fffaf5' }}>
                  {['Date', 'Type', 'Contact', 'Discussion Summary', 'Outcome', 'Next Follow-up', 'Logged by', ''].map((h, hi) => (
                    <th key={hi} style={th}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const due = e.next_followup_date && e.next_followup_date <= today()
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: '#1f1108', fontWeight: 600 }}>{formatDate(e.engagement_date)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{e.engagement_type_label}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{e.contact_name || '—'}</td>
                      <td style={{ ...td, minWidth: 240, whiteSpace: 'pre-wrap', color: '#1f1108' }}>{e.summary}</td>
                      <td style={td}><Pill label={e.outcome_label} hex={OUTCOME_HEX[e.outcome] || '#78716c'} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: due ? '#c2410c' : '#57534e', fontWeight: due ? 600 : 400 }}>
                        {e.next_followup_date ? formatDate(e.next_followup_date) : '—'}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{e.created_by_name || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {e.can_edit && canEditOwn && <button type="button" onClick={() => openEdit(e)} style={{ ...linkBtn, color: '#2563eb', marginRight: 12 }}>Edit</button>}
                        {e.can_edit && canDeleteOwn && <button type="button" onClick={() => setDeleting(e)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <FormSheet tour="orgdetail-engagement-form" width={640} icon={editing ? 'edit' : 'chat'} title={editing ? 'Edit Engagement' : 'Add Customer Engagement'}
          subtitle={`Meeting, call, visit or discussion with ${org.name}.`} onClose={() => setOpen(false)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={save} disabled={saving} data-tour="orgdetail-engagement-save" style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name={editing ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Engagement'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="user" title="With whom and when">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 260px' }} data-tour="orgdetail-engagement-contact">
                  <label style={sheetLabel}>Contact person <Req /></label>
                  <SearchableSelect value={form.org_contact_id} onChange={(v) => set('org_contact_id', v)} ariaLabel="Contact person"
                    options={org.contacts.map((c) => ({ value: String(c.id), label: `${c.name}${c.designation ? ` — ${c.designation}` : ''}` }))}
                    placeholder="Pick the person you spoke to" />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 160 }} data-tour="orgdetail-engagement-date">
                  <label style={sheetLabel}>Engagement date <Req /></label>
                  <DateField value={form.engagement_date} onChange={(v) => set('engagement_date', v)} />
                </div>
                <div style={{ flex: '0 1 210px', minWidth: 190 }} data-tour="orgdetail-engagement-type">
                  <label style={sheetLabel}>Engagement type <Req /></label>
                  <SearchableSelect value={form.engagement_type} onChange={(v) => set('engagement_type', v)} options={TYPES} placeholder="Meeting, call, visit…" ariaLabel="Engagement type" />
                </div>
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="What was discussed">
              <div data-tour="orgdetail-engagement-summary">
                <label style={sheetLabel}>Discussion summary <Req /></label>
                <textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }}
                  placeholder="Notes about the conversation — what the customer said, plans, concerns" />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }} data-tour="orgdetail-engagement-outcome">
                  <label style={sheetLabel}>Outcome <Req /></label>
                  <SearchableSelect value={form.outcome} onChange={(v) => set('outcome', v)} options={OUTCOMES} placeholder="Pick the outcome" ariaLabel="Outcome" />
                </div>
                <div style={{ flex: '0 1 190px', minWidth: 170 }} data-tour="orgdetail-engagement-followup">
                  <label style={sheetLabel}>Next follow-up date <Optional /></label>
                  <DateField value={form.next_followup_date} onChange={(v) => set('next_followup_date', v)} placeholder="Not planned" />
                </div>
              </div>
              {form.outcome === 'inquiry_required' && (
                <p style={sheetHint}>Inquiry required — after saving, raise it from the Inquiries tab of this organization.</p>
              )}
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog open={!!deleting} title="Delete this engagement?"
        message={deleting ? `The ${deleting.engagement_type_label.toLowerCase()} of ${formatDate(deleting.engagement_date)} with ${deleting.contact_name || 'the contact'} will be removed.` : ''}
        confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  )
}
