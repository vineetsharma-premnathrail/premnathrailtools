'use client'

import { useEffect, useState } from 'react'
import { crmApi, usersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { CrmActivity, OrgContact, DirectoryUser } from '@/types'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import Checkbox from '@/components/Checkbox'
import { BRAND, TEXT } from '@/lib/theme'

function ChipMultiSelect<T extends { id: number; label: string }>({
  options, selected, onToggle, emptyLabel,
}: { options: T[]; selected: number[]; onToggle: (id: number) => void; emptyLabel: string }) {
  if (options.length === 0) return <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>{emptyLabel}</p>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onToggle(o.id)}
          style={{
            fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${selected.includes(o.id) ? BRAND.primary : 'rgba(0,0,0,0.12)'}`,
            background: selected.includes(o.id) ? 'rgba(255,122,69,0.1)' : '#fff',
            color: selected.includes(o.id) ? BRAND.primary : '#57534e',
          }}
        >
          {selected.includes(o.id) ? '✓ ' : ''}{o.label}
        </button>
      ))}
    </div>
  )
}

/** Meeting-level MOM export — unlike the per-activity "Export MoM" one-click
 * button, this lets you pick a meeting subject/date, attendees on both sides,
 * and which of the logged follow-ups to fold into a single Word/PDF Minutes
 * of Meeting. Shared by Inquiry and Tender Activities tabs since both export
 * against the same `/mom-docx` + `/mom-pdf` shape (see MomExportRequest on
 * the backend) — only the org id, related module/id, and API call differ. */
type Props = {
  open: boolean
  onClose: () => void
  orgId: number | null | undefined
  orgName?: string | null
  activities: CrmActivity[]
  onExportDocx: (payload: Record<string, unknown>) => Promise<Blob>
  onExportPdf: (payload: Record<string, unknown>) => Promise<Blob>
}

// Mounted only while open, so every opening starts blank.
export default function MomExportDialog(props: Props) {
  if (!props.open) return null
  return <MomExportSheet {...props} />
}

function MomExportSheet({ onClose, orgId, orgName, activities, onExportDocx, onExportPdf }: Props) {
  const [subject, setSubject] = useState('')
  const [meetingDate, setMeetingDate] = useState(new Date().toLocaleDateString('en-CA')) // local date, not UTC
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [pewMemberIds, setPewMemberIds] = useState<number[]>([])
  const [clientContactIds, setClientContactIds] = useState<number[]>([])
  const [activityIds, setActivityIds] = useState<number[]>(() => activities.map((a) => a.id))
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (orgId) crmApi.listOrgContacts(orgId).then(setContacts).catch(() => setContacts([]))
    usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
  }, [orgId])

  const toggleActivity = (id: number) => setActivityIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const togglePewMember = (id: number) => setPewMemberIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleClientContact = (id: number) => setClientContactIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const download = async (kind: 'docx' | 'pdf') => {
    if (!subject.trim()) { setError('Enter the meeting subject — it is the title of the MOM document.'); return }
    setExporting(kind)
    setError('')
    try {
      const payload = {
        subject: subject.trim(),
        meeting_date: meetingDate,
        pew_member_ids: pewMemberIds,
        client_contact_ids: clientContactIds,
        activity_ids: activityIds,
      }
      const blob = kind === 'docx' ? await onExportDocx(payload) : await onExportPdf(payload)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const orgSlug = (orgName || 'Meeting').replace(/\s+/g, '_').replace(/\//g, '-')
      const dateSlug = meetingDate.replace(/-/g, '')
      link.download = `MOM_${orgSlug}_${dateSlug}.${kind === 'docx' ? 'docx' : 'pdf'}`
      link.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      setError(extractErrorMessages(err, `MOM ${kind === 'docx' ? 'Word' : 'PDF'} export failed.`).join(' '))
    } finally {
      setExporting(null)
    }
  }

  const busy = !!exporting
  return (
    <FormSheet width={640} icon="doc" title="Export Meeting MOM" subtitle={`One Minutes of Meeting from the follow-ups you pick${orgName ? ` — ${orgName}` : ''}.`} onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} data-tour="mom-close-btn" style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>
        <button type="button" onClick={() => download('pdf')} disabled={busy} data-tour="mom-export-pdf-btn" style={sheetBtn('secondary', SHEET.INK, busy)}>
          <SheetIcon name="doc" size={16} />{exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
        </button>
        <button type="button" onClick={() => download('docx')} disabled={busy} data-tour="mom-export-docx-btn" style={sheetBtn('primary', SHEET.BLUE, busy)}>
          <SheetIcon name="doc" size={16} />{exporting === 'docx' ? 'Exporting…' : 'Export Word (.docx)'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="calendar" title="Meeting">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-tour="mom-subject" style={{ flex: '1 1 260px' }}>
              <label style={sheetLabel}>Subject <Req /></label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Technical discussion on signalling requirement" style={sheetInput} autoFocus />
            </div>
            <div data-tour="mom-meeting-date" style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={sheetLabel}>Meeting Date</label>
              <DateField value={meetingDate} onChange={setMeetingDate} />
            </div>
          </div>
        </SheetSection>
        <SheetSection icon="users" title="Attendees">
          <div data-tour="mom-pew-attendees">
            <label style={sheetLabel}>PEW Attendees</label>
            <ChipMultiSelect
              options={directory.map((u) => ({ id: u.id, label: u.name }))}
              selected={pewMemberIds}
              onToggle={togglePewMember}
              emptyLabel="No users found."
            />
          </div>
          <div data-tour="mom-client-attendees" style={{ marginTop: 14 }}>
            <label style={sheetLabel}>Client Attendees</label>
            <ChipMultiSelect
              options={contacts.map((c) => ({ id: c.id, label: c.name }))}
              selected={clientContactIds}
              onToggle={toggleClientContact}
              emptyLabel="No contacts saved for this customer organization yet."
            />
          </div>
        </SheetSection>
        <SheetSection icon="list" title="Follow-ups to Include">
          <div data-tour="mom-followups">
            {activities.length === 0 ? (
              <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>No follow-ups logged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                {activities.map((a) => (
                  <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: SHEET.INK, cursor: 'pointer' }}>
                    <Checkbox checked={activityIds.includes(a.id)} onChange={() => toggleActivity(a.id)} />
                    {a.subject || a.activity_type || `Follow-up #${a.id}`}
                    {a.created_at && <span style={{ color: SHEET.MUTED }}> · {new Date(a.created_at).toLocaleDateString('en-GB')}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
