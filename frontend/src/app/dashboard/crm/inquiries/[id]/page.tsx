'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Inquiry, Organization, OrgContact, InquiryTask, InquiryApprovalItem, QuotationItem, PurchaseOrderItem, CrmDiscussionItem, CrmActivity, CrmNote, CrmDocument, CrmStageLogEntry, CrmTeamMember } from '@/types'
import { downloadBlob } from '@/components/rnd/toolStyles'
import CrmNav from '@/components/crm/CrmNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import InquiryForm from '@/components/crm/InquiryForm'
import { INQ_STAGES, DEPARTMENTS, TASK_STATUSES, PRIORITIES, APPROVAL_TYPES, CUSTOMER_RESPONSES, PO_STATUSES, DOC_CATEGORIES, ACTIVITY_TYPES } from '@/components/crm/constants'
import { Card, InfoRow, Field, Row, Row3, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/crm/ui'

const TABS = ['Info', 'Department Tasks', 'Quotations', 'Sales', 'Documents', 'Discussion', 'Activities', 'Notes', 'Timeline'] as const

export default function InquiryDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const inquiryId = Number(params.id)

  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [contact, setContact] = useState<OrgContact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Info')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStage, setPendingStage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

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
    } catch {
      setError('Inquiry not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && inquiryId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, inquiryId])

  const canModify = !!inquiry && !!user && (user.role === 'admin' || user.role === 'super_admin' || inquiry.created_by_id === user.id)

  const patch = async (payload: Record<string, unknown>) => {
    if (!inquiry) return
    try {
      setInquiry(await crmApi.updateInquiry(inquiry.id, payload))
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Update failed.')
    }
  }

  const handleDelete = async () => {
    if (!inquiry) return
    await crmApi.deleteInquiry(inquiry.id)
    router.push('/dashboard/crm/inquiries')
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !inquiry) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!inquiry) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fa9b9b' }}>{inquiry.universal_id}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(37,99,235,0.1)', color: '#1d4ed8' }}>{inquiry.status}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(244,113,59,0.1)', color: '#fa9b9b' }}>{inquiry.priority}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>{org?.name || 'Inquiry'}</h1>
        </div>
        {canModify && !editing && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setEditing(true); setTab('Info') }} style={secondaryBtnStyle}>Edit</button>
            <button onClick={() => setShowDeleteConfirm(true)} style={dangerBtnStyle}>Delete</button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <StageProgress stage={inquiry.current_stage} canModify={canModify} onRequestChange={setPendingStage} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px', marginRight: 16, border: 'none', background: 'transparent', whiteSpace: 'nowrap',
              borderBottom: tab === t ? '2px solid #fa9b9b' : '2px solid transparent',
              color: tab === t ? '#fa9b9b' : '#78716c', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t}
          </button>
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
      {tab === 'Info' && !editing && <InfoTab inquiry={inquiry} org={org} contact={contact} />}
      {tab === 'Department Tasks' && <TasksTab inquiryId={inquiry.id} canModify={canModify} />}
      {tab === 'Quotations' && <QuotationsTab inquiryId={inquiry.id} canModify={canModify} />}
      {tab === 'Sales' && <PurchaseOrdersTab inquiryId={inquiry.id} orgId={inquiry.org_id} canModify={canModify} />}
      {tab === 'Documents' && <DocumentsTab inquiry={inquiry} canModify={canModify} />}
      {tab === 'Discussion' && <DiscussionTab inquiryId={inquiry.id} />}
      {tab === 'Activities' && <ActivitiesTab inquiry={inquiry} org={org} />}
      {tab === 'Notes' && <NotesTab inquiry={inquiry} />}
      {tab === 'Timeline' && <TimelineTab inquiryId={inquiry.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this inquiry?"
        message={`Delete inquiry ${inquiry.universal_id}? It can be restored from the recycle bin for 10 days.`}
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', marginBottom: 20, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflowX: 'auto' }}>
      {INQ_STAGES.map((s, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        const clickable = canModify && !active
        const circleBg = done ? '#22c55e' : active ? '#fa9b9b' : '#fff'
        const circleColor = done || active ? '#fff' : '#a8a29e'
        const circleBorder = done ? '#22c55e' : active ? '#fa9b9b' : 'rgba(0,0,0,0.1)'
        const labelColor = active ? '#fa9b9b' : done ? '#16a34a' : '#a8a29e'
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < INQ_STAGES.length - 1 ? 1 : undefined }}>
            <div onClick={clickable ? () => onRequestChange(s) : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: clickable ? 'pointer' : 'default', userSelect: 'none' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: circleBg, color: circleColor, border: `2px solid ${circleBorder}`, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.02em', color: labelColor, whiteSpace: 'nowrap' }}>{s}</span>
            </div>
            {i < INQ_STAGES.length - 1 && <div style={{ flex: 1, height: 2, margin: '0 6px 14px', background: done ? '#4ade80' : 'rgba(0,0,0,0.08)' }} />}
          </div>
        )
      })}
    </div>
  )
}

function InfoTab({ inquiry, org, contact }: { inquiry: Inquiry; org: Organization | null; contact: OrgContact | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Organization">
          <InfoRow label="Name" value={org?.name || '—'} />
          <InfoRow label="GST Number" value={org?.gst_number || '—'} />
          <InfoRow label="Type" value={org?.org_type || '—'} />
          <InfoRow label="City" value={org?.city || '—'} />
          <InfoRow label="State" value={org?.state || '—'} />
          <InfoRow label="Address" value={org?.address || '—'} />
          <div style={{ paddingTop: 10, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1f1108', margin: '0 0 10px' }}>Contact Person</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <InfoRow label="Name" value={contact?.name || '—'} />
              <InfoRow label="Mobile" value={contact?.mobile || '—'} />
              <InfoRow label="Email" value={contact?.email || '—'} />
              <InfoRow label="Department" value={contact?.department || '—'} />
            </div>
          </div>
        </Card>
        <Card title="Lead Info">
          <InfoRow label="Lead Source" value={inquiry.lead_source || '—'} />
          <InfoRow label="BD Owner" value={inquiry.bd_owner || '—'} />
          <InfoRow label="Sales Engineer" value={inquiry.sales_engineer || '—'} />
          <InfoRow label="Created On" value={inquiry.created_at ? new Date(inquiry.created_at).toLocaleDateString() : '—'} />
          <InfoRow label="Follow-up Date" value={inquiry.next_followup_date || '—'} />
          <InfoRow label="Follow-up Priority" value={inquiry.followup_priority || '—'} />
          <InfoRow label="Assigned To" value={inquiry.followup_assigned_to || '—'} />
          <InfoRow label="Follow-up Remarks" value={inquiry.followup_remarks || '—'} />
        </Card>
      </div>
      <Card title="Product Requirement">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <InfoRow label="Product" value={inquiry.product || '—'} />
          <InfoRow label="Category" value={inquiry.product_category || '—'} />
          <InfoRow label="Quantity / Unit" value={inquiry.quantity != null ? `${inquiry.quantity} ${inquiry.unit || ''}` : '—'} />
          <InfoRow label="Required Delivery" value={inquiry.required_delivery_date || '—'} />
          <InfoRow label="Delivery Location" value={inquiry.delivery_location || '—'} />
          <InfoRow label="Expected Value" value={inquiry.expected_value != null ? `₹${inquiry.expected_value.toLocaleString()}` : '—'} />
          <InfoRow label="Budget" value={inquiry.budget != null ? `₹${inquiry.budget.toLocaleString()}` : '—'} />
          <InfoRow label="Expected Order Date" value={inquiry.expected_order_date || '—'} />
          <InfoRow label="Inspection Req." value={inquiry.inspection_req || '—'} />
          <InfoRow label="Warranty Req." value={inquiry.warranty_req || '—'} />
        </div>
        <InfoRow label="Specification" value={inquiry.product_spec || '—'} />
        <InfoRow label="Requirement Summary" value={inquiry.requirement_desc || '—'} />
        <InfoRow label="Detailed Requirement" value={inquiry.detailed_requirement || '—'} />
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
    if (editingId) await crmApi.updateInquiryTask(inquiryId, editingId, form)
    else await crmApi.createInquiryTask(inquiryId, form)
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
            <form onSubmit={save} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{t.task_title} <span style={{ fontWeight: 500, color: '#78716c' }}>· {t.department}</span></p>
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

function QuotationsTab({ inquiryId, canModify }: { inquiryId: number; canModify: boolean }) {
  const [quotations, setQuotations] = useState<QuotationItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const emptyForm = { quot_number: '', price: '', valid_until: '', delivery_time: '', customer_response: '', submitted_date: '', payment_terms: '', notes: '' }
  const [form, setForm] = useState(emptyForm)
  const load = () => crmApi.listQuotations(inquiryId).then(setQuotations)
  useEffect(() => { load() }, [inquiryId])

  const startEdit = (q: QuotationItem) => {
    setEditingId(q.id)
    setForm({
      quot_number: q.quot_number || '', price: q.price != null ? String(q.price) : '', valid_until: q.valid_until || '',
      delivery_time: q.delivery_time || '', customer_response: q.customer_response || '', submitted_date: q.submitted_date || '',
      payment_terms: q.payment_terms || '', notes: q.notes || '',
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
    const payload = { ...form, price: form.price ? Number(form.price) : undefined }
    if (editingId) await crmApi.updateQuotation(inquiryId, editingId, payload)
    else await crmApi.createQuotation(inquiryId, payload)
    cancelForm()
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => (showForm ? cancelForm() : setShowForm(true))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Quotation'}</button>
          {showForm && (
            <form onSubmit={save} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Quotation Number"><input value={form.quot_number} onChange={(e) => setForm((f) => ({ ...f, quot_number: e.target.value }))} placeholder="QT-2026-001" style={inputStyle} /></Field>
              <Field label="Price (₹)"><input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Valid Until"><DateField value={form.valid_until} onChange={(v) => setForm((f) => ({ ...f, valid_until: v }))} /></Field>
              <Field label="Delivery Time"><input value={form.delivery_time} onChange={(e) => setForm((f) => ({ ...f, delivery_time: e.target.value }))} placeholder="e.g. 12 weeks" style={inputStyle} /></Field>
              <Field label="Customer Response">
                <select value={form.customer_response} onChange={(e) => setForm((f) => ({ ...f, customer_response: e.target.value }))} style={inputStyle}>
                  <option value="">— Awaiting —</option>
                  {CUSTOMER_RESPONSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Submitted Date"><DateField value={form.submitted_date} onChange={(v) => setForm((f) => ({ ...f, submitted_date: v }))} /></Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Payment Terms"><textarea value={form.payment_terms} onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" style={primaryBtnStyle}>{editingId ? 'Save Changes' : 'Save Quotation'}</button>
              </div>
            </form>
          )}
        </div>
      )}
      {quotations.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No quotations yet.</p>
      ) : (
        quotations.map((q) => (
          <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{q.quot_number || `Version ${q.version}`}</p>
              <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>
                {q.price != null ? `₹${q.price.toLocaleString()}` : '—'} · {q.delivery_time || '—'} · {q.customer_response || '— Awaiting —'}
                {q.valid_until && ` · Valid: ${q.valid_until}`}{q.submitted_date && ` · Submitted: ${q.submitted_date}`}
              </p>
              {q.payment_terms && <p style={{ fontSize: 12, color: '#57534e', margin: '4px 0 0' }}>Payment: {q.payment_terms}</p>}
              {q.notes && <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>{q.notes}</p>}
            </div>
            {canModify && <button onClick={() => startEdit(q)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>Edit</button>}
          </div>
        ))
      )}
    </div>
  )
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
    const payload = { ...form, po_value: form.po_value ? Number(form.po_value) : undefined }
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
            <form onSubmit={save} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{po.po_number || `PO #${po.id}`}</p>
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

function DocumentsTab({ inquiry, canModify }: { inquiry: Inquiry; canModify: boolean }) {
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <DocumentFolderPanel title="Client Documents" folderType="client" docs={clientDocs} inquiry={inquiry} canModify={canModify} onUploaded={load} onRemove={remove} error={error} setError={setError} />
      <DocumentFolderPanel title="Internal Documents" folderType="internal" docs={internalDocs} inquiry={inquiry} canModify={canModify} onUploaded={load} onRemove={remove} error={error} setError={setError} />
    </div>
  )
}

function DocumentFolderPanel({ title, folderType, docs, inquiry, canModify, onUploaded, onRemove, error, setError }: {
  title: string
  folderType: 'client' | 'internal'
  docs: CrmDocument[]
  inquiry: Inquiry
  canModify: boolean
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
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: 0 }}>{title}</p>
      {docs.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>None</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
              <div>
                <a href={d.sharepoint_url || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>{d.file_name}</a>
                <p style={{ fontSize: 11, color: '#a8a29e', margin: '2px 0 0' }}>{d.doc_category || '—'}</p>
              </div>
              {canModify && <button onClick={() => onRemove(d.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Delete</button>}
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
          {uploading && <span style={{ fontSize: 12.5, color: '#78716c' }}>Uploading…</span>}
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
        <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: 0 }}>Internal Discussion</p>
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
              <p style={{ fontSize: 12, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{m.sent_by_name || 'Unknown'} {m.department && <span style={{ fontWeight: 500, color: '#a8a29e' }}>· {m.department}</span>}</p>
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

function ActivitiesTab({ inquiry, org }: { inquiry: Inquiry; org: Organization | null }) {
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showMomModal, setShowMomModal] = useState(false)
  const emptyForm = { activity_type: ACTIVITY_TYPES[0], assigned_to: '', next_followup: '', status: 'Open', remarks: '', action_plan: '' }
  const [form, setForm] = useState(emptyForm)

  const load = () => crmApi.listActivities({ related_module: 'inquiry', related_id: inquiry.id }).then(setActivities)
  useEffect(() => { load() }, [inquiry.id])

  const startEdit = (a: CrmActivity) => {
    setEditingId(a.id)
    setForm({ activity_type: a.activity_type || ACTIVITY_TYPES[0], assigned_to: a.assigned_to || '', next_followup: a.next_followup || '', status: a.status, remarks: a.remarks || '', action_plan: a.action_plan || '' })
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingId) await crmApi.updateActivity(editingId, form)
    else await crmApi.createActivity({ ...form, org_id: inquiry.org_id, related_module: 'inquiry', related_id: inquiry.id, universal_id: inquiry.universal_id })
    cancelForm()
    load()
  }

  const markDone = async (id: number) => {
    await crmApi.updateActivity(id, { status: 'Done' })
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => (showForm ? cancelForm() : setShowForm(true))} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Log Activity'}</button>
        {activities.length > 0 && (
          <button onClick={() => setShowMomModal(true)} style={secondaryBtnStyle}>Export MOM (Word)</button>
        )}
      </div>
      {showForm && (
        <form onSubmit={save} style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Activity Type">
            <select value={form.activity_type} onChange={(e) => setForm((f) => ({ ...f, activity_type: e.target.value }))} style={inputStyle}>
              {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Assigned To (Responsibility)"><input value={form.assigned_to} onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))} placeholder="Person name" style={inputStyle} /></Field>
          <Field label="Due Date (Target)"><DateField value={form.next_followup} onChange={(v) => setForm((f) => ({ ...f, next_followup: v }))} /></Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={inputStyle}>
              <option value="Open">Open</option>
              <option value="Done">Done</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Observation"><textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} placeholder="What was discussed or observed?" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Action Plan"><textarea value={form.action_plan} onChange={(e) => setForm((f) => ({ ...f, action_plan: e.target.value }))} rows={2} placeholder="What needs to be done next?" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={primaryBtnStyle}>{editingId ? 'Save Changes' : 'Save Activity'}</button>
          </div>
        </form>
      )}
      {activities.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No activities logged.</p>
      ) : (
        activities.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>
                {a.activity_type || 'Activity'} {a.assigned_to && <span style={{ fontWeight: 500, color: '#78716c' }}>· {a.assigned_to}</span>}
              </p>
              <p style={{ fontSize: 12, color: '#57534e', margin: 0 }}>{a.remarks || '—'} {a.next_followup && `· Due: ${a.next_followup}`}</p>
              {a.action_plan && <p style={{ fontSize: 12, color: '#78716c', margin: '2px 0 0' }}>Action Plan: {a.action_plan}</p>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: a.status === 'Done' ? 'rgba(34,197,94,0.12)' : a.status === 'Cancelled' ? 'rgba(0,0,0,0.06)' : 'rgba(234,179,8,0.12)', color: a.status === 'Done' ? '#16a34a' : a.status === 'Cancelled' ? '#78716c' : '#a16207' }}>{a.status}</span>
              {a.status === 'Open' && <button onClick={() => markDone(a.id)} style={secondaryBtnStyle}>Mark Done</button>}
              <button onClick={() => startEdit(a)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Edit</button>
            </div>
          </div>
        ))
      )}
      {showMomModal && (
        <MomExportModal
          inquiry={inquiry}
          org={org}
          activities={activities}
          onClose={() => setShowMomModal(false)}
        />
      )}
    </div>
  )
}

function MomExportModal({ inquiry, org, activities, onClose }: {
  inquiry: Inquiry
  org: Organization | null
  activities: CrmActivity[]
  onClose: () => void
}) {
  const [subject, setSubject] = useState('')
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().slice(0, 10))
  const [teamMembers, setTeamMembers] = useState<CrmTeamMember[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [pewIds, setPewIds] = useState<number[]>([])
  const [contactIds, setContactIds] = useState<number[]>(inquiry.org_contact_id ? [inquiry.org_contact_id] : [])
  const [activityIds, setActivityIds] = useState<number[]>(activities.map((a) => a.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    crmApi.listTeamMembers().then(setTeamMembers)
    crmApi.listOrgContacts(inquiry.org_id).then(setContacts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiry.org_id])

  const toggle = (list: number[], setList: (v: number[]) => void, id: number) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const submit = async () => {
    if (!subject.trim()) {
      setError('Please enter a subject for the meeting.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const blob = await crmApi.exportInquiryMom(inquiry.id, {
        subject,
        meeting_date: meetingDate,
        pew_member_ids: pewIds,
        client_contact_ids: contactIds,
        activity_ids: activityIds,
      })
      downloadBlob(blob, `MOM_${(org?.name || 'Inquiry').replace(/\s+/g, '_')}_${meetingDate}.docx`)
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
        <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>Client and contact details are pulled automatically from this inquiry — only the meeting-specific details below need to be filled in.</p>

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

        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 8px' }}>Activities to Include as Rows</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {activities.map((a) => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: activityIds.includes(a.id) ? 'rgba(244,113,59,0.1)' : '#f9fafb', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                <input type="checkbox" checked={activityIds.includes(a.id)} onChange={() => toggle(activityIds, setActivityIds, a.id)} style={{ marginTop: 2 }} />
                <span>{a.remarks || a.activity_type || `Activity #${a.id}`}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, flex: 1 }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ ...primaryBtnStyle, flex: 1, opacity: busy ? 0.7 : 1 }}>{busy ? 'Generating…' : 'Download .docx'}</button>
        </div>
      </div>
    </div>
  )
}

function NotesTab({ inquiry }: { inquiry: Inquiry }) {
  const [notes, setNotes] = useState<CrmNote[]>([])
  const [noteText, setNoteText] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const load = () => crmApi.listNotes({ related_module: 'inquiry', related_id: inquiry.id }).then(setNotes)
  useEffect(() => { load() }, [inquiry.id])

  const startEdit = (n: CrmNote) => {
    setEditingId(n.id)
    setNoteText(n.note)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setNoteText('')
  }

  const save = async () => {
    if (!noteText.trim()) return
    if (editingId) await crmApi.updateNote(editingId, { note: noteText })
    else await crmApi.createNote({ org_id: inquiry.org_id, related_module: 'inquiry', related_id: inquiry.id, universal_id: inquiry.universal_id, note: noteText })
    cancelEdit()
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} style={primaryBtnStyle}>{editingId ? 'Save Changes' : 'Save Note'}</button>
          {editingId && <button onClick={cancelEdit} style={secondaryBtnStyle}>Cancel</button>}
        </div>
      </div>
      {notes.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No notes yet.</p>
      ) : (
        notes.map((n) => (
          <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <p style={{ fontSize: 12.5, color: '#1f1108', margin: 0, whiteSpace: 'pre-wrap' }}>{n.note}</p>
            <button onClick={() => startEdit(n)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>Edit</button>
          </div>
        ))
      )}
    </div>
  )
}

function TimelineTab({ inquiryId }: { inquiryId: number }) {
  const [entries, setEntries] = useState<CrmStageLogEntry[]>([])
  useEffect(() => { crmApi.listInquiryStages(inquiryId).then(setEntries) }, [inquiryId])

  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No stage history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.id} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{e.stage}</p>
          <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0 }}>{e.entered_by_name || 'System'} · {e.created_at ? new Date(e.created_at).toLocaleString() : ''}</p>
        </div>
      ))}
    </div>
  )
}

