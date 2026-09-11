'use client'

import { useEffect, useState } from 'react'
import { crmApi, usersApi } from '@/lib/api'
import { CrmActivity, OrgContact, DirectoryUser } from '@/types'
import { XIcon, inputStyle, primaryBtnStyle, secondaryBtnStyle, Field } from '@/components/crm/ui'
import Checkbox from '@/components/Checkbox'
import MessageDialog from '@/components/erp/MessageDialog'
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
export default function MomExportDialog({
  open, onClose, orgId, orgName, activities, onExportDocx, onExportPdf,
}: {
  open: boolean
  onClose: () => void
  orgId: number | null | undefined
  orgName?: string | null
  activities: CrmActivity[]
  onExportDocx: (payload: Record<string, unknown>) => Promise<Blob>
  onExportPdf: (payload: Record<string, unknown>) => Promise<Blob>
}) {
  const [subject, setSubject] = useState('')
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().slice(0, 10))
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [pewMemberIds, setPewMemberIds] = useState<number[]>([])
  const [clientContactIds, setClientContactIds] = useState<number[]>([])
  const [activityIds, setActivityIds] = useState<number[]>([])
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setSubject('')
    setMeetingDate(new Date().toISOString().slice(0, 10))
    setPewMemberIds([])
    setClientContactIds([])
    setActivityIds(activities.map((a) => a.id))
    setError('')
    if (orgId) crmApi.listOrgContacts(orgId).then(setContacts).catch(() => setContacts([]))
    usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId])

  if (!open) return null

  const toggleActivity = (id: number) => setActivityIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const togglePewMember = (id: number) => setPewMemberIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleClientContact = (id: number) => setClientContactIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const download = async (kind: 'docx' | 'pdf') => {
    if (!subject.trim()) { setError('Subject is required.'); return }
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
    } catch {
      setError(`MOM ${kind === 'docx' ? 'Word' : 'PDF'} export failed.`)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ maxHeight: '85vh', overflowY: 'auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: 0 }}>Export Meeting MOM</p>
            <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', display: 'flex', cursor: 'pointer', color: '#a8a29e', padding: 4 }}><XIcon size={16} /></button>
          </div>
          <MessageDialog open={!!error} variant="error" title="Cannot Export MOM" message={error} onClose={() => setError('')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Subject">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Technical discussion on signalling requirement" style={inputStyle} />
            </Field>
            <Field label="Meeting Date">
              <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="PEW Attendees">
              <ChipMultiSelect
                options={directory.map((u) => ({ id: u.id, label: u.name }))}
                selected={pewMemberIds}
                onToggle={togglePewMember}
                emptyLabel="No users found."
              />
            </Field>
            <Field label="Client Attendees">
              <ChipMultiSelect
                options={contacts.map((c) => ({ id: c.id, label: c.name }))}
                selected={clientContactIds}
                onToggle={toggleClientContact}
                emptyLabel="No contacts saved for this organization yet."
              />
            </Field>
            <Field label="Follow-ups to Include">
              {activities.length === 0 ? (
                <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>No follow-ups logged yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                  {activities.map((a) => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#1f1108', cursor: 'pointer' }}>
                      <Checkbox checked={activityIds.includes(a.id)} onChange={() => toggleActivity(a.id)} />
                      {a.subject || a.activity_type || `Follow-up #${a.id}`}
                      {a.created_at && <span style={{ color: '#a8a29e' }}> · {new Date(a.created_at).toLocaleDateString('en-GB')}</span>}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={() => download('docx')} disabled={!!exporting} style={{ ...primaryBtnStyle, opacity: exporting ? 0.7 : 1, cursor: exporting ? 'not-allowed' : 'pointer' }}>
              {exporting === 'docx' ? 'Exporting…' : 'Export Word (.docx)'}
            </button>
            <button onClick={() => download('pdf')} disabled={!!exporting} style={{ ...secondaryBtnStyle, opacity: exporting ? 0.7 : 1, cursor: exporting ? 'not-allowed' : 'pointer' }}>
              {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
