'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Inquiry, Organization, OrgContact, InquiryTask, InquiryApprovalItem, QuotationItem, QuotationLineItem, PurchaseOrderItem, CrmDiscussionItem, CrmActivity, CrmDocument, CrmStageLogEntry } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import InquiryForm from '@/components/crm/InquiryForm'
import ActivityForm from '@/components/crm/ActivityForm'
import { RichText } from '@/components/RichTextEditor'
import ActivityViewDialog from '@/components/crm/ActivityViewDialog'
import TechnicalOfferPickerDialog from '@/components/crm/TechnicalOfferPickerDialog'
import { INQ_STAGES, DEPARTMENTS, TASK_STATUSES, PRIORITIES, APPROVAL_TYPES, CUSTOMER_RESPONSES, PO_STATUSES, DOC_CATEGORIES, QUOTE_CONDITIONS } from '@/components/crm/constants'
import { Card, InfoRow, Field, Row, Row3, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, ActivityPhotos, RevisionSelector, SpecInfoRow, SpecRevision, ComboBox, handleEnterAsTab } from '@/components/crm/ui'

const TABS = ['Info', 'Quotations', 'Documents', 'Follow Ups', 'Timeline'] as const

export default function InquiryDetailPanel({ inquiryId, onDeleted }: { inquiryId: number; onDeleted?: () => void }) {
  const { user } = useAuth()
  const router = useRouter()

  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [contact, setContact] = useState<OrgContact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Info')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStage, setPendingStage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [revisions, setRevisions] = useState<SpecRevision[]>([])
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null)
  const [sendingTOR, setSendingTOR] = useState(false)
  const [torError, setTorError] = useState('')
  const [showTorPicker, setShowTorPicker] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await crmApi.getInquiry(inquiryId)
      setInquiry(data)
      crmApi.getOrganization(data.org_id).then(setOrg).catch(() => {})
      if (data.org_contact_id) {
        crmApi.listOrgContacts(data.org_id).then((contacts: OrgContact[]) => {
          setContact(contacts.find((c) => c.id === data.org_contact_id) || null)
        }).catch(() => {})
      } else {
        setContact(null)
      }
      crmApi.getInquirySpecRevisions(inquiryId).then(setRevisions).catch(() => setRevisions([]))
    } catch {
      setError('Inquiry not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (inquiryId) { setTab('Info'); setEditing(false); load() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiryId])

  const canModify = !!inquiry && !!user && (user.role === 'admin' || inquiry.created_by_id === user.id)
  const isAdmin = user?.role === 'admin'

  const patch = async (payload: Record<string, unknown>) => {
    if (!inquiry) return
    try {
      setInquiry(await crmApi.updateInquiry(inquiry.id, payload))
      crmApi.getInquirySpecRevisions(inquiry.id).then(setRevisions).catch(() => {})
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Update failed.')
    }
  }

  const handleDelete = async () => {
    if (!inquiry) return
    await crmApi.deleteInquiry(inquiry.id)
    if (onDeleted) onDeleted()
    else router.push('/dashboard/crm/inquiries')
  }

  // Enabled the first time, and again any time the inquiry is edited after the last
  // request was sent — greyed out otherwise so R&D isn't emailed duplicate requests
  // for an unchanged requirement.
  const torActive = !!inquiry && (
    !inquiry.technical_offer_sent_at ||
    (!!inquiry.updated_at && new Date(inquiry.updated_at) > new Date(inquiry.technical_offer_sent_at))
  )

  const sendTechnicalOfferRequest = async (documentIds: number[]) => {
    if (!inquiry || !torActive) return
    setSendingTOR(true)
    setTorError('')
    try {
      setInquiry(await crmApi.createInquiryTechnicalOfferRequest(inquiry.id, documentIds))
      setShowTorPicker(false)
    } catch (err: any) {
      setTorError(err?.response?.data?.detail || 'Failed to send Technical Offer Request.')
    } finally {
      setSendingTOR(false)
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !inquiry) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!inquiry) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45' }}>{inquiry.universal_id}</span>
            {inquiry.created_at && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#a8a29e' }}>{new Date(inquiry.created_at).toLocaleDateString('en-GB')}</span>
            )}
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span title={`Status: ${inquiry.status}`} style={{ fontSize: 11, fontWeight: 600, color: '#78716c' }}>{inquiry.status}</span>
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span title={`Priority: ${inquiry.priority}`} style={{ fontSize: 11, fontWeight: 600, color: '#78716c' }}>{inquiry.priority}</span>
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span title={`Stage: ${inquiry.current_stage}`} style={{ fontSize: 11, fontWeight: 600, color: '#78716c' }}>{inquiry.current_stage}</span>
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1f1108', margin: 0 }}>{org?.name || 'Inquiry'}</h1>
        </div>
        {!editing && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, width: '100%', maxWidth: '100%' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
              <button onClick={() => router.push('/dashboard/crm/inquiries')} type="button" style={secondaryBtnStyle}>
                ← Back
              </button>
              <button
                onClick={() => setShowTorPicker(true)}
                disabled={!torActive || sendingTOR}
                title={!torActive ? `Already sent as ${inquiry.technical_offer_number} — edit the inquiry to send again.` : 'Emails R&D the Organization, Project, and Product Requirement details as a PDF.'}
                style={{ ...secondaryBtnStyle, opacity: !torActive || sendingTOR ? 0.5 : 1, cursor: !torActive || sendingTOR ? 'not-allowed' : 'pointer' }}
              >
                {sendingTOR ? 'Sending…' : 'Send Technical Offer Request to R&D'}
              </button>
              {canModify && <button onClick={() => { setEditing(true); setTab('Info') }} style={secondaryBtnStyle}>Edit</button>}
              {isAdmin && <button onClick={() => setShowDeleteConfirm(true)} style={dangerBtnStyle}>Delete</button>}
            </div>
            {inquiry.technical_offer_number && (
              <span style={{ fontSize: 11, color: '#78716c' }}>
                {torActive ? 'Previously sent as ' : 'Sent as '}<strong>{inquiry.technical_offer_number}</strong>
                {inquiry.technical_offer_sent_at && ` on ${new Date(inquiry.technical_offer_sent_at).toLocaleString()}`}
              </span>
            )}
          </div>
        )}
      </div>

      {torError && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {torError}
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <StageProgress stage={inquiry.current_stage} canModify={canModify} onRequestChange={setPendingStage} />

      <div className="hide-scrollbar" style={{ display: 'flex', gap: 8, marginBottom: 20, padding: '6px 6px 8px', borderBottom: '1px solid rgba(0,0,0,0.08)', overflowX: 'auto', overflowY: 'visible' }}>
        {TABS.map((t) => (
          <div key={t} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 16 }}>
            <button
              onClick={() => setTab(t)}
              style={{
                padding: '10px 6px', border: 'none', background: 'transparent', whiteSpace: 'nowrap',
                borderBottom: tab === t ? '2px solid #FF7A45' : '2px solid transparent',
                color: tab === t ? '#FF7A45' : '#78716c', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {t}
              {t === 'Info' && tab === t && revisions.length > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(255,122,69,0.15)', color: '#FF7A45' }}>
                  {revisions.length}
                </span>
              )}
            </button>
            {t === 'Info' && tab === t && !editing && revisions.length > 0 && (
              <RevisionSelector revisions={revisions} selectedId={selectedRevId} onSelect={setSelectedRevId} />
            )}
          </div>
        ))}
      </div>

      {tab === 'Info' && editing && (
        <InquiryForm
          initial={inquiry}
          submitLabel="Save Changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            await patch(payload)
            setEditing(false)
          }}
        />
      )}
      {tab === 'Info' && !editing && <InfoTab inquiry={inquiry} org={org} contact={contact} revisions={revisions} selectedRevId={selectedRevId} />}
      {tab === 'Quotations' && <QuotationsTab inquiryId={inquiry.id} canModify={canModify} org={org} contact={contact} inquiry={inquiry} />}
      {tab === 'Documents' && <DocumentsTab inquiry={inquiry} canModify={canModify} isAdmin={isAdmin} />}
      {tab === 'Follow Ups' && <ActivitiesTab inquiry={inquiry} org={org} />}
      {tab === 'Timeline' && <TimelineTab inquiryId={inquiry.id} />}

      <TechnicalOfferPickerDialog
        open={showTorPicker}
        relatedModule="inquiry"
        relatedId={inquiry.id}
        sending={sendingTOR}
        onSend={sendTechnicalOfferRequest}
        onCancel={() => setShowTorPicker(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this inquiry?"
        message={`Delete inquiry ${inquiry.universal_id}? This action cannot be undone.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ConfirmDialog
        open={!!pendingStage}
        title="Update Stage"
        danger={false}
        confirmLabel="Update Stage"
        message={pendingStage ? `Move this inquiry from "${inquiry.current_stage}" to "${pendingStage}"?` : ''}
        onConfirm={() => { const s = pendingStage; setPendingStage(null); if (s) patch({ current_stage: s }) }}
        onCancel={() => setPendingStage(null)}
      />
    </div>
  )
}

function StageProgress({ stage, canModify, onRequestChange }: { stage: string; canModify: boolean; onRequestChange: (s: string) => void }) {
  const activeIdx = INQ_STAGES.indexOf(stage)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 20 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FF7A45', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {activeIdx + 1}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e' }}>Stage {activeIdx + 1} of {INQ_STAGES.length}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1f1108' }}>{stage}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 100, height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <div style={{ width: `${((activeIdx + 1) / INQ_STAGES.length) * 100}%`, height: '100%', background: '#22c55e' }} />
          </div>
          <span style={{ fontSize: 14, color: '#a8a29e', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
        </div>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 20, borderRadius: 14, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.4)', boxShadow: '0 16px 40px rgba(15,23,42,0.22), 0 4px 10px rgba(15,23,42,.1)', overflow: 'hidden' }}>
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
          {INQ_STAGES.map((s, i) => {
            const done = i < activeIdx
            const active = i === activeIdx
            const clickable = canModify && !active
            const circleBg = done ? '#22c55e' : active ? '#FF7A45' : '#fff'
            const circleColor = done || active ? '#fff' : '#a8a29e'
            const circleBorder = done ? '#22c55e' : active ? '#FF7A45' : 'rgba(0,0,0,0.15)'
            return (
              <div
                key={s}
                onClick={clickable ? () => { onRequestChange(s); setOpen(false) } : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: clickable ? 'pointer' : 'default', background: active ? 'rgba(250,155,155,0.1)' : 'transparent' }}
                onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'rgba(250,155,155,0.1)' : 'transparent' }}
              >
                <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: circleBg, color: circleColor, border: `2px solid ${circleBorder}`, fontSize: 9.5, fontWeight: 700, flexShrink: 0 }}>
                  {done ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? '#FF7A45' : done ? '#16a34a' : '#57534e' }}>{s}</span>
              </div>
            )
          })}
        </div>
        </div>
      )}
    </div>
  )
}

function InfoTab({ inquiry, org, contact, revisions, selectedRevId }: { inquiry: Inquiry; org: Organization | null; contact: OrgContact | null; revisions: SpecRevision[]; selectedRevId: number | null }) {
  const selectedRev = revisions.find((r) => r.id === selectedRevId) || null
  const changeFor = (field: string) => selectedRev?.changes.find((c) => c.field === field)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <Card title="Organization">
          <InfoRow label="Name" value={org?.name || 'Not provided'} />
          <InfoRow label="GST Number" value={org?.gst_number || 'Not provided'} />
          <InfoRow label="Type" value={org?.org_type || 'Not provided'} />
          <InfoRow label="City" value={org?.city || 'Not provided'} />
          <InfoRow label="State" value={org?.state || 'Not provided'} />
          <InfoRow label="Address" value={org?.address || 'Not provided'} />
          <div style={{ paddingTop: 10, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1f1108', margin: '0 0 10px' }}>Contact Person</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <InfoRow label="Name" value={contact?.name || 'Not provided'} />
              <InfoRow label="Mobile" value={contact?.mobile || 'Not provided'} />
              <InfoRow label="Email" value={contact?.email || 'Not provided'} />
              <InfoRow label="Department" value={contact?.department || 'Not provided'} />
            </div>
          </div>
        </Card>
        <Card title="Lead Info">
          <InfoRow label="Lead Source" value={inquiry.lead_source || 'Not provided'} />
          <InfoRow label="BD Owner" value={inquiry.bd_owner || 'Not provided'} />
          <InfoRow label="Sales Engineer" value={inquiry.sales_engineer || 'Not provided'} />
          <InfoRow label="Created On" value={inquiry.created_at ? new Date(inquiry.created_at).toLocaleDateString() : 'Not provided'} />
          <InfoRow label="Follow-up Date" value={inquiry.next_followup_date || 'Not provided'} />
          <InfoRow label="Follow-up Priority" value={inquiry.followup_priority || 'Not provided'} />
          <InfoRow label="Assigned To" value={inquiry.followup_assigned_to || 'Not provided'} />
          <InfoRow label="Follow-up Remarks" value={inquiry.followup_remarks || 'Not provided'} />
        </Card>
      </div>
      <Card title="Product Requirement">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <SpecInfoRow label="Product" value={inquiry.product || 'Not provided'} change={changeFor('product')} />
          <SpecInfoRow label="Category" value={inquiry.product_category || 'Not provided'} change={changeFor('product_category')} />
          <SpecInfoRow label="Quantity / Unit" value={inquiry.quantity != null ? `${inquiry.quantity} ${inquiry.unit || ''}` : 'Not provided'} change={changeFor('quantity') || changeFor('unit')} />
          <SpecInfoRow label="Required Delivery" value={inquiry.required_delivery_date || 'Not provided'} change={changeFor('required_delivery_date')} />
          <SpecInfoRow label="Delivery Location" value={inquiry.delivery_location || 'Not provided'} change={changeFor('delivery_location')} />
          <InfoRow label="Expected Value" value={inquiry.expected_value != null ? `₹${inquiry.expected_value.toLocaleString()}` : 'Not provided'} />
          <InfoRow label="Budget" value={inquiry.budget != null ? `₹${inquiry.budget.toLocaleString()}` : 'Not provided'} />
          <InfoRow label="Expected Order Date" value={inquiry.expected_order_date || 'Not provided'} />
          <SpecInfoRow label="Inspection Req." value={inquiry.inspection_req || 'Not provided'} change={changeFor('inspection_req')} />
          <SpecInfoRow label="Warranty Req." value={inquiry.warranty_req || 'Not provided'} change={changeFor('warranty_req')} />
        </div>
        <SpecInfoRow label="Specification" value={inquiry.product_spec || 'Not provided'} change={changeFor('product_spec')} />
        <SpecInfoRow label="Requirement Summary" value={inquiry.requirement_desc || 'Not provided'} change={changeFor('requirement_desc')} />
        <SpecInfoRow label="Detailed Requirement" value={inquiry.detailed_requirement || 'Not provided'} change={changeFor('detailed_requirement')} />
        <InfoRow label="Project Details" value={inquiry.project_details || 'Not provided'} />
      </Card>
    </div>
  )
}

function TasksTab({ inquiryId, canModify }: { inquiryId: number; canModify: boolean }) {
  const [tasks, setTasks] = useState<InquiryTask[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const emptyForm = { department: DEPARTMENTS[0], task_title: '', assigned_user_name: '', due_date: '', priority: 'Medium', status: 'Pending', remarks: '' }
  const [form, setForm] = useState(emptyForm)
  const load = () => crmApi.listInquiryTasks(inquiryId).then(setTasks)
  useEffect(() => { load() }, [inquiryId])

  const startEdit = (t: InquiryTask) => {
    setEditingId(t.id)
    setForm({ department: t.department, task_title: t.task_title, assigned_user_name: t.assigned_user_name || '', due_date: t.due_date || '', priority: t.priority, status: t.status, remarks: t.remarks || '' })
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.task_title.trim()) return
    const payload: Record<string, unknown> = { ...form }
    Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k] })
    if (editingId) await crmApi.updateInquiryTask(inquiryId, editingId, payload)
    else await crmApi.createInquiryTask(inquiryId, payload)
    cancelForm()
    load()
  }

  const updateStatus = async (taskId: number, status: string) => {
    await crmApi.updateInquiryTask(inquiryId, taskId, { status })
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => (showForm ? cancelForm() : setShowForm(true))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Task'}</button>
          {showForm && (
            <form onSubmit={save} onKeyDown={handleEnterAsTab} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Department">
                <select value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} style={inputStyle}>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Task Title"><input value={form.task_title} onChange={(e) => setForm((f) => ({ ...f, task_title: e.target.value }))} placeholder="Task description" style={inputStyle} /></Field>
              <Field label="Assigned To"><input value={form.assigned_user_name} onChange={(e) => setForm((f) => ({ ...f, assigned_user_name: e.target.value }))} placeholder="Person name" style={inputStyle} /></Field>
              <Field label="Due Date"><DateField value={form.due_date} onChange={(v) => setForm((f) => ({ ...f, due_date: v }))} /></Field>
              <Field label="Priority">
                <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} style={inputStyle}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={inputStyle}>
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Remarks"><textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" style={primaryBtnStyle}>{editingId ? 'Save Changes' : 'Save Task'}</button>
              </div>
            </form>
          )}
        </div>
      )}
      {tasks.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No tasks yet.</p>
      ) : (
        tasks.map((t) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{t.task_title} <span style={{ fontWeight: 500, color: '#78716c' }}>· {t.department}</span></p>
              <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>
                {t.assigned_user_name && `Assigned: ${t.assigned_user_name} · `}Priority: {t.priority} {t.due_date && `· Due: ${t.due_date}`}
              </p>
              {t.remarks && <p style={{ fontSize: 12, color: '#57534e', margin: '4px 0 0' }}>{t.remarks}</p>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select value={t.status} onChange={(e) => updateStatus(t.id, e.target.value)} disabled={!canModify} style={{ ...inputStyle, width: 140 }}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {canModify && <button onClick={() => startEdit(t)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Edit</button>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

const emptyLineItem = { description: '', model_number: '', quantity: '', unit_price: '', gst_percent: '', subtotal: '', total: '' }

function QuotationsTab({ inquiryId, canModify, org, contact, inquiry }: { inquiryId: number; canModify: boolean; org: Organization | null; contact: OrgContact | null; inquiry: Inquiry }) {
  const [quotations, setQuotations] = useState<QuotationItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [revisingId, setRevisingId] = useState<number | null>(null)
  const todayIso = new Date().toISOString().slice(0, 10)
  const emptyForm = {
    quotation_type: 'Domestic', gst_type: 'CGST_SGST', quote_date: todayIso, client_name: org?.name || '', client_contact_name: contact?.name || '',
    client_contact_email: contact?.email || '', client_contact_phone: contact?.mobile || '',
    technical_offer_number: inquiry?.technical_offer_number || '',
    technical_offer_date: inquiry?.technical_offer_sent_at ? String(inquiry.technical_offer_sent_at).slice(0, 10) : '',
    valid_until: '', delivery_time: '', payment_terms: '', notes: '',
    discount: '', discount_type: 'percent', quote_conditions: '', quote_conditions_custom: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([{ ...emptyLineItem }])
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [pdfError, setPdfError] = useState('')
  const [formError, setFormError] = useState('')
  const [products, setProducts] = useState<{ id: number; name: string; model_number?: string | null; unit_price?: number | null; default_price?: number | null }[]>([])
  const [paymentTerms, setPaymentTerms] = useState<{ id: number; label: string; description?: string | null }[]>([])
  const [quotRevisions, setQuotRevisions] = useState<Record<number, SpecRevision[]>>({})
  const [selectedQuotRev, setSelectedQuotRev] = useState<Record<number, number | null>>({})
  const load = () => {
    crmApi.listQuotations(inquiryId).then((data: QuotationItem[]) => {
      setQuotations(data)
      data.filter((q) => q.revision_number > 0).forEach((q) => {
        crmApi.getQuotationRevisions(inquiryId, q.id).then((revs) => setQuotRevisions((m) => ({ ...m, [q.id]: revs }))).catch(() => {})
      })
    })
  }
  // Status tracking, not a revision — updates independently of the price/payment-terms
  // revision flow, so it lives outside ReviseQuotationForm as its own control.
  const updateCustomerResponse = async (quotId: number, value: string) => {
    await crmApi.updateQuotation(inquiryId, quotId, { customer_response: value || undefined })
    load()
  }
  useEffect(() => { load() }, [inquiryId])
  useEffect(() => {
    crmApi.listProducts().then(setProducts).catch(() => {})
    crmApi.listPaymentTerms().then(setPaymentTerms).catch(() => {})
  }, [])

  const applyProductToRow = (idx: number, product: { name: string; model_number?: string | null; default_price?: number | null }) => {
    setItems((rows) => rows.map((row, i) => i === idx ? {
      ...row,
      description: product.name,
      model_number: product.model_number || '',
      unit_price: product.default_price != null ? String(product.default_price) : row.unit_price,
    } : row))
  }

  // Saves whatever the user already typed into that row's Description/Model No. fields as a
  // new Product — no separate popup, since the row's own inputs already hold the values.
  const createProductFromRow = async (idx: number, typedName: string) => {
    const row = items[idx]
    const name = typedName.trim()
    if (!name) return
    const created = await crmApi.createProduct({
      name,
      model_number: row.model_number.trim() || undefined,
      default_price: row.unit_price ? Number(row.unit_price) : undefined,
    })
    setProducts((p) => [...p, created])
    updateItemRow(idx, 'description', created.name)
  }

  // Saves whatever the user already typed into the Payment Terms field as a new Payment Term —
  // no separate popup, the typed text becomes both the label and the terms text.
  const createPaymentTermFromField = async (typedText: string) => {
    const text = typedText.trim()
    if (!text) return
    const created = await crmApi.createPaymentTerm({ label: text, description: text })
    setPaymentTerms((p) => [...p, created])
    setForm((f) => ({ ...f, payment_terms: created.description || created.label }))
  }

  useEffect(() => {
    if (showForm) return
    setForm((f) => ({
      ...f,
      client_name: f.client_name || org?.name || '',
      client_contact_name: f.client_contact_name || contact?.name || '',
      client_contact_email: f.client_contact_email || contact?.email || '',
      client_contact_phone: f.client_contact_phone || contact?.mobile || '',
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, contact])

  const downloadPdf = async (q: QuotationItem) => {
    setDownloadingId(q.id)
    setPdfError('')
    try {
      const blob = await crmApi.downloadQuotationPdf(inquiryId, q.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${q.quot_number || `Quotation-${q.id}`}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setPdfError('PDF generation failed.')
    } finally {
      setDownloadingId(null)
    }
  }

  const cancelForm = () => {
    setForm(emptyForm)
    setItems([{ ...emptyLineItem }])
    setFormError('')
    setShowForm(false)
  }

  const addItemRow = () => setItems((rows) => [...rows, { ...emptyLineItem }])
  const removeItemRow = (idx: number) => setItems((rows) => rows.filter((_, i) => i !== idx))
  const updateItemRow = (idx: number, field: keyof typeof emptyLineItem, value: string) =>
    setItems((rows) => rows.map((row, i) => {
      if (i !== idx) return row
      const updated = { ...row, [field]: value }
      if (field === 'quantity' || field === 'unit_price' || field === 'gst_percent') {
        const qty = Number(updated.quantity) || 0
        const price = Number(updated.unit_price) || 0
        const gst = form.quotation_type === 'Export' ? 0 : Number(updated.gst_percent) || 0
        const subtotal = qty * price
        const total = subtotal + subtotal * (gst / 100)
        updated.subtotal = subtotal ? String(Number(subtotal.toFixed(2))) : ''
        updated.total = subtotal ? String(Number(total.toFixed(2))) : ''
      }
      return updated
    }))
  const grandTotal = items.reduce((sum, it) => sum + (Number(it.total) || 0), 0)

  useEffect(() => {
    setItems((rows) => rows.map((row) => {
      const qty = Number(row.quantity) || 0
      const price = Number(row.unit_price) || 0
      const gst = form.quotation_type === 'Export' ? 0 : Number(row.gst_percent) || 0
      const subtotal = qty * price
      const total = subtotal + subtotal * (gst / 100)
      return { ...row, subtotal: subtotal ? String(Number(subtotal.toFixed(2))) : row.subtotal, total: subtotal ? String(Number(total.toFixed(2))) : row.total }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.quotation_type])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.client_name.trim()) {
      setFormError('Client Name is required.')
      return
    }
    const validItems = items.filter((it) => it.description || it.model_number || it.quantity || it.unit_price)
    if (validItems.length === 0) {
      setFormError('Add at least one line item.')
      return
    }
    const { quote_conditions_custom, ...rest } = form
    const payload: Record<string, unknown> = {
      ...rest,
      discount: form.discount ? Number(form.discount) : undefined,
      discount_type: form.discount ? form.discount_type : undefined,
      quote_conditions: form.quote_conditions === 'Other/Custom' ? (quote_conditions_custom || undefined) : (form.quote_conditions || undefined),
      items: validItems
        .map((it) => ({
          description: it.description || undefined,
          model_number: it.model_number || undefined,
          quantity: it.quantity ? Number(it.quantity) : undefined,
          unit_price: it.unit_price ? Number(it.unit_price) : undefined,
          gst_percent: form.quotation_type === 'Export' || !it.gst_percent ? undefined : Number(it.gst_percent),
          subtotal: it.subtotal ? Number(it.subtotal) : undefined,
          total: it.total ? Number(it.total) : undefined,
        })),
    }
    // Date fields (and any other optional field left blank) must be omitted, not sent as ''
    // — the backend expects a real date or nothing, and an empty string fails validation.
    Object.keys(payload).forEach((k) => {
      if (payload[k] === '') delete payload[k]
    })
    try {
      await crmApi.createQuotation(inquiryId, payload)
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || 'Failed to save quotation.')
      return
    }
    cancelForm()
    load()
  }

  const isExport = form.quotation_type === 'Export'
  const currencySymbol = isExport ? '$' : '₹'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => (showForm ? cancelForm() : (setFormError(''), setShowForm(true)))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Create Quote'}</button>
          {showForm && (
            <form
              onSubmit={save}
              onKeyDown={handleEnterAsTab}
              style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {formError && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                  {formError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Quotation Type">
                  <select value={form.quotation_type} onChange={(e) => setForm((f) => ({ ...f, quotation_type: e.target.value }))} style={inputStyle}>
                    <option value="Domestic">Domestic (INR)</option>
                    <option value="Export">Export (USD)</option>
                  </select>
                </Field>
                {!isExport && (
                  <Field label="GST Type">
                    <select value={form.gst_type} onChange={(e) => setForm((f) => ({ ...f, gst_type: e.target.value }))} style={inputStyle}>
                      <option value="CGST_SGST">CGST + SGST (Intra-state)</option>
                      <option value="IGST">IGST (Inter-state)</option>
                    </select>
                  </Field>
                )}
                <Field label="Date of Quote"><DateField value={form.quote_date} onChange={(v) => setForm((f) => ({ ...f, quote_date: v }))} /></Field>
                <Field label="Technical Offer Number"><input value={form.technical_offer_number} onChange={(e) => setForm((f) => ({ ...f, technical_offer_number: e.target.value }))} style={inputStyle} /></Field>
                <Field label="Technical Offer Date"><DateField value={form.technical_offer_date} onChange={(v) => setForm((f) => ({ ...f, technical_offer_date: v }))} /></Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Client Name *"><input value={form.client_name} onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))} style={inputStyle} /></Field>
                <Field label="Contact Person Name"><input value={form.client_contact_name} onChange={(e) => setForm((f) => ({ ...f, client_contact_name: e.target.value }))} style={inputStyle} /></Field>
                <Field label="Contact Email"><input type="email" value={form.client_contact_email} onChange={(e) => setForm((f) => ({ ...f, client_contact_email: e.target.value }))} style={inputStyle} /></Field>
                <Field label="Contact Phone"><input value={form.client_contact_phone} onChange={(e) => setForm((f) => ({ ...f, client_contact_phone: e.target.value }))} style={inputStyle} /></Field>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#57534e', marginBottom: 6, display: 'block' }}>Line Items *</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((row, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: isExport ? '2fr 1.2fr 0.7fr 0.9fr 0.9fr auto' : '2fr 1.2fr 0.7fr 0.9fr 0.7fr 0.9fr auto', gap: 6, alignItems: 'center' }}>
                      <ComboBox
                        value={row.description}
                        onChange={(v) => updateItemRow(idx, 'description', v)}
                        onPick={(o) => { const p = products.find((pr) => String(pr.id) === o.key); if (p) applyProductToRow(idx, p) }}
                        onCreateNew={(query) => createProductFromRow(idx, query)}
                        createLabel="New Product"
                        options={products.map((p) => ({ key: String(p.id), label: p.name, sublabel: p.model_number || undefined }))}
                        placeholder="Description — type or pick a product"
                      />
                      <input value={row.model_number} onChange={(e) => updateItemRow(idx, 'model_number', e.target.value)} placeholder="Model No." style={inputStyle} />
                      <input type="number" value={row.quantity} onChange={(e) => updateItemRow(idx, 'quantity', e.target.value)} placeholder="Qty" style={inputStyle} />
                      <input type="number" value={row.unit_price} onChange={(e) => updateItemRow(idx, 'unit_price', e.target.value)} placeholder={`Price/unit (${currencySymbol})`} style={inputStyle} />
                      {!isExport && <input type="number" value={row.gst_percent} onChange={(e) => updateItemRow(idx, 'gst_percent', e.target.value)} placeholder="GST %" style={inputStyle} />}
                      <input type="number" value={row.subtotal} readOnly placeholder="Subtotal" style={{ ...inputStyle, background: 'rgba(0,0,0,0.04)', color: '#57534e' }} />
                      <button type="button" onClick={() => removeItemRow(idx)} style={{ ...secondaryBtnStyle, padding: '6px 10px', fontSize: 11 }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={addItemRow} style={{ ...secondaryBtnStyle, padding: '6px 14px', fontSize: 12 }}>+ Add Line Item</button>
                </div>
                <p style={{ marginTop: 10, fontSize: 13.5, fontWeight: 700, color: '#1f1108', textAlign: 'right' }}>
                  Grand Total: {currencySymbol}{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Delivery Time"><input value={form.delivery_time} onChange={(e) => setForm((f) => ({ ...f, delivery_time: e.target.value }))} placeholder="e.g. 12 weeks" style={inputStyle} /></Field>
                <Field label="Quote Validity Date"><DateField value={form.valid_until} onChange={(v) => setForm((f) => ({ ...f, valid_until: v }))} /></Field>
                <Field label="Discount">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} placeholder="0" style={inputStyle} />
                    <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))} style={{ ...inputStyle, width: 90, flex: '0 0 90px' }}>
                      <option value="percent">%</option>
                      <option value="flat">{isExport ? 'USD' : 'INR'}</option>
                    </select>
                  </div>
                </Field>
                <Field label="Quote Conditions">
                  <select value={form.quote_conditions} onChange={(e) => setForm((f) => ({ ...f, quote_conditions: e.target.value }))} style={inputStyle}>
                    <option value="">— Select —</option>
                    {QUOTE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              {form.quote_conditions === 'Other/Custom' && (
                <Field label="Custom Quote Conditions">
                  <textarea value={form.quote_conditions_custom} onChange={(e) => setForm((f) => ({ ...f, quote_conditions_custom: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                </Field>
              )}
              <Field label="Payment Terms">
                <ComboBox
                  value={form.payment_terms}
                  onChange={(v) => setForm((f) => ({ ...f, payment_terms: v }))}
                  onPick={(o) => { const t = paymentTerms.find((pt) => String(pt.id) === o.key); setForm((f) => ({ ...f, payment_terms: t ? (t.description || t.label) : o.label })) }}
                  onCreateNew={(query) => createPaymentTermFromField(query)}
                  createLabel="New Payment Term"
                  options={paymentTerms.map((t) => ({ key: String(t.id), label: t.label, sublabel: t.description || undefined }))}
                  placeholder="Select from Payment Terms list or type your own"
                />
              </Field>
              <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              <div>
                <button type="submit" style={primaryBtnStyle}>Save Quotation</button>
              </div>
            </form>
          )}
        </div>
      )}
      {quotations.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No quotations yet.</p>
      ) : (
        quotations.map((q) => (
          <div key={q.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>
                  {q.quot_number} · {q.quotation_type}
                </p>
                {(quotRevisions[q.id]?.length || 0) > 0 && (
                  <RevisionSelector
                    revisions={quotRevisions[q.id]}
                    selectedId={selectedQuotRev[q.id] ?? null}
                    onSelect={(id) => setSelectedQuotRev((m) => ({ ...m, [q.id]: id }))}
                  />
                )}
              </div>
              {selectedQuotRev[q.id] != null && (() => {
                const rev = quotRevisions[q.id]?.find((r) => r.id === selectedQuotRev[q.id])
                if (!rev) return null
                return (
                  <div style={{ marginBottom: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,122,69,0.06)', border: '1px dashed rgba(255,122,69,0.3)' }}>
                    {rev.changes.map((c, i) => (
                      <p key={i} style={{ fontSize: 12, margin: i === 0 ? 0 : '2px 0 0' }}>
                        <strong>{quotationRevisionFieldLabel(c.field)}:</strong>{' '}
                        <span style={{ color: '#b91c1c', textDecoration: 'line-through' }}>{c.old == null || String(c.old).trim() === '' ? '(empty)' : String(c.old)}</span>
                        {' → '}
                        <span style={{ color: '#166534', fontWeight: 600 }}>{c.new == null || String(c.new).trim() === '' ? '(empty)' : String(c.new)}</span>
                      </p>
                    ))}
                  </div>
                )
              })()}
              <p style={{ fontSize: 12.5, color: '#57534e', margin: 0, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {q.client_name || '—'} · {q.delivery_time || '—'} ·
                {canModify ? (
                  <select
                    value={q.customer_response || ''}
                    onChange={(e) => updateCustomerResponse(q.id, e.target.value)}
                    style={{ ...inputStyle, width: 'auto', padding: '3px 8px', fontSize: 12.5 }}
                  >
                    <option value="">— Awaiting —</option>
                    {CUSTOMER_RESPONSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (q.customer_response || '— Awaiting —')}
                {q.valid_until && ` · Valid: ${q.valid_until}`}{q.submitted_date && ` · Submitted: ${q.submitted_date}`}
                {q.discount != null && ` · Discount: ${q.discount_type === 'flat' ? (q.quotation_type === 'Export' ? 'USD ' : 'INR ') : ''}${q.discount}${q.discount_type === 'flat' ? '' : '%'}`}
              </p>
              {q.quote_conditions && <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>Conditions: {q.quote_conditions}</p>}
              {q.client_contact_name && (
                <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>
                  Contact: {q.client_contact_name}{q.client_contact_email && ` · ${q.client_contact_email}`}{q.client_contact_phone && ` · ${q.client_contact_phone}`}
                </p>
              )}
              {q.items.length > 0 && (
                <div style={{ marginTop: 8, overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: '#78716c' }}>
                        <th style={{ textAlign: 'left', padding: '2px 10px 2px 0' }}>Description</th>
                        <th style={{ textAlign: 'left', padding: '2px 10px' }}>Model No.</th>
                        <th style={{ textAlign: 'right', padding: '2px 10px' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '2px 10px' }}>Price/Unit</th>
                        {q.quotation_type !== 'Export' && <th style={{ textAlign: 'right', padding: '2px 10px' }}>GST %</th>}
                        <th style={{ textAlign: 'right', padding: '2px 10px' }}>Subtotal</th>
                        <th style={{ textAlign: 'right', padding: '2px 0 2px 10px' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.items.map((it: QuotationLineItem) => (
                        <tr key={it.id}>
                          <td style={{ padding: '2px 10px 2px 0' }}>{it.description || '—'}</td>
                          <td style={{ padding: '2px 10px' }}>{it.model_number || '—'}</td>
                          <td style={{ textAlign: 'right', padding: '2px 10px' }}>{it.quantity ?? '—'}</td>
                          <td style={{ textAlign: 'right', padding: '2px 10px' }}>{it.unit_price ?? '—'}</td>
                          {q.quotation_type !== 'Export' && <td style={{ textAlign: 'right', padding: '2px 10px' }}>{it.gst_percent ?? '—'}</td>}
                          <td style={{ textAlign: 'right', padding: '2px 10px' }}>{it.subtotal ?? '—'}</td>
                          <td style={{ textAlign: 'right', padding: '2px 0 2px 10px' }}>{it.total ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={q.quotation_type !== 'Export' ? 6 : 5} style={{ textAlign: 'right', padding: '4px 10px 0 0', fontWeight: 600, color: '#1f1108' }}>Grand Total</td>
                        <td style={{ textAlign: 'right', padding: '4px 0 0 10px', fontWeight: 600, color: '#1f1108' }}>
                          {q.items.reduce((sum, it) => sum + (Number(it.total) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {q.payment_terms && <p style={{ fontSize: 12, color: '#57534e', margin: '4px 0 0' }}>Payment: {q.payment_terms}</p>}
              {q.notes && <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>{q.notes}</p>}
              {revisingId === q.id && (
                <ReviseQuotationForm
                  inquiryId={inquiryId}
                  quotation={q}
                  paymentTerms={paymentTerms}
                  onCreatePaymentTerm={createPaymentTermFromField}
                  onCancel={() => setRevisingId(null)}
                  onSaved={() => { setRevisingId(null); load() }}
                />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <button onClick={() => downloadPdf(q)} disabled={downloadingId === q.id} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, opacity: downloadingId === q.id ? 0.7 : 1 }}>
                {downloadingId === q.id ? 'Generating…' : 'Download PDF'}
              </button>
              {canModify && (
                <button onClick={() => setRevisingId((id) => (id === q.id ? null : q.id))} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>
                  {revisingId === q.id ? 'Cancel' : 'Revise'}
                </button>
              )}
            </div>
          </div>
        ))
      )}
      {pdfError && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{pdfError}</p>}
    </div>
  )
}

/**
 * Post-creation edits to a quotation are deliberately limited to price/unit, payment terms,
 * validity, and delivery time (plus status tracking) — everything else about the quote is
 * fixed once created. A bigger change means creating a new quotation for the inquiry instead.
 * Each save here bumps the quote's revision number and is recorded in its revision history.
 */
function ReviseQuotationForm({
  inquiryId, quotation, paymentTerms, onCreatePaymentTerm, onCancel, onSaved,
}: {
  inquiryId: number
  quotation: QuotationItem
  paymentTerms: { id: number; label: string; description?: string | null }[]
  onCreatePaymentTerm: (text: string) => Promise<void>
  onCancel: () => void
  onSaved: () => void
}) {
  const [paymentTermsValue, setPaymentTermsValue] = useState(quotation.payment_terms || '')
  const [validUntil, setValidUntil] = useState(quotation.valid_until || '')
  const [deliveryTime, setDeliveryTime] = useState(quotation.delivery_time || '')
  const [itemPrices, setItemPrices] = useState<Record<number, string>>(
    Object.fromEntries(quotation.items.map((it) => [it.id, it.unit_price != null ? String(it.unit_price) : '']))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    const payload: Record<string, unknown> = {
      payment_terms: paymentTermsValue || undefined,
      valid_until: validUntil || undefined,
      delivery_time: deliveryTime || undefined,
      items: quotation.items
        .filter((it) => itemPrices[it.id] !== '' && Number(itemPrices[it.id]) !== it.unit_price)
        .map((it) => ({ id: it.id, unit_price: Number(itemPrices[it.id]) })),
    }
    try {
      await crmApi.updateQuotation(inquiryId, quotation.id, payload)
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save revision.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: 'rgba(255,122,69,0.05)', border: '1px dashed rgba(255,122,69,0.3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>{error}</p>}
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#c2410c', margin: 0 }}>
        Revise Quotation — price, payment terms, validity, delivery time only
      </p>
      {quotation.items.length > 0 && (
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#78716c', marginBottom: 6, display: 'block' }}>Price / Unit</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {quotation.items.map((it) => (
              <div key={it.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: '#57534e' }}>{it.description || `Item #${it.id}`}{it.model_number ? ` · ${it.model_number}` : ''}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#a8a29e', flexShrink: 0 }}>Price/unit</span>
                  <input
                    type="number"
                    value={itemPrices[it.id] ?? ''}
                    onChange={(e) => setItemPrices((p) => ({ ...p, [it.id]: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <Field label="Payment Terms">
          <ComboBox
            value={paymentTermsValue}
            onChange={setPaymentTermsValue}
            onPick={(o) => { const t = paymentTerms.find((pt) => String(pt.id) === o.key); setPaymentTermsValue(t ? (t.description || t.label) : o.label) }}
            onCreateNew={(query) => onCreatePaymentTerm(query).then(() => setPaymentTermsValue(query))}
            createLabel="New Payment Term"
            options={paymentTerms.map((t) => ({ key: String(t.id), label: t.label, sublabel: t.description || undefined }))}
            placeholder="Payment Terms"
          />
        </Field>
        <Field label="Quote Validity Date"><DateField value={validUntil} onChange={setValidUntil} /></Field>
        <Field label="Delivery Time"><input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} placeholder="e.g. 12 weeks" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, padding: '6px 14px', fontSize: 12, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save Revision'}
        </button>
        <button type="button" onClick={onCancel} style={{ ...secondaryBtnStyle, padding: '6px 14px', fontSize: 12 }}>Cancel</button>
      </div>
    </div>
  )
}

const QUOTATION_REVISION_FIELD_LABELS: Record<string, string> = {
  payment_terms: 'Payment Terms', valid_until: 'Quote Validity', delivery_time: 'Delivery Time',
}

function quotationRevisionFieldLabel(field: string): string {
  if (field.startsWith('item_') && field.endsWith('_unit_price')) return 'Price'
  return QUOTATION_REVISION_FIELD_LABELS[field] || field
}

function PurchaseOrdersTab({ inquiryId, orgId, canModify }: { inquiryId: number; orgId: number; canModify: boolean }) {
  const [pos, setPos] = useState<PurchaseOrderItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const emptyForm = { po_number: '', po_date: '', po_value: '', delivery_schedule: '', special_conditions: '', status: 'Active' }
  const [form, setForm] = useState(emptyForm)
  const load = () => crmApi.listInquiryPurchaseOrders(inquiryId).then(setPos)
  useEffect(() => { load() }, [inquiryId])

  const startEdit = (po: PurchaseOrderItem) => {
    setEditingId(po.id)
    setForm({
      po_number: po.po_number || '', po_date: po.po_date || '', po_value: po.po_value != null ? String(po.po_value) : '',
      delivery_schedule: po.delivery_schedule || '', special_conditions: po.special_conditions || '', status: po.status || 'Active',
    })
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = { ...form, po_value: form.po_value ? Number(form.po_value) : undefined }
    Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k] })
    if (editingId) await crmApi.updatePurchaseOrder(editingId, payload)
    else await crmApi.createInquiryPurchaseOrder(inquiryId, { ...payload, org_id: orgId })
    cancelForm()
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => (showForm ? cancelForm() : setShowForm(true))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add PO'}</button>
          {showForm && (
            <form onSubmit={save} onKeyDown={handleEnterAsTab} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="PO Number"><input value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} style={inputStyle} /></Field>
              <Field label="PO Date"><DateField value={form.po_date} onChange={(v) => setForm((f) => ({ ...f, po_date: v }))} /></Field>
              <Field label="PO Value (₹)"><input type="number" value={form.po_value} onChange={(e) => setForm((f) => ({ ...f, po_value: e.target.value }))} style={inputStyle} /></Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Delivery Schedule"><textarea value={form.delivery_schedule} onChange={(e) => setForm((f) => ({ ...f, delivery_schedule: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Special Conditions"><textarea value={form.special_conditions} onChange={(e) => setForm((f) => ({ ...f, special_conditions: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" style={primaryBtnStyle}>{editingId ? 'Save Changes' : 'Save PO'}</button>
              </div>
            </form>
          )}
        </div>
      )}
      {pos.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No sales yet.</p>
      ) : (
        pos.map((po) => (
          <div key={po.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{po.po_number || `PO #${po.id}`}</p>
              <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>
                {po.po_value != null ? `₹${po.po_value.toLocaleString()}` : '—'} · {po.status}{po.po_date && ` · ${po.po_date}`}
              </p>
              {po.delivery_schedule && <p style={{ fontSize: 12, color: '#57534e', margin: '4px 0 0' }}>Delivery: {po.delivery_schedule}</p>}
              {po.special_conditions && <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>{po.special_conditions}</p>}
            </div>
            {canModify && <button onClick={() => startEdit(po)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>Edit</button>}
          </div>
        ))
      )}
    </div>
  )
}

function DocumentsTab({ inquiry, canModify, isAdmin }: { inquiry: Inquiry; canModify: boolean; isAdmin: boolean }) {
  const [documents, setDocuments] = useState<CrmDocument[]>([])
  const [error, setError] = useState('')

  const load = () => crmApi.listDocuments({ related_module: 'inquiry', related_id: inquiry.id }).then(setDocuments)
  useEffect(() => { load() }, [inquiry.id])

  const remove = async (id: number) => {
    await crmApi.deleteDocument(id)
    load()
  }

  const clientDocs = documents.filter((d) => d.folder_type === 'client')
  const internalDocs = documents.filter((d) => d.folder_type === 'internal')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <DocumentFolderPanel title="Client Documents" folderType="client" docs={clientDocs} inquiry={inquiry} canModify={canModify} canDelete={isAdmin} onUploaded={load} onRemove={remove} error={error} setError={setError} />
      <DocumentFolderPanel title="Internal Documents" folderType="internal" docs={internalDocs} inquiry={inquiry} canModify={canModify} canDelete={isAdmin} onUploaded={load} onRemove={remove} error={error} setError={setError} />
    </div>
  )
}

function DocumentFolderPanel({ title, folderType, docs, inquiry, canModify, canDelete, onUploaded, onRemove, error, setError }: {
  title: string
  folderType: 'client' | 'internal'
  docs: CrmDocument[]
  inquiry: Inquiry
  canModify: boolean
  canDelete: boolean
  onUploaded: () => void
  onRemove: (id: number) => void
  error: string
  setError: (v: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [docCategory, setDocCategory] = useState(DOC_CATEGORIES[DOC_CATEGORIES.length - 1])
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      await crmApi.uploadDocuments(
        { related_module: 'inquiry', related_id: inquiry.id, folder_type: folderType, doc_category: docCategory, universal_id: inquiry.universal_id, org_id: inquiry.org_id },
        Array.from(files)
      )
      onUploaded()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div style={{ position: 'relative', padding: 16, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {uploading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, borderRadius: 14, background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid rgba(255,122,69,0.2)', borderTopColor: '#FF7A45', animation: 'crm-spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45' }}>Uploading…</span>
          <style>{'@keyframes crm-spin { to { transform: rotate(360deg) } }'}</style>
        </div>
      )}
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: 0 }}>{title}</p>
      {docs.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>None</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
              <div>
                <a
                  href="#"
                  onClick={async (e) => {
                    e.preventDefault()
                    try {
                      const blob = await crmApi.getDocumentContent(d.id)
                      window.open(URL.createObjectURL(blob), '_blank')
                    } catch {
                      setError('Unable to open document.')
                    }
                  }}
                  style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none', cursor: 'pointer' }}
                >{d.file_name}</a>
                <p style={{ fontSize: 11, color: '#a8a29e', margin: '2px 0 0' }}>{d.doc_category || '—'}</p>
              </div>
              {canDelete && <button onClick={() => onRemove(d.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Delete</button>}
            </div>
          ))}
        </div>
      )}
      {canModify && (
        <div style={{ paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#78716c', margin: 0 }}>Upload {title.slice(0, -1)}</p>
          <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} style={inputStyle}>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple onChange={(e) => handleUpload(e.target.files)} disabled={uploading} style={inputStyle} />
        </div>
      )}
      {error && <p style={{ fontSize: 12.5, color: '#b91c1c' }}>{error}</p>}
    </div>
  )
}

function DiscussionTab({ inquiryId }: { inquiryId: number }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<CrmDiscussionItem[]>([])
  const [deptFilter, setDeptFilter] = useState('')
  const [text, setText] = useState('')
  const load = () => crmApi.listInquiryDiscussions(inquiryId).then(setMessages)
  useEffect(() => { load() }, [inquiryId])

  const send = async () => {
    if (!text.trim()) return
    await crmApi.createInquiryDiscussion(inquiryId, { message: text, department: deptFilter || undefined })
    setText('')
    load()
  }

  const visible = deptFilter ? messages.filter((m) => m.department === deptFilter) : messages

  return (
    <div style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: 0 }}>Internal Discussion</p>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} style={{ ...inputStyle, width: 200 }}>
          <option value="">All Departments</option>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div style={{ padding: 16, minHeight: 200, maxHeight: 384, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', fontStyle: 'italic' }}>No messages yet. Start the discussion!</p>
        ) : (
          visible.map((m) => (
            <div key={m.id} style={{ padding: '10px 14px', borderRadius: 10, background: m.sent_by_id === user?.id ? 'rgba(244,113,59,0.06)' : '#fffaf5', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{m.sent_by_name || 'Unknown'} {m.department && <span style={{ fontWeight: 500, color: '#a8a29e' }}>· {m.department}</span>}</p>
              <p style={{ fontSize: 13, color: '#57534e', margin: 0, whiteSpace: 'pre-wrap' }}>{m.message}</p>
            </div>
          ))
        )}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Type your message and press Send…"
          rows={2}
          style={{ ...inputStyle, flex: 1, resize: 'none' }}
        />
        <button onClick={send} style={primaryBtnStyle}>Send</button>
      </div>
    </div>
  )
}

function MailsTab() {
  return (
    <div style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: 40, textAlign: 'center' }}>
      <p style={{ fontSize: 13, color: '#a8a29e', fontStyle: 'italic', margin: 0 }}>Email integration coming soon.</p>
    </div>
  )
}

function ActivitiesTab({ inquiry, org }: { inquiry: Inquiry; org: Organization | null }) {
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingActivity, setEditingActivity] = useState<CrmActivity | null>(null)
  const [viewingActivity, setViewingActivity] = useState<CrmActivity | null>(null)
  const [exportingMomId, setExportingMomId] = useState<number | null>(null)
  const [momError, setMomError] = useState('')

  const load = () => crmApi.listActivities({ related_module: 'inquiry', related_id: inquiry.id }).then(setActivities)
  useEffect(() => { load() }, [inquiry.id])

  const exportMom = async (a: CrmActivity) => {
    setExportingMomId(a.id)
    setMomError('')
    try {
      const blob = await crmApi.exportActivityMom(a.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const orgSlug = (org?.name || 'Activity').replace(/\s+/g, '_').replace(/\//g, '-')
      const dateSlug = (a.created_at || '').slice(0, 10).replace(/-/g, '') || 'undated'
      link.download = `MOM_${orgSlug}_${dateSlug}.docx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setMomError('MoM export failed.')
    } finally {
      setExportingMomId(null)
    }
  }

  const startEdit = (a: CrmActivity) => {
    setEditingActivity(a)
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingActivity(null)
    setShowForm(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => { if (showForm) cancelForm(); else { setEditingActivity(null); setShowForm(true) } }} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Follow Up'}</button>
      </div>
      {momError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{momError}</div>
      )}
      {showForm && (
        <ActivityForm
          initial={editingActivity || { org_id: inquiry.org_id, related_module: 'inquiry', related_id: inquiry.id, universal_id: inquiry.universal_id }}
          submitLabel={editingActivity ? 'Save Changes' : 'Add Follow Up'}
          onCancel={cancelForm}
          onSubmit={async (payload, photos) => {
            const saved = editingActivity
              ? await crmApi.updateActivity(editingActivity.id, payload)
              : await crmApi.createActivity(payload)
            if (photos.length) await crmApi.uploadActivityAttachments(saved.id, photos)
            cancelForm()
            load()
          }}
        />
      )}
      {!showForm && (activities.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No follow-ups logged.</p>
      ) : (
        activities.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>
                {a.activity_type || 'Activity'} {a.assigned_to && <span title={`Contact Person: ${a.assigned_to}`} style={{ fontWeight: 500, color: '#78716c' }}>· {a.assigned_to}</span>}
                {a.created_at && <span title={`Created: ${new Date(a.created_at).toLocaleString('en-GB')}`} style={{ fontWeight: 500, color: '#a8a29e' }}> · {new Date(a.created_at).toLocaleString('en-GB')}</span>}
              </p>
              {a.mom_items?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {a.mom_items.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#57534e' }}>
                      <span style={{ fontWeight: 600, color: '#a8a29e' }}>{i + 1}.</span> {item.observation || '—'}
                      {item.action_plan && <span> · Action Plan: {item.action_plan}</span>}
                      <span> · Responsibility: {item.responsibility || '—'}</span>
                      <span> · Target: {item.target_date || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {a.remarks ? <RichText html={a.remarks} style={{ fontSize: 12, color: '#57534e' }} /> : <p style={{ fontSize: 12, color: '#57534e', margin: 0 }}>—</p>}
                  {a.next_followup && <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '2px 0 0' }}>Due: {a.next_followup}</p>}
                  {a.action_plan && (
                    <div style={{ marginTop: 2 }}>
                      <span style={{ fontSize: 12, color: '#78716c', fontWeight: 600 }}>Action Plan: </span>
                      <RichText html={a.action_plan} style={{ fontSize: 12, color: '#78716c', display: 'inline' }} />
                    </div>
                  )}
                </>
              )}
              <ActivityPhotos attachments={a.attachments} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setViewingActivity(a)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>View</button>
              <button onClick={() => startEdit(a)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Edit</button>
              <button disabled={exportingMomId === a.id} onClick={() => exportMom(a)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, opacity: exportingMomId === a.id ? 0.7 : 1 }}>
                {exportingMomId === a.id ? 'Exporting…' : 'Export MoM'}
              </button>
            </div>
          </div>
        ))
      ))}

      <ActivityViewDialog activity={viewingActivity} onClose={() => setViewingActivity(null)} />
    </div>
  )
}

type TimelineEntry = {
  key: string
  kind: 'created' | 'updated' | 'deleted' | 'stage' | 'followup' | 'quotation' | 'info' | 'email' | 'email_failed'
  title: string
  detail?: string
  by?: string
  date: string | null
}

const TIMELINE_KIND_STYLE: Record<TimelineEntry['kind'], { bg: string; text: string; label: string }> = {
  created: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', label: 'Created' },
  updated: { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8', label: 'Updated' },
  deleted: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Deleted' },
  stage: { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed', label: 'Stage' },
  followup: { bg: 'rgba(249,115,22,0.12)', text: '#c2410c', label: 'Follow Up' },
  quotation: { bg: 'rgba(234,179,8,0.14)', text: '#a16207', label: 'Quotation' },
  info: { bg: 'rgba(99,102,241,0.12)', text: '#4338ca', label: 'Info Update' },
  email: { bg: 'rgba(13,148,136,0.12)', text: '#0f766e', label: 'Email Sent' },
  email_failed: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Email Failed' },
}

function auditActionKind(action: string): TimelineEntry['kind'] {
  if (action === 'created') return 'created'
  if (action === 'deleted') return 'deleted'
  if (action.endsWith('_sent')) return 'email'
  if (action.endsWith('_failed')) return 'email_failed'
  return 'updated'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Renders a spec revision's field-level changes as "old → new" lines for the Timeline detail.
 * When only one field changed, its label is already the entry's title, so it's dropped here
 * to avoid repeating it twice; with multiple fields each line is prefixed with its label.
 */
function specRevisionDetailHtml(changes: { field: string; old: unknown; new: unknown }[]): string {
  const single = changes.length === 1
  return changes.map((c) => {
    const label = AUDIT_FIELD_LABELS[c.field] || c.field
    const oldText = c.old == null || String(c.old).trim() === '' ? '(empty)' : String(c.old)
    const newText = c.new == null || String(c.new).trim() === '' ? '(empty)' : String(c.new)
    const prefix = single ? '' : `<strong>${escapeHtml(label)}:</strong> `
    return `<div>${prefix}<span style="color:#b91c1c;text-decoration:line-through;">${escapeHtml(oldText)}</span> → <span style="color:#166534;font-weight:600;">${escapeHtml(newText)}</span></div>`
  }).join('')
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  product_category: 'Category', product: 'Product', quantity: 'Quantity', unit: 'Unit',
  required_delivery_date: 'Required Delivery Date', delivery_location: 'Delivery Location',
  inspection_req: 'Inspection Requirement', warranty_req: 'Warranty Requirement', product_spec: 'Specification',
  requirement_desc: 'Requirement Summary', detailed_requirement: 'Detailed Requirement', project_details: 'Project Details',
  railway_zone: 'Railway Zone', division: 'Division', lead_source: 'Lead Source', bd_owner: 'BD Owner',
  sales_engineer: 'Sales Engineer', status: 'Status', current_stage: 'Stage', budget: 'Budget',
  expected_value: 'Expected Value', probability: 'Probability', expected_order_date: 'Expected Order Date',
  priority: 'Priority', next_followup_date: 'Follow-up Date', followup_priority: 'Follow-up Priority',
  followup_assigned_to: 'Follow-up Assigned To', followup_remarks: 'Follow-up Remarks',
  org_id: 'Organization', org_contact_id: 'Contact',
}

/**
 * Audit summaries were historically stored as free text, e.g. "Name updated: field1, field2."
 * The name is shown separately in the meta line, and the "Updated" badge already says what
 * happened — so this cleans the title down to just the field list, with field names labeled.
 */
function cleanAuditTitle(summary: string | null, actor: string | null | undefined): string | null {
  if (!summary) return summary
  let s = summary
  if (actor && s.startsWith(actor)) s = s.slice(actor.length).replace(/^\s+/, '')
  s = s.replace(/^updated:\s*/i, '').replace(/\.\s*$/, '')
  s = s.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, (token) => AUDIT_FIELD_LABELS[token.toLowerCase()] || token)
  if (!s) return summary
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function TimelineTab({ inquiryId }: { inquiryId: number }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null)

  useEffect(() => {
    Promise.all([
      crmApi.getInquiryAudit(inquiryId),
      crmApi.listInquiryStages(inquiryId),
      crmApi.listActivities({ related_module: 'inquiry', related_id: inquiryId }),
      crmApi.listQuotations(inquiryId),
      crmApi.getInquirySpecRevisions(inquiryId),
    ]).then(([audit, stages, activities, quotations, specRevisions]) => {
      const merged: TimelineEntry[] = [
        // Generic "updated" audit rows carry no diff detail — every real edit now produces
        // a proper Info Update entry (below) instead, so a bare "Updated: field" row with
        // nothing else to show is just noise. Only created/deleted are worth keeping here.
        ...audit
          .filter((a: { action: string }) => a.action !== 'updated')
          .map((a: { id: number; action: string; summary: string | null; performed_by: string; performed_at: string | null }) => ({
            key: `audit-${a.id}`,
            kind: auditActionKind(a.action),
            title: cleanAuditTitle(a.summary, a.performed_by) || `Inquiry ${a.action}`,
            by: a.performed_by,
            date: a.performed_at,
          })),
        ...specRevisions.map((r: SpecRevision) => ({
          key: `spec-${r.id}`,
          kind: 'info' as const,
          title: r.changes.map((c) => AUDIT_FIELD_LABELS[c.field] || c.field).join(', '),
          detail: specRevisionDetailHtml(r.changes),
          by: r.performed_by,
          date: r.performed_at,
        })),
        ...stages.map((s: CrmStageLogEntry) => ({
          key: `stage-${s.id}`,
          kind: 'stage' as const,
          title: `Moved to stage: ${s.stage}`,
          detail: s.notes,
          by: s.entered_by_name,
          date: s.created_at || null,
        })),
        ...activities.map((a: CrmActivity) => ({
          key: `followup-${a.id}`,
          kind: 'followup' as const,
          title: a.subject || a.contact_names?.join(', ') || a.activity_type || 'Follow Up',
          detail: a.remarks,
          by: a.created_by_name,
          date: a.activity_date || a.created_at || null,
        })),
        ...quotations.map((q: QuotationItem) => ({
          key: `quotation-${q.id}`,
          kind: 'quotation' as const,
          title: `Quotation ${q.quot_number || `Rev ${q.revision_number}`} generated`,
          detail: q.price != null ? `₹${q.price.toLocaleString()}${q.delivery_time ? ` · Delivery: ${q.delivery_time}` : ''}` : undefined,
          date: q.submitted_date || q.created_at || null,
        })),
      ]
      merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      setEntries(merged)
    })
  }, [inquiryId])

  if (entries === null) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No timeline history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.key} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: TIMELINE_KIND_STYLE[e.kind].bg, color: TIMELINE_KIND_STYLE[e.kind].text }}>
                {TIMELINE_KIND_STYLE[e.kind].label}
              </span>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>{e.title}</p>
            </div>
            <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {e.by || 'System'} · {e.date ? new Date(e.date).toLocaleString() : '—'}
            </p>
          </div>
          {e.detail && <RichText html={e.detail} style={{ fontSize: 12, color: '#57534e', margin: '2px 0' }} />}
        </div>
      ))}
    </div>
  )
}
