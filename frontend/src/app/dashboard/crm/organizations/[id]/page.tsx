'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { OrganizationDetail, Inquiry, Tender, CrmActivity, CrmNote, OrgContact } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import InquiryForm from '@/components/crm/InquiryForm'
import TenderForm from '@/components/crm/TenderForm'
import ActivityForm from '@/components/crm/ActivityForm'
import { Card, InfoRow, Field, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/crm/ui'

const TABS = ['Overview', 'Contacts', 'Inquiries', 'Tenders', 'Activities', 'Notes', 'Audit Trail'] as const

export default function OrganizationDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const orgId = Number(params.id)

  const [org, setOrg] = useState<OrganizationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setOrg(await crmApi.getOrganizationDetail(orgId))
    } catch {
      setError('Organization not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && orgId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, orgId])

  const canModify = !!org && !!user && (user.role === 'admin' || user.role === 'super_admin' || org.created_by_id === user.id)

  const handleDelete = async () => {
    await crmApi.deleteOrganization(orgId)
    router.push('/dashboard/crm/organizations')
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !org) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!org) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 4px' }}>{org.org_type || 'Organization'}</p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>{org.name}</h1>
        </div>
        {canModify && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href={`/dashboard/crm/organizations/${org.id}/edit`} style={{ ...secondaryBtnStyle, textDecoration: 'none', display: 'inline-block' }}>Edit</Link>
            <button onClick={() => setShowDeleteConfirm(true)} style={dangerBtnStyle}>Delete</button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Inquiries" value={org.inquiry_count} color="#fa9b9b" />
        <StatCard label="Tenders" value={org.tender_count} color="#8b5cf6" />
        <StatCard label="Contacts" value={org.contacts.length} color="#3b82f6" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px', marginRight: 16, border: 'none', background: 'transparent',
              borderBottom: tab === t ? '2px solid #fa9b9b' : '2px solid transparent',
              color: tab === t ? '#fa9b9b' : '#78716c', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab org={org} />}
      {tab === 'Contacts' && <ContactsTab org={org} canModify={canModify} onRefresh={load} />}
      {tab === 'Inquiries' && <InquiriesTab orgId={org.id} canModify={canModify} />}
      {tab === 'Tenders' && <TendersTab orgId={org.id} canModify={canModify} />}
      {tab === 'Activities' && <ActivitiesTab orgId={org.id} />}
      {tab === 'Notes' && <NotesTab orgId={org.id} />}
      {tab === 'Audit Trail' && <AuditTab orgId={org.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this organization?"
        message={`Delete organization ${org.name}? Its inquiries and tenders will also be moved to the recycle bin. It can be restored within 10 days.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 800, color, margin: 0 }}>{value}</p>
    </div>
  )
}

function OverviewTab({ org }: { org: OrganizationDetail }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Card title="Organization Details">
        <InfoRow label="Type" value={org.org_type || '—'} />
        <InfoRow label="Parent Organization" value={org.parent_org || '—'} />
        <InfoRow label="Railway Zone" value={org.railway_zone || '—'} />
        <InfoRow label="Division / Workshop" value={org.division_workshop || '—'} />
      </Card>
      <Card title="Location">
        <InfoRow label="Address" value={org.address || '—'} />
        <InfoRow label="City" value={org.city || '—'} />
        <InfoRow label="State" value={org.state || '—'} />
        <InfoRow label="PIN Code" value={org.pin_code || '—'} />
        <InfoRow label="Country" value={org.country || '—'} />
      </Card>
      <Card title="Contact & Registration">
        <InfoRow label="GST Number" value={org.gst_number || '—'} />
        <InfoRow label="Official Phone" value={org.official_phone || '—'} />
        <InfoRow label="Official Email" value={org.official_email || '—'} />
        <InfoRow label="Website" value={org.website || '—'} />
      </Card>
    </div>
  )
}

function ContactsTab({ org, canModify, onRefresh }: { org: OrganizationDetail; canModify: boolean; onRefresh: () => void }) {
  const emptyForm = { name: '', designation: '', mobile: '', email: '', department: '' }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const startEdit = (c: OrganizationDetail['contacts'][number]) => {
    setEditingId(c.id)
    setForm({ name: c.name, designation: c.designation || '', mobile: c.mobile || '', email: c.email || '', department: c.department || '' })
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) await crmApi.updateOrgContact(org.id, editingId, form)
      else await crmApi.createOrgContact(org.id, form)
      cancelForm()
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => (showForm ? cancelForm() : setShowForm(true))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Contact'}</button>
          {showForm && (
            <form onSubmit={submit} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="Name"><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Designation"><input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Department"><input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Mobile"><input value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Email"><input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} /></Field>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, width: '100%' }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Contact'}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {org.contacts.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No contacts added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {org.contacts.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div
                  style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', fontSize: 13, fontWeight: 700,
                  }}
                >
                  {c.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108', margin: 0 }}>{c.name}</p>
                    {c.designation && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: '#fa9b9b' }}>{c.designation}</span>
                    )}
                    {c.department && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(0,0,0,0.05)', color: '#78716c' }}>{c.department}</span>
                    )}
                  </div>
                  {(c.mobile || c.email) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                      {c.mobile && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>
                          {c.mobile}
                        </span>
                      )}
                      {c.email && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>
                          {c.email}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {canModify && (
                <button onClick={() => startEdit(c)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>Edit</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ value }: { value: string }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: 'rgba(0,0,0,0.05)', color: '#57534e', whiteSpace: 'nowrap' }}>
      {value}
    </span>
  )
}

function InquiriesTab({ orgId, canModify }: { orgId: number; canModify: boolean }) {
  const router = useRouter()
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const load = () => crmApi.listInquiries({ org_id: orgId }).then(setInquiries).finally(() => setLoading(false))
  useEffect(() => { load() }, [orgId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => setShowForm((v) => !v)} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Inquiry'}</button>
          {showForm && (
            <div style={{ marginTop: 12 }}>
              <InquiryForm
                defaultOrgId={orgId}
                submitLabel="Save Inquiry"
                onCancel={() => setShowForm(false)}
                onSubmit={async (payload) => {
                  await crmApi.createInquiry(payload)
                  setShowForm(false)
                  load()
                }}
              />
            </div>
          )}
        </div>
      )}

      {inquiries.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No inquiries for this organization.</p>
      ) : (
        <div style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fffaf5' }}>
                {['ID', 'Product', 'Status', 'Priority', 'Follow-up'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fffaf5', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inquiries.map((i) => (
                <tr key={i.id} onClick={() => router.push(`/dashboard/crm/inquiries/${i.id}`)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#fa9b9b', fontWeight: 700 }}>{i.universal_id || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.product || '—'}</td>
                  <td style={{ padding: '10px 16px' }}><StatusPill value={i.status} /></td>
                  <td style={{ padding: '10px 16px' }}><StatusPill value={i.priority} /></td>
                  <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{i.next_followup_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TendersTab({ orgId, canModify }: { orgId: number; canModify: boolean }) {
  const router = useRouter()
  const [tenders, setTenders] = useState<Tender[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const load = () => crmApi.listTenders({ org_id: orgId }).then(setTenders).finally(() => setLoading(false))
  useEffect(() => { load() }, [orgId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => setShowForm((v) => !v)} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Tender'}</button>
          {showForm && (
            <div style={{ marginTop: 12 }}>
              <TenderForm
                defaultOrgId={orgId}
                submitLabel="Save Tender"
                onCancel={() => setShowForm(false)}
                onSubmit={async (payload) => {
                  await crmApi.createTender(payload)
                  setShowForm(false)
                  load()
                }}
              />
            </div>
          )}
        </div>
      )}

      {tenders.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No tenders for this organization.</p>
      ) : (
        <div style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fffaf5' }}>
                {['ID', 'Tender No.', 'Name', 'Status', 'Submission'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fffaf5', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenders.map((t) => (
                <tr key={t.id} onClick={() => router.push(`/dashboard/crm/tenders/${t.id}`)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#fa9b9b', fontWeight: 700 }}>{t.universal_id || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#57534e' }}>{t.tender_number || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tender_name || '—'}</td>
                  <td style={{ padding: '10px 16px' }}><StatusPill value={t.status} /></td>
                  <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{t.submission_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ActivitiesTab({ orgId }: { orgId: number }) {
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CrmActivity | null>(null)
  const load = () => crmApi.listActivities({ org_id: orgId }).then(setActivities).finally(() => setLoading(false))
  useEffect(() => { load() }, [orgId])
  useEffect(() => { crmApi.listOrgContacts(orgId).then(setContacts) }, [orgId])
  const contactById = new Map(contacts.map((c) => [c.id, c]))

  const cancelForm = () => {
    setEditing(null)
    setShowForm(false)
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <button onClick={() => (showForm ? cancelForm() : setShowForm(true))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Log Activity'}</button>
        {showForm && (
          <div style={{ marginTop: 12 }}>
            <ActivityForm
              initial={editing || undefined}
              defaultOrgId={orgId}
              submitLabel={editing ? 'Save Changes' : 'Save Activity'}
              onCancel={cancelForm}
              onSubmit={async (payload) => {
                if (editing) await crmApi.updateActivity(editing.id, payload)
                else await crmApi.createActivity(payload)
                cancelForm()
                load()
              }}
            />
          </div>
        )}
      </div>

      {activities.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No activities logged.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activities.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{a.activity_type || 'Activity'} <span style={{ fontWeight: 500, color: '#78716c' }}>· {a.status}</span></p>
                <p style={{ fontSize: 12.5, color: '#57534e', margin: '0 0 4px' }}>{a.remarks || '—'}</p>
                {a.action_plan && <p style={{ fontSize: 12, color: '#78716c', margin: '0 0 4px' }}>Action Plan: {a.action_plan}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 11.5, color: '#a8a29e' }}>
                  {a.org_contact_id && contactById.get(a.org_contact_id) && <span>Contact: {contactById.get(a.org_contact_id)!.name}</span>}
                  {a.related_module && a.universal_id && <span>{a.related_module}: {a.universal_id}</span>}
                  {a.assigned_to && <span>Assigned To: {a.assigned_to}</span>}
                  {a.next_followup && <span>Follow-up: {a.next_followup}</span>}
                </div>
              </div>
              <button onClick={() => { setEditing(a); setShowForm(true) }} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>Edit</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NotesTab({ orgId }: { orgId: number }) {
  const [notes, setNotes] = useState<CrmNote[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const load = () => crmApi.listNotes({ org_id: orgId }).then(setNotes).finally(() => setLoading(false))
  useEffect(() => { load() }, [orgId])

  const add = async () => {
    if (!text.trim()) return
    await crmApi.createNote({ org_id: orgId, note: text })
    setText('')
    load()
  }

  const startEdit = (n: CrmNote) => {
    setEditingId(n.id)
    setEditText(n.note)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveEdit = async () => {
    if (!editText.trim() || editingId == null) return
    await crmApi.updateNote(editingId, { note: editText })
    cancelEdit()
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note..." style={{ ...inputStyle, flex: 1 }} />
        <button onClick={add} style={primaryBtnStyle}>Add</button>
      </div>
      {loading ? (
        <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No notes yet.</p>
      ) : (
        notes.map((n) => (
          <div key={n.id} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            {editingId === n.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={saveEdit} style={primaryBtnStyle}>Save Changes</button>
                  <button onClick={cancelEdit} style={secondaryBtnStyle}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <p style={{ fontSize: 13, color: '#1f1108', margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>{n.note}</p>
                  <button onClick={() => startEdit(n)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>Edit</button>
                </div>
                <p style={{ fontSize: 11, color: '#a8a29e', margin: 0 }}>{n.created_by_name || 'Unknown'} · {n.created_at ? new Date(n.created_at).toLocaleString() : ''}</p>
              </>
            )}
          </div>
        ))
      )}
    </div>
  )
}

function AuditTab({ orgId }: { orgId: number }) {
  const [entries, setEntries] = useState<{ id: number; action: string; summary: string | null; performed_by: string; performed_at: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { crmApi.getOrganizationAudit(orgId).then(setEntries).finally(() => setLoading(false)) }, [orgId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No audit history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.id} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1108' }}>{e.performed_by}</span>
            <span style={{ fontSize: 11.5, color: '#a8a29e' }}>{e.performed_at ? new Date(e.performed_at).toLocaleString() : ''}</span>
          </div>
          <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>{e.summary || e.action}</p>
        </div>
      ))}
    </div>
  )
}
