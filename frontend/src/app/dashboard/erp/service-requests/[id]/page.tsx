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

  const canModify = !!sr && !!user && (user.role === 'admin' || user.role === 'super_admin' || sr.created_by_id === user.id)

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
    <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', marginBottom: 20, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', overflowX: 'auto' }}>
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

const MATERIAL_AVAILABILITY_BADGE: Record<string, { fg: string; label: string }> = {
  in_stock: { fg: '#16a34a', label: 'In Stock' },
  reserved: { fg: '#f97316', label: 'Reserved' },
  ordered: { fg: '#3b82f6', label: 'Ordered' },
  out_of_stock: { fg: '#ef4444', label: 'Out of Stock' },
}

function MaterialsTab({ srId, canModify }: { srId: number; canModify: boolean }) {
  const [materials, setMaterials] = useState<ServiceRequest['materials']>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ material_name: '', part_number: '', quantity: '1', unit_price: '0' })
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false)

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
      unit_price: Number(form.unit_price) || 0,
    })
    setForm({ material_name: '', part_number: '', quantity: '1', unit_price: '0' })
    load()
  }

  const removeMaterial = async (matId: number) => {
    await erpApi.deleteMaterial(srId, matId)
    load()
  }

  const total = materials.reduce((sum, m) => sum + m.total_price, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setPurchaseModalOpen(true)} style={secondaryBtnStyle}>Send to Purchase Dept.</button>
        </div>
      )}

      {canModify && (
        <form onSubmit={addMaterial} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: 14, borderRadius: 14, background: '#faf9f7' }}>
          <input placeholder="Material name" value={form.material_name} onChange={(e) => setForm((f) => ({ ...f, material_name: e.target.value }))} style={{ ...inputStyle, flex: '1 1 180px' }} />
          <input placeholder="Part number" value={form.part_number} onChange={(e) => setForm((f) => ({ ...f, part_number: e.target.value }))} style={{ ...inputStyle, flex: '1 1 120px' }} />
          <input type="number" min="0" step="0.01" placeholder="Qty" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} style={{ ...inputStyle, width: 90 }} />
          <input type="number" min="0" step="0.01" placeholder="Unit price" value={form.unit_price} onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))} style={{ ...inputStyle, width: 120 }} />
          <button type="submit" style={primaryBtnStyle}>Add</button>
        </form>
      )}

      <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Material', 'Part No.', 'Qty', 'Status', 'Availability', 'Unit Price', 'Total', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && materials.length === 0 && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No materials added.</td></tr>}
            {materials.map((m) => {
              const statusBadge = MATERIAL_STATUS_BADGE[m.status || 'pending'] || MATERIAL_STATUS_BADGE.pending
              const availBadge = MATERIAL_AVAILABILITY_BADGE[m.availability || 'in_stock'] || MATERIAL_AVAILABILITY_BADGE.in_stock
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
                <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, color: availBadge.fg }}>{availBadge.label}</td>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>₹{m.unit_price.toFixed(2)}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700 }}>₹{m.total_price.toFixed(2)}</td>
                <td style={{ padding: '10px 14px' }}>
                  {canModify && (
                    <button onClick={() => removeMaterial(m.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Remove</button>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
          {materials.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid rgba(0,0,0,0.08)' }}>
                <td colSpan={6} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700 }}>Total</td>
                <td colSpan={2} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800 }}>₹{total.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {purchaseModalOpen && (
        <SendPurchaseEmailModal srId={srId} onClose={() => setPurchaseModalOpen(false)} />
      )}
    </div>
  )
}

function SendPurchaseEmailModal({ srId, onClose }: { srId: number; onClose: () => void }) {
  const [users, setUsers] = useState<{ id: string; name: string; email: string; job_title: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    erpApi.getPurchaseUsers(srId)
      .then(setUsers)
      .catch((err) => setError(err?.response?.data?.detail || 'Failed to load Purchase department users.'))
      .finally(() => setLoading(false))
  }, [srId])

  const toggle = (email: string) => setSelected((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]))

  const send = async () => {
    if (selected.length === 0) return
    setSending(true)
    setError('')
    try {
      await erpApi.sendPurchaseEmail(srId, selected)
      setSent(true)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to send email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 16, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Send to Purchase Dept.</h3>
        <p style={{ fontSize: 12.5, color: '#78716c', margin: '0 0 16px' }}>Select recipients from the Purchase department</p>

        {error && <p style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 12 }}>{error}</p>}

        {sent ? (
          <p style={{ fontSize: 13, color: '#047857', fontWeight: 600 }}>Email sent to {selected.length} recipient(s).</p>
        ) : loading ? (
          <p style={{ fontSize: 13, color: '#a8a29e' }}>Loading…</p>
        ) : users.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e' }}>No Purchase department users found in Azure AD.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 16 }}>
            {users.map((u) => (
              <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={selected.includes(u.email)} onChange={() => toggle(u.email)} />
                <span>{u.name} <span style={{ color: '#a8a29e' }}>({u.email})</span></span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={secondaryBtnStyle}>{sent ? 'Close' : 'Cancel'}</button>
          {!sent && (
            <button onClick={send} disabled={sending || selected.length === 0} style={{ ...primaryBtnStyle, opacity: sending || selected.length === 0 ? 0.6 : 1 }}>
              {sending ? 'Sending…' : 'Send Email'}
            </button>
          )}
        </div>
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
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', overflow: 'hidden' }}>
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
        <div key={e.id} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)' }}>
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
    <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)' }}>
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
