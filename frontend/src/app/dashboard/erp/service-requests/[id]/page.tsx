'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { AuditEntry, Project, ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadPreview from '@/components/FileUploadPreview'
import Link from 'next/link'

const WORKFLOW_STEPS = [
  { key: 'open', label: 'Reported' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'pending_parts', label: 'Pending Parts' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
]
const TABS = ['Overview', 'Diagnostics & RCA', 'Materials', 'Attachments', 'Audit Trail'] as const

export default function ServiceRequestDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const params = useParams()
  const router = useRouter()
  const srId = Number(params.id)

  const [sr, setSr] = useState<ServiceRequest | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await erpApi.getServiceRequest(srId)
      setSr(data)
      erpApi.getProject(data.project_id).then(setProject).catch(() => {})
    } catch {
      setError('Service request not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && srId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, srId])

  const canModify = !!sr && !!user && (user.role === 'admin' || sr.created_by_id === user.id)

  const patch = async (payload: Record<string, unknown>) => {
    if (!sr) return
    try {
      const updated = await erpApi.updateServiceRequest(sr.id, payload)
      setSr(updated)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Update failed.')
    }
  }

  const handleDelete = async () => {
    if (!sr) return
    await erpApi.deleteServiceRequest(sr.id)
    router.push('/dashboard/erp/service-requests')
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !sr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!sr) return null

  return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#fa9b9b', margin: '0 0 4px' }}>{sr.request_number}</p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>{sr.issue_title}</h1>
        </div>
        {canModify && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Link
              href={`/dashboard/erp/service-requests/${sr.id}/edit`}
              style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Edit
            </Link>
            <button onClick={() => setShowDeleteConfirm(true)} style={{ ...dangerBtnStyle }}>Delete</button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <WorkflowSteps status={sr.status} canModify={canModify && !sr.is_locked} onRequestChange={setPendingStatus} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px',
              marginRight: 16,
              border: 'none',
              background: 'transparent',
              borderBottom: tab === t ? '2px solid #fa9b9b' : '2px solid transparent',
              color: tab === t ? '#fa9b9b' : '#78716c',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab sr={sr} project={project} canModify={canModify} onPatch={patch} />}
      {tab === 'Diagnostics & RCA' && <RcaTab sr={sr} canModify={canModify} onPatch={patch} />}
      {tab === 'Materials' && <MaterialsTab srId={sr.id} canModify={canModify} />}
      {tab === 'Attachments' && <AttachmentsTab sr={sr} canModify={canModify} onRefresh={load} />}
      {tab === 'Audit Trail' && <AuditTab srId={sr.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this service request?"
        message={`Delete service request ${sr.request_number}? It can be restored from the recycle bin for 10 days.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ConfirmDialog
        open={!!pendingStatus}
        title="Update Status"
        danger={false}
        confirmLabel="Update Status"
        message={
          pendingStatus
            ? `Status ko update karna chahte hain? "${WORKFLOW_STEPS.find((s) => s.key === sr.status)?.label || sr.status}" → "${WORKFLOW_STEPS.find((s) => s.key === pendingStatus)?.label || pendingStatus}"`
            : ''
        }
        onConfirm={() => { const s = pendingStatus; setPendingStatus(null); if (s) patch({ status: s }) }}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  )
}

function WorkflowSteps({ status, canModify, onRequestChange }: { status: string; canModify: boolean; onRequestChange: (key: string) => void }) {
  const activeIdx = WORKFLOW_STEPS.findIndex((s) => s.key === status)

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', marginBottom: 20, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflowX: 'auto' }}>
      {WORKFLOW_STEPS.map((step, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        const clickable = canModify && !active
        const circleBg = done ? '#22c55e' : active ? '#fa9b9b' : '#fff'
        const circleColor = done || active ? '#fff' : '#a8a29e'
        const circleBorder = done ? '#22c55e' : active ? '#fa9b9b' : 'rgba(0,0,0,0.1)'
        const labelColor = active ? '#fa9b9b' : done ? '#16a34a' : '#a8a29e'
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < WORKFLOW_STEPS.length - 1 ? 1 : undefined }}>
            <div
              onClick={clickable ? () => onRequestChange(step.key) : undefined}
              title={clickable ? `Set status to ${step.label}` : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: clickable ? 'pointer' : 'default', userSelect: 'none' }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: circleBg,
                  color: circleColor,
                  border: `2px solid ${circleBorder}`,
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.02em', color: labelColor, whiteSpace: 'nowrap' }}>
                {step.label}
              </span>
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '0 8px 16px', background: done ? '#4ade80' : 'rgba(0,0,0,0.08)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function OverviewTab({ sr, project, canModify, onPatch }: { sr: ServiceRequest; project: Project | null; canModify: boolean; onPatch: (p: Record<string, unknown>) => void }) {
  const initials = (sr.assigned_to_name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Issue Details">
          <InfoRow label="Category" value={sr.issue_category || '—'} />
          <InfoRow label="Sub-Category" value={sr.sub_category || '—'} />
          <InfoRow label="Failure Mode" value={sr.failure_mode || '—'} />
          <InfoRow label="Description" value={sr.issue_description || '—'} />
        </Card>

        <Card title="Reported By">
          <InfoRow label="Name" value={sr.reported_by_name || '—'} />
          <InfoRow label="Phone" value={sr.reported_by_phone || '—'} />
          <InfoRow label="Email" value={sr.reported_by_email || '—'} />
        </Card>

        <Card title="Status & Priority">
          <Field label="Status">
            <select
              value={sr.status}
              disabled={!canModify || sr.is_locked}
              onChange={(e) => onPatch({ status: e.target.value })}
              style={inputStyle}
            >
              {WORKFLOW_STEPS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={sr.priority}
              disabled={!canModify || sr.is_locked}
              onChange={(e) => onPatch({ priority: e.target.value })}
              style={inputStyle}
            >
              {['critical', 'high', 'medium', 'low'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Asset Context">
          <InfoRow label="Machine" value={project ? `${project.serial_number}${project.model_name ? ` — ${project.model_name}` : ''}` : '—'} />
          <InfoRow label="Site / Location" value={project?.site_name || '—'} />
          <InfoRow label="Request Date" value={sr.created_at ? new Date(sr.created_at).toLocaleDateString() : '—'} />
        </Card>

        <Card title="Assignment">
          {sr.assigned_to_name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1f1108', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                {initials}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108' }}>{sr.assigned_to_name}</span>
            </div>
          )}
          <InfoRow label="Opened" value={sr.opened_at ? new Date(sr.opened_at).toLocaleDateString() : '—'} />
          <InfoRow label="Expected Attend" value={sr.expected_date_to_attend || '—'} />
          <InfoRow label="Expected Close" value={sr.expected_completion_date || '—'} />
          <InfoRow label="Closed" value={sr.closed_at ? new Date(sr.closed_at).toLocaleDateString() : '—'} />
        </Card>

        <Card title="Service Notes">
          <p style={{ fontSize: 13.5, color: '#1f1108', margin: 0 }}>{sr.service_report_notes || '—'}</p>
        </Card>
      </div>
    </div>
  )
}

function RcaTab({ sr, canModify, onPatch }: { sr: ServiceRequest; canModify: boolean; onPatch: (p: Record<string, unknown>) => Promise<void> | void }) {
  const [rootCause, setRootCause] = useState(sr.root_cause || '')
  const [correctiveAction, setCorrectiveAction] = useState(sr.resolution_description || '')
  const [preventiveActions, setPreventiveActions] = useState(sr.preventive_actions || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty =
    rootCause !== (sr.root_cause || '') ||
    correctiveAction !== (sr.resolution_description || '') ||
    preventiveActions !== (sr.preventive_actions || '')

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await onPatch({
        root_cause: rootCause,
        resolution_description: correctiveAction,
        preventive_actions: preventiveActions,
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Root Cause Analysis">
        <Field label="Root Cause">
          <textarea
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            disabled={!canModify}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', textTransform: 'none' }}
          />
        </Field>
        <Field label="Corrective Action">
          <textarea
            value={correctiveAction}
            onChange={(e) => setCorrectiveAction(e.target.value)}
            disabled={!canModify}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', textTransform: 'none' }}
          />
        </Field>
        <Field label="Preventive Recommendation">
          <textarea
            value={preventiveActions}
            onChange={(e) => setPreventiveActions(e.target.value)}
            disabled={!canModify}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', textTransform: 'none' }}
          />
        </Field>
        {canModify && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={save} disabled={!dirty || saving} style={{ ...primaryBtnStyle, opacity: !dirty || saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save RCA'}
            </button>
            {saved && !dirty && <span style={{ fontSize: 12.5, color: '#047857', fontWeight: 600 }}>Saved</span>}
          </div>
        )}
      </Card>
    </div>
  )
}

const MATERIAL_STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  issued: { bg: '#16a34a', fg: '#fff', label: 'Issued' },
  returned: { bg: '#64748b', fg: '#fff', label: 'Returned' },
  pending: { bg: '#fb923c', fg: '#fff', label: 'Pending' },
}

const PR_STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  submitted: { bg: '#3b82f61a', fg: '#3b82f6', label: 'Submitted' },
  approved: { bg: '#8b5cf61a', fg: '#8b5cf6', label: 'Approved' },
  po_raised: { bg: '#f59e0b1a', fg: '#f59e0b', label: 'PO Raised' },
  partially_received: { bg: '#f973161a', fg: '#f97316', label: 'Partially Received' },
  received: { bg: '#0ea5e91a', fg: '#0ea5e9', label: 'Received' },
  closed: { bg: '#22c55e1a', fg: '#22c55e', label: 'Closed' },
  rejected: { bg: '#dc26261a', fg: '#dc2626', label: 'Rejected' },
  cancelled: { bg: '#94a3b81a', fg: '#94a3b8', label: 'Cancelled' },
}

function MaterialsTab({ srId, canModify }: { srId: number; canModify: boolean }) {
  const [materials, setMaterials] = useState<ServiceRequest['materials']>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ material_name: '', part_number: '', quantity: '1' })
  const [raisingPR, setRaisingPR] = useState(false)
  const [prMessage, setPrMessage] = useState('')
  const [prError, setPrError] = useState('')
  const [receiveInputs, setReceiveInputs] = useState<Record<number, string>>({})
  const [savingReceive, setSavingReceive] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setMaterials(await erpApi.listMaterials(srId))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srId])

  const addMaterial = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.material_name.trim()) return
    await erpApi.addMaterial(srId, {
      material_name: form.material_name,
      part_number: form.part_number || undefined,
      quantity: Number(form.quantity) || 1,
    })
    setForm({ material_name: '', part_number: '', quantity: '1' })
    load()
  }

  const removeMaterial = async (matId: number) => {
    await erpApi.deleteMaterial(srId, matId)
    load()
  }

  const raisePR = async () => {
    setRaisingPR(true)
    setPrError('')
    setPrMessage('')
    try {
      const pr = await erpApi.raisePurchaseRequisition(srId)
      setPrMessage(`Purchase requisition ${pr.pr_number} raised — the Purchase department has been notified.`)
      load()
    } catch (err: any) {
      setPrError(err?.response?.data?.detail || 'Failed to raise purchase requisition.')
    } finally {
      setRaisingPR(false)
    }
  }

  const saveReceive = async (matId: number, maxQty: number) => {
    const raw = receiveInputs[matId]
    const qty = Math.max(0, Math.min(Number(raw), maxQty))
    if (Number.isNaN(qty)) return
    setSavingReceive(matId)
    try {
      await erpApi.receiveMaterial(srId, matId, qty)
      setReceiveInputs((prev) => { const next = { ...prev }; delete next[matId]; return next })
      load()
    } finally {
      setSavingReceive(null)
    }
  }

  const hasUnlinkedMaterials = materials.some((m) => !m.pr_id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {prMessage && <span style={{ fontSize: 12.5, color: '#047857', fontWeight: 600 }}>{prMessage}</span>}
          {prError && <span style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{prError}</span>}
          <button
            onClick={raisePR}
            disabled={raisingPR || !hasUnlinkedMaterials}
            style={{ ...primaryBtnStyle, opacity: raisingPR || !hasUnlinkedMaterials ? 0.55 : 1, cursor: raisingPR || !hasUnlinkedMaterials ? 'not-allowed' : 'pointer' }}
            title={!hasUnlinkedMaterials ? 'Every material already belongs to a purchase requisition' : ''}
          >
            {raisingPR ? 'Raising…' : 'Raise Purchase Requisition'}
          </button>
        </div>
      )}

      {canModify && (
        <form onSubmit={addMaterial} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: 14, borderRadius: 14, background: '#faf9f7' }}>
          <input placeholder="Material name" value={form.material_name} onChange={(e) => setForm((f) => ({ ...f, material_name: e.target.value }))} style={{ ...inputStyle, flex: '1 1 180px' }} />
          <input placeholder="Part number" value={form.part_number} onChange={(e) => setForm((f) => ({ ...f, part_number: e.target.value }))} style={{ ...inputStyle, flex: '1 1 120px' }} />
          <input type="number" min="0" step="0.01" placeholder="Qty" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} style={{ ...inputStyle, width: 90 }} />
          <button type="submit" style={primaryBtnStyle}>Add</button>
        </form>
      )}

      <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Material', 'Part No.', 'Qty', 'Status', 'PR', 'Received', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && materials.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No materials added.</td></tr>}
            {materials.map((m) => {
              const statusBadge = MATERIAL_STATUS_BADGE[m.status || 'pending'] || MATERIAL_STATUS_BADGE.pending
              const prBadge = m.pr_status ? (PR_STATUS_BADGE[m.pr_status] || PR_STATUS_BADGE.submitted) : null
              const canReceive = canModify && !!m.pr_id && m.receiving_status !== 'received'
              return (
              <tr key={m.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{m.material_name}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716c' }}>{m.part_number || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{m.quantity} {m.unit}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: statusBadge.bg, color: statusBadge.fg }}>
                    {statusBadge.label}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {prBadge ? (
                    <Link href={`/dashboard/purchase`} style={{ textDecoration: 'none' }}>
                      <span title={m.pr_number} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: prBadge.bg, color: prBadge.fg }}>
                        {m.pr_number} · {prBadge.label}
                      </span>
                    </Link>
                  ) : (
                    <span style={{ fontSize: 12, color: '#a8a29e' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {canReceive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={m.quantity}
                        step="0.01"
                        placeholder={`${m.received_quantity}/${m.quantity}`}
                        value={receiveInputs[m.id] ?? ''}
                        onChange={(e) => setReceiveInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        style={{ ...inputStyle, width: 70, padding: '5px 8px' }}
                      />
                      <button
                        onClick={() => saveReceive(m.id, m.quantity)}
                        disabled={savingReceive === m.id || receiveInputs[m.id] === undefined || receiveInputs[m.id] === ''}
                        style={{ ...primaryBtnStyle, padding: '5px 10px', fontSize: 11.5, opacity: savingReceive === m.id ? 0.6 : 1 }}
                      >
                        {savingReceive === m.id ? '…' : 'Mark'}
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600, color: m.receiving_status === 'received' ? '#16a34a' : '#78716c' }}>
                      {m.received_quantity}/{m.quantity}{m.receiving_status === 'received' ? ' ✓' : ''}
                    </span>
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {canModify && (
                    <button onClick={() => removeMaterial(m.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Remove</button>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AttachmentsTab({ sr, canModify, onRefresh }: { sr: ServiceRequest; canModify: boolean; onRefresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])

  const stageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    setStaged((prev) => [...prev, ...Array.from(files)])
  }

  const confirmUpload = async () => {
    if (staged.length === 0) return
    setUploading(true)
    setError('')
    try {
      await erpApi.uploadAttachments(sr.id, staged)
      setStaged([])
      onRefresh()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (attachmentId: number) => {
    await erpApi.deleteAttachment(sr.id, attachmentId)
    onRefresh()
  }

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#57534e' }}>Attachments &amp; Documents</span>
        </div>
        <span style={{ fontSize: 12, color: '#a8a29e' }}>{sr.attachments.length} file(s)</span>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {canModify && (
          <div
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files) }}
            style={{
              padding: '32px 20px',
              borderRadius: 14,
              border: `2px dashed ${dragOver ? '#fa9b9b' : 'rgba(0,0,0,0.15)'}`,
              background: dragOver ? 'rgba(244,113,59,0.05)' : '#fff',
              textAlign: 'center',
              cursor: uploading ? 'wait' : 'pointer',
            }}
          >
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>
              {uploading ? 'Uploading…' : 'Drag & drop files here'}
            </p>
            {!uploading && (
              <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>
                or <span style={{ color: '#fa9b9b', fontWeight: 700 }}>click to browse</span>
              </p>
            )}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              {['PDF', 'DOCX', 'XLSX', 'JPG/PNG', 'MP4'].map((t) => (
                <span key={t} style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.05)', color: '#78716c' }}>{t}</span>
              ))}
            </div>
          </div>
        )}

        <FileUploadPreview
          files={staged}
          uploading={uploading}
          onRemove={(i) => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
          onConfirm={confirmUpload}
          onCancel={() => { setStaged([]); if (fileRef.current) fileRef.current.value = '' }}
        />

        {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}

        {sr.attachments.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>No attachments uploaded.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sr.attachments.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                <a href={a.sharepoint_url || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
                  {a.filename}
                </a>
                {canModify && (
                  <button onClick={() => handleDelete(a.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Delete</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AuditTab({ srId }: { srId: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    erpApi.getAuditTrail(srId).then(setEntries).finally(() => setLoading(false))
  }, [srId])

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fa9b9b', margin: '0 0 12px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: '#1f1108', margin: 0 }}>{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#78716c', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  textTransform: 'capitalize',
}

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: '9px 18px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  color: '#57534e',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const dangerBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid rgba(220,38,38,0.25)',
  background: 'rgba(220,38,38,0.06)',
  color: '#b91c1c',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
