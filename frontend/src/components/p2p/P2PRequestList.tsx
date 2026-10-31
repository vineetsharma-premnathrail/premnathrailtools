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
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import Select from '@/components/shared/Select'
import { RowCount, pillStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { Funnel } from '@phosphor-icons/react'
import Checkbox from '@/components/Checkbox'
import { priorityLabel } from '@/lib/priority'

// One-row text longer than 25 characters is cut with "…" (full text in the title); two-row columns cut at 50.
const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
const clip2 = (v?: string | null) => clip(v, 50)

// Statuses counted as "in progress" on the counter row (approved, then sourcing / PO / receiving).
const IN_PROGRESS = ['approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted', 'po_raised', 'po_approved', 'partially_received']

// Status "groups" the count chips and the Status dropdown share (filter value 'group:<key>').
const STATUS_GROUPS: Record<string, { label: string; statuses: string[] }> = {
  pending: { label: 'Pending approval', statuses: ['submitted'] },
  progress: { label: 'In progress (all stages)', statuses: IN_PROGRESS },
  closed: { label: 'Closed (received / closed)', statuses: ['received', 'closed'] },
}
const matchesStatus = (status: string, filter: string) =>
  !filter || (filter.startsWith('group:') ? !!STATUS_GROUPS[filter.slice(6)]?.statuses.includes(status) : status === filter)

export type P2PListStats = { total: number; pending: number; inProgress: number; closed: number }

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Pending Approval',
  approved: 'Approved',
  vendor_quotations: 'RFQ / Quotations',
  technical_evaluation: 'Technical Evaluation',
  commercial_evaluation: 'Commercial Evaluation',
  vendor_selected: 'Vendor Selected',
  po_drafted: 'Draft PO',
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

export default function P2PRequestList({ statuses, emptyLabel, context, queue, onlyPendingForViewer, showFilters, onlyMine, mineToggle, toolbarLeft, toolbarRight, onStats, statusFilter: statusFilterProp, onStatusFilterChange }: {
  statuses?: string[]; emptyLabel: string; context?: string; queue?: string; onlyPendingForViewer?: boolean; showFilters?: boolean;
  /** Only the requisitions this user raised (the My Requisitions tab). */ onlyMine?: boolean;
  /** Adds a "Raised by me" switch to the Filters popup. */ mineToggle?: boolean;
  /** Registry toolbar (only with showFilters): left = create button, right = Export / Import after the Filters button. */
  toolbarLeft?: React.ReactNode; toolbarRight?: React.ReactNode;
  /** Counter numbers for the rows shown (they follow the search and filters). */
  onStats?: (s: P2PListStats) => void;
  /** Controlled Status filter ('' = all, a status code, or 'group:pending|progress|closed') so count chips outside the list stay in sync with the Filters popup. */
  statusFilter?: string; onStatusFilterChange?: (v: string) => void }) {
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
  const [ownStatusFilter, setOwnStatusFilter] = useState('')
  const statusFilter = statusFilterProp ?? ownStatusFilter
  const setStatusFilter = onStatusFilterChange ?? setOwnStatusFilter
  const [search, setSearch] = useState('')
  // PR numbers sort ascending by default (app standard); the header toggles it.
  const [sortAsc, setSortAsc] = useState(true)
  // Project filter (server-side): a whole project or one vehicle / lot.
  const [opFilter, setOpFilter] = useState<OrderProjectValue | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [draft, setDraft] = useState<{ status: string; category: string; buyer: string; op: OrderProjectValue | null; mine: boolean }>({ status: '', category: '', buyer: '', op: null, mine: false })
  const detailHref = (pr: object) => (context ? `${recordPath('/dashboard/p2p', pr)}?from=${context}` : recordPath('/dashboard/p2p', pr))

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const opParams = opFilter
        ? (opFilter.elementId ? { order_project_element_id: opFilter.elementId } : { order_project_id: opFilter.projectId })
        : {}
      const data = await p2pApi.list(queue ? { limit: 1000, queue, ...opParams } : { limit: 1000, ...opParams })
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
  const statusOptions = Array.from(new Map(prs.map((pr) => [pr.status, STATUS_LABELS[pr.status] || pr.status])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
  const q = search.trim().toLowerCase()
  // Everything except the Status filter: the count chips count these, so they stay totals when a chip is on.
  const visibleAnyStatus = prs.filter(pendingOnViewer).filter((pr) =>
    ((!onlyMine && !mineOnly) || pr.requested_by_id === user?.id)
    && (!categoryFilter || pr.category_code === categoryFilter)
    && (!q || [pr.p2p_number, pr.category_label, pr.project_label, pr.requested_by_name, pr.assigned_buyer_name].some((x) => (x || '').toLowerCase().includes(q)))
    && (!buyerFilter || (buyerFilter === 'none' ? pr.assigned_buyer_id == null : String(pr.assigned_buyer_id) === buyerFilter)))
  const visiblePrs = visibleAnyStatus.filter((pr) => matchesStatus(pr.status, statusFilter))
    .sort((a, b) => (sortAsc ? 1 : -1) * (a.p2p_number || '').localeCompare(b.p2p_number || '', undefined, { numeric: true }))
  const filtersActive = !!(categoryFilter || buyerFilter || statusFilter || q || opFilter || mineOnly)
  // Filters-popup count (search is outside the popup and not counted).
  const activeFilterCount = [categoryFilter, buyerFilter, statusFilter].filter(Boolean).length + (opFilter ? 1 : 0) + (mineOnly ? 1 : 0)
  const clearPopupFilters = () => { setCategoryFilter(''); setBuyerFilter(''); setStatusFilter(''); setOpFilter(null); setMineOnly(false); setFilterOpen(false) }
  const openFilters = () => { setDraft({ status: statusFilter, category: categoryFilter, buyer: buyerFilter, op: opFilter, mine: mineOnly }); setFilterOpen(true) }
  const applyFilters = () => { setStatusFilter(draft.status); setCategoryFilter(draft.category); setBuyerFilter(draft.buyer); setOpFilter(draft.op); setMineOnly(draft.mine); setFilterOpen(false) }
  const statTotal = visibleAnyStatus.length
  const statPending = visibleAnyStatus.filter((pr) => pr.status === 'submitted').length
  const statProgress = visibleAnyStatus.filter((pr) => IN_PROGRESS.includes(pr.status)).length
  const statClosed = visibleAnyStatus.filter((pr) => pr.status === 'received' || pr.status === 'closed').length
  useEffect(() => {
    onStats?.({ total: statTotal, pending: statPending, inProgress: statProgress, closed: statClosed })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statTotal, statPending, statProgress, statClosed])

  const isAdmin = user?.role === 'admin'
  // Matrix PRs: the PO goes to the people picked per role plus every Director,
  // and ALL roles must approve (any one Director clears the Director slot);
  // legacy PRs keep the Purchase Head / Director / Partner chain.
  const showPoValue = context === 'po-approval'
  const columns = ['PR No.', 'Category', 'Project', 'Required By', 'Priority', ...(showPoValue ? ['PO Value'] : []), 'Status', ...(showPoValue ? [''] : [])]
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {toolbarLeft}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input aria-label="Search requisitions" data-tour="p2p-list-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PR no., project, requester…" style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
            <button type="button" onClick={openFilters} data-tour="p2p-filter-btn" aria-label="Filters" title="Filters"
              style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...(activeFilterCount ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
              <Funnel size={16} weight={activeFilterCount ? 'fill' : 'regular'} />
              Filters
              {activeFilterCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeFilterCount}</span>}
            </button>
            {activeFilterCount > 0 && <button type="button" onClick={clearPopupFilters} style={secondaryBtnStyle} data-tour="p2p-clear-btn">Clear</button>}
            {toolbarRight}
          </div>
        </div>
      )}
      {showFilters && filterOpen && (
        <FormSheet icon="search" title="Filters" subtitle="Narrow the requisitions, then press Apply." width={560} busy={false} onClose={() => setFilterOpen(false)} tour="p2p-filter-sheet"
          footer={<>
            <button type="button" onClick={clearPopupFilters} style={sheetBtn('secondary', SHEET.INK)}>Clear Filters</button>
            <button type="button" onClick={applyFilters} style={sheetBtn('primary', SHEET.BLUE)} data-tour="p2p-apply-btn"><SheetIcon name="check" size={16} />Apply Filters</button>
          </>}>
          <div data-tour="p2p-list-filters" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={sheetLabel}>Status</label>
              <Select aria-label="Filter by status" style={sheetInput} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
                <option value="">All statuses</option>
                {Object.entries(STATUS_GROUPS).map(([k, g]) => <option key={k} value={`group:${k}`}>{g.label}</option>)}
                {statusOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>Category</label>
              <Select aria-label="Filter by category" style={sheetInput} value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
                <option value="">All categories</option>
                {categoryOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>Buyer</label>
              <Select aria-label="Filter by buyer" style={sheetInput} value={draft.buyer} onChange={(e) => setDraft((d) => ({ ...d, buyer: e.target.value }))}>
                <option value="">All buyers</option>
                {buyerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                <option value="none">No buyer assigned</option>
              </Select>
            </div>
            {mineToggle && (
              <label data-tour="p2p-mine-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#57534e', cursor: 'pointer' }}>
                <Checkbox checked={draft.mine} onChange={(e) => setDraft((d) => ({ ...d, mine: e.target.checked }))} />
                Raised by me
              </label>
            )}
            <div aria-label="Filter by project">
              <label style={sheetLabel}>Project</label>
              <OrderProjectPicker value={draft.op} onChange={(v) => setDraft((d) => ({ ...d, op: v }))} requireElement={false} placeholder="All projects" />
            </div>
          </div>
        </FormSheet>
      )}
      <div data-tour="p2p-list-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {columns.map((h, i) => (
                <th key={h || 'actions'} data-fit-min={60} data-fit-cut={h === 'Project' ? '' : undefined} aria-sort={i === 0 ? (sortAsc ? 'ascending' : 'descending') : undefined} style={{ textAlign: h === 'PO Value' ? 'right' : 'left', padding: '10px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {i === 0
                    ? <button type="button" onClick={() => setSortAsc(!sortAsc)} title={`Sorted by PR number, ${sortAsc ? 'lowest first' : 'highest first'} — click to reverse`}
                        style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer' }}>{h} {sortAsc ? '↑' : '↓'}</button>
                    : h}
                  {i === 0 && <RowCount count={visiblePrs.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && visiblePrs.length === 0 && (
              <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>
                {filtersActive ? 'No requisitions match the search and filters — clear them to see all.' : emptyLabel}
              </td></tr>
            )}
            {visiblePrs.map((pr) => {
              const status = displayStatus(pr)
              return (
              <tr key={pr.id} onClick={() => router.push(detailHref(pr))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '10px 8px', fontSize: 13, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{pr.p2p_number}</td>
                <td title={pr.category_label || pr.category_code || undefined} style={{ padding: '10px 8px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{clip(pr.category_label || pr.category_code)}</td>
                <td data-fit-clamp style={{ padding: '10px 8px', fontSize: 13, color: TEXT.secondary }}><div title={pr.project_label || undefined}>{clip2(pr.project_label)}</div></td>
                <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(pr.required_date)}</td>
                <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{pr.priority ? priorityLabel(pr.priority) : '—'}</td>
                {showPoValue && (
                  <td style={{ padding: '10px 8px', fontSize: 13, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {pr.po_value != null ? `₹ ${pr.po_value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                )}
                <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                  <span data-tour="p2p-list-status" style={pillStyle(status.hex)}>
                    {status.label}
                  </span>
                </td>
                {showPoValue && <td style={{ padding: '10px 8px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, whiteSpace: 'nowrap' }}>
                    {canApprovePoInline(pr) && (
                      <button type="button" data-tour="p2p-list-approve" onClick={() => openDecision('approve', pr.id)} style={{ ...smallSecondaryBtnStyle, color: '#15803d' }}>Approve</button>
                    )}
                    {canRejectPoInline(pr) && (
                      <button type="button" data-tour="p2p-list-reject" onClick={() => openDecision('reject', pr.id)} style={smallDangerBtnStyle}>Reject</button>
                    )}
                  </div>
                </td>}
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
