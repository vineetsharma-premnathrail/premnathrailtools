'use client'

import { useEffect, useRef, useState, Fragment } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'

import { p2pApi, rfqApi, purchaseOrdersApi, storeApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { P2PRequest, RFQ, P2PPurchaseOrder, P2PRequestItemStockCheck, StoreItem } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import Select from '@/components/shared/Select'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { userPoRoles, p2pRoleLabel } from '@/lib/p2pRoles'
import { secondaryBtnStyle, primaryBtnStyle, dangerBtnStyle, smallPrimaryBtnStyle, smallSecondaryBtnStyle, RowCount, inputStyle as sharedInputStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow, thStyle, numThStyle, tdStyle, numTdStyle, chipBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import ServiceEntriesPanel from '@/components/p2p/ServiceEntriesPanel'
import PoDeliveryCostsPanel from '@/components/p2p/PoDeliveryCostsPanel'
import { useRecordId, recordHref, recordPath } from '@/lib/recordRef'
import { OrderProjectChip } from '@/components/sales/ProjectUnitPicker'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { FormSheet, SheetIcon, SheetIconName, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const FULFILLMENT_LABELS: Record<string, string> = {
  pending: 'Awaiting Decision', stock_issued: 'Issued from Stock', sent_to_procurement: 'In Procurement',
}
const FULFILLMENT_HEX: Record<string, string> = {
  pending: '#f59e0b', stock_issued: '#22c55e', sent_to_procurement: '#3b82f6',
}

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved',
  vendor_quotations: 'RFQ / Quotations', technical_evaluation: 'Technical Evaluation',
  commercial_evaluation: 'Commercial Evaluation', vendor_selected: 'Vendor Selected', po_drafted: 'PO Draft',
  po_raised: 'PO Raised', po_approved: 'PO Approved',
  partially_received: 'Partially Received', received: 'Received',
  closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled', returned: 'Returned for changes', draft: 'Draft',
}
const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6', approved: '#22c55e',
  vendor_quotations: '#6366f1', technical_evaluation: '#8b5cf6', commercial_evaluation: '#a855f7',
  vendor_selected: '#0ea5e9', po_drafted: '#64748b',
  po_raised: '#f59e0b', po_approved: '#22c55e',
  partially_received: '#d97706', received: '#16a34a', closed: '#22c55e',
  rejected: '#dc2626', cancelled: '#94a3b8', returned: '#7c3aed', draft: '#64748b',
}
// Statuses a requisition can still be cancelled from (backend
// cancel_p2p_request refuses po_raised — the PO must be rejected — and
// receipts; po_approved is Purchase-only, see canCancel).
const CANCELLABLE_STATUSES = ['submitted', 'returned', 'approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted']

// Extra fields the single-PR GET carries beyond the shared P2PRequest type:
// the latest PO with its lines (approvers usually can't call the Purchase
// Orders API) and per-role approval state on the PO Approval panel.
type PoPanelEntry = {
  role: string; role_label: string; people: { id: number; name?: string | null }[]
  approved_at?: string | null; approved_by_name?: string | null; comment?: string | null
}
type P2PRequestDetail = Omit<P2PRequest, 'po_approval_panel'> & {
  purchase_order?: P2PPurchaseOrder | null
  po_approval_panel?: PoPanelEntry[]
}

const money = (v?: number | null) => (v == null ? '—' : `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

// A submitted PR where some (but not all) assigned approvers have signed off
// gets its own purple "Partially Approved" display — distinct from the
// blue "Submitted" (nobody's approved yet) and green "Approved" (all done).
function displayStatus(pr: P2PRequest): { label: string; hex: string } {
  if (pr.status === 'submitted') {
    const assignedCount = pr.approvals?.length
      || [pr.approver_id, pr.project_head_id, pr.plant_head_id].filter((v) => v != null).length
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
const inputStyle: React.CSSProperties = sharedInputStyle
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const primaryBtn = primaryBtnStyle
const STOCK_LABELS: Record<string, string> = { in_stock: 'In Stock', partial: 'Partial', not_in_stock: 'Not in Stock', no_match: 'Not linked to Item Master' }
const STOCK_HEX: Record<string, string> = { in_stock: '#16a34a', partial: '#f59e0b', not_in_stock: '#dc2626', no_match: '#94a3b8' }

const sheetErr: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
type PromptKind = 'cancel' | 'reject' | 'approve' | 'approve-po' | 'short-close' | 'issue'

const dangerBtn = dangerBtnStyle

// Purpose of the requisition (backend P2P_PURPOSES), shown in the header.
const PURPOSE_LABELS: Record<string, string> = {
  customer_order: 'Project', machine_project: 'Service', development: 'New development',
  department: 'Department running cost', capital: 'Asset / capital purchase', stock: 'Store stock refill',
}
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const PRIORITY_HEX: Record<string, string> = { low: '#64748b', medium: '#d97706', high: '#dc2626' }
const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged by vendor', partially_fulfilled: 'Partially received', fulfilled: 'Fully received', cancelled: 'Cancelled',
}
const PO_STATUS_HEX: Record<string, string> = {
  draft: '#64748b', issued: '#3b82f6', acknowledged: '#0ea5e9', partially_fulfilled: '#d97706', fulfilled: '#16a34a', cancelled: '#94a3b8',
}
// One approver's state on the approval grids — a Pill instead of a hand-made badge.
const PILL_HEX = { Approved: '#16a34a', Pending: '#64748b', Rejected: '#dc2626', Cancelled: '#64748b' } as const

export default function MyP2PRequestDetailPage() {
  // Deliberately NOT useRequireApp('p2p'): PR approvers are picked from the
  // whole user directory and usually lack the p2p app — being named on the
  // PR is their access. The backend still 403s anyone not entitled to it.
  const { user, isLoading } = useAuth()
  const isAuthorized = !!user
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromApproval = searchParams.get('from') === 'approval'
  const fromPoApproval = searchParams.get('from') === 'po-approval'
  const { id: resolvedPrId, error: linkError } = useRecordId(params.id as string)
  const prId = resolvedPrId ?? 0
  // PO Tracking / PO notifications open ONE purchase order of a split requisition: ?po=<signed ref>.
  const { id: wantedPoId } = useRecordId(searchParams.get('po'))

  const [pr, setPr] = useState<P2PRequestDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)

  const [promptAction, setPromptAction] = useState<'' | PromptKind>('')
  const [promptText, setPromptText] = useState('')
  const [sheetError, setSheetError] = useState('')

  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [loadedPo, setPo] = useState<P2PPurchaseOrder | null>(null)
  // Every live PO of this requisition (a split requisition has several) — `po` is the one shown:
  // the one picked here, else the one the link names (?po=), else the newest.
  const [allPos, setAllPos] = useState<P2PPurchaseOrder[]>([])
  const [pickedPoId, setPickedPoId] = useState<number | null>(null)
  const po = allPos.find((x) => x.id === (pickedPoId ?? wantedPoId)) ?? loadedPo

  const [stockCheckLoading, setStockCheckLoading] = useState<Record<number, boolean>>({})
  const [stockCheckErrors, setStockCheckErrors] = useState<Record<number, string>>({})
  const [stockCheckResults, setStockCheckResults] = useState<Record<number, P2PRequestItemStockCheck>>({})
  const stockCheckFetched = useRef<Set<number>>(new Set())
  const [issueQtyByItem, setIssueQtyByItem] = useState<Record<number, string>>({})
  const [issueLocByItem, setIssueLocByItem] = useState<Record<number, string>>({})
  const [confirmProcurementItemId, setConfirmProcurementItemId] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const isPurchaseTeam = !!user?.apps?.includes('purchase')
  const { can, canFeature } = useCan()
  // Working a PR (edit / cancel / close / stock decisions) needs 'Edit' on
  // Purchase Requisitions; named approvers act through routing with View only.
  const canEditPr = can('p2p', 'purchase_requisitions', 'edit')
  // Purchase Requisitions features (role editor). PO approvers who open the
  // PR through Purchase Orders › View alone aren't governed by them, and see
  // prices per the Purchase Orders tab's switch (as the backend does).
  const viaPrTab = can('p2p', 'purchase_requisitions', 'view')
  const prFeature = (feature: string, action: 'view' | 'create' | 'edit' | 'delete') =>
    !viaPrTab || canFeature('p2p', 'purchase_requisitions', feature, action)
  const seePrices = viaPrTab ? canFeature('p2p', 'purchase_requisitions', 'prices', 'view') : canFeature('p2p', 'purchase_orders', 'prices', 'view')
  const seePoBlock = prFeature('purchase_order', 'view')
  const seeAttachments = prFeature('attachments', 'view')
  const seeStockCheck = prFeature('fulfilment', 'view')
  // Issuing from store stock is the Store Manager's job (admins too); the
  // Purchase team sees the stock result and decides what to procure.
  const canIssueStock = (user?.role === 'admin' || (pr?.approvals || []).some((a) => a.role === 'store_manager' && a.approver_id === user?.id))
    && prFeature('fulfilment', 'create')
  const [issuePrompt, setIssuePrompt] = useState<{ itemId: number; locationId: number; qty: number } | null>(null)
  // Older PO lines (raised before lines were picked from the Item Master)
  // are linked once to their item here, before goods can be received.
  const [linkingLineId, setLinkingLineId] = useState<number | null>(null)
  const [linkChoice, setLinkChoice] = useState('')
  const [linkItems, setLinkItems] = useState<StoreItem[]>([])
  const startLink = (lineId: number) => {
    setLinkingLineId(lineId)
    setLinkChoice('')
    setSheetError('')
    if (!linkItems.length) {
      storeApi.listItems({ status: 'active' }).then(setLinkItems)
        .catch((err) => setError(extractErrorMessages(err, 'Could not load the Item Master list.')))
    }
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data: P2PRequestDetail = await p2pApi.get(prId)
      // Stock may have moved since the last look (e.g. a line was just
      // issued) — drop cached checks so remaining pending lines re-check.
      stockCheckFetched.current = new Set()
      setStockCheckResults({})
      setStockCheckErrors({})
      setPr(data)

      const [rfqList, poList] = await Promise.all([
        rfqApi.list({ p2p_request_id: data.id }).catch(() => []),
        purchaseOrdersApi.list({ p2p_request_id: data.id }).catch(() => []),
      ])
      setRfq(rfqList[0] || null)
      // Approvers without the Purchase app get a 403 on the PO list — fall
      // back to the PO the PR itself carries so they see what they sign.
      const live = (poList as P2PPurchaseOrder[]).filter((x) => x.status !== 'cancelled')
      setAllPos(live)
      setPo(poList[0] || data.purchase_order || null)
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
      await load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Action failed.'))
    } finally {
      setBusy(false)
    }
  }

  // Every action that needs a comment / reason opens one popup; a failure
  // stays inside it (real reason shown) so the typed text isn't lost.
  const openPrompt = (kind: PromptKind) => { setPromptText(''); setSheetError(''); setPromptAction(kind) }
  const approve = () => openPrompt('approve')
  const reject = () => openPrompt('reject')
  const closePrompt = () => { if (!busy) { setPromptAction(''); setIssuePrompt(null) } }

  const runInSheet = async (fn: () => Promise<unknown>, fallback: string, onDone: () => void) => {
    setBusy(true)
    setSheetError('')
    try {
      await fn()
      onDone()
      await load()
    } catch (err) {
      setSheetError(extractErrorMessages(err, fallback).join(' '))
    } finally {
      setBusy(false)
    }
  }

  const promptActionDo = (value: string) => {
    const action = promptAction
    const done = () => { setPromptAction(''); setIssuePrompt(null) }
    if (action === 'cancel') runInSheet(() => p2pApi.cancel(prId, value || undefined), 'Could not cancel the requisition.', done)
    if (action === 'reject') runInSheet(() => p2pApi.reject(prId, value || undefined), 'Could not reject.', done)
    if (action === 'approve') runInSheet(() => p2pApi.approve(prId, value || undefined), 'Could not approve the requisition.', done)
    if (action === 'approve-po') runInSheet(() => p2pApi.approvePO(prId, value || undefined), 'Could not approve the PO.', done)
    if (action === 'short-close') runInSheet(() => p2pApi.close(prId, value), 'Could not short-close the requisition.', done)
    if (action === 'issue' && issuePrompt) {
      const p = issuePrompt
      runInSheet(() => p2pApi.issueItemFromStock(prId, p.itemId, { location_id: p.locationId, quantity: p.qty > 0 ? p.qty : undefined, comment: value }), 'Could not issue from stock.', done)
    }
  }

  const resubmit = () => runAction(() => p2pApi.resubmit(prId))
  const discardDraft = async () => {
    setConfirmDiscard(false)
    setBusy(true)
    setError('')
    try {
      await p2pApi.discardDraft(prId)
      router.push('/dashboard/p2p')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not discard the draft.'))
      setBusy(false)
    }
  }

  // The stock check runs automatically for every still-undecided line the
  // buyer can act on — availability is visible immediately, with no
  // per-line "Check Stock" button to click.
  useEffect(() => {
    if (!pr || !user) return
    const canManage = (!!user.apps?.includes('purchase') || user.role === 'admin' || !!user.is_store_manager)
      && seeStockCheck && pr.status !== 'submitted' && pr.status !== 'rejected' && pr.status !== 'cancelled'
    if (!canManage) return
    for (const it of pr.items) {
      if (it.fulfillment_status !== 'pending' || stockCheckFetched.current.has(it.id)) continue
      stockCheckFetched.current.add(it.id)
      setStockCheckLoading((prev) => ({ ...prev, [it.id]: true }))
      p2pApi.checkItemStock(prId, it.id)
        .then((result) => {
          setStockCheckResults((prev) => ({ ...prev, [it.id]: result }))
          setIssueQtyByItem((prev) => ({ ...prev, [it.id]: String(result.requested_qty) }))
        })
        .catch((err) => {
          setStockCheckErrors((prev) => ({ ...prev, [it.id]: extractErrorMessages(err, 'Stock check failed.').join(' ') }))
        })
        .finally(() => setStockCheckLoading((prev) => ({ ...prev, [it.id]: false })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr, user])

  const sendToProcurement = (itemId: number) => runAction(async () => {
    await p2pApi.sendItemToProcurement(prId, itemId)
    setConfirmProcurementItemId(null)
  })



  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p" listLabel="Back to purchase requisitions" /></div>)
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Not found.</p>

  const status = displayStatus(pr)
  const statusColor = status.hex
  const isAdmin = user?.role === 'admin'
  // Manager-matrix PRs carry their approver slots in `approvals`; PRs from
  // before the matrix still use the legacy head columns.
  const approvalRoles = pr.approvals?.length
    ? pr.approvals.map((a) => ({ role: a.role, label: a.role_label || p2pRoleLabel(a.role), id: a.approver_id, name: a.approver_name, approvedAt: a.approved_at, comment: a.comment }))
    : [
        { role: 'department_head', label: 'Department Head', id: pr.approver_id, name: pr.approver_name, approvedAt: pr.department_head_approved_at, comment: pr.department_head_comment },
        { role: 'project_head', label: 'Project Head', id: pr.project_head_id, name: pr.project_head_name, approvedAt: pr.project_head_approved_at, comment: pr.project_head_comment },
        { role: 'plant_head', label: 'Plant Head', id: pr.plant_head_id, name: pr.plant_head_name, approvedAt: pr.plant_head_approved_at, comment: pr.plant_head_comment },
      ]
  // Legacy PO chain rows (all three must sign). Matrix PRs render the
  // any-one-approves panel instead — see the PO Approval section below.
  const poApprovalRoles = [
    { role: 'purchase_head', label: 'Purchase Head', name: pr.purchase_head_approved_by_name, approvedAt: pr.purchase_head_approved_at, comment: pr.purchase_head_comment },
    { role: 'director', label: 'Director', name: pr.director_approved_by_name, approvedAt: pr.director_approved_at, comment: pr.director_comment },
    { role: 'partner', label: 'Partner', name: pr.partner_approved_by_name, approvedAt: pr.partner_approved_at, comment: pr.partner_comment },
  ]
  const isMatrixPr = !!pr.project_type
  // The PO Approval panel only appears once the PR has reached the RFQ
  // stage (2026-09-30) — before that it's pure noise on a requisition that
  // may yet be fulfilled entirely from store stock and never need a PO.
  const poRaised = pr.status === 'po_raised' || pr.status === 'po_approved' || !!pr.po_number
  const showPoApproval = !!rfq || poRaised
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
  const roleRows = [...approvalRoles.map((r) => r.role), 'purchase_head', 'director', 'partner']
  const terminalNote = pr.status === 'cancelled'
    ? { label: 'Cancelled', bg: 'rgba(148,163,184,0.15)', color: '#64748b', reason: pr.cancelled_reason, name: undefined }
    : pr.status === 'rejected' && !roleRows.includes(rejectedByRole || '')
    ? { label: 'Rejected', bg: 'rgba(220,38,38,0.1)', color: '#dc2626', reason: pr.rejected_reason, name: pr.rejected_by_name }
    : null

  const hasAssignedHeads = approvalRoles.some((r) => r.id != null)
  const myPendingRole = approvalRoles.find((r) => r.id != null && r.id === user?.id && !r.approvedAt)
  // No named approvers (legacy PR): a purchase-team decision, so the matrix
  // Approve / Reject grant applies; named approvers need only View.
  const canApproveOrReject = pr.status === 'submitted' && (hasAssignedHeads ? (!!myPendingRole || isAdmin) : isPurchaseTeam && can('p2p', 'purchase_requisitions', 'approve'))
  const canRejectAccess = pr.status === 'submitted' && (hasAssignedHeads ? (approvalRoles.some((r) => r.id != null && r.id === user?.id) || isAdmin) : isPurchaseTeam && can('p2p', 'purchase_requisitions', 'reject'))
  // Approvals through the central approval engine (Organization › Approval
  // Workflows) are decided in the Approval panels below; the buttons in the
  // header stay only for requisitions / POs still on the old approval path.
  const engine = pr.engine_approval || null
  const prViaEngine = !!engine?.pr_request_id
  // Distinct buyers of the lines (one requisition can carry lines for several buyers, 2026-10-27).
  const lineBuyers = Array.from(new Set(pr.items.map((it) => it.buyer_name || pr.assigned_buyer_name).filter((n): n is string => !!n)))
  const poViaEngine = !!engine?.po_id
  const canApproveReject = fromApproval && canApproveOrReject && !prViaEngine
  const canRejectStill = fromApproval && canRejectAccess && !prViaEngine
  // Which of this PR's PO-approval roles the viewer holds (matrix or legacy).
  const myPoRoles = userPoRoles(user, pr).filter((r) => (pr.pending_po_approval_roles || []).includes(r))
  const canApprovePo = fromPoApproval && pr.status === 'po_raised' && myPoRoles.length > 0 && !poViaEngine
  // Say why Approve PO is missing instead of silently hiding it.
  const poApproveBlockedReason = poViaEngine || !fromPoApproval || pr.status !== 'po_raised' || canApprovePo ? null
    : userPoRoles(user, pr).length === 0 ? 'Only the PO approvers picked on this requisition, or a Director, can approve this PO.'
    : 'You have already acted on this PO, or it is no longer pending your approval.'
  const canRejectPo = fromPoApproval && pr.status === 'po_raised' && (userPoRoles(user, pr).length > 0 || isAdmin) && !poViaEngine
  // Once a PR is approved, the buyer can check store stock per item and
  // decide item-by-item whether to issue it from stock or send it to
  // procurement — not available once the request has been rejected/cancelled
  // (nothing left to decide) or before it's even approved (submitted).
  const canManageStock = seeStockCheck && ((isPurchaseTeam && canEditPr) || canIssueStock) && !['draft', 'submitted', 'returned', 'rejected', 'cancelled', 'closed'].includes(pr.status)
  // An approved PO already sits with the vendor: only Purchase can call it
  // off (with a reason), and the PO is cancelled with the requisition.
  const cancelAfterPoApproval = pr.status === 'po_approved'
  const canCancel = can('p2p', 'purchase_requisitions', 'cancel') && (cancelAfterPoApproval
    ? isPurchaseTeam
    : (isPurchaseTeam || pr.requested_by_id === user?.id) && CANCELLABLE_STATUSES.includes(pr.status))
  // Partially received = short-close: the vendor won't supply the balance.
  const isShortClose = pr.status === 'partially_received'
  // Sent back by an approver (or withdrawn): the requester resubmits it.
  const canResubmit = pr.status === 'returned' && can('p2p', 'purchase_requisitions', 'submit')
    && (isPurchaseTeam || pr.requested_by_id === user?.id)
  // A draft is private to its requester: they submit it, edit it or throw it away.
  const isDraft = pr.status === 'draft'
  const isMyDraft = isDraft && pr.requested_by_id === user?.id
  // Full edit of header + lines (server decides: until an RFQ is raised).
  // A submitted requisition is not edited from here (owner 2026-10-28); only the requester's own draft is.
  const canEditContent = isDraft && !!pr.can_edit
  // Before an RFQ, saying why editing is locked helps; after, the status says it.
  const editLockNote = !pr.can_edit && pr.edit_block_reason && isDraft
    ? pr.edit_block_reason : null
  const canClose = isPurchaseTeam && canEditPr && prFeature('close', 'edit') && (pr.status === 'received' || isShortClose)
  // Purchase's quick header edit — same lock as the full edit (no changes once an RFQ is raised).
  // An approver who came from an approval queue usually lacks the p2p app,
  // so Back must return to that queue, not the p2p-gated main list.
  const backHref = fromApproval ? '/dashboard/p2p/approval' : fromPoApproval ? '/dashboard/p2p/po-approval' : '/dashboard/p2p'
  const poLines = po?.items || []
  const canLinkPoLines = !!po && isPurchaseTeam && can('p2p', 'purchase_orders', 'edit') && canFeature('p2p', 'purchase_orders', 'link_item', 'edit') && !['fulfilled', 'cancelled'].includes(po.status)
  const saveLink = (lineId: number) => {
    if (!po) return
    if (!linkChoice) { setSheetError('Pick the Item Master item this PO line is.'); return }
    runInSheet(() => purchaseOrdersApi.linkItem(po.id, lineId, Number(linkChoice)), 'Could not link the line to the Item Master.', () => setLinkingLineId(null))
  }
  const poLinesTotal = po?.total_value ?? (poLines.length ? poLines.reduce((sum, l) => sum + (l.line_total || 0), 0) : pr.po_value ?? null)

  const promptMeta: Record<PromptKind, { icon: SheetIconName; color: string; title: string; label: string; placeholder: string; hint?: string; submit: string; busy: string; required: boolean }> = {
    approve: { icon: 'check', color: '#16a34a', title: 'Approve this Purchase Requisition?', label: 'Comment', placeholder: 'e.g. Needed for the Q3 build — quantities checked', hint: 'Your comment is recorded on the approval trail.', submit: 'Approve', busy: 'Approving…', required: true },
    'approve-po': { icon: 'check', color: '#16a34a', title: 'Approve this PO?', label: 'Comment', placeholder: 'e.g. Rates checked against the last PO — OK', hint: 'Your comment is recorded on the approval trail.', submit: 'Approve PO', busy: 'Approving…', required: true },
    reject: { icon: 'x', color: '#dc2626', title: 'Reject this Purchase Requisition?', label: 'Reason for rejecting', placeholder: 'Why it is rejected — the requester sees this', submit: 'Reject', busy: 'Rejecting…', required: false },
    cancel: { icon: 'x', color: '#dc2626', title: 'Cancel this Purchase Requisition?', label: 'Reason for cancelling', placeholder: 'Why it is no longer needed',
      hint: cancelAfterPoApproval ? 'The PO is already approved and with the vendor. Cancelling also cancels the PO — tell the vendor. The reason is recorded on the PO and the requisition history.' : undefined,
      submit: 'Cancel Requisition', busy: 'Cancelling…', required: cancelAfterPoApproval },
    'short-close': { icon: 'flag', color: '#d97706', title: 'Short-close this Requisition?', label: 'Reason', placeholder: "e.g. vendor can't supply the balance",
      hint: "Only part of the order has been received. Short-closing writes off the balance: no more goods can be received against this PO, and the requisition can't be reopened.", submit: 'Short-close', busy: 'Closing…', required: true },
    issue: { icon: 'box', color: SHEET.BLUE, title: 'Issue from Store Stock?', label: 'Comment', placeholder: 'e.g. handed to whom / where',
      hint: 'Stock is deducted from the selected store. Your comment is recorded on the material issue and the requisition history.', submit: 'Issue', busy: 'Issuing…', required: true },
  }
  const m = promptAction ? promptMeta[promptAction] : null
  const submitPrompt = () => {
    if (!m) return
    if (m.required && !promptText.trim()) { setSheetError(`${m.label} is required.`); return }
    promptActionDo(promptText.trim())
  }

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{pr.p2p_number}</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Purchase requisition — what is needed, who approves it, and how it is being bought.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canApproveReject && (
            <button data-tour="pr-detail-approve" disabled={busy} onClick={approve} style={primaryBtn}>Approve</button>
          )}
          {canApprovePo && (
            <button data-tour="pr-detail-approve-po" disabled={busy} onClick={() => openPrompt('approve-po')} style={primaryBtn}>Approve PO</button>
          )}
          {(canRejectStill || canRejectPo) && (
            <button data-tour="pr-detail-reject" disabled={busy} onClick={reject} style={dangerBtn}>Reject</button>
          )}
          {canResubmit && (
            <button data-tour="pr-detail-resubmit" type="button" disabled={busy} onClick={resubmit} style={primaryBtn}>Resubmit for Approval</button>
          )}
          {isMyDraft && (
            <button data-tour="pr-detail-submit-draft" type="button" disabled={busy} onClick={resubmit} style={primaryBtn}>Submit for Approval</button>
          )}
          {canEditContent && (
            <button data-tour="pr-detail-edit-content" type="button" disabled={busy} onClick={() => router.push(recordHref('/dashboard/p2p/new', pr, 'id', undefined, 'edit'))} style={secondaryBtnStyle}>
              Edit Draft
            </button>
          )}
          {isMyDraft && (
            <button data-tour="pr-detail-discard-draft" type="button" disabled={busy} onClick={() => setConfirmDiscard(true)} style={dangerBtn}>Discard Draft</button>
          )}
          {canClose && (
            <button data-tour="pr-detail-close" type="button" disabled={busy} onClick={() => (isShortClose ? openPrompt('short-close') : setConfirmClose(true))} style={primaryBtn}>{isShortClose ? 'Short-close Requisition' : 'Close Requisition'}</button>
          )}
          {canCancel && (
            <button data-tour="pr-detail-cancel" type="button" disabled={busy} onClick={() => openPrompt('cancel')} style={dangerBtn}>Cancel Requisition</button>
          )}
          <button data-tour="pr-detail-back" onClick={() => router.push(backHref)} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
        </div>
      </div>

      {poApproveBlockedReason && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: 13 }}>
          Approve PO isn&apos;t available to you: {poApproveBlockedReason}
        </div>
      )}

      <MessageDialog open={!!error} variant="error" title="Cannot Complete Action" message={error} onClose={() => setError('')} />

      {isDraft && (
        <div data-tour="pr-detail-draft-note" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.25)', color: TEXT.secondary, fontSize: 13 }}>
          This is a draft — only you can see it, and nobody has been asked to approve it. Click <b>Submit for Approval</b> when it&apos;s ready.
        </div>
      )}
      {editLockNote && (
        <div data-tour="pr-detail-edit-lock" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: 13 }}>
          Editing is locked: {editLockNote}
        </div>
      )}

      <DetailCard tour="pr-detail-request-info">
        <DetailSummary
          title={(pr.purpose && PURPOSE_LABELS[pr.purpose]) || pr.category_label || pr.category_code}
          text={`${pr.requested_by_name || 'Someone'}${pr.department ? ` (${pr.department})` : ''} asked for ${pr.items.length} item${pr.items.length === 1 ? '' : 's'}${pr.project_label ? ` for ${pr.project_label}` : ''}${pr.required_date ? `, needed by ${formatDate(pr.required_date)}` : ''}.`}
          meta={<>
            <span data-tour="pr-detail-status"><Pill label={status.label} hex={statusColor} /></span>
            {pr.priority && <Pill label={`${PRIORITY_LABELS[pr.priority] || pr.priority} priority`} hex={PRIORITY_HEX[pr.priority] || '#64748b'} />}
            <span>Raised {formatDate(pr.request_date)}</span>
            {pr.assigned_buyer_name && <span>· Buyer {pr.assigned_buyer_name}</span>}
          </>}
        />
        <DetailGroup title="What it is for">
          <DetailRow label="Purpose">{pr.purpose ? PURPOSE_LABELS[pr.purpose] || pr.purpose : null}</DetailRow>
          {/* Requisitions raised since 2026-10-27 have no category of their own (ITM): each line shows its own. */}
          {pr.category_code !== 'ITM' && <DetailRow label="Category">{pr.category_label || pr.category_code}</DetailRow>}
          <DetailRow label="Charged to">{pr.rnd_project_id ? `R&D project: ${pr.rnd_project_label || `#${pr.rnd_project_id}`}` : (pr.project_label || null)}</DetailRow>
          {pr.order_project_number && <DetailRow label="Project">{pr.order_project_number}</DetailRow>}
          <DetailRow label="Requirement type">{pr.requirement_type || null}</DetailRow>
        </DetailGroup>
        <DetailGroup title="People & dates" last={!pr.remarks}>
          <DetailRow label="Requested by">{pr.requested_by_name ? `${pr.requested_by_name}${pr.department ? ` · ${pr.department}` : ''}` : null}</DetailRow>
          <DetailRow label={lineBuyers.length > 1 ? 'Buyers' : 'Buyer'}>{lineBuyers.length > 1 ? lineBuyers.join(', ') : pr.assigned_buyer_name || null}</DetailRow>
          <DetailRow label="Request date">{formatDate(pr.request_date)}</DetailRow>
          <DetailRow label="Required by">{pr.required_date ? formatDate(pr.required_date) : null}</DetailRow>
        </DetailGroup>
        {pr.remarks && (
          <DetailGroup last>
            <DetailRow label="Remarks">{pr.remarks}</DetailRow>
          </DetailGroup>
        )}
      </DetailCard>

      {prViaEngine ? (
        <div data-tour="pr-detail-approval">
          <ApprovalPanel entityType="p2p_request" entityId={pr.id} onChanged={load} title="Approval" />
        </div>
      ) : (
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
                      <Pill label={pill.text} hex={pill.color} />
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
                <Pill label={terminalNote.label} hex={terminalNote.color} />
              </p>
              {terminalNote.reason && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{terminalNote.reason}&quot;</p>}
            </div>
          )}
        </div>
      </div>
      )}

      <div data-tour="pr-detail-items" style={{ ...sectionStyle, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Item Details</h2>
        {pr.items.some((it) => it.stock_status) && (
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
            {pr.items.filter((it) => it.stock_status === 'in_stock').length} of {pr.items.length} line(s) available in store stock
            {(() => { const t = pr.items.map((it) => it.stock_checked_at).filter(Boolean).sort().pop(); return t ? ` · checked ${formatDateTime(t)}` : '' })()}
            {pr.status === 'submitted' ? ' — re-checked automatically at approval.' : '.'}
          </p>
        )}
        <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              {['SL', 'Item Description', 'Make', 'Part Code', 'UOM', 'Qty', 'Project / Inhouse', 'Category', 'Buyer', 'Ship To', 'Stock', 'Attachments', 'Fulfillment'].map((h, i) => (
                <th key={h} style={h === 'Qty' ? numThStyle : thStyle}>{h}{i === 0 && <RowCount count={pr.items.length} />}</th>
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
                <tr>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{idx + 1}</td>
                <td style={{ ...tdStyle, minWidth: 200 }}>{it.item_code && <span style={{ fontWeight: 700, color: TEXT.heading }}>{it.item_code} — </span>}{it.item_name}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{it.make || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{it.part_code || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{it.unit || '—'}</td>
                <td style={numTdStyle}>{it.quantity.toLocaleString('en-IN')}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>
                  {it.project_inhouse || '—'}
                  {it.order_project_number && (
                    <div style={{ marginTop: 4 }}>
                      <OrderProjectChip opNumber={it.order_project_number} elementNo={it.order_project_element_no} label={it.order_project_element_label}
                        title={it.order_project_display || undefined}
                        onClick={can('projects', 'all_projects', 'view') ? () => router.push(recordPath('/dashboard/projects', it, 'order_project_id')) : undefined} />
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{it.category || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{it.buyer_name || pr.assigned_buyer_name || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{it.ship_to || '—'}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>
                  {it.stock_status ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                      <Pill label={STOCK_LABELS[it.stock_status] || it.stock_status} hex={STOCK_HEX[it.stock_status] || '#64748b'} />
                      {it.stock_status === 'partial' && it.stock_available_qty != null && (
                        <span style={{ fontSize: 11, color: TEXT.muted }}>{it.stock_available_qty} of {it.quantity} available</span>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: TEXT.muted }}>—</span>
                  )}
                </td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>
                  {(it.attachments.length === 0 || !seeAttachments) && <span style={{ color: TEXT.muted }}>—</span>}
                  {seeAttachments && it.attachments.map((a) => (
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
                <td style={{ ...tdStyle, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                    <Pill label={FULFILLMENT_LABELS[it.fulfillment_status] || it.fulfillment_status} hex={fulfillmentHex} />
                    {it.fulfillment_status === 'sent_to_procurement' && (it.issued_qty || 0) > 0 && (
                      <span style={{ fontSize: 11, color: TEXT.muted }}>{it.issued_qty} issued from stock · buying {it.quantity - (it.issued_qty || 0)}</span>
                    )}
                    {it.fulfillment_status === 'stock_issued' && (
                      <span style={{ fontSize: 11, color: TEXT.muted }}>{it.issued_qty} {it.unit || ''} @ {it.issued_from_location_name || '—'}</span>
                    )}
                  </div>
                </td>
                </tr>
                {showActions && (
                  <tr key={`${it.id}-stock`}>
                    <td colSpan={13} style={{ ...tdStyle, padding: '10px 14px', background: 'rgba(148,163,184,0.06)' }}>
                      {stockCheckLoading[it.id] ? (
                        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Checking store stock…</p>
                      ) : stockCheckErrors[it.id] ? (
                        <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{stockCheckErrors[it.id]}</p>
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
                              {check.ship_to_location ? `${check.ship_to_location.available_qty} available` : it.ship_to ? 'Not a store — pick one below' : 'Not set — pick a store below'}
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
                          {(() => {
                            // Issue from whichever store actually holds the
                            // stock — the line's Ship To is often blank or not a
                            // store location, and that must not force a purchase.
                            const locs = check.locations || []
                            const shipToId = check.ship_to_location?.location_id
                            const defaultLoc = (shipToId && locs.some((l) => l.location_id === shipToId) ? shipToId : locs[0]?.location_id) ?? null
                            const selectedLocId = issueLocByItem[it.id] ? Number(issueLocByItem[it.id]) : defaultLoc
                            const selectedLoc = locs.find((l) => l.location_id === selectedLocId)
                            const fullyCovered = locs.some((l) => l.available_qty >= check.requested_qty)
                            const maxIssue = Math.min(check.requested_qty, selectedLoc?.available_qty ?? 0)
                            const issueQty = issueQtyByItem[it.id] != null ? Number(issueQtyByItem[it.id]) : maxIssue
                            const buyQty = check.requested_qty - (issueQty > 0 ? issueQty : 0)
                            return (
                              <>
                                {locs.length > 0 && canIssueStock && (
                                  <>
                                    <div>
                                      <label style={{ ...labelStyle, marginBottom: 4 }}>Issue From</label>
                                      <Select
                                        data-tour="pr-detail-issue-from"
                                        value={selectedLocId ?? ''}
                                        onChange={(e) => setIssueLocByItem((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                        style={{ ...inputStyle, width: 'auto', minWidth: 180 }}
                                      >
                                        {locs.map((l) => (
                                          <option key={l.location_id!} value={l.location_id!}>{l.location_name || `Location ${l.location_id}`} — {l.available_qty} available</option>
                                        ))}
                                      </Select>
                                    </div>
                                    <div>
                                      <label style={{ ...labelStyle, marginBottom: 4 }}>Issue Qty</label>
                                      <input
                                        data-tour="pr-detail-issue-qty"
                                        type="number"
                                        min={0}
                                        max={maxIssue}
                                        value={issueQtyByItem[it.id] ?? String(maxIssue)}
                                        onChange={(e) => setIssueQtyByItem((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                        style={{ ...inputStyle, width: 90 }}
                                      />
                                    </div>
                                  </>
                                )}
                                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                  {selectedLocId != null && !canIssueStock && (
                                    <span style={{ fontSize: 12, color: TEXT.secondary }}>Waiting for the Store Manager to issue from stock{!fullyCovered ? ' — or send it to procurement' : ''}.</span>
                                  )}
                                  {selectedLocId != null && canIssueStock && (
                                    <button
                                      data-tour="pr-detail-issue-btn"
                                      type="button"
                                      disabled={busy}
                                      onClick={() => { setIssuePrompt({ itemId: it.id, locationId: selectedLocId, qty: issueQty }); openPrompt('issue') }}
                                      style={smallPrimaryBtnStyle}
                                    >
                                      {buyQty > 0 ? `Issue ${issueQty} & Buy ${buyQty}` : 'Issue from Stock'}
                                    </button>
                                  )}
                                  {!fullyCovered && ((isPurchaseTeam && canEditPr) || isAdmin) && prFeature('fulfilment', 'edit') && (
                                    <button
                                      data-tour="pr-detail-send-procurement-btn"
                                      type="button"
                                      disabled={busy}
                                      onClick={() => setConfirmProcurementItemId(it.id)}
                                      style={smallSecondaryBtnStyle}
                                    >
                                      Send to Procurement
                                    </button>
                                  )}
                                </div>
                              </>
                            )
                          })()}
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



      {rfq && rfq.attachments.length > 0 && canFeature('p2p', 'rfq', 'vendor_quotes', 'view') && (
        <div data-tour="pr-detail-vendor-quotations" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Quotations</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
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

      {po && seePoBlock && (
        <DetailCard tour="pr-detail-po-info">
          {allPos.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: TEXT.muted }}>This requisition was split into {allPos.length} purchase orders — pick one:</span>
              {allPos.map((x) => (
                <button key={x.id} type="button" onClick={() => setPickedPoId(x.id)} style={chipBtnStyle(x.id === po.id)}>
                  {x.po_number}{x.vendor_name ? ` · ${x.vendor_name}` : ''}
                </button>
              ))}
            </div>
          )}
          <DetailSummary
            title={`Purchase Order ${po.po_number}`}
            text={`Order placed with ${po.vendor_name || 'the vendor'} for ${poLines.length || 'the'} line${poLines.length === 1 ? '' : 's'} of this requisition.`}
            meta={<>
              <Pill label={PO_STATUS_LABELS[po.status] || po.status} hex={PO_STATUS_HEX[po.status] || '#64748b'} />
              <span>PO date {formatDate(po.po_date)}</span>
              {po.expected_delivery && <span>· Delivery by {formatDate(po.expected_delivery)}</span>}
            </>}
          />
          <DetailGroup>
            <DetailRow label="Vendor">{po.vendor_name || null}</DetailRow>
            <DetailRow label="Expected delivery">{po.expected_delivery ? formatDate(po.expected_delivery) : null}</DetailRow>
            {seePrices && <DetailRow label="PO value (incl. tax)">{poLinesTotal != null ? money(poLinesTotal) : null}</DetailRow>}
            {canFeature('p2p', 'purchase_orders', 'po_document', 'view') && (
              <DetailRow label="Tally PO no.">{po.external_ref || null}</DetailRow>
            )}
            {canFeature('p2p', 'purchase_orders', 'po_document', 'view') && (
              <DetailRow label="Tally PO (PDF)">
                {po.document_filename && rfq ? (
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getPoDocumentBlob(rfq.id, po.id), po.document_filename!) }}
                    style={{ color: '#2563eb', textDecoration: 'none' }}
                  >
                    {po.document_filename}
                  </a>
                ) : <span style={{ color: TEXT.muted }}>No document attached yet</span>}
              </DetailRow>
            )}
          </DetailGroup>
          {poLines.length > 0 && (
            <div style={{ overflow: 'auto', marginTop: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    {(seePrices ? ['SL', 'Item', 'Qty', 'Unit Price', 'Tax %', 'Line Total'] : ['SL', 'Item', 'Qty', 'Tax %']).map((h, i) => (
                      <th key={h} style={h === 'SL' || h === 'Item' ? thStyle : numThStyle}>{h}{i === 0 && <RowCount count={poLines.length} />}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {poLines.map((l, idx) => (
                    <tr key={l.id}>
                      <td style={{ ...tdStyle, color: TEXT.secondary }}>{idx + 1}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span>
                            {l.item_code && <span style={{ fontWeight: 700, color: TEXT.heading }}>{l.item_code} — </span>}
                            {l.item_name}{l.make ? <span style={{ color: TEXT.muted }}> · {l.make}</span> : null}
                          </span>
                          {l.category && l.category !== 'stock' && (
                            <Pill label={l.category === 'service' ? 'Service' : 'Asset'} hex={l.category === 'service' ? '#7c3aed' : '#0891b2'}
                              title={l.category === 'service' ? 'Service — confirmed on a service entry, never store stock' : 'Asset — received on the GRN, capitalised by Finance, never store stock'} />
                          )}
                        </div>
                        {!l.store_item_id && (
                          <div data-tour="pr-detail-po-link-item" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Pill label="Not linked to Item Master" hex="#b45309" />
                            {canLinkPoLines && (
                              <button type="button" onClick={() => startLink(l.id)} style={smallSecondaryBtnStyle}>Link to Item Master</button>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={numTdStyle}>{l.quantity.toLocaleString('en-IN')} {l.unit || ''}</td>
                      {seePrices && <td style={numTdStyle}>{money(l.unit_price)}</td>}
                      <td style={numTdStyle}>{l.tax_rate != null ? `${l.tax_rate}%` : '—'}</td>
                      {seePrices && <td style={{ ...numTdStyle, fontWeight: 600 }}>{money(l.line_total)}</td>}
                    </tr>
                  ))}
                  {seePrices && (
                  <tr>
                    <td colSpan={5} style={{ ...numTdStyle, fontWeight: 700, color: TEXT.heading, borderTop: `1px solid ${BORDER.normal}` }}>Total</td>
                    <td style={{ ...numTdStyle, fontWeight: 700, color: TEXT.heading, borderTop: `1px solid ${BORDER.normal}` }}>{money(poLinesTotal)}</td>
                  </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </DetailCard>
      )}

      {poViaEngine && engine?.po_id ? (
        <div data-tour="pr-detail-po-approval">
          <ApprovalPanel entityType="p2p_purchase_order" entityId={engine.po_id} onChanged={load} title="PO Approval" />
        </div>
      ) : showPoApproval && (pr.approval_scheme === 'engine' && !poRaised ? (
        <div data-tour="pr-detail-po-approval" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>PO Approval</h2>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>PO not sent for approval yet. It goes through the &ldquo;Purchase order&rdquo; workflow (Organization › Approval Workflows).</p>
        </div>
      ) : (
      <div data-tour="pr-detail-po-approval" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>PO Approval</h2>
        {isMatrixPr ? (
          !poRaised ? (
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>PO not raised yet. It will go to {(pr.po_approval_role_labels || []).join(', ')}; all of them must approve (any one Director).</p>
          ) : (
            <div>
              <p style={{ fontSize: 13.5, color: TEXT.body, margin: '0 0 12px' }}>All of these must approve the PO (any one Director).</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                {(pr.po_approval_panel || []).map((a) => {
                  const rejectedHere = pr.status === 'rejected' && rejectedByRole === a.role
                  const pill = rejectedHere
                    ? { text: 'Rejected', bg: 'rgba(220,38,38,0.1)', color: '#dc2626' }
                    : a.approved_at
                    ? { text: 'Approved', bg: 'rgba(34,197,94,0.12)', color: '#16a34a' }
                    : { text: 'Pending', bg: 'rgba(148,163,184,0.15)', color: '#64748b' }
                  const actor = rejectedHere ? pr.rejected_by_name : a.approved_by_name
                  const note = rejectedHere ? pr.rejected_reason : a.comment
                  return (
                    <div key={a.role}>
                      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{a.role_label}</p>
                      {actor ? (
                        <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                          {actor}
                          <Pill label={pill.text} hex={pill.color} />
                        </p>
                      ) : a.people.length ? (
                        <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body, flexWrap: 'wrap' }}>
                          {a.people.map((p) => p.name || `User #${p.id}`).join(a.role === 'director' ? ' / ' : ', ')}
                          <Pill label={pill.text} hex={pill.color} />
                        </p>
                      ) : (
                        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>— nobody holds this role</p>
                      )}
                      {note && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{note}&quot;</p>}
                    </div>
                  )
                })}
                {pr.status === 'rejected' && !(pr.po_approval_panel || []).some((a) => a.role === rejectedByRole) && (
                  <div>
                    <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>Rejected</p>
                    <p style={{ fontSize: 13.5, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: TEXT.body }}>
                      {pr.rejected_by_name || '—'}
                      <Pill label={`Rejected${pr.rejected_by_role ? ` as ${p2pRoleLabel(pr.rejected_by_role)}` : ''}`} hex="#dc2626" />
                    </p>
                    {pr.rejected_reason && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{pr.rejected_reason}&quot;</p>}
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
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
                      <Pill label={pill.text} hex={pill.color} />
                    </p>
                    {note && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '4px 0 0', fontStyle: 'italic' }}>&quot;{note}&quot;</p>}
                  </>
                )}
              </div>
            )
          })}
        </div>
        )}
      </div>
      ))}

      {po && po.status !== 'cancelled' && canFeature('p2p', 'purchase_orders', 'delivery_costs', 'view') && poLines.some((l) => (l.category || 'stock') === 'stock') && (
        <PoDeliveryCostsPanel poId={po.id} onChanged={load} />
      )}

      {po && canFeature('p2p', 'purchase_orders', 'service_entries', 'view') && poLines.some((l) => l.category === 'service') && (
        <ServiceEntriesPanel poId={po.id} poOpen={['issued', 'acknowledged', 'partially_fulfilled'].includes(po.status)} onChanged={load} />
      )}

      {pr.attachments.length > 0 && seeAttachments && (
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

      {promptAction && m && (
      <FormSheet width={580} icon={m.icon} iconColor={m.color} title={m.title} subtitle={pr.category_code === 'ITM' ? pr.p2p_number : `${pr.p2p_number} · ${pr.category_label || pr.category_code}`} onClose={closePrompt} busy={busy}
        footer={<>
          <button type="button" onClick={closePrompt} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>
          <button type="button" onClick={submitPrompt} disabled={busy} style={sheetBtn('primary', m.color, busy)}><SheetIcon name={m.icon} size={16} />{busy ? m.busy : m.submit}</button>
        </>}>
        <div style={{ padding: '20px 24px' }}>
          {sheetError && <div style={sheetErr}>{sheetError}</div>}
          <label style={sheetLabel}>{m.label} {m.required ? <Req /> : <Optional />}</label>
          <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={promptText} onChange={(e) => setPromptText(e.target.value)} placeholder={m.placeholder} autoFocus />
          {m.hint && <p style={sheetHint}>{m.hint}</p>}
        </div>
      </FormSheet>
      )}
      {linkingLineId != null && canLinkPoLines && (
        <FormSheet width={580} icon="link" title="Link to Item Master" subtitle={poLines.find((x) => x.id === linkingLineId)?.item_name || 'PO line'}
          onClose={() => { if (!busy) setLinkingLineId(null) }} busy={busy}
          footer={<>
            <button type="button" onClick={() => setLinkingLineId(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={() => saveLink(linkingLineId)} disabled={busy || !linkChoice} style={sheetBtn('primary', SHEET.BLUE, busy || !linkChoice)}><SheetIcon name="link" size={16} />{busy ? 'Linking…' : 'Link'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {sheetError && <div style={sheetErr}>{sheetError}</div>}
            <label style={sheetLabel}>Item Master item <Req /></label>
            <SearchableSelect value={linkChoice} onChange={setLinkChoice} placeholder="Search item code, name or part no…"
              options={linkItems.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}${i.part_number ? ` · ${i.part_number}` : ''}` }))} />
            <p style={sheetHint}>The line then carries the Item Master id — the GRN receives it into that item&apos;s stock.</p>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this draft?"
        message={`Draft ${pr.p2p_number} and everything in it will be deleted. This can't be undone.`}
        confirmLabel="Discard Draft"
        onConfirm={discardDraft}
        onCancel={() => setConfirmDiscard(false)}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Close this Requisition?"
        message="Every ordered item has been received. Closing marks the requisition complete — it can't be reopened."
        confirmLabel="Close Requisition"
        danger={false}
        onConfirm={() => { setConfirmClose(false); runAction(() => p2pApi.close(prId)) }}
        onCancel={() => setConfirmClose(false)}
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
