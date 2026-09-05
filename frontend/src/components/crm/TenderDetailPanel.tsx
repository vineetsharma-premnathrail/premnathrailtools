'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Tender, Organization, TenderTaskItem, TenderCompetitorItem, PurchaseOrderItem, CrmDiscussionItem, CrmActivity, CrmDocument, CrmStageLogEntry } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import TenderForm from '@/components/crm/TenderForm'
import { RichText } from '@/components/RichTextEditor'
import ActivityViewDialog from '@/components/crm/ActivityViewDialog'
import TechnicalOfferPickerDialog from '@/components/crm/TechnicalOfferPickerDialog'
import { TND_STAGES, DEPARTMENTS, TASK_STATUSES, PRIORITIES, DOC_CATEGORIES, tenderStatusColor } from '@/components/crm/constants'
import { Card, InfoRow, Field, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, RevisionSelector, SpecInfoRow, SpecRevision, handleEnterAsTab } from '@/components/crm/ui'

const TABS = ['Info', 'Dates', 'Documents', 'Follow Ups', 'Timeline'] as const

export default function TenderDetailPanel({ tenderId, onDeleted }: { tenderId: number; onDeleted?: () => void }) {
  const { user } = useAuth()
  const router = useRouter()

  const [tender, setTender] = useState<Tender | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
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
      const data = await crmApi.getTender(tenderId)
      setTender(data)
      crmApi.getOrganization(data.org_id).then(setOrg).catch(() => {})
      crmApi.getTenderSpecRevisions(tenderId).then(setRevisions).catch(() => setRevisions([]))
    } catch {
      setError('Tender not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tenderId) { setTab('Info'); setEditing(false); load() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId])

  const canModify = !!tender && !!user && (user.role === 'admin' || tender.created_by_id === user.id)
  const isAdmin = user?.role === 'admin'

  const patch = async (payload: Record<string, unknown>) => {
    if (!tender) return
    try {
      setTender(await crmApi.updateTender(tender.id, payload))
      crmApi.getTenderSpecRevisions(tender.id).then(setRevisions).catch(() => {})
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Update failed.')
    }
  }

  const handleDelete = async () => {
    if (!tender) return
    await crmApi.deleteTender(tender.id)
    if (onDeleted) onDeleted()
    else router.push('/dashboard/crm/tenders')
  }

  const torActive = !!tender && (
    !tender.technical_offer_sent_at ||
    (!!tender.updated_at && new Date(tender.updated_at) > new Date(tender.technical_offer_sent_at))
  )

  const sendTechnicalOfferRequest = async (documentIds: number[]) => {
    if (!tender || !torActive) return
    setSendingTOR(true)
    setTorError('')
    try {
      setTender(await crmApi.createTenderTechnicalOfferRequest(tender.id, documentIds))
      setShowTorPicker(false)
    } catch (err: any) {
      setTorError(err?.response?.data?.detail || 'Failed to send Technical Offer Request.')
    } finally {
      setSendingTOR(false)
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !tender) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!tender) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45' }}>{tender.universal_id}</span>
            <span title={`Status: ${tender.status}`} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: tenderStatusColor(tender.status).bg, color: tenderStatusColor(tender.status).text }}>{tender.status}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{tender.tender_name || org?.name || 'Tender'}</h1>
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
                title={!torActive ? `Already sent as ${tender.technical_offer_number} — edit the tender to send again.` : 'Emails R&D the Organization, Project, and Product Requirement details as a PDF.'}
                style={{ ...secondaryBtnStyle, opacity: !torActive || sendingTOR ? 0.5 : 1, cursor: !torActive || sendingTOR ? 'not-allowed' : 'pointer' }}
              >
                {sendingTOR ? 'Sending…' : 'Send Technical Offer Request to R&D'}
              </button>
              {canModify && <button onClick={() => { setEditing(true); setTab('Info') }} style={secondaryBtnStyle}>Edit</button>}
              {isAdmin && <button onClick={() => setShowDeleteConfirm(true)} style={dangerBtnStyle}>Delete</button>}
            </div>
            {tender.technical_offer_number && (
              <span style={{ fontSize: 11, color: '#78716c' }}>
                {torActive ? 'Previously sent as ' : 'Sent as '}<strong>{tender.technical_offer_number}</strong>
                {tender.technical_offer_sent_at && ` on ${new Date(tender.technical_offer_sent_at).toLocaleString()}`}
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

      <StageProgress stage={tender.current_stage} canModify={canModify} onRequestChange={setPendingStage} />

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
      {tab === 'Info' && !editing && <InfoTab tender={tender} org={org} revisions={revisions} selectedRevId={selectedRevId} />}
      {tab === 'Dates' && <DatesTab tender={tender} />}
      {tab === 'Documents' && <DocumentsTab tender={tender} canModify={canModify} isAdmin={isAdmin} />}
      {tab === 'Follow Ups' && <ActivitiesTab tender={tender} />}
      {tab === 'Timeline' && <TimelineTab tenderId={tender.id} />}

      <TechnicalOfferPickerDialog
        open={showTorPicker}
        relatedModule="tender"
        relatedId={tender.id}
        sending={sendingTOR}
        onSend={sendTechnicalOfferRequest}
        onCancel={() => setShowTorPicker(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this tender?"
        message={`Delete tender ${tender.universal_id}? This action cannot be undone.`}
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
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e' }}>Stage {activeIdx + 1} of {TND_STAGES.length}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1f1108' }}>{stage}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 100, height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <div style={{ width: `${((activeIdx + 1) / TND_STAGES.length) * 100}%`, height: '100%', background: '#22c55e' }} />
          </div>
          <span style={{ fontSize: 14, color: '#a8a29e', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
        </div>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 20, borderRadius: 14, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.4)', boxShadow: '0 16px 40px rgba(15,23,42,0.22), 0 4px 10px rgba(15,23,42,.1)', overflow: 'hidden' }}>
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
          {TND_STAGES.map((s, i) => {
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
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: clickable ? 'pointer' : 'default', background: active ? 'rgba(255,122,69,0.1)' : 'transparent' }}
                onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'rgba(255,122,69,0.1)' : 'transparent' }}
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

function InfoTab({ tender, org, revisions, selectedRevId }: { tender: Tender; org: Organization | null; revisions: SpecRevision[]; selectedRevId: number | null }) {
  const showResult = tender.status === 'Won' || tender.status === 'Lost' || tender.awarded_to || tender.loss_reason
  const selectedRev = revisions.find((r) => r.id === selectedRevId) || null
  const changeFor = (field: string) => selectedRev?.changes.find((c) => c.field === field)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <Card title="Tender Details">
          <SpecInfoRow label="Tender No." value={tender.tender_number || '—'} change={changeFor('tender_number')} />
          <SpecInfoRow label="Authority" value={tender.tender_authority || '—'} change={changeFor('tender_authority')} />
          <SpecInfoRow label="Portal" value={tender.tender_portal || '—'} change={changeFor('tender_portal')} />
          <SpecInfoRow label="Type" value={tender.tender_type || '—'} change={changeFor('tender_type')} />
          <SpecInfoRow label="Category" value={tender.tender_category || '—'} change={changeFor('tender_category')} />
          <SpecInfoRow label="Value" value={tender.tender_value != null ? `${tender.currency} ${tender.tender_value.toLocaleString()}` : '—'} change={changeFor('tender_value') || changeFor('currency')} />
          <InfoRow label="Currency" value={tender.currency} />
          <InfoRow label="Current Stage" value={tender.current_stage} />
        </Card>
        <Card title="Organization">
          <InfoRow label="Name" value={org?.name || '—'} />
          <SpecInfoRow label="Railway Zone" value={tender.railway_zone || '—'} change={changeFor('railway_zone')} />
          <SpecInfoRow label="Division" value={tender.division || '—'} change={changeFor('division')} />
          <SpecInfoRow label="Workshop" value={tender.workshop || '—'} change={changeFor('workshop')} />
          <div style={{ paddingTop: 10, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1f1108', margin: '0 0 10px' }}>Participation</p>
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
            <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e' }}>Milestone</th>
            <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e' }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <td style={{ padding: '10px 16px', color: '#57534e' }}>{label}</td>
              <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1f1108' }}>{value || '—'}</td>
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
    const payload: Record<string, unknown> = { ...form }
    Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k] })
    if (editingId) await crmApi.updateTenderTask(tenderId, editingId, payload)
    else await crmApi.createTenderTask(tenderId, payload)
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
            <form onSubmit={save} onKeyDown={handleEnterAsTab} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
            <form onSubmit={create} onKeyDown={handleEnterAsTab} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{c.competitor_name}</p>
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
    const payload: Record<string, unknown> = { ...form, po_value: form.po_value ? Number(form.po_value) : undefined }
    Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k] })
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
            <form onSubmit={save} onKeyDown={handleEnterAsTab} style={{ marginTop: 12, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

function DocumentsTab({ tender, canModify, isAdmin }: { tender: Tender; canModify: boolean; isAdmin: boolean }) {
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <TenderDocumentFolderPanel title="Client Documents" folderType="client" docs={clientDocs} tender={tender} canModify={canModify} canDelete={isAdmin} onUploaded={load} onRemove={remove} error={error} setError={setError} />
      <TenderDocumentFolderPanel title="Internal Documents" folderType="internal" docs={internalDocs} tender={tender} canModify={canModify} canDelete={isAdmin} onUploaded={load} onRemove={remove} error={error} setError={setError} />
    </div>
  )
}

function TenderDocumentFolderPanel({ title, folderType, docs, tender, canModify, canDelete, onUploaded, onRemove, error, setError }: {
  title: string
  folderType: 'client' | 'internal'
  docs: CrmDocument[]
  tender: Tender
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

function ActivitiesTab({ tender }: { tender: Tender }) {
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [viewingActivity, setViewingActivity] = useState<CrmActivity | null>(null)
  useEffect(() => { crmApi.listActivities({ related_module: 'tender', related_id: tender.id }).then(setActivities) }, [tender.id])

  if (activities.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No follow-ups logged.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {activities.map((a) => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>
              {a.activity_type || 'Follow Up'}
              {a.assigned_to && <span title={`Contact Person: ${a.assigned_to}`} style={{ fontWeight: 500, color: '#78716c' }}> · {a.assigned_to}</span>}
              {a.created_at && <span title={`Created: ${new Date(a.created_at).toLocaleString('en-GB')}`} style={{ fontWeight: 500, color: '#a8a29e' }}> · {new Date(a.created_at).toLocaleString('en-GB')}</span>}
            </p>
            {a.remarks ? <RichText html={a.remarks} style={{ fontSize: 12, color: '#57534e' }} /> : <p style={{ fontSize: 12, color: '#57534e', margin: 0 }}>—</p>}
            {a.next_followup && <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '2px 0 0' }}>Due: {a.next_followup}</p>}
          </div>
          <button onClick={() => setViewingActivity(a)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, flexShrink: 0 }}>View</button>
        </div>
      ))}

      <ActivityViewDialog activity={viewingActivity} onClose={() => setViewingActivity(null)} />
    </div>
  )
}

type TenderTimelineEntry = {
  key: string
  kind: 'created' | 'updated' | 'deleted' | 'stage' | 'followup' | 'info' | 'email' | 'email_failed'
  title: string
  detail?: string
  by?: string
  date: string | null
}

const TENDER_TIMELINE_KIND_STYLE: Record<TenderTimelineEntry['kind'], { bg: string; text: string; label: string }> = {
  created: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', label: 'Created' },
  updated: { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8', label: 'Updated' },
  deleted: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Deleted' },
  stage: { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed', label: 'Stage' },
  followup: { bg: 'rgba(249,115,22,0.12)', text: '#c2410c', label: 'Follow Up' },
  info: { bg: 'rgba(99,102,241,0.12)', text: '#4338ca', label: 'Info Update' },
  email: { bg: 'rgba(13,148,136,0.12)', text: '#0f766e', label: 'Email Sent' },
  email_failed: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Email Failed' },
}

function auditActionKind(action: string): TenderTimelineEntry['kind'] {
  if (action === 'created') return 'created'
  if (action === 'deleted') return 'deleted'
  if (action.endsWith('_sent')) return 'email'
  if (action.endsWith('_failed')) return 'email_failed'
  return 'updated'
}

const TENDER_AUDIT_FIELD_LABELS: Record<string, string> = {
  tender_number: 'Tender No.', tender_name: 'Tender Name', tender_authority: 'Tender Authority',
  tender_portal: 'Portal', tender_type: 'Type', tender_category: 'Category', tender_value: 'Value',
  currency: 'Currency', status: 'Status', current_stage: 'Stage', railway_zone: 'Railway Zone',
  division: 'Division', workshop: 'Workshop', org_id: 'Organization', org_contact_id: 'Contact',
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
    const label = TENDER_AUDIT_FIELD_LABELS[c.field] || c.field
    const oldText = c.old == null || String(c.old).trim() === '' ? '(empty)' : String(c.old)
    const newText = c.new == null || String(c.new).trim() === '' ? '(empty)' : String(c.new)
    const prefix = single ? '' : `<strong>${escapeHtml(label)}:</strong> `
    return `<div>${prefix}<span style="color:#b91c1c;text-decoration:line-through;">${escapeHtml(oldText)}</span> → <span style="color:#166534;font-weight:600;">${escapeHtml(newText)}</span></div>`
  }).join('')
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
  s = s.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, (token) => TENDER_AUDIT_FIELD_LABELS[token.toLowerCase()] || token)
  if (!s) return summary
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function TimelineTab({ tenderId }: { tenderId: number }) {
  const [entries, setEntries] = useState<TenderTimelineEntry[] | null>(null)

  useEffect(() => {
    Promise.all([
      crmApi.getTenderAudit(tenderId),
      crmApi.listTenderStages(tenderId),
      crmApi.listActivities({ related_module: 'tender', related_id: tenderId }),
      crmApi.getTenderSpecRevisions(tenderId),
    ]).then(([audit, stages, activities, specRevisions]) => {
      const merged: TenderTimelineEntry[] = [
        // Generic "updated" audit rows carry no diff detail — every real edit now produces
        // a proper Info Update entry (below) instead, so a bare "Updated: field" row with
        // nothing else to show is just noise. Only created/deleted are worth keeping here.
        ...audit
          .filter((a: { action: string }) => a.action !== 'updated')
          .map((a: { id: number; action: string; summary: string | null; performed_by: string; performed_at: string | null }) => ({
            key: `audit-${a.id}`,
            kind: auditActionKind(a.action),
            title: cleanAuditTitle(a.summary, a.performed_by) || `Tender ${a.action}`,
            by: a.performed_by,
            date: a.performed_at,
          })),
        ...specRevisions.map((r: SpecRevision) => ({
          key: `spec-${r.id}`,
          kind: 'info' as const,
          title: r.changes.map((c) => TENDER_AUDIT_FIELD_LABELS[c.field] || c.field).join(', '),
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
      ]
      merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      setEntries(merged)
    })
  }, [tenderId])

  if (entries === null) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No timeline history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.key} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: TENDER_TIMELINE_KIND_STYLE[e.kind].bg, color: TENDER_TIMELINE_KIND_STYLE[e.kind].text }}>
                {TENDER_TIMELINE_KIND_STYLE[e.kind].label}
              </span>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>{e.title}</p>
            </div>
            <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>{e.by || 'System'} · {e.date ? new Date(e.date).toLocaleString() : '—'}</p>
          </div>
          {e.detail && <RichText html={e.detail} style={{ fontSize: 12, color: '#57534e', margin: '2px 0' }} />}
        </div>
      ))}
    </div>
  )
}
