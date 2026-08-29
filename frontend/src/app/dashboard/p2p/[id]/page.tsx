'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'

import { p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import PromptDialog from '@/components/erp/PromptDialog'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', po_raised: 'PO Raised', po_approved: 'PO Approved',
  partially_received: 'Partially Received', received: 'Received',
  closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6', approved: '#22c55e', po_raised: '#f59e0b', po_approved: '#22c55e',
  partially_received: '#f97316', received: '#0ea5e9', closed: '#22c55e',
  rejected: '#dc2626', cancelled: '#94a3b8',
}

// A submitted PR where some (but not all) assigned heads have signed off
// gets its own purple "Partially Approved" display — distinct from the
// blue "Submitted" (nobody's approved yet) and green "Approved" (all done).
function displayStatus(pr: P2PRequest): { label: string; hex: string } {
  if (pr.status === 'submitted') {
    const assignedCount = [pr.approver_id, pr.project_head_id, pr.plant_head_id].filter((v) => v != null).length
    const pendingCount = pr.pending_approval_roles?.length ?? assignedCount
    if (assignedCount > 0 && pendingCount > 0 && pendingCount < assignedCount) {
      return { label: 'Partially Approved', hex: '#8b5cf6' }
    }
  }
  return { label: STATUS_LABELS[pr.status] || pr.status, hex: STATUS_HEX[pr.status] || '#64748b' }
}


const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}
const dangerBtn: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10,
  border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)', color: '#b91c1c', cursor: 'pointer',
}

export default function MyP2PRequestDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromApproval = searchParams.get('from') === 'approval'
  const fromPoApproval = searchParams.get('from') === 'po-approval'
  const prId = Number(params.id)

  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [activePanel, setActivePanel] = useState<'' | 'edit'>('')
  const [promptAction, setPromptAction] = useState<'' | 'cancel' | 'reject' | 'approve' | 'approve-po'>('')

  const [editProjectLabel, setEditProjectLabel] = useState('')
  const [editRequiredDate, setEditRequiredDate] = useState('')
  const [editRequirementType, setEditRequirementType] = useState('')
  const [editPriority, setEditPriority] = useState('medium')
  const [editRemarks, setEditRemarks] = useState('')




  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await p2pApi.get(prId)
      setPr(data)
      setEditProjectLabel(data.project_label || '')
      setEditRequiredDate(data.required_date || '')
      setEditRequirementType(data.requirement_type || '')
      setEditPriority(data.priority || 'medium')
      setEditRemarks(data.remarks || '')
    } catch {
      setError('Purchase requisition not found, or you do not have access to it.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && prId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, prId])



  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setActivePanel('')
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const approve = () => setPromptAction('approve')
  const reject = () => setPromptAction('reject')

  const promptActionDo = (value: string) => {
    const action = promptAction
    setPromptAction('')
    if (action === 'cancel') runAction(() => p2pApi.cancel(prId, value || undefined))
    if (action === 'reject') runAction(() => p2pApi.reject(prId, value || undefined))
    if (action === 'approve') runAction(() => p2pApi.approve(prId, value || undefined))
    if (action === 'approve-po') runAction(() => p2pApi.approvePO(prId, value || undefined))
  }

  const saveEdit = () => runAction(() =>
    p2pApi.update(prId, {
      project_label: editProjectLabel || undefined,
      required_date: editRequiredDate || undefined,
      requirement_type: editRequirementType || undefined,
      priority: editPriority,
      remarks: editRemarks || undefined,
    })
  )



  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Not found.</p>

  const status = displayStatus(pr)
  const statusColor = status.hex
  const isAdmin = user?.role === 'admin'
  const approvalRoles = [
    { role: 'department_head', label: 'Department Head', id: pr.approver_id, name: pr.approver_name, approvedAt: pr.department_head_approved_at, comment: pr.department_head_comment },
    { role: 'project_head', label: 'Project Head', id: pr.project_head_id, name: pr.project_head_name, approvedAt: pr.project_head_approved_at, comment: pr.project_head_comment },
    { role: 'plant_head', label: 'Plant Head', id: pr.plant_head_id, name: pr.plant_head_name, approvedAt: pr.plant_head_approved_at, comment: pr.plant_head_comment },
  ]
  const poApprovalRoles = [
    { role: 'purchase_head', label: 'Purchase Head', approvedAt: pr.purchase_head_approved_at, comment: pr.purchase_head_comment },
    { role: 'director', label: 'Director', approvedAt: pr.director_approved_at, comment: pr.director_comment },
    { role: 'md', label: 'MD', approvedAt: pr.md_approved_at, comment: pr.md_comment },
  ]
  const hasAssignedHeads = approvalRoles.some((r) => r.id != null)
  const myPendingRole = approvalRoles.find((r) => r.id != null && r.id === user?.id && !r.approvedAt)
  const canApproveOrReject = pr.status === 'submitted' && (hasAssignedHeads ? (!!myPendingRole || isAdmin) : isPurchaseTeam)
  const canRejectAccess = pr.status === 'submitted' && (hasAssignedHeads ? (approvalRoles.some((r) => r.id != null && r.id === user?.id) || isAdmin) : isPurchaseTeam)
  const canApproveReject = fromApproval && canApproveOrReject
  const canRejectStill = fromApproval && canRejectAccess
  const poRole = user?.is_purchase_head ? 'purchase_head' : user?.is_director ? 'director' : user?.is_md ? 'md' : null
  const canApprovePo = fromPoApproval && pr.status === 'po_raised' && poRole != null && (pr.pending_po_approval_roles || []).includes(poRole)

  return (
    <div>
      <button onClick={() => router.push('/dashboard/p2p')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to My Requisitions
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{pr.p2p_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {status.label}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{pr.category_label || pr.category_code} · {pr.project_label || 'No project specified'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canApproveReject && (
            <button disabled={busy} onClick={approve} style={primaryBtn}>Approve</button>
          )}
          {canApprovePo && (
            <button disabled={busy} onClick={() => setPromptAction('approve-po')} style={primaryBtn}>Approve PO</button>
          )}
          {canRejectStill && (
            <button disabled={busy} onClick={reject} style={dangerBtn}>Reject</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {pr.status === 'rejected' && pr.rejected_reason && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          Rejected: {pr.rejected_reason}
        </div>
      )}
      {pr.status === 'cancelled' && pr.cancelled_reason && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)', color: '#475569', fontSize: 13 }}>
          Cancelled: {pr.cancelled_reason}
        </div>
      )}

      {activePanel === 'edit' && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Edit Details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Project</label>
              <input style={inputStyle} value={editProjectLabel} onChange={(e) => setEditProjectLabel(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Required Date</label>
              <DateField value={editRequiredDate} onChange={setEditRequiredDate} />
            </div>
            <div>
              <label style={labelStyle}>Requirement Type</label>
              <input style={inputStyle} value={editRequirementType} onChange={(e) => setEditRequirementType(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Remarks</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
            </div>
          </div>
          <button disabled={busy} onClick={saveEdit} style={primaryBtn}>Save Changes</button>
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Request Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <InfoRow label="Department" value={pr.department || '—'} />
          <InfoRow label="Requested By" value={pr.requested_by_name || '—'} />
          <InfoRow label="Request Date" value={new Date(pr.request_date).toLocaleDateString()} />
          <InfoRow label="Required Date" value={pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'} />
          <InfoRow label="Requirement Type" value={pr.requirement_type || '—'} />
          <InfoRow label="Priority" value={pr.priority} />
          <InfoRow label="Buyer" value={pr.assigned_buyer_name || '—'} />
        </div>
        {pr.remarks && <div style={{ marginTop: 10 }}><InfoRow label="Remarks" value={pr.remarks} /></div>}
      </div>

      {pr.status === 'po_raised' || pr.status === 'po_approved' || pr.po_number ? (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>PO Approval</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {poApprovalRoles.map((r) => (
              <div key={r.role}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{r.label}</p>
                <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: r.approvedAt ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.15)', color: r.approvedAt ? '#16a34a' : '#64748b' }}>
                    {r.approvedAt ? 'Approved' : 'Pending'}
                  </span>
                </p>
                {r.comment && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{r.comment}&quot;</p>}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Approval</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {approvalRoles.map((r) => (
            <div key={r.role}>
              <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{r.label}</p>
              {r.id == null ? (
                <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>— not assigned</p>
              ) : (
                <>
                  <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                    {r.name || '—'}
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: r.approvedAt ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.15)', color: r.approvedAt ? '#16a34a' : '#64748b' }}>
                      {r.approvedAt ? 'Approved' : 'Pending'}
                    </span>
                  </p>
                  {r.comment && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{r.comment}&quot;</p>}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...sectionStyle, overflow: 'auto' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Item Details</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              {['SL', 'Item Description', 'Make', 'Part Code', 'UOM', 'Qty', 'Project/Inhouse', 'Category', 'Ship To', 'Attachments', ...(isPurchaseTeam ? ['Stock Item'] : [])].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pr.items.map((it, idx) => (
              <tr key={it.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{idx + 1}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.item_name}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.make || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.part_code || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.unit || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.quantity}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.project_inhouse || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.category || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.ship_to || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
                  {it.attachments.length === 0 && <span style={{ color: TEXT.muted }}>—</span>}
                  {it.attachments.map((a) => (
                    <a
                      key={a.id}
                      href="#"
                      onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => p2pApi.getAttachmentBlob(pr.id, a.id)) }}
                      style={{ display: 'block', color: TEXT.heading, textDecoration: 'none' }}
                    >
                      {a.filename}
                    </a>
                  ))}
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>



      {pr.attachments.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Attachments</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pr.attachments.map((a) => (
              <a
                key={a.id}
                href="#"
                onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => p2pApi.getAttachmentBlob(pr.id, a.id)) }}
                style={{ fontSize: 13, color: TEXT.heading, textDecoration: 'none' }}
              >
                {a.filename} <span style={{ color: TEXT.muted, fontSize: 11 }}>({a.doc_type})</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <PromptDialog
        open={promptAction === 'approve'}
        title="Approve this PR?"
        placeholder="Comment (optional)"
        confirmLabel="Approve"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
      <PromptDialog
        open={promptAction === 'approve-po'}
        title="Approve this PO?"
        placeholder="Comment (optional)"
        confirmLabel="Approve PO"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
      <PromptDialog
        open={promptAction === 'cancel'}
        title="Cancel this PR?"
        placeholder="Reason for cancelling (optional)"
        confirmLabel="Cancel Requisition"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
      <PromptDialog
        open={promptAction === 'reject'}
        title="Reject this PR?"
        placeholder="Reason for rejecting (optional)"
        confirmLabel="Reject"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}
