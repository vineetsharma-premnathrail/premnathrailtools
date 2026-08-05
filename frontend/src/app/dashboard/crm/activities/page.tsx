'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmActivity, CrmTeamMember, Organization, OrgContact } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import { downloadBlob } from '@/components/rnd/toolStyles'
import { InfoRow, Field, Row, primaryBtnStyle, secondaryBtnStyle, inputStyle } from '@/components/crm/ui'

const QUICK_FILTERS = ['all', 'open', 'done', 'today', 'overdue'] as const

export default function ActivitiesPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState<typeof QUICK_FILTERS[number]>('all')
  const [viewing, setViewing] = useState<CrmActivity | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [momExportFor, setMomExportFor] = useState<CrmActivity | null>(null)

  const load = async () => {
    setLoading(true)
    const [data, orgData] = await Promise.all([
      crmApi.listActivities({ search: search || undefined, status: statusFilter || undefined }),
      crmApi.listOrganizations(),
    ])
    setActivities(data)
    setOrganizations(orgData)
    setLoading(false)
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isAuthorized) crmApi.listAllOrgContacts().then(setContacts) }, [isAuthorized])
  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const orgById = new Map(organizations.map((o) => [o.id, o]))
  const contactById = new Map<number, OrgContact>(contacts.map((c) => [c.id, c] as const))
  const contactNames = (a: CrmActivity) => {
    const ids = a.contact_ids?.length ? a.contact_ids : a.org_contact_id ? [a.org_contact_id] : []
    return ids.map((id) => contactById.get(id)?.name).filter(Boolean).join(', ')
  }

  const remove = async (id: number) => {
    await crmApi.deleteActivity(id)
    load()
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const visible = activities.filter((a) => {
    if (quickFilter === 'open') return a.status === 'Open'
    if (quickFilter === 'done') return a.status === 'Done'
    if (quickFilter === 'today') return a.next_followup?.slice(0, 10) === todayStr
    if (quickFilter === 'overdue') return a.status === 'Open' && !!a.next_followup && a.next_followup.slice(0, 10) < todayStr
    return true
  })

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>Activities</h1>
        <button onClick={() => router.push('/dashboard/crm/activities/new')} style={primaryBtnStyle}>+ Log Activity</button>
      </div>

      <div style={{ borderRadius: 16, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 16, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by ID, owner, remarks…" style={{ ...inputStyle, flex: '1 1 260px' }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 160 }}>
            <option value="">All Statuses</option>
            <option value="Open">Open</option>
            <option value="Done">Done</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
          {QUICK_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setQuickFilter(f)}
              style={{
                padding: '5px 12px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                background: quickFilter === f ? '#fa9b9b' : 'rgba(0,0,0,0.05)', color: quickFilter === f ? '#fff' : '#57534e',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: '#78716c', padding: 24 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', padding: 24, textAlign: 'center' }}>No activities found</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fffaf5' }}>
                  {['Type', 'Organization', 'Contact Person', 'Universal ID', 'Module', 'Next Follow-up', 'Assigned To', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} onClick={() => setViewing(a)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: 'rgba(0,0,0,0.05)', color: '#57534e' }}>{a.activity_type || '—'}</span>
                    </td>
                    <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.org_id ? orgById.get(a.org_id)?.name || '—' : '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{contactNames(a) || '—'}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#fa9b9b' }}>{a.universal_id || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e', textTransform: 'capitalize' }}>{a.related_module || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e' }}>{a.next_followup || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e' }}>{a.assigned_to || '—'}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: a.status === 'Done' ? 'rgba(34,197,94,0.12)' : a.status === 'Cancelled' ? 'rgba(0,0,0,0.06)' : 'rgba(234,179,8,0.12)', color: a.status === 'Done' ? '#16a34a' : a.status === 'Cancelled' ? '#78716c' : '#a16207' }}>{a.status}</span>
                    </td>
                    <td style={{ padding: '10px 16px' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setViewing(a)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>View</button>
                        <button onClick={() => router.push(`/dashboard/crm/activities/${a.id}/edit`)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Edit</button>
                        <button onClick={() => setPendingDelete(a.id)} style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)', background: 'rgba(220,38,38,0.08)', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '80vh', overflowY: 'auto' }}>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: 0 }}>{viewing.activity_type || 'Activity'}</p>
            <InfoRow label="Organization" value={viewing.org_id ? orgById.get(viewing.org_id)?.name || '—' : '—'} />
            <InfoRow label="Contact Person(s)" value={contactNames(viewing) || '—'} />
            <InfoRow label="Related Module" value={viewing.related_module || '—'} />
            <InfoRow label="Universal ID" value={viewing.universal_id || '—'} />
            <InfoRow label="Activity Type" value={viewing.activity_type || '—'} />
            <InfoRow label="Status" value={viewing.status} />
            <InfoRow label="Activity Date" value={viewing.activity_date || '—'} />
            <InfoRow label="Next Follow-up Date" value={viewing.next_followup || '—'} />
            <InfoRow label="Assigned To" value={viewing.assigned_to || '—'} />
            <InfoRow label="Observation / Remarks" value={viewing.remarks || '—'} />
            <InfoRow label="Action Plan" value={viewing.action_plan || '—'} />
            <InfoRow label="Created At" value={viewing.created_at ? new Date(viewing.created_at).toLocaleString() : '—'} />
            {viewing.mom_items && viewing.mom_items.length > 0 && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 8px' }}>MOM Line Items</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {viewing.mom_items.map((item, i) => (
                    <div key={i} style={{ padding: 10, borderRadius: 8, background: '#fffaf5', border: '1px solid rgba(0,0,0,0.05)', fontSize: 12.5 }}>
                      <p style={{ margin: 0, fontWeight: 700, color: '#78716c' }}>S.NO {i + 1}</p>
                      <p style={{ margin: '4px 0 0' }}>{item.observation || '—'}</p>
                      {item.action_plan && (
                        <p style={{ margin: '4px 0 0', color: '#57534e' }}><strong>Action Plan:</strong> {item.action_plan}</p>
                      )}
                      <p style={{ margin: '4px 0 0', color: '#57534e' }}><strong>Responsibility:</strong> {item.responsibility || '—'}</p>
                      <p style={{ margin: '4px 0 0', color: '#57534e' }}><strong>Target Date:</strong> {item.target_date || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {viewing.related_module === 'inquiry' && viewing.related_id && (
                <button onClick={() => setMomExportFor(viewing)} style={secondaryBtnStyle}>Export to DOC</button>
              )}
              <button onClick={() => setViewing(null)} style={secondaryBtnStyle}>Close</button>
              <button onClick={() => router.push(`/dashboard/crm/activities/${viewing.id}/edit`)} style={primaryBtnStyle}>Edit</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this activity?"
        message="This activity will be permanently deleted."
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) remove(id) }}
        onCancel={() => setPendingDelete(null)}
      />

      {momExportFor && (
        <MomExportModal
          activity={momExportFor}
          orgName={momExportFor.org_id ? orgById.get(momExportFor.org_id)?.name : undefined}
          onClose={() => setMomExportFor(null)}
        />
      )}
    </div>
  )
}

function MomExportModal({ activity, orgName, onClose }: {
  activity: CrmActivity
  orgName?: string
  onClose: () => void
}) {
  const [subject, setSubject] = useState(activity.activity_type || '')
  const [meetingDate, setMeetingDate] = useState(activity.activity_date || new Date().toISOString().slice(0, 10))
  const [teamMembers, setTeamMembers] = useState<CrmTeamMember[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [pewIds, setPewIds] = useState<number[]>([])
  const [contactIds, setContactIds] = useState<number[]>(activity.org_contact_id ? [activity.org_contact_id] : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    crmApi.listTeamMembers().then(setTeamMembers)
    if (activity.org_id) crmApi.listOrgContacts(activity.org_id).then(setContacts)
    if (activity.related_module === 'inquiry' && activity.related_id) {
      crmApi.getInquiry(activity.related_id).then((inquiry) => {
        if (!inquiry.bd_owner) return
        crmApi.listTeamMembers().then((members: CrmTeamMember[]) => {
          const match = members.find((m) => m.name.trim().toLowerCase() === inquiry.bd_owner.trim().toLowerCase())
          if (match) setPewIds((ids) => (ids.includes(match.id) ? ids : [...ids, match.id]))
        })
      }).catch(() => {
        setError('This activity\'s linked inquiry no longer exists, so the BD Owner could not be auto-selected — pick PEW members manually.')
      })
    }
  }, [activity.org_id, activity.related_module, activity.related_id])

  const toggle = (list: number[], setList: (v: number[]) => void, id: number) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const submit = async (format: 'docx' | 'pdf') => {
    if (!subject.trim()) {
      setError('Please enter a subject for the meeting.')
      return
    }
    if (!activity.related_id) return
    setBusy(true)
    setError('')
    try {
      const payload = {
        subject,
        meeting_date: meetingDate,
        pew_member_ids: pewIds,
        client_contact_ids: contactIds,
        activity_ids: [activity.id],
      }
      const blob = format === 'pdf'
        ? await crmApi.exportInquiryMomPdf(activity.related_id, payload)
        : await crmApi.exportInquiryMom(activity.related_id, payload)
      downloadBlob(blob, `MOM_${(orgName || 'Activity').replace(/\s+/g, '_')}_${meetingDate}.${format}`)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to generate MOM document.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: 0 }}>Export Minutes of Meeting</p>
        <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>This single activity's Observation / Action Plan points become the MOM table rows.</p>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}

        <Row>
          <Field label="Subject *"><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Introduction to Premnath Rail" style={inputStyle} /></Field>
          <Field label="Meeting Date"><DateField value={meetingDate} onChange={setMeetingDate} /></Field>
        </Row>

        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 8px' }}>PEW Member(s) Present</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 120, overflowY: 'auto' }}>
            {teamMembers.length === 0 && <span style={{ fontSize: 12.5, color: '#a8a29e' }}>No internal users found.</span>}
            {teamMembers.map((m) => (
              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: pewIds.includes(m.id) ? 'rgba(244,113,59,0.1)' : '#f9fafb', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                <input type="checkbox" checked={pewIds.includes(m.id)} onChange={() => toggle(pewIds, setPewIds, m.id)} />
                {m.name}{m.designation ? ` (${m.designation})` : ''}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 8px' }}>Client Member(s) Present</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 120, overflowY: 'auto' }}>
            {contacts.length === 0 && <span style={{ fontSize: 12.5, color: '#a8a29e' }}>No contacts found for this organization.</span>}
            {contacts.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: contactIds.includes(c.id) ? 'rgba(244,113,59,0.1)' : '#f9fafb', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                <input type="checkbox" checked={contactIds.includes(c.id)} onChange={() => toggle(contactIds, setContactIds, c.id)} />
                {c.name}{c.designation ? ` (${c.designation})` : ''}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, flex: 1 }}>Cancel</button>
          <button onClick={() => submit('docx')} disabled={busy} style={{ ...secondaryBtnStyle, flex: 1, opacity: busy ? 0.7 : 1 }}>{busy ? 'Generating…' : 'Download .docx'}</button>
          <button onClick={() => submit('pdf')} disabled={busy} style={{ ...primaryBtnStyle, flex: 1, opacity: busy ? 0.7 : 1 }}>{busy ? 'Generating…' : 'Download .pdf'}</button>
        </div>
      </div>
    </div>
  )
}
