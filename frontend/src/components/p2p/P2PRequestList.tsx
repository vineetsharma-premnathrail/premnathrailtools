'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'
import { userPoRoles } from '@/lib/p2pRoles'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  po_raised: 'PO Raised',
  po_approved: 'PO Approved',
  partially_received: 'Partially Received',
  received: 'Received',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6',
  approved: '#22c55e',
  po_raised: '#f59e0b',
  po_approved: '#22c55e',
  partially_received: '#f97316',
  received: '#0ea5e9',
  closed: '#22c55e',
  rejected: '#dc2626',
  cancelled: '#94a3b8',
}

// A submitted PR where some (but not all) assigned heads have signed off
// shows its own purple "Partially Approved" state — distinct from blue
// "Submitted" (nobody's approved yet) and green "Approved" (all done).
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

const filterSelectStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
  background: 'rgba(255,255,255,.7)', fontSize: 13, color: TEXT.body, outline: 'none', minWidth: 200,
}

export default function P2PRequestList({ statuses, emptyLabel, context, queue, onlyPendingForViewer, showFilters }: { statuses?: string[]; emptyLabel: string; context?: string; queue?: string; onlyPendingForViewer?: boolean; showFilters?: boolean }) {
  const router = useRouter()
  const { user } = useAuth()
  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [actionError, setActionError] = useState<string | string[]>('')
  const [approvingId, setApprovingId] = useState<number | null>(null)
  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [buyerFilter, setBuyerFilter] = useState('')
  const detailHref = (id: number) => (context ? `/dashboard/p2p/${id}?from=${context}` : `/dashboard/p2p/${id}`)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await p2pApi.list(queue ? { limit: 500, queue } : { limit: 500 })
      setPrs(statuses ? data.filter((pr: P2PRequest) => statuses.includes(pr.status)) : data)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to load your Procurement requests.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, queue])

  // "Pending" in the P.R Approval queue means pending on THE VIEWER: their
  // own slot unsigned (matrix rows, or the legacy head columns). Admins see
  // every pending PR.
  const pendingOnViewer = (pr: P2PRequest): boolean => {
    if (!onlyPendingForViewer || user?.role === 'admin') return true
    if (pr.approvals?.length) return pr.approvals.some((a) => a.approver_id === user?.id && !a.approved_at)
    if (pr.approver_id === user?.id && !pr.department_head_approved_at) return true
    if (pr.project_head_id === user?.id && !pr.project_head_approved_at) return true
    if (pr.plant_head_id === user?.id && !pr.plant_head_approved_at) return true
    return false
  }

  const categoryOptions = Array.from(new Map(prs.map((pr) => [pr.category_code, pr.category_label || pr.category_code])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
  const buyerOptions = Array.from(new Map(prs.filter((pr) => pr.assigned_buyer_id != null)
    .map((pr) => [String(pr.assigned_buyer_id), pr.assigned_buyer_name || `User #${pr.assigned_buyer_id}`])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
  const visiblePrs = prs.filter(pendingOnViewer).filter((pr) =>
    (!categoryFilter || pr.category_code === categoryFilter)
    && (!buyerFilter || (buyerFilter === 'none' ? pr.assigned_buyer_id == null : String(pr.assigned_buyer_id) === buyerFilter)))
  const filtersActive = !!(categoryFilter || buyerFilter)

  const isAdmin = user?.role === 'admin'
  // Matrix PRs: the PO goes to the PR's role set and any one holder approves;
  // legacy PRs keep the Purchase Head / Director / MD chain. The requester
  // can't approve their own PR's PO (the backend refuses it too).
  const canApprovePoInline = (pr: P2PRequest) =>
    context === 'po-approval' && pr.status === 'po_raised'
    && userPoRoles(user, pr).some((r) => (pr.pending_po_approval_roles || []).includes(r))
  const canRejectPoInline = (pr: P2PRequest) =>
    context === 'po-approval' && pr.status === 'po_raised'
    && (userPoRoles(user, pr).length > 0 || isAdmin)

  const confirmApprovePo = async (comment: string) => {
    if (approvingId == null) return
    setBusy(true)
    try {
      await p2pApi.approvePO(approvingId, comment || undefined)
      setApprovingId(null)
      await load()
    } catch (err: any) {
      setApprovingId(null)
      setActionError(extractErrorMessages(err, 'Failed to approve this PO.'))
    } finally {
      setBusy(false)
    }
  }

  const confirmRejectPo = async (reason: string) => {
    if (rejectingId == null) return
    setBusy(true)
    try {
      await p2pApi.reject(rejectingId, reason || undefined)
      setRejectingId(null)
      await load()
    } catch (err: any) {
      setRejectingId(null)
      setActionError(extractErrorMessages(err, 'Failed to reject this PO.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <MessageDialog open={!!error} variant="error" title="Cannot Load Requests" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={!!actionError} variant="error" title="Cannot Complete Action" message={actionError} onClose={() => setActionError('')} />
      <PromptDialog
        open={approvingId != null}
        title="Approve this PO?"
        message="Your comment is recorded on the approval trail."
        placeholder="Comment (required)"
        confirmLabel="Approve"
        danger={false}
        requireValue
        onConfirm={confirmApprovePo}
        onCancel={() => (busy ? null : setApprovingId(null))}
      />
      <PromptDialog
        open={rejectingId != null}
        title="Reject this PO?"
        placeholder="Reason for rejecting (optional)"
        confirmLabel="Reject"
        onConfirm={confirmRejectPo}
        onCancel={() => (busy ? null : setRejectingId(null))}
      />
      {showFilters && (
        <div data-tour="p2p-list-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <select aria-label="Filter by category" style={filterSelectStyle} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
          <select aria-label="Filter by buyer" style={filterSelectStyle} value={buyerFilter} onChange={(e) => setBuyerFilter(e.target.value)}>
            <option value="">All buyers</option>
            {buyerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            <option value="none">No buyer assigned</option>
          </select>
          {filtersActive && (
            <span onClick={() => { setCategoryFilter(''); setBuyerFilter('') }} style={{ fontSize: 12.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>Clear filters</span>
          )}
        </div>
      )}
      <div data-tour="p2p-list-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Purchase Requisition Number', 'Category', 'Project', 'Required Date', 'Priority', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && visiblePrs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>
                {filtersActive ? 'No requisitions match the selected category / buyer.' : emptyLabel}
              </td></tr>
            )}
            {visiblePrs.map((pr) => {
              const status = displayStatus(pr)
              return (
              <tr key={pr.id} onClick={() => router.push(detailHref(pr.id))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{pr.p2p_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.category_label || pr.category_code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.project_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(pr.required_date)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{pr.priority}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${status.hex}1a`, color: status.hex, whiteSpace: 'nowrap' }}>
                    {status.label}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span data-tour="p2p-list-view" onClick={() => router.push(detailHref(pr.id))} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span>
                    {canApprovePoInline(pr) && (
                      <span data-tour="p2p-list-approve" onClick={() => setApprovingId(pr.id)} style={{ fontSize: 11.5, fontWeight: 600, color: '#16a34a', cursor: 'pointer' }}>Approve</span>
                    )}
                    {canRejectPoInline(pr) && (
                      <span data-tour="p2p-list-reject" onClick={() => setRejectingId(pr.id)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Reject</span>
                    )}
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
