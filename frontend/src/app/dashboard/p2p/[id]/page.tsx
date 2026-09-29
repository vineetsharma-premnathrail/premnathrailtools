'use client'

import { useEffect, useState, Fragment } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'

import { p2pApi, rfqApi, purchaseOrdersApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { P2PRequest, RFQ, P2PPurchaseOrder, P2PRequestItemStockCheck } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import PromptDialog from '@/components/erp/PromptDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'

const FULFILLMENT_LABELS: Record<string, string> = {
  pending: 'Awaiting Decision', stock_issued: 'Issued from Stock', sent_to_procurement: 'In Procurement',
}
const FULFILLMENT_HEX: Record<string, string> = {
  pending: '#f59e0b', stock_issued: '#22c55e', sent_to_procurement: '#3b82f6',
}

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
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)

  const [activePanel, setActivePanel] = useState<'' | 'edit'>('')
  const [promptAction, setPromptAction] = useState<'' | 'cancel' | 'reject' | 'approve' | 'approve-po'>('')

  const [editProjectLabel, setEditProjectLabel] = useState('')
  const [editRequiredDate, setEditRequiredDate] = useState('')
  const [editRequirementType, setEditRequirementType] = useState('')
  const [editPriority, setEditPriority] = useState('medium')
  const [editRemarks, setEditRemarks] = useState('')

  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [po, setPo] = useState<P2PPurchaseOrder | null>(null)

  const [stockCheckOpenId, setStockCheckOpenId] = useState<number | null>(null)
  const [stockCheckLoadingId, setStockCheckLoadingId] = useState<number | null>(null)
  const [stockCheckResults, setStockCheckResults] = useState<Record<number, P2PRequestItemStockCheck>>({})
  const [issueQtyByItem, setIssueQtyByItem] = useState<Record<number, string>>({})
  const [confirmProcurementItemId, setConfirmProcurementItemId] = useState<number | null>(null)

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

      const [rfqList, poList] = await Promise.all([
        rfqApi.list({ p2p_request_id: data.id }).catch(() => []),
        purchaseOrdersApi.list({ p2p_request_id: data.id }).catch(() => []),
      ])
      setRfq(rfqList[0] || null)
      setPo(poList[0] || null)
    } catch (err) {
      setError(extractErrorMessages(err, 'Purchase requisition not found, or you do not have access to it.').join(' '))
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
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Action failed.'))
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

  const checkStock = async (itemId: number) => {
    if (stockCheckOpenId === itemId) { setStockCheckOpenId(null); return }
    setStockCheckOpenId(itemId)
    if (stockCheckResults[itemId]) return
    setStockCheckLoadingId(itemId)
    setError('')
    try {
      const result = await p2pApi.checkItemStock(prId, itemId)
      setStockCheckResults((prev) => ({ ...prev, [itemId]: result }))
      setIssueQtyByItem((prev) => ({ ...prev, [itemId]: String(result.requested_qty) }))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Stock check failed.'))
      setStockCheckOpenId(null)
    } finally {
      setStockCheckLoadingId(null)
    }
  }

  const issueFromStock = (itemId: number, locationId: number) => runAction(async () => {
    const qty = Number(issueQtyByItem[itemId])
    await p2pApi.issueItemFromStock(prId, itemId, { location_id: locationId, quantity: qty > 0 ? qty : undefined })
    setStockCheckOpenId(null)
  })

  const sendToProcurement = (itemId: number) => runAction(async () => {
    await p2pApi.sendItemToProcurement(prId, itemId)
    setStockCheckOpenId(null)
    setConfirmProcurementItemId(null)
  })



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
    { role: 'purchase_head', label: 'Purchase Head', name: pr.purchase_head_approved_by_name, approvedAt: pr.purchase_head_approved_at, comment: pr.purchase_head_comment },
    { role: 'director', label: 'Director', name: pr.director_approved_by_name, approvedAt: pr.director_approved_at, comment: pr.director_comment },
    { role: 'md', label: 'MD', name: pr.md_approved_by_name, approvedAt: pr.md_approved_at, comment: pr.md_comment },
  ]
  // The PO Approval chain (Purchase Head → Director → MD) is always shown, so
  // the full six-step chain is visible in one place from the start — its rows
  // just read "PO not raised yet" until a PO actually exists. Hiding the whole
  // panel until then made those three roles look like they'd gone missing.
  const poRaised = pr.status === 'po_raised' || pr.status === 'po_approved' || !!pr.po_number
  // A rejection is shown on the rejecting role's own row — same shape as an
  // approval (pill + quoted note) — rather than as a separate banner.
  const rejectedByRole = pr.status === 'rejected' ? pr.rejected_by_role : null
  const rowPill = (role: string, approvedAt?: string | null) =>
    rejectedByRole === role
      ? { text: 'Rejected', bg: 'rgba(220,38,38,0.1)', color: '#dc2626' }
      : approvedAt
      ? { text: 'Approved', bg: 'rgba(34,197,94,0.12)', color: '#16a34a' }
      : { text: 'Pending', bg: 'rgba(148,163,184,0.15)', color: '#64748b' }
  // Rejections by an admin or the purchase team at large belong to no role
  // row above, and a cancellation records no role at all — both get their own
  // cell at the end of the Approval grid instead, in that same shape.
  const roleRows = ['department_head', 'project_head', 'plant_head', 'purchase_head', 'director', 'md']
  const terminalNote = pr.status === 'cancelled'
    ? { label: 'Cancelled', bg: 'rgba(148,163,184,0.15)', color: '#64748b', reason: pr.cancelled_reason, name: undefined }
    : pr.status === 'rejected' && !roleRows.includes(rejectedByRole || '')
    ? { label: 'Rejected', bg: 'rgba(220,38,38,0.1)', color: '#dc2626', reason: pr.rejected_reason, name: pr.rejected_by_name }
    : null

  const hasAssignedHeads = approvalRoles.some((r) => r.id != null)
  const myPendingRole = approvalRoles.find((r) => r.id != null && r.id === user?.id && !r.approvedAt)
  const canApproveOrReject = pr.status === 'submitted' && (hasAssignedHeads ? (!!myPendingRole || isAdmin) : isPurchaseTeam)
  const canRejectAccess = pr.status === 'submitted' && (hasAssignedHeads ? (approvalRoles.some((r) => r.id != null && r.id === user?.id) || isAdmin) : isPurchaseTeam)
  const canApproveReject = fromApproval && canApproveOrReject
  const canRejectStill = fromApproval && canRejectAccess
  const poRole = user?.is_purchase_head ? 'purchase_head' : user?.is_director ? 'director' : user?.is_md ? 'md' : null
  const canApprovePo = fromPoApproval && pr.status === 'po_raised' && poRole != null && (pr.pending_po_approval_roles || []).includes(poRole)
  const canRejectPo = fromPoApproval && pr.status === 'po_raised' && (poRole != null || isAdmin)
  // Once a PR is approved, the buyer can check store stock per item and
  // decide item-by-item whether to issue it from stock or send it to
  // procurement — not available once the request has been rejected/cancelled
  // (nothing left to decide) or before it's even approved (submitted).
  const canManageStock = isPurchaseTeam && pr.status !== 'submitted' && pr.status !== 'rejected' && pr.status !== 'cancelled'

  return (
    <div>
      <P2PNav />

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
          <button data-tour="pr-detail-back" onClick={() => router.push('/dashboard/p2p')} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
          {canApproveReject && (
            <button data-tour="pr-detail-approve" disabled={busy} onClick={approve} style={primaryBtn}>Approve</button>
          )}
          {canApprovePo && (
            <button data-tour="pr-detail-approve-po" disabled={busy} onClick={() => setPromptAction('approve-po')} style={primaryBtn}>Approve PO</button>
          )}
          {(canRejectStill || canRejectPo) && (
            <button data-tour="pr-detail-reject" disabled={busy} onClick={reject} style={dangerBtn}>Reject</button>
          )}
        </div>
      </div>

      <MessageDialog open={!!error} variant="error" title="Cannot Complete Action" message={error} onClose={() => setError('')} />

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
          <button disabled={busy} onClick={saveEdit} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>Save Changes</button>
        </div>
      )}

      <div data-tour="pr-detail-request-info" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Request Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <InfoRow label="Department" value={pr.department || '—'} />
          <InfoRow label="Requested By" value={pr.requested_by_name || '—'} />
          <InfoRow label="Request Date" value={formatDate(pr.request_date)} />
          <InfoRow label="Required Date" value={formatDate(pr.required_date)} />
          <InfoRow label="Requirement Type" value={pr.requirement_type || '—'} />
          <InfoRow label="Priority" value={pr.priority} />
          <InfoRow label="Buyer" value={pr.assigned_buyer_name || '—'} />
        </div>
        {pr.remarks && <div style={{ marginTop: 10 }}><InfoRow label="Remarks" value={pr.remarks} /></div>}
      </div>

      {po && (
        <div data-tour="pr-detail-po-info" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Purchase Order</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 14 }}>
            <InfoRow label="PO Number" value={po.po_number} />
            <InfoRow label="Vendor" value={po.vendor_name || '—'} />
          </div>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>PO Document</p>
            {po.document_filename && rfq ? (
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getPoDocumentBlob(rfq.id, po.id), po.document_filename!) }}
                style={{ fontSize: 13.5, color: '#2563eb', textDecoration: 'none' }}
              >
                {po.document_filename}
              </a>
            ) : (
              <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>No document attached.</p>
            )}
          </div>
        </div>
      )}

      {rfq && rfq.attachments.length > 0 && (
        <div data-tour="pr-detail-vendor-quotations" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Quotations</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            {rfq.attachments.map((a) => (
              <div key={a.id} style={{ borderRadius: 12, border: `1px solid ${BORDER.normal}`, padding: 12 }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{a.vendor_tier}</p>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading, margin: '0 0 2px' }}>{a.vendor_name || '—'}</p>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getAttachmentBlob(rfq.id, a.id), a.filename) }}
                  style={{ fontSize: 12.5, color: '#2563eb', textDecoration: 'none' }}
                >
                  {a.filename}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div data-tour="pr-detail-po-approval" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>PO Approval</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {poApprovalRoles.map((r) => {
            const pill = rowPill(r.role, r.approvedAt)
            const note = rejectedByRole === r.role ? pr.rejected_reason || r.comment : r.comment
            const actor = rejectedByRole === r.role ? pr.rejected_by_name : r.name
            return (
              <div key={r.role}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{r.label}</p>
                {!poRaised ? (
                  <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>— PO not raised yet</p>
                ) : (
                  <>
                    <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                      {actor || '—'}
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: pill.bg, color: pill.color }}>
                        {pill.text}
                      </span>
                    </p>
                    {note && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{note}&quot;</p>}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div data-tour="pr-detail-approval" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Approval</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {approvalRoles.map((r) => {
            const pill = rowPill(r.role, r.approvedAt)
            const note = rejectedByRole === r.role ? pr.rejected_reason || r.comment : r.comment
            return (
              <div key={r.role}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{r.label}</p>
                {r.id == null ? (
                  <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>— not assigned</p>
                ) : (
                  <>
                    <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                      {(rejectedByRole === r.role ? pr.rejected_by_name : null) || r.name || '—'}
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: pill.bg, color: pill.color }}>
                        {pill.text}
                      </span>
                    </p>
                    {note && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{note}&quot;</p>}
                  </>
                )}
              </div>
            )
          })}
          {terminalNote && (
            <div>
              <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{terminalNote.label}</p>
              <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                {terminalNote.name || '—'}
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: terminalNote.bg, color: terminalNote.color }}>
                  {terminalNote.label}
                </span>
              </p>
              {terminalNote.reason && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{terminalNote.reason}&quot;</p>}
            </div>
          )}
        </div>
      </div>

      <div data-tour="pr-detail-items" style={{ ...sectionStyle, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Item Details</h2>
        <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              {['SL', 'Item Description', 'Make', 'Part Code', 'UOM', 'Qty', 'Project/Inhouse', 'Category', 'Ship To', 'Attachments', 'Fulfillment'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pr.items.map((it, idx) => {
              const fulfillmentHex = FULFILLMENT_HEX[it.fulfillment_status] || '#64748b'
              const check = stockCheckResults[it.id]
              const showActions = canManageStock && it.fulfillment_status === 'pending'
              return (
              <Fragment key={it.id}>
                <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
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
                      onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => p2pApi.getAttachmentBlob(pr.id, a.id), a.filename) }}
                      style={{ display: 'block', color: TEXT.heading, textDecoration: 'none' }}
                    >
                      {a.filename}
                    </a>
                  ))}
                </td>
                <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${fulfillmentHex}1a`, color: fulfillmentHex, whiteSpace: 'nowrap' }}>
                      {FULFILLMENT_LABELS[it.fulfillment_status] || it.fulfillment_status}
                    </span>
                    {it.fulfillment_status === 'stock_issued' && (
                      <span style={{ fontSize: 11, color: TEXT.muted }}>{it.issued_qty} {it.unit || ''} @ {it.issued_from_location_name || '—'}</span>
                    )}
                    {showActions && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => checkStock(it.id)}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', color: TEXT.heading, cursor: 'pointer' }}
                      >
                        {stockCheckOpenId === it.id ? 'Hide Stock Check' : 'Check Stock'}
                      </button>
                    )}
                  </div>
                </td>
                </tr>
                {stockCheckOpenId === it.id && (
                  <tr key={`${it.id}-stock`} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td colSpan={11} style={{ padding: '10px 14px', background: 'rgba(148,163,184,0.06)' }}>
                      {stockCheckLoadingId === it.id ? (
                        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Checking store stock…</p>
                      ) : !check ? null : !check.matched ? (
                        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{check.message || 'No matching store item found.'}</p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
                          <div>
                            <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>Matched Store Item</p>
                            <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>{check.store_item_code} — {check.store_item_name}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>At Ship-To ({it.ship_to || '—'})</p>
                            <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                              {check.ship_to_location ? `${check.ship_to_location.available_qty} available` : 'Ship-to location not recognized'}
                            </p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>Total (All Locations)</p>
                            <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>{check.total_across_locations?.available_qty ?? 0} available</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>Requested Qty</p>
                            <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>{check.requested_qty}</p>
                          </div>
                          {check.ship_to_location && (
                            <div>
                              <label style={{ ...labelStyle, marginBottom: 4 }}>Issue Qty</label>
                              <input
                                type="number"
                                min={0}
                                max={check.requested_qty}
                                value={issueQtyByItem[it.id] ?? String(check.requested_qty)}
                                onChange={(e) => setIssueQtyByItem((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                style={{ ...inputStyle, width: 90, padding: '7px 10px' }}
                              />
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            {check.ship_to_location && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => issueFromStock(it.id, check.ship_to_location!.location_id!)}
                                style={{ ...primaryBtn, padding: '8px 14px', fontSize: 12.5 }}
                              >
                                Issue from Stock
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmProcurementItemId(it.id)}
                              style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', color: TEXT.heading, cursor: 'pointer' }}
                            >
                              Send to Procurement
                            </button>
                          </div>
                        </div>
                      )}
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



      {pr.attachments.length > 0 && (
        <div data-tour="pr-detail-attachments" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Attachments</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pr.attachments.map((a) => (
              <a
                key={a.id}
                href="#"
                onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => p2pApi.getAttachmentBlob(pr.id, a.id), a.filename) }}
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
        title="Approve this Purchase Requisition?"
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
        title="Cancel this Purchase Requisition?"
        placeholder="Reason for cancelling (optional)"
        confirmLabel="Cancel Requisition"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
      <PromptDialog
        open={promptAction === 'reject'}
        title="Reject this Purchase Requisition?"
        placeholder="Reason for rejecting (optional)"
        confirmLabel="Reject"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
      <ConfirmDialog
        open={confirmProcurementItemId != null}
        title="Send Item to Procurement?"
        message="This confirms the item is not available in store stock and will be purchased through the normal RFQ/PO flow. This cannot be undone."
        confirmLabel="Send to Procurement"
        danger={false}
        onConfirm={() => confirmProcurementItemId != null && sendToProcurement(confirmProcurementItemId)}
        onCancel={() => setConfirmProcurementItemId(null)}
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
