'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Tender, Organization, TenderTaskItem, TenderCompetitorItem, PurchaseOrderItem, CrmDiscussionItem, CrmActivity, CrmNote, CrmDocument, CrmStageLogEntry } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import TenderForm from '@/components/crm/TenderForm'
import { TND_STAGES, DEPARTMENTS, TASK_STATUSES, PRIORITIES, DOC_CATEGORIES } from '@/components/crm/constants'
import { Card, InfoRow, Field, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/crm/ui'

const TABS = ['Info', 'Dates', 'Department Tasks', 'Competitor Analysis', 'Sales', 'Documents', 'Discussion', 'Activities', 'Notes', 'Timeline'] as const

export default function TenderDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const tenderId = Number(params.id)

  const [tender, setTender] = useState<Tender | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
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
      const data = await crmApi.getTender(tenderId)
      setTender(data)
      crmApi.getOrganization(data.org_id).then(setOrg).catch(() => {})
    } catch {
      setError('Tender not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && tenderId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, tenderId])

  const canModify = !!tender && !!user && (user.role === 'admin' || tender.created_by_id === user.id)

  const patch = async (payload: Record<string, unknown>) => {
    if (!tender) return
    try {
      setTender(await crmApi.updateTender(tender.id, payload))
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Update failed.')
    }
  }

  const handleDelete = async () => {
    if (!tender) return
    await crmApi.deleteTender(tender.id)
    router.push('/dashboard/crm/tenders')
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !tender) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!tender) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fa9b9b' }}>{tender.universal_id}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(37,99,235,0.1)', color: '#1d4ed8' }}>{tender.status}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>{tender.tender_name || org?.name || 'Tender'}</h1>
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

      <StageProgress stage={tender.current_stage} canModify={canModify} onRequestChange={setPendingStage} />

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
        <TenderForm
          initial={tender}
          submitLabel="Save Changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            await patch(payload)
            setEditing(false)
          }}
        />
      )}
      {tab === 'Info' && !editing && <InfoTab tender={tender} org={org} />}
      {tab === 'Dates' && <DatesTab tender={tender} />}
      {tab === 'Department Tasks' && <TasksTab tenderId={tender.id} canModify={canModify} />}
      {tab === 'Competitor Analysis' && <CompetitorsTab tenderId={tender.id} canModify={canModify} />}
      {tab === 'Sales' && <PurchaseOrdersTab tenderId={tender.id} orgId={tender.org_id} canModify={canModify} />}
      {tab === 'Documents' && <DocumentsTab tender={tender} canModify={canModify} />}
      {tab === 'Discussion' && <DiscussionTab tenderId={tender.id} />}
      {tab === 'Activities' && <ActivitiesTab tender={tender} />}
      {tab === 'Notes' && <NotesTab tender={tender} />}
      {tab === 'Timeline' && <TimelineTab tenderId={tender.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this tender?"
        message={`Delete tender ${tender.universal_id}? It can be restored from the recycle bin for 10 days.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ConfirmDialog
        open={!!pendingStage}
        title="Update Stage"
        danger={false}
        confirmLabel="Update Stage"
        message={pendingStage ? `Move this tender from "${tender.current_stage}" to "${pendingStage}"?` : ''}
        onConfirm={() => { const s = pendingStage; setPendingStage(null); if (s) patch({ current_stage: s }) }}
        onCancel={() => setPendingStage(null)}
      />
    </div>
  )
}

function StageProgress({ stage, canModify, onRequestChange }: { stage: string; canModify: boolean; onRequestChange: (s: string) => void }) {
  const activeIdx = TND_STAGES.indexOf(stage)
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', marginBottom: 20, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflowX: 'auto' }}>
      {TND_STAGES.map((s, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        const clickable = canModify && !active
        const circleBg = done ? '#22c55e' : active ? '#fa9b9b' : '#fff'
        const circleColor = done || active ? '#fff' : '#a8a29e'
        const circleBorder = done ? '#22c55e' : active ? '#fa9b9b' : 'rgba(0,0,0,0.1)'
        const labelColor = active ? '#fa9b9b' : done ? '#16a34a' : '#a8a29e'
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < TND_STAGES.length - 1 ? 1 : undefined }}>
            <div onClick={clickable ? () => onRequestChange(s) : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: clickable ? 'pointer' : 'default', userSelect: 'none' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: circleBg, color: circleColor, border: `2px solid ${circleBorder}`, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.02em', color: labelColor, whiteSpace: 'nowrap' }}>{s}</span>
            </div>
            {i < TND_STAGES.length - 1 && <div style={{ flex: 1, height: 2, margin: '0 6px 14px', background: done ? '#4ade80' : 'rgba(0,0,0,0.08)' }} />}
          </div>
        )
      })}
    </div>
  )
}

function InfoTab({ tender, org }: { tender: Tender; org: Organization | null }) {
  const showResult = tender.status === 'Won' || tender.status === 'Lost' || tender.awarded_to || tender.loss_reason
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Tender Details">
          <InfoRow label="Tender No." value={tender.tender_number || '—'} />
          <InfoRow label="Authority" value={tender.tender_authority || '—'} />
          <InfoRow label="Portal" value={tender.tender_portal || '—'} />
          <InfoRow label="Type" value={tender.tender_type || '—'} />
          <InfoRow label="Category" value={tender.tender_category || '—'} />
          <InfoRow label="Value" value={tender.tender_value != null ? `${tender.currency} ${tender.tender_value.toLocaleString()}` : '—'} />
          <InfoRow label="Currency" value={tender.currency} />
          <InfoRow label="Current Stage" value={tender.current_stage} />
        </Card>
        <Card title="Organization">
          <InfoRow label="Name" value={org?.name || '—'} />
          <InfoRow label="Railway Zone" value={tender.railway_zone || '—'} />
          <InfoRow label="Division" value={tender.division || '—'} />
          <InfoRow label="Workshop" value={tender.workshop || '—'} />
          <div style={{ paddingTop: 10, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1f1108', margin: '0 0 10px' }}>Participation</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <InfoRow label="Participate" value={tender.participate == null ? '—' : tender.participate ? 'Yes' : 'No'} />
              <InfoRow label="Decision By" value={tender.decision_by || '—'} />
              <InfoRow label="Reason (if No)" value={tender.reason_no_participate || '—'} />
            </div>
          </div>
        </Card>
      </div>
      {showResult && (
        <Card title="Result">
          <InfoRow label="Awarded To" value={tender.awarded_to || '—'} />
          <InfoRow label="LOI Number" value={tender.loi_number || '—'} />
          <InfoRow label="Contract Value" value={tender.contract_value != null ? `${tender.currency} ${tender.contract_value.toLocaleString()}` : '—'} />
          <InfoRow label="Loss Reason" value={tender.loss_reason || '—'} />
        </Card>
      )}
    </div>
  )
}

function DatesTab({ tender }: { tender: Tender }) {
  const rows: [string, string | undefined][] = [
    ['Publish Date', tender.publish_date],
    ['Document Download', tender.doc_download_date],
    ['Pre-Bid Meeting', tender.pre_bid_meeting_date],
    ['Query Submission', tender.query_submission_date],
    ['Submission Date', tender.submission_date],
    ['Technical Opening', tender.opening_date],
    ['Financial Opening', tender.financial_opening_date],
    ['Expected Award', tender.expected_award_date],
  ]
  return (
    <div style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#fffaf5', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e' }}>Milestone</th>
            <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e' }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <td style={{ padding: '10px 16px', color: '#57534e' }}>{label}</td>
              <td style={{ padding: '10px 16px', fontWeight: 700, color: '#1f1108' }}>{value || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TasksTab({ tenderId, canModify }: { tenderId: number; canModify: boolean }) {
  const [tasks, setTasks] = useState<TenderTaskItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const emptyForm = { department: DEPARTMENTS[0], task_title: '', assigned_user_name: '', due_date: '', priority: 'Medium', status: 'Pending', remarks: '' }
  const [form, setForm] = useState(emptyForm)
  const load = () => crmApi.listTenderTasks(tenderId).then(setTasks)
  useEffect(() => { load() }, [tenderId])

  const startEdit = (t: TenderTaskItem) => {
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
    if (editingId) await crmApi.updateTenderTask(tenderId, editingId, form)
    else await crmApi.createTenderTask(tenderId, form)
    cancelForm()
    load()
  }

  const updateStatus = async (taskId: number, status: string) => {
    await crmApi.updateTenderTask(tenderId, taskId, { status })
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
              <Field label="Assigned To"><input value={form.assigned_user_name} onChange={(e) => setForm((f) => ({ ...f, assigned_user_name: e.target.value }))} style={inputStyle} /></Field>
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

function CompetitorsTab({ tenderId, canModify }: { tenderId: number; canModify: boolean }) {
  const [competitors, setCompetitors] = useState<TenderCompetitorItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const emptyForm = { competitor_name: '', expected_price: '', remarks: '' }
  const [form, setForm] = useState(emptyForm)
  const load = () => crmApi.listTenderCompetitors(tenderId).then(setCompetitors)
  useEffect(() => { load() }, [tenderId])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.competitor_name.trim()) return
    await crmApi.createTenderCompetitor(tenderId, { ...form, expected_price: form.expected_price ? Number(form.expected_price) : undefined })
    setForm(emptyForm)
    setShowForm(false)
    load()
  }

  const remove = async (id: number) => {
    await crmApi.deleteTenderCompetitor(tenderId, id)
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          <button onClick={() => setShowForm((v) => !v)} style={primaryBtnStyle}>{showForm ? 'Cancel' : '+ Add Competitor'}</button>
          {showForm && (
            <form onSubmit={create} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Competitor Name"><input value={form.competitor_name} onChange={(e) => setForm((f) => ({ ...f, competitor_name: e.target.value }))} style={inputStyle} /></Field>
              <Field label="Expected Price (₹)"><input type="number" value={form.expected_price} onChange={(e) => setForm((f) => ({ ...f, expected_price: e.target.value }))} style={inputStyle} /></Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Remarks"><textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" style={primaryBtnStyle}>Save</button>
              </div>
            </form>
          )}
        </div>
      )}
      {competitors.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No competitor data yet.</p>
      ) : (
        competitors.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{c.competitor_name}</p>
              <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>{c.expected_price != null ? `₹${c.expected_price.toLocaleString()}` : '—'}</p>
              {c.remarks && <p style={{ fontSize: 12, color: '#57534e', margin: '4px 0 0' }}>{c.remarks}</p>}
            </div>
            {canModify && <button onClick={() => remove(c.id)} style={{ ...dangerBtnStyle, padding: '5px 12px', fontSize: 11.5 }}>Delete</button>}
          </div>
        ))
      )}
    </div>
  )
}

function PurchaseOrdersTab({ tenderId, orgId, canModify }: { tenderId: number; orgId: number; canModify: boolean }) {
  const [pos, setPos] = useState<PurchaseOrderItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const emptyForm = { po_number: '', po_date: '', po_value: '', delivery_schedule: '', special_conditions: '', status: 'Active' }
  const [form, setForm] = useState(emptyForm)
  const load = () => crmApi.listTenderPurchaseOrders(tenderId).then(setPos)
  useEffect(() => { load() }, [tenderId])

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
    else await crmApi.createTenderPurchaseOrder(tenderId, { ...payload, org_id: orgId })
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

function DocumentsTab({ tender, canModify }: { tender: Tender; canModify: boolean }) {
  const [documents, setDocuments] = useState<CrmDocument[]>([])
  const [error, setError] = useState('')

  const load = () => crmApi.listDocuments({ related_module: 'tender', related_id: tender.id }).then(setDocuments)
  useEffect(() => { load() }, [tender.id])

  const remove = async (id: number) => {
    await crmApi.deleteDocument(id)
    load()
  }

  const clientDocs = documents.filter((d) => d.folder_type === 'client')
  const internalDocs = documents.filter((d) => d.folder_type === 'internal')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <TenderDocumentFolderPanel title="Client Documents" folderType="client" docs={clientDocs} tender={tender} canModify={canModify} onUploaded={load} onRemove={remove} error={error} setError={setError} />
      <TenderDocumentFolderPanel title="Internal Documents" folderType="internal" docs={internalDocs} tender={tender} canModify={canModify} onUploaded={load} onRemove={remove} error={error} setError={setError} />
    </div>
  )
}

function TenderDocumentFolderPanel({ title, folderType, docs, tender, canModify, onUploaded, onRemove, error, setError }: {
  title: string
  folderType: 'client' | 'internal'
  docs: CrmDocument[]
  tender: Tender
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
        { related_module: 'tender', related_id: tender.id, folder_type: folderType, doc_category: docCategory, universal_id: tender.universal_id, org_id: tender.org_id },
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

function DiscussionTab({ tenderId }: { tenderId: number }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<CrmDiscussionItem[]>([])
  const [deptFilter, setDeptFilter] = useState('')
  const [text, setText] = useState('')
  const load = () => crmApi.listTenderDiscussions(tenderId).then(setMessages)
  useEffect(() => { load() }, [tenderId])

  const send = async () => {
    if (!text.trim()) return
    await crmApi.createTenderDiscussion(tenderId, { message: text, department: deptFilter || undefined })
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

function ActivitiesTab({ tender }: { tender: Tender }) {
  const [activities, setActivities] = useState<CrmActivity[]>([])
  useEffect(() => { crmApi.listActivities({ related_module: 'tender', related_id: tender.id }).then(setActivities) }, [tender.id])

  if (activities.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No activities logged.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {activities.map((a) => (
        <div key={a.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{a.activity_type || 'Activity'} · {a.status}</p>
          <p style={{ fontSize: 12, color: '#57534e', margin: 0 }}>{a.remarks || '—'} {a.next_followup && `· Due: ${a.next_followup}`}</p>
        </div>
      ))}
    </div>
  )
}

function NotesTab({ tender }: { tender: Tender }) {
  const [notes, setNotes] = useState<CrmNote[]>([])
  const [noteText, setNoteText] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const load = () => crmApi.listNotes({ related_module: 'tender', related_id: tender.id }).then(setNotes)
  useEffect(() => { load() }, [tender.id])

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
    else await crmApi.createNote({ org_id: tender.org_id, related_module: 'tender', related_id: tender.id, universal_id: tender.universal_id, note: noteText })
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

function TimelineTab({ tenderId }: { tenderId: number }) {
  const [entries, setEntries] = useState<CrmStageLogEntry[]>([])
  useEffect(() => { crmApi.listTenderStages(tenderId).then(setEntries) }, [tenderId])

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

