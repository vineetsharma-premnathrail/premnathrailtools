'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi, prRequestApi, usersApi } from '@/lib/api'
import { AuditEntry, Project, ServiceRequest, ServiceMaterial, DirectoryUser, PRCategoryMeta } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadPreview from '@/components/FileUploadPreview'
import CameraCapture from '@/components/CameraCapture'
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
  const [form, setForm] = useState({
    material_name: '', part_number: '', model_number: '', unit: '', quantity: '1',
    estimated_budget: '', description: '', reason: '',
  })
  const [raisingPR, setRaisingPR] = useState(false)
  const [prMessage, setPrMessage] = useState('')
  const [prError, setPrError] = useState('')
  const [showRaiseDialog, setShowRaiseDialog] = useState(false)
  const [raiseForm, setRaiseForm] = useState({ priority: 'medium', required_by_date: '', reason: '', category_code: '', requirement_type: '' })
  const [categories, setCategories] = useState<PRCategoryMeta[]>([])
  const [requirementTypes, setRequirementTypes] = useState<string[]>([])
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [approverIds, setApproverIds] = useState<number[]>([])
  const [approverSearch, setApproverSearch] = useState('')
  const [receiveInputs, setReceiveInputs] = useState<Record<number, string>>({})
  const [savingReceive, setSavingReceive] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setMaterials(await erpApi.listMaterials(srId))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srId])

  useEffect(() => {
    if (!showRaiseDialog || categories.length > 0) return
    prRequestApi.getMeta().then((m) => { setCategories(m.categories); setRequirementTypes(m.requirement_types) }).catch(() => {})
    usersApi.directory().then(setDirectory).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRaiseDialog])

  const addMaterial = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.material_name.trim()) return
    await erpApi.addMaterial(srId, {
      material_name: form.material_name,
      part_number: form.part_number || undefined,
      model_number: form.model_number || undefined,
      unit: form.unit || undefined,
      quantity: Number(form.quantity) || 1,
      estimated_budget: form.estimated_budget ? Number(form.estimated_budget) : undefined,
      description: form.description || undefined,
      reason: form.reason || undefined,
    })
    setForm({ material_name: '', part_number: '', model_number: '', unit: '', quantity: '1', estimated_budget: '', description: '', reason: '' })
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
      const pr = await erpApi.raisePurchaseRequisition(srId, {
        priority: raiseForm.priority,
        required_by_date: raiseForm.required_by_date || undefined,
        reason: raiseForm.reason || undefined,
        category_code: raiseForm.category_code || undefined,
        requirement_type: raiseForm.requirement_type || undefined,
        approver_id: approverIds.length === 1 ? approverIds[0] : undefined,
        approver_name: approverIds.length
          ? approverIds.map((id) => directory.find((u) => u.id === id)?.name).filter(Boolean).join(', ')
          : undefined,
      })
      setPrMessage(`Purchase requisition ${pr.pr_number} raised — the Purchase department has been notified.`)
      setShowRaiseDialog(false)
      setRaiseForm({ priority: 'medium', required_by_date: '', reason: '', category_code: '', requirement_type: '' })
      setApproverIds([])
      setApproverSearch('')
    } catch (err: any) {
      // The request can fail on the client (network drop, dev-server reload,
      // timeout) even after the server already committed the PR — re-fetch
      // regardless of outcome so the page never shows a stale "still
      // unlinked" materials list when the PR was actually raised.
      setPrError(err?.response?.data?.detail || 'Failed to raise purchase requisition — refreshing to confirm current status…')
    } finally {
      setRaisingPR(false)
      load()
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
            onClick={() => setShowRaiseDialog(true)}
            disabled={raisingPR || !hasUnlinkedMaterials}
            style={{ ...primaryBtnStyle, opacity: raisingPR || !hasUnlinkedMaterials ? 0.55 : 1, cursor: raisingPR || !hasUnlinkedMaterials ? 'not-allowed' : 'pointer' }}
            title={!hasUnlinkedMaterials ? 'Every material already belongs to a purchase requisition' : ''}
          >
            {raisingPR ? 'Raising…' : 'Raise Purchase Requisition'}
          </button>
        </div>
      )}

      {showRaiseDialog && (
        <div onClick={() => !raisingPR && setShowRaiseDialog(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: 0 }}>Raise Purchase Requisition</p>
            <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>These details are set once here and can&apos;t be changed later. Items come from the materials list below.</p>
            <Field label="PR Category (optional)">
              <select value={raiseForm.category_code} onChange={(e) => setRaiseForm((f) => ({ ...f, category_code: e.target.value }))} style={{ ...inputStyle, textTransform: 'none' }}>
                <option value="">Select category…</option>
                {categories.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
              </select>
            </Field>
            <Field label="Requirement Type (optional)">
              <select value={raiseForm.requirement_type} onChange={(e) => setRaiseForm((f) => ({ ...f, requirement_type: e.target.value }))} style={{ ...inputStyle, textTransform: 'none' }}>
                <option value="">Select type…</option>
                {requirementTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={raiseForm.priority} onChange={(e) => setRaiseForm((f) => ({ ...f, priority: e.target.value }))} style={{ ...inputStyle, textTransform: 'capitalize' }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Required By (optional)">
              <input type="date" value={raiseForm.required_by_date} onChange={(e) => setRaiseForm((f) => ({ ...f, required_by_date: e.target.value }))} style={{ ...inputStyle, textTransform: 'none' }} />
            </Field>
            <Field label="Manager / Approver (optional)">
              {approverIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {approverIds.map((id) => {
                    const u = directory.find((x) => x.id === id)
                    if (!u) return null
                    return (
                      <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '4px 6px 4px 10px', borderRadius: 8, background: 'rgba(244,113,59,0.1)', border: '1px solid rgba(244,113,59,0.25)', color: '#c2410c' }}>
                        {u.name}
                        <span onClick={() => setApproverIds((prev) => prev.filter((x) => x !== id))} style={{ cursor: 'pointer', fontWeight: 800 }}>×</span>
                      </span>
                    )
                  })}
                </div>
              )}
              <input
                value={approverSearch}
                onChange={(e) => setApproverSearch(e.target.value)}
                placeholder="Search by name or email…"
                style={{ ...inputStyle, textTransform: 'none' }}
              />
              {approverSearch.trim() && (
                <div style={{ marginTop: 6, maxHeight: 140, overflowY: 'auto', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff' }}>
                  {directory
                    .filter((u) => !approverIds.includes(u.id))
                    .filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(approverSearch.trim().toLowerCase()))
                    .slice(0, 8)
                    .map((u) => (
                      <div
                        key={u.id}
                        onClick={() => { setApproverIds((prev) => [...prev, u.id]); setApproverSearch('') }}
                        style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,0.05)' }}
                      >
                        <span style={{ fontWeight: 700 }}>{u.name}</span>{' '}
                        <span style={{ color: '#78716c', fontSize: 12 }}>({u.email})</span>
                      </div>
                    ))}
                </div>
              )}
            </Field>
            <Field label="Reason for Purchase (optional)">
              <textarea value={raiseForm.reason} onChange={(e) => setRaiseForm((f) => ({ ...f, reason: e.target.value }))} rows={3} style={{ ...inputStyle, textTransform: 'none', resize: 'vertical' }} />
            </Field>
            {prError && <span style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{prError}</span>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowRaiseDialog(false)} disabled={raisingPR} style={secondaryBtnStyle}>Cancel</button>
              <button onClick={raisePR} disabled={raisingPR} style={{ ...primaryBtnStyle, opacity: raisingPR ? 0.6 : 1 }}>{raisingPR ? 'Raising…' : 'Confirm & Raise'}</button>
            </div>
          </div>
        </div>
      )}

      {canModify && (
        <form onSubmit={addMaterial} style={{ padding: 14, borderRadius: 14, background: '#faf9f7', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr>
                {['Part / Item Name *', 'Part Code', 'Model Number', 'Unit', 'Qty', 'Est. Budget', 'Description / Specification', 'Reason / Purpose', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '0 8px', minWidth: 160 }}>
                  <input value={form.material_name} onChange={(e) => setForm((f) => ({ ...f, material_name: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 110 }}>
                  <input value={form.part_number} onChange={(e) => setForm((f) => ({ ...f, part_number: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 110 }}>
                  <input value={form.model_number} onChange={(e) => setForm((f) => ({ ...f, model_number: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 90 }}>
                  <input placeholder="pcs / kg" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 70 }}>
                  <input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 100 }}>
                  <input type="number" min="0" step="0.01" value={form.estimated_budget} onChange={(e) => setForm((f) => ({ ...f, estimated_budget: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 160 }}>
                  <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px', minWidth: 160 }}>
                  <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} style={inputStyle} />
                </td>
                <td style={{ padding: '0 8px' }}>
                  <button type="submit" style={primaryBtnStyle}>Add</button>
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      )}

      <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Material', 'Photos', 'Part No.', 'Model No.', 'Qty', 'Est. Budget', 'Status', 'PR', 'Received', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && materials.length === 0 && <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No materials added.</td></tr>}
            {materials.map((m) => {
              const statusBadge = MATERIAL_STATUS_BADGE[m.status || 'pending'] || MATERIAL_STATUS_BADGE.pending
              const prBadge = m.pr_status ? (PR_STATUS_BADGE[m.pr_status] || PR_STATUS_BADGE.submitted) : null
              const canReceive = canModify && !!m.pr_id && m.receiving_status !== 'received'
              const isExpanded = expandedId === m.id
              return (
              <Fragment key={m.id}>
              <tr style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>
                  {m.material_name}
                  {(m.description || m.reason) && (
                    <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 2 }}>
                      {m.description}{m.description && m.reason ? ' — ' : ''}{m.reason}
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    style={{ border: 'none', background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, color: '#78716c', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    Photos ({m.attachments?.length || 0}) {isExpanded ? '▴' : '▾'}
                  </button>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716c' }}>{m.part_number || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716c' }}>{m.model_number || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{m.quantity}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716c' }}>{m.estimated_budget ?? '—'}</td>
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
              {isExpanded && (
                <tr>
                  <td colSpan={8} style={{ padding: '0 14px 14px' }}>
                    <MaterialPhotoGallery srId={srId} material={m} canModify={canModify} onChanged={load} />
                  </td>
                </tr>
              )}
              </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MaterialPhotoGallery({ srId, material, canModify, onChanged }: { srId: number; material: ServiceMaterial; canModify: boolean; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])

  const stageFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    setStaged((prev) => [...prev, ...Array.from(files)])
  }

  const confirmUpload = async () => {
    if (staged.length === 0) return
    setUploading(true)
    setError('')
    try {
      await erpApi.uploadMaterialAttachments(srId, material.id, staged)
      setStaged([])
      onChanged()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (attachmentId: number) => {
    await erpApi.deleteMaterialAttachment(srId, material.id, attachmentId)
    onChanged()
  }

  return (
    <div style={{ borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {showCamera && (
        <CameraCapture onCapture={(file) => stageFiles([file])} onClose={() => setShowCamera(false)} />
      )}
      {canModify && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => !uploading && setShowCamera(true)}
            disabled={uploading}
            aria-label="Take photo"
            title="Take photo"
            style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', background: '#faf9f7', fontSize: 19, cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            📷
          </button>

          <button
            type="button"
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files) }}
            disabled={uploading}
            aria-label="Browse photos"
            title="Browse photos, or drag &amp; drop here"
            style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, border: `1px solid ${dragOver ? '#fa9b9b' : 'rgba(0,0,0,0.1)'}`, background: dragOver ? 'rgba(244,113,59,0.08)' : '#faf9f7', fontSize: 19, cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🖼️
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
          <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0 }}>
            {uploading ? 'Uploading…' : 'Take a photo, or browse / drag & drop (JPG/PNG)'}
          </p>
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

      {(!material.attachments || material.attachments.length === 0) ? (
        <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>No photos added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {material.attachments.map((a) => (
            <div key={a.id} style={{ position: 'relative', width: 64, height: 64, flex: 'none' }}>
              <MaterialPhotoThumb srId={srId} matId={material.id} attachment={a} />
              {canModify && (
                <button
                  onClick={() => handleDelete(a.id)}
                  aria-label={`Delete ${a.filename}`}
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, lineHeight: '20px', cursor: 'pointer', padding: 0 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MaterialPhotoThumb({ srId, matId, attachment }: { srId: number; matId: number; attachment: import('@/types').ServiceMaterialAttachment }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    erpApi.getMaterialAttachmentBlob(srId, matId, attachment.id).then((blob) => {
      if (cancelled) return
      url = URL.createObjectURL(blob)
      setBlobUrl(url)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [srId, matId, attachment.id])

  return (
    <button
      onClick={() => blobUrl && window.open(blobUrl, '_blank', 'noopener,noreferrer')}
      disabled={!blobUrl}
      style={{ width: 64, height: 64, padding: 0, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, background: '#f5f5f4', cursor: blobUrl ? 'pointer' : 'default', overflow: 'hidden' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {blobUrl && <img src={blobUrl} alt={attachment.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </button>
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

  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null)

  const openPreview = async (a: import('@/types').ServiceRequestAttachment) => {
    setPreviewLoadingId(a.id)
    setError('')
    try {
      // Permission-gated, short-lived Microsoft preview link — never the raw
      // sharepoint_url. Opens in its own tab (that's the intended UX here).
      const { getUrl } = await erpApi.previewAttachment(sr.id, a.id)
      window.open(getUrl, '_blank', 'noopener,noreferrer')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not open preview.')
    } finally {
      setPreviewLoadingId(null)
    }
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
                <button
                  onClick={() => openPreview(a)}
                  disabled={previewLoadingId === a.id}
                  style={{ fontSize: 13, color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: previewLoadingId === a.id ? 'wait' : 'pointer', textDecoration: 'underline' }}
                >
                  {previewLoadingId === a.id ? 'Opening…' : a.filename}
                </button>
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
