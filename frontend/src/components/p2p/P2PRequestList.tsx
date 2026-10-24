'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { approvalsApi, p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import { FormSheet, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { userPoRoles } from '@/lib/p2pRoles'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  vendor_quotations: 'RFQ / Quotations',
  technical_evaluation: 'Technical Evaluation',
  commercial_evaluation: 'Commercial Evaluation',
  vendor_selected: 'Vendor Selected',
  po_drafted: 'PO Draft',
  po_raised: 'PO Raised',
  po_approved: 'PO Approved',
  partially_received: 'Partially Received',
  received: 'Received',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  returned: 'Returned for changes',
  draft: 'Draft',
}

const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6',
  approved: '#22c55e',
  vendor_quotations: '#6366f1',
  technical_evaluation: '#8b5cf6',
  commercial_evaluation: '#a855f7',
  vendor_selected: '#0ea5e9',
  po_drafted: '#64748b',
  po_raised: '#f59e0b',
  po_approved: '#22c55e',
  partially_received: '#d97706',
  received: '#16a34a',
  closed: '#22c55e',
  rejected: '#dc2626',
  cancelled: '#94a3b8',
  returned: '#7c3aed',
  draft: '#64748b',
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
  const [decisionText, setDecisionText] = useState('')
  const [decisionError, setDecisionError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [buyerFilter, setBuyerFilter] = useState('')
  // Order Project filter (server-side): a whole project or one vehicle / lot.
  const [opFilter, setOpFilter] = useState<OrderProjectValue | null>(null)
  const detailHref = (pr: object) => (context ? `${recordPath('/dashboard/p2p', pr)}?from=${context}` : recordPath('/dashboard/p2p', pr))

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const opParams = opFilter
        ? (opFilter.elementId ? { order_project_element_id: opFilter.elementId } : { order_project_id: opFilter.projectId })
        : {}
      const data = await p2pApi.list(queue ? { limit: 500, queue, ...opParams } : { limit: 500, ...opParams })
      setPrs(statuses ? data.filter((pr: P2PRequest) => statuses.includes(pr.status)) : data)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load your Procurement requests.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, queue, opFilter])

  // "Pending" in the P.R Approval queue means pending on THE VIEWER: their
  // own slot unsigned (matrix rows, or the legacy head columns). Admins see
  // every pending PR.
  const pendingOnViewer = (pr: P2PRequest): boolean => {
    if (!onlyPendingForViewer || user?.role === 'admin') return true
    // Approval engine (Organization › Approval Workflows): the backend says
    // whether the viewer can act on the live step (incl. as a delegate).
    if (pr.engine_approval) return pr.engine_approval.status === 'pending' && pr.engine_approval.can_decide
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
  const filtersActive = !!(categoryFilter || buyerFilter || opFilter)

  const isAdmin = user?.role === 'admin'
  // Matrix PRs: the PO goes to the people picked per role plus every Director,
  // and ALL roles must approve (any one Director clears the Director slot);
  // legacy PRs keep the Purchase Head / Director / Partner chain.
  const showPoValue = context === 'po-approval'
  const columns = ['Purchase Requisition Number', 'Category', 'Project', 'Required Date', 'Priority', ...(showPoValue ? ['PO Value'] : []), 'Status', '']
  // Engine-routed POs: the backend's can_decide; older in-flight POs: the old role check.
  const enginePo = (pr: P2PRequest) => pr.engine_approval?.entity_type === 'p2p_purchase_order' && pr.engine_approval.status === 'pending'
  const canApprovePoInline = (pr: P2PRequest) =>
    context === 'po-approval' && pr.status === 'po_raised'
    && (enginePo(pr) ? !!pr.engine_approval?.can_decide
      : userPoRoles(user, pr).some((r) => (pr.pending_po_approval_roles || []).includes(r)))
  const canRejectPoInline = (pr: P2PRequest) =>
    context === 'po-approval' && pr.status === 'po_raised'
    && (enginePo(pr) ? !!pr.engine_approval?.can_decide : (userPoRoles(user, pr).length > 0 || isAdmin))
  const rowById = (id: number | null) => prs.find((p) => p.id === id)

  const openDecision = (kind: 'approve' | 'reject', id: number) => {
    setDecisionText(''); setDecisionError('')
    if (kind === 'approve') setApprovingId(id); else setRejectingId(id)
  }
  const closeDecision = () => { if (!busy) { setApprovingId(null); setRejectingId(null) } }

  const confirmApprovePo = async (comment: string) => {
    if (approvingId == null) return
    setBusy(true)
    setDecisionError('')
    try {
      const row = rowById(approvingId)
      if (row && enginePo(row) && row.engine_approval) {
        // Central approval engine — the same decision the Approval panel makes.
        await approvalsApi.decide(row.engine_approval.request_id, 'approve', comment || undefined)
      } else {
        await p2pApi.approvePO(approvingId, comment || undefined)
      }
      setApprovingId(null)
      await load()
    } catch (err) {
      setDecisionError(extractErrorMessages(err, 'Failed to approve this PO.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const confirmRejectPo = async (reason: string) => {
    if (rejectingId == null) return
    setBusy(true)
    setDecisionError('')
    try {
      const row = rowById(rejectingId)
      if (row && enginePo(row) && row.engine_approval) {
        await approvalsApi.decide(row.engine_approval.request_id, 'reject', reason || undefined)
      } else {
        await p2pApi.reject(rejectingId, reason || undefined)
      }
      setRejectingId(null)
      await load()
    } catch (err) {
      setDecisionError(extractErrorMessages(err, 'Failed to reject this PO.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <MessageDialog open={!!error} variant="error" title="Cannot Load Requests" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={!!actionError} variant="error" title="Cannot Complete Action" message={actionError} onClose={() => setActionError('')} />
      {(approvingId != null || rejectingId != null) && (() => {
        const approving = approvingId != null
        const row = rowById(approving ? approvingId : rejectingId)
        const color = approving ? '#16a34a' : '#dc2626'
        const submit = () => {
          const v = decisionText.trim()
          if (!v) { setDecisionError(approving ? 'Write a comment — it is recorded on the approval trail.' : 'Write the reason for rejecting — it is sent to the buyer.'); return }
          if (approving) confirmApprovePo(v); else confirmRejectPo(v)
        }
        return (
          <FormSheet width={580} icon={approving ? 'check' : 'x'} iconColor={color} title={approving ? 'Approve this PO?' : 'Reject this PO?'}
            subtitle={row ? `${row.p2p_number}${row.po_value != null ? ` · ₹ ${row.po_value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}` : 'Purchase order'}
            onClose={closeDecision} busy={busy}
            footer={<>
              <button type="button" onClick={closeDecision} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
              <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', color, busy)}><SheetIcon name={approving ? 'check' : 'x'} size={16} />{busy ? (approving ? 'Approving…' : 'Rejecting…') : (approving ? 'Approve' : 'Reject')}</button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              {decisionError && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{decisionError}</div>}
              <label style={sheetLabel}>{approving ? 'Comment' : 'Reason for rejecting'} <Req /></label>
              <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={decisionText} onChange={(e) => setDecisionText(e.target.value)} autoFocus
                placeholder={approving ? 'e.g. Rates checked against the last PO — OK' : 'e.g. L2 is cheaper for the same make — re-check the award'} />
              <p style={sheetHint}>{approving ? 'Your comment is recorded on the approval trail.' : 'The reason is sent to the buyer and recorded on the approval trail.'}</p>
            </div>
          </FormSheet>
        )
      })()}
      {showFilters && (
        <div data-tour="p2p-list-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <Select aria-label="Filter by category" style={filterSelectStyle} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </Select>
          <Select aria-label="Filter by buyer" style={filterSelectStyle} value={buyerFilter} onChange={(e) => setBuyerFilter(e.target.value)}>
            <option value="">All buyers</option>
            {buyerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            <option value="none">No buyer assigned</option>
          </Select>
          <div aria-label="Filter by order project" style={{ flex: '0 1 300px', minWidth: 240 }}>
            <OrderProjectPicker value={opFilter} onChange={(v) => setOpFilter(v)} requireElement={false} placeholder="All order projects" />
          </div>
          {filtersActive && (
            <span onClick={() => { setCategoryFilter(''); setBuyerFilter(''); setOpFilter(null) }} style={{ fontSize: 12.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>Clear filters</span>
          )}
        </div>
      )}
      <div data-tour="p2p-list-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {columns.map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && visiblePrs.length === 0 && (
              <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>
                {filtersActive ? 'No requisitions match the selected category / buyer / order project.' : emptyLabel}
              </td></tr>
            )}
            {visiblePrs.map((pr) => {
              const status = displayStatus(pr)
              return (
              <tr key={pr.id} onClick={() => router.push(detailHref(pr))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{pr.p2p_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.category_label || pr.category_code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.project_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(pr.required_date)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{pr.priority}</td>
                {showPoValue && (
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {pr.po_value != null ? `₹ ${pr.po_value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                )}
                <td style={{ padding: '12px 16px' }}>
                  <span data-tour="p2p-list-status" style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${status.hex}1a`, color: status.hex, whiteSpace: 'nowrap' }}>
                    {status.label}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span data-tour="p2p-list-view" onClick={() => router.push(detailHref(pr))} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span>
                    {canApprovePoInline(pr) && (
                      <span data-tour="p2p-list-approve" onClick={() => openDecision('approve', pr.id)} style={{ fontSize: 11.5, fontWeight: 600, color: '#16a34a', cursor: 'pointer' }}>Approve</span>
                    )}
                    {canRejectPoInline(pr) && (
                      <span data-tour="p2p-list-reject" onClick={() => openDecision('reject', pr.id)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Reject</span>
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
