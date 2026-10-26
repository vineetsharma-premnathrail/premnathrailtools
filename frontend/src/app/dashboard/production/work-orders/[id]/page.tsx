'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { productionApi } from '@/lib/api'
import {
  ProductionLookupOption, ProductionStockMovement, ProductionTimeLog, ProductionWorkOrder,
  ProductionWorkOrderCosting, ProductionWorkOrderOperation,
} from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, smallSecondaryBtnStyle, RowCount, pillStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetHint, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { ChangeFlagBanner, DependentOrdersSection, JobWorkLinkDialog, WorkOrderLinks } from '@/components/production/WorkOrderEngineering'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { productionEngineeringApi } from '@/lib/productionEngineeringApi'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
const OP_STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' }
const OP_STATUS_HEX: Record<string, string> = { pending: '#78716c', in_progress: '#F59E0B', completed: '#16A34A' }
const INSP_LABELS: Record<string, string> = { pending: 'Inspection pending', in_progress: 'Inspecting', passed: 'Passed', failed: 'Failed', conditionally_passed: 'Passed (conditional)' }
const INSP_HEX: Record<string, string> = { pending: '#F59E0B', in_progress: '#2563EB', passed: '#16A34A', failed: '#DC2626', conditionally_passed: '#0d9488' }
const TXN_LABELS: Record<string, string> = {
  issue: 'Issued', return_in: 'Returned', receipt: 'Output received',
  // Inspection-controlled output goes to Quality stock under a final-inspection lot
  quality_in: 'Output received (Quality stock)', quality_release: 'Released after inspection',
  quality_block: 'Rejected at inspection (Blocked)', quality_hold: 'Held for re-inspection',
  blocked_release: 'Released from Blocked', blocked_to_quality: 'Back to Quality for re-inspection',
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }
const primaryBtn: React.CSSProperties = primaryBtnStyle
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle
const dangerBtn: React.CSSProperties = { ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }
const pill = pillStyle
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const fmtQty = (n: number) => +n.toFixed(4)
const today = () => new Date().toISOString().slice(0, 10)
const toOptions = (rows: ProductionLookupOption[], none = '— None —') => [{ value: '', label: none }, ...rows.map((r) => ({ value: String(r.id), label: r.label }))]

interface WorkOrderBundle {
  wo: ProductionWorkOrder
  movements: ProductionStockMovement[]
  logs: ProductionTimeLog[]
  costing: ProductionWorkOrderCosting | null
}

/** Which feature-gated parts of the bundle the user may load (the API 403s
 *  the rest, so they are skipped instead of failing the whole page). */
async function fetchBundle(woId: number, movementsOk: boolean, logsOk: boolean, costingOk: boolean): Promise<WorkOrderBundle> {
  const [wo, movements, logs, costing] = await Promise.all([
    productionApi.getWorkOrder(woId),
    movementsOk ? productionApi.getStockMovements(woId) : Promise.resolve([]),
    logsOk ? productionApi.listTimeLogs({ work_order_id: woId }) : Promise.resolve([]),
    costingOk ? productionApi.getCosting(woId) : Promise.resolve(null),
  ])
  return { wo, movements, logs, costing }
}

type Tab = 'materials' | 'operations' | 'output' | 'time' | 'costing'
type Confirm = 'release' | 'complete' | 'close' | 'delete' | null

// Quantity cells: right-aligned so the numbers line up down the column.
const numTd: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

export default function WorkOrderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const { can, canDelete, canFeature } = useCan()
  // Release goes through Organization › Approval Workflows › Work order release:
  // a work-order approver releases in one click, anyone else submits it to them.
  // Mirror the backend dependency (tab action or feature) on each route.
  const wof = (feature: string, action: Parameters<typeof canFeature>[3]) => canFeature('production', 'work_orders', feature, action)
  const canApprove = wof('release', 'approve')
  const canSubmitRelease = wof('release', 'submit')
  const canFinish = wof('lifecycle', 'approve')
  const canCancelWo = wof('lifecycle', 'cancel')
  const canEdit = can('production', 'work_orders', 'edit')
  const canPrint = wof('job_card', 'print')
  const canIssue = wof('materials', 'create')
  const canReturn = wof('materials', 'edit')
  const canReceive = wof('output', 'create')
  const canRunFloor = canFeature('production', 'shop_floor', 'run_operations', 'edit')
  const canLinkJobWork = canFeature('production', 'shop_floor', 'job_work', 'edit')
  const seeMaterials = wof('materials', 'view')
  const seeOperations = wof('operations', 'view')
  const seeOutput = wof('output', 'view')
  const seeTime = wof('time_logs', 'view')
  const seeCosting = wof('costs', 'view')
  const router = useRouter()
  const params = useParams()
  const { id: woIdResolved, error: linkError } = useRecordId(params.id as string)
  const woId = woIdResolved ?? 0

  const [wo, setWo] = useState<ProductionWorkOrder | null>(null)
  const [tab, setTab] = useState<Tab>('materials')
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  // Errors raised while a popup is open are shown inside that popup.
  const [popupError, setPopupError] = useState<string | string[]>('')

  const [movements, setMovements] = useState<ProductionStockMovement[]>([])
  const [logs, setLogs] = useState<ProductionTimeLog[]>([])
  const [costing, setCosting] = useState<ProductionWorkOrderCosting | null>(null)
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  // Role assign-to rules (core/features/production.py) — the server enforces them on save too.
  const allowSupervisor = useAssigneeFilter('production:work_orders.supervisor')
  const allowOperator = useAssigneeFilter('production:shop_floor.run_operations')
  const [locations, setLocations] = useState<ProductionLookupOption[]>([])
  const [projects, setProjects] = useState<ProductionLookupOption[]>([])

  // Material issue / return
  const [materialMode, setMaterialMode] = useState<'issue' | 'return' | null>(null)
  const [materialQty, setMaterialQty] = useState<Record<number, string>>({})
  const [materialLocation, setMaterialLocation] = useState('')
  const [materialRemarks, setMaterialRemarks] = useState('')

  // Output receipt
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveQty, setReceiveQty] = useState('')
  const [receiveBatch, setReceiveBatch] = useState('')
  const [receiveRemarks, setReceiveRemarks] = useState('')

  // Time log
  const [logOp, setLogOp] = useState<ProductionWorkOrderOperation | null>(null)
  const [jobWorkOp, setJobWorkOp] = useState<ProductionWorkOrderOperation | null>(null)
  const [noYieldOp, setNoYieldOp] = useState<ProductionWorkOrderOperation | null>(null)
  const [logDate, setLogDate] = useState(today())
  const [logHours, setLogHours] = useState('')
  const [logGood, setLogGood] = useState('0')
  const [logScrap, setLogScrap] = useState('0')
  const [logOperator, setLogOperator] = useState('')
  const [logRemarks, setLogRemarks] = useState('')

  // Edit details
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [editOp, setEditOp] = useState<OrderProjectValue | null>(null)

  const applyBundle = useCallback((b: WorkOrderBundle) => {
    setWo(b.wo)
    setMovements(b.movements)
    setLogs(b.logs)
    setCosting(b.costing)
  }, [])

  const load = useCallback(() => fetchBundle(woId, seeOutput, seeTime, seeCosting)
    .then(applyBundle)
    .catch((err) => setError(extractErrorMessages(err, 'Failed to load work order.'))), [woId, applyBundle, seeOutput, seeTime, seeCosting])

  useEffect(() => {
    if (!isAuthorized || !woId) return
    let cancelled = false
    fetchBundle(woId, seeOutput, seeTime, seeCosting)
      .then((b) => { if (!cancelled) applyBundle(b) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load work order.')) })
    productionApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
    productionApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
    productionApi.lookupProjects().then(setProjects).catch(() => setProjects([]))
    return () => { cancelled = true }
  }, [isAuthorized, woId, applyBundle, seeOutput, seeTime, seeCosting])

  /** Runs an action and reloads; returns the real error message, or null on success. */
  const run = async (fn: () => Promise<unknown>, fallback: string, success?: string): Promise<string | string[] | null> => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      await load()
      if (success) setNotice(success)
      return null
    } catch (err) {
      return extractErrorMessages(err, fallback)
    } finally {
      setBusy(false)
    }
  }

  /** `run` with the error shown on the page — or inside the open popup when `inPopup`. */
  const act = async (fn: () => Promise<unknown>, fallback: string, success?: string, inPopup = false) => {
    setPopupError('')
    const msg = await run(fn, fallback, success)
    if (msg) {
      if (inPopup) setPopupError(msg)
      else setError(msg)
      return false
    }
    return true
  }

  const openMaterialMode = (mode: 'issue' | 'return') => {
    if (!wo) return
    const prefill: Record<number, string> = {}
    for (const m of wo.materials) {
      const qty = mode === 'issue' ? Math.min(m.outstanding_qty, m.reserved_qty + Math.max(m.available_qty, 0)) : 0
      prefill[m.item_id] = qty > 0 ? String(fmtQty(qty)) : ''
    }
    setMaterialQty(prefill)
    setMaterialLocation('')
    setMaterialRemarks('')
    setPopupError('')
    setMaterialMode(mode)
  }

  const submitMaterials = async () => {
    const lines = Object.entries(materialQty)
      .map(([itemId, q]) => ({ item_id: Number(itemId), quantity: Number(q) }))
      .filter((l) => l.quantity > 0)
    if (!lines.length) { setPopupError(`Enter a quantity for at least one item to ${materialMode}.`); return }
    const payload = { lines, location_id: materialLocation ? Number(materialLocation) : null, remarks: materialRemarks.trim() || null }
    const ok = materialMode === 'issue'
      ? await act(() => productionApi.issueMaterials(woId, payload), 'Failed to issue materials.', 'Materials issued from Store.', true)
      : await act(() => productionApi.returnMaterials(woId, payload), 'Failed to return materials.', 'Materials returned to Store.', true)
    if (ok) setMaterialMode(null)
  }

  const submitReceipt = async () => {
    const qty = Number(receiveQty)
    if (!(qty > 0)) { setPopupError('Enter the finished quantity to receive.'); return }
    const ok = await act(() => productionApi.receiveOutput(woId, {
      quantity: qty, batch_number: receiveBatch.trim() || null, remarks: receiveRemarks.trim() || null,
    }), 'Failed to receive output.', `${qty} unit(s) received into Store.`, true)
    if (ok) { setReceiveQty(''); setReceiveBatch(''); setReceiveRemarks(''); setReceiveOpen(false) }
  }

  const openLog = (op: ProductionWorkOrderOperation) => {
    setLogOp(op)
    setLogDate(today())
    setLogHours('')
    setLogGood('0')
    setLogScrap('0')
    setLogOperator('')
    setLogRemarks('')
    setPopupError('')
  }

  const submitLog = async () => {
    if (!logOp) return
    const hours = Number(logHours)
    if (!(hours > 0) || hours > 24) { setPopupError('Hours must be more than 0 and at most 24.'); return }
    const ok = await act(() => productionApi.createTimeLog({
      work_order_id: woId, operation_id: logOp.id, log_date: logDate, hours,
      qty_good: Number(logGood) || 0, qty_scrap: Number(logScrap) || 0,
      operator_id: logOperator ? Number(logOperator) : null, remarks: logRemarks.trim() || null,
    }), 'Failed to book time.', 'Time booked.', true)
    if (ok) setLogOp(null)
  }

  const startEdit = () => {
    if (!wo) return
    setEdit({
      quantity_planned: String(wo.quantity_planned), priority: wo.priority,
      erp_project_id: wo.erp_project_id ? String(wo.erp_project_id) : '',
      source_location_id: wo.source_location_id ? String(wo.source_location_id) : '',
      target_location_id: wo.target_location_id ? String(wo.target_location_id) : '',
      supervisor_id: wo.supervisor_id ? String(wo.supervisor_id) : '',
      planned_start_date: wo.planned_start_date || '', planned_end_date: wo.planned_end_date || '',
      remarks: wo.remarks || '',
    })
    setEditOp(wo.order_project_id && wo.order_project_element_id ? { projectId: wo.order_project_id, elementId: wo.order_project_element_id } : null)
    setPopupError('')
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!wo) return
    const num = (v: string) => (v ? Number(v) : null)
    const payload: Record<string, unknown> = {
      priority: edit.priority, erp_project_id: num(edit.erp_project_id),
      source_location_id: num(edit.source_location_id), target_location_id: num(edit.target_location_id),
      supervisor_id: num(edit.supervisor_id), planned_start_date: edit.planned_start_date || null,
      planned_end_date: edit.planned_end_date || null, remarks: edit.remarks.trim() || null,
    }
    // Only send the Order Project element when it changed (a build's WO inherits the build's).
    if (!wo.rrv_build_id && (editOp?.elementId ?? null) !== (wo.order_project_element_id ?? null)) {
      payload.order_project_element_id = editOp?.elementId ?? null
    }
    if (wo.status === 'draft') {
      const qty = Number(edit.quantity_planned)
      if (!(qty > 0)) { setPopupError('Planned quantity must be more than zero.'); return }
      payload.quantity_planned = qty
    }
    const ok = await act(() => productionApi.updateWorkOrder(woId, payload), 'Failed to save work order.', 'Work order updated.', true)
    if (ok) setEditing(false)
  }

  const printJobCard = async () => {
    setError('')
    try {
      const blob = await productionApi.getJobCard(woId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      // A blob request's error body is a Blob too — unwrap it for the real reason.
      const body = (err as { response?: { data?: unknown } })?.response?.data
      if (body instanceof Blob) {
        try {
          const parsed = JSON.parse(await body.text())
          if (parsed?.detail) { setError(String(parsed.detail)); return }
        } catch { /* not JSON — fall back below */ }
      }
      setError(extractErrorMessages(err, 'Failed to build the job card PDF.'))
    }
  }

  const runConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (which === 'release') await act(() => productionApi.releaseWorkOrder(woId), canApprove ? 'Failed to release work order.' : 'Failed to submit the release.',
      canApprove ? 'Released to the shop floor.' : 'Release submitted — a work-order approver has been asked to approve it.')
    if (which === 'complete') await act(() => productionApi.completeWorkOrder(woId), 'Failed to complete work order.', 'Work order completed.')
    if (which === 'close') await act(() => productionApi.closeWorkOrder(woId), 'Failed to close work order.', 'Work order closed.')
    if (which === 'delete') {
      setBusy(true)
      try {
        await productionApi.deleteWorkOrder(woId)
        router.push('/dashboard/production/work-orders')
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to delete work order.'))
        setBusy(false)
      }
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProductionNav /><InvalidRecordLink message={linkError} listHref="/dashboard/production/work-orders" listLabel="Back to work orders" /></div>)
  if (!woId) return <div><ProductionNav /></div>

  const executing = wo?.status === 'released' || wo?.status === 'in_progress'
  const editable = wo && ['draft', 'released', 'in_progress'].includes(wo.status)
  const remaining = wo ? fmtQty(wo.quantity_planned - wo.quantity_completed) : 0
  // Sub-tabs the role holds (core/features/production.py); an unheld one never shows.
  const visibleTabs = ([['materials', seeMaterials], ['operations', seeOperations], ['output', seeOutput], ['time', seeTime], ['costing', seeCosting]] as [Tab, boolean][])
    .filter(([, ok]) => ok).map(([k]) => k)
  const shownTab: Tab | null = visibleTabs.includes(tab) ? tab : (visibleTabs[0] ?? null)

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module · Work Order
          </p>
          <div data-tour="production-wo-detail-header" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{wo?.wo_number || 'Work Order'}</h1>
          </div>
        </div>
        <button data-tour="production-wo-detail-back-btn" onClick={() => router.push('/dashboard/production/work-orders')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {notice}
        </div>
      )}

      {wo && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {wo.status === 'draft' && (canApprove || canSubmitRelease) && <button data-tour="production-wo-release-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('release')}>{canApprove ? 'Release to Shop Floor' : 'Submit for Release'}</button>}
            {wo.status === 'in_progress' && canFinish && <button data-tour="production-wo-complete-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('complete')}>Complete Work Order</button>}
            {wo.status === 'completed' && canFinish && <button data-tour="production-wo-close-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('close')}>Close Work Order</button>}
            {editable && canEdit && !editing && <button data-tour="production-wo-edit-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={startEdit}>Edit Details</button>}
            {canPrint && <button data-tour="production-wo-job-card-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={printJobCard}>Print Job Card</button>}
            {editable && wo.status !== 'draft' && canCancelWo && <button data-tour="production-wo-cancel-btn" type="button" disabled={busy} style={dangerBtn} onClick={() => setCancelOpen(true)}>Cancel Work Order</button>}
            {wo.status === 'draft' && canDelete('production', 'work_orders', (wo as { created_by_id?: number | null } | null)?.created_by_id ?? null) && <button data-tour="production-wo-delete-btn" type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirm('delete')}>Delete Draft</button>}
          </div>

          <div data-tour="production-wo-approval-panel">
            <ApprovalPanel entityType="production_work_order" entityId={wo.id} title="Release approval" onChanged={() => load()} />
          </div>

          <ChangeFlagBanner wo={wo} canEdit={can('production', 'work_orders', 'edit')} onChanged={load} />
          {/* One record card: what is being made, its key facts, then details grouped. */}
          <DetailCard tour="production-wo-info">
            <DetailSummary
              title={`${wo.product_code} — ${wo.product_name}`}
              text={`Make ${wo.quantity_planned} ${wo.product_uom || 'unit(s)'} to BOM ${wo.bom_number} v${wo.bom_version} — ${wo.project_label ? `for ${wo.project_label}` : 'a stock build (no machine / project)'}.`}
              meta={<>
                <Pill label={STATUS_LABELS[wo.status] || wo.status} hex={STATUS_HEX[wo.status] || '#78716c'} />
                {wo.is_overdue && <Pill label="Overdue" hex="#DC2626" />}
                <span>· <strong style={{ color: TEXT.heading }}>{PRIORITY_LABELS[wo.priority] || wo.priority}</strong> priority</span>
                <span>· Planned {wo.planned_start_date ? formatDate(wo.planned_start_date) : '—'} → {wo.planned_end_date ? formatDate(wo.planned_end_date) : '—'}</span>
                <span>· Supervisor: <strong style={{ color: TEXT.heading }}>{wo.supervisor_name || '—'}</strong></span>
              </>}
            />
            <DetailGroup title="Progress">
              <DetailRow label="Output received">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <span>{fmtQty(wo.quantity_completed)} of {wo.quantity_planned} {wo.product_uom || ''}</span>
                  <span style={{ color: TEXT.secondary }}>{wo.progress_percent}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', maxWidth: 420 }}>
                  <div style={{ width: `${wo.progress_percent}%`, height: '100%', background: '#16A34A' }} />
                </div>
              </DetailRow>
              <DetailRow label="Scrapped">{`${fmtQty(wo.quantity_scrapped)} ${wo.product_uom || ''}`}</DetailRow>
              <DetailRow label="Actual start → end">{`${wo.actual_start_at ? formatDateTime(wo.actual_start_at) : 'Not started'} → ${wo.actual_end_at ? formatDateTime(wo.actual_end_at) : '—'}`}</DetailRow>
            </DetailGroup>
            {(wo.rrv_build_id || wo.sales_order_label || wo.parent_work_order_id || wo.order_project_number) && (
              <DetailGroup title="Linked records">
                {wo.rrv_build_id && (
                  <DetailRow label="RRV build">
                    <button type="button" onClick={() => router.push(recordPath('/dashboard/production/rrv-builds', wo, 'rrv_build_id'))}
                      style={{ padding: 0, border: 'none', background: 'none', color: '#2563EB', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', textAlign: 'left' }}>
                      {wo.rrv_build_number || `#${wo.rrv_build_id}`} · {wo.build_role === 'main' ? 'main assembly' : 'sub-assembly'} →
                    </button>
                  </DetailRow>
                )}
                <WorkOrderLinks wo={wo} />
              </DetailGroup>
            )}
            <DetailGroup title="Store locations">
              <DetailRow label="Issue materials from">{wo.source_location_name || <span style={{ color: '#b45309' }}>Not set — needed before release</span>}</DetailRow>
              <DetailRow label="Receive output into">{wo.target_location_name || <span style={{ color: '#b45309' }}>Not set — needed before release</span>}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Other details" last>
              <DetailRow label="Plant">{wo.branch_name}</DetailRow>
              <DetailRow label="Remarks">{wo.remarks}</DetailRow>
              {wo.cancel_reason && <DetailRow label="Cancel reason">{wo.cancel_reason}</DetailRow>}
            </DetailGroup>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>Created by {wo.created_by_name || '—'}</p>
          </DetailCard>

          {wof('sub_orders', 'view') && <DependentOrdersSection wo={wo} canCreate={wof('sub_orders', 'create')} onChanged={load} />}

          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
            {([
              ['materials', `Materials${wo.shortage_count ? ` (${wo.shortage_count} short)` : ''}`],
              ['operations', `Operations (${wo.operations.filter((o) => o.status === 'completed').length}/${wo.operations.length})`],
              ['output', 'Output & Stock'],
              ['time', `Time Logs (${logs.length})`],
              ['costing', 'Costing'],
            ] as [Tab, string][]).filter(([key]) => visibleTabs.includes(key)).map(([key, label]) => (
              <button key={key} data-tour={`production-wo-tab-${key}`} type="button" onClick={() => setTab(key)} style={{
                padding: '9px 14px', marginBottom: -1, fontSize: 12.5, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                color: shownTab === key ? '#FF6A2A' : '#78716c', borderBottom: shownTab === key ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>
                {label}
              </button>
            ))}
          </div>

          {shownTab === 'materials' && (
            <div data-tour="production-wo-materials" style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <p style={{ ...sectionTitle, margin: 0 }}>Material Requirement</p>
                {executing && (canIssue || canReturn) && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {canIssue && <button data-tour="production-wo-issue-btn" type="button" style={primaryBtn} onClick={() => openMaterialMode('issue')}>Issue from Store</button>}
                    {canIssue && wo.shortage_count > 0 && (
                      <button data-tour="production-wo-reserve-btn" type="button" disabled={busy} style={secondaryBtnStyle}
                        onClick={() => act(() => productionApi.reserveMaterials(woId), 'Failed to reserve material.', 'Reservations topped up from free stock.')}>
                        Top Up Reservation
                      </button>
                    )}
                    {canReturn && <button data-tour="production-wo-return-btn" type="button" style={secondaryBtnStyle} onClick={() => openMaterialMode('return')}>Return Unused</button>}
                  </div>
                )}
                {wo.status === 'completed' && canReturn && (
                  <button type="button" style={secondaryBtnStyle} onClick={() => openMaterialMode('return')}>Return Unused</button>
                )}
              </div>
              {wo.status === 'draft' && (
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>Release the work order to start issuing material from Store.</p>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead>
                    <tr>
                      {['Item', 'Required', 'Issued', 'Returned', 'Outstanding', 'Reserved', `Free${wo.source_location_name ? ' at source' : ''}`].map((h, i) => <th key={h} style={i === 0 ? thStyle : { ...thStyle, textAlign: 'right' }}>{h}{i === 0 && <RowCount count={wo.materials.length} />}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {wo.materials.map((m) => {
                      const short = m.outstanding_qty > m.reserved_qty + m.available_qty + 1e-9
                      return (
                        <tr key={m.id}>
                          <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>
                            {m.item_code} — {m.item_name}
                            {m.required_qty === 0 && <span style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}> · extra</span>}
                          </td>
                          <td style={numTd}>{fmtQty(m.required_qty)} {m.uom || ''}</td>
                          <td style={numTd}>{fmtQty(m.issued_qty)}</td>
                          <td style={numTd}>{fmtQty(m.returned_qty)}</td>
                          <td style={{ ...numTd, fontWeight: 600 }}>{fmtQty(m.outstanding_qty)}</td>
                          <td style={numTd}>{wo.status === 'draft' ? '—' : fmtQty(m.reserved_qty)}</td>
                          <td style={{ ...numTd, color: short && m.outstanding_qty > 0 ? '#DC2626' : TEXT.body, fontWeight: short && m.outstanding_qty > 0 ? 600 : 400 }}>
                            {wo.source_location_id ? fmtQty(m.available_qty) : '—'}{short && m.outstanding_qty > 0 && wo.source_location_id ? ' · short' : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {shownTab === 'operations' && (
            <div data-tour="production-wo-operations" style={sectionStyle}>
              <p style={sectionTitle}>Routing Operations</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                  <thead>
                    <tr>{['Seq', 'Operation', 'Workstation', 'Hours (actual / plan)', 'Good', 'Scrap', 'Quality', 'Status', ''].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={wo.operations.length} />}</th>)}</tr>
                  </thead>
                  <tbody>
                    {wo.operations.map((op) => {
                      const inspPassed = op.inspection_status === 'passed' || op.inspection_status === 'conditionally_passed'
                      const canRequest = executing && op.requires_inspection && op.status !== 'completed' && (!op.inspection_status || op.inspection_status === 'failed')
                      return (
                        <tr key={op.id}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{op.sequence}</td>
                          <td style={{ ...tdStyle, color: TEXT.heading }}>
                            {op.operation_name}
                            {op.instructions && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>{op.instructions}</div>}
                          </td>
                          <td style={tdStyle}>
                            {op.control_key === 'external' ? (
                              <>
                                <span style={pill('#9333ea')}>External</span>
                                <div style={{ fontSize: 12, marginTop: 3 }}>{op.vendor_name || '—'}</div>
                                <div style={{ fontSize: 11, color: op.job_work_returned ? '#15803d' : TEXT.muted }}>
                                  {op.job_work_issue_number ? `${op.job_work_issue_number} · ${op.job_work_returned ? 'material back' : 'at vendor'}` : 'No challan linked'}
                                </div>
                              </>
                            ) : (op.workstation_name || '—')}
                            {op.confirmation === 'required' && <div style={{ fontSize: 10.5, color: TEXT.muted }}>confirmation required</div>}
                            {op.confirmation === 'none' && <div style={{ fontSize: 10.5, color: TEXT.muted }}>milestone</div>}
                          </td>
                          <td style={{ ...tdStyle, color: op.actual_hours > op.planned_hours ? '#b45309' : TEXT.body }}>{op.actual_hours} / {op.planned_hours}</td>
                          <td style={tdStyle}>{fmtQty(op.qty_good)}</td>
                          <td style={{ ...tdStyle, color: op.qty_scrap > 0 ? '#DC2626' : TEXT.body }}>{fmtQty(op.qty_scrap)}</td>
                          <td style={tdStyle}>
                            {!op.requires_inspection ? '—' : op.inspection_status ? (
                              <span style={pill(INSP_HEX[op.inspection_status] || '#78716c')} title={op.inspection_number || ''}>
                                {INSP_LABELS[op.inspection_status] || op.inspection_status}
                              </span>
                            ) : <span style={pill('#78716c')}>Gate — not requested</span>}
                            {op.inspection_number && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3 }}>{op.inspection_number}</div>}
                          </td>
                          <td style={tdStyle}><span style={pill(OP_STATUS_HEX[op.status])}>{OP_STATUS_LABELS[op.status] || op.status}</span></td>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            {executing && canRunFloor && op.status !== 'completed' && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {op.status === 'pending' && <button data-tour="production-wo-op-start-btn" type="button" disabled={busy} style={smallBtn} onClick={() => act(() => productionApi.startOperation(woId, op.id), 'Failed to start operation.')}>Start</button>}
                                {op.control_key === 'external' && !op.job_work_issue_id && canLinkJobWork && (
                                  <button type="button" disabled={busy} style={smallBtn} onClick={() => setJobWorkOp(op)}>Link Challan</button>
                                )}
                                {op.confirmation !== 'none' && <button data-tour="production-wo-op-log-btn" type="button" disabled={busy} style={smallBtn} onClick={() => openLog(op)}>Log Time</button>}
                                {op.confirmation === 'required' && op.qty_good <= 0 && (
                                  <button type="button" disabled={busy} style={smallBtn} onClick={() => setNoYieldOp(op)}>Complete (no yield)</button>
                                )}
                                {canRequest && (
                                  <button data-tour="production-wo-op-inspect-btn" type="button" disabled={busy} style={smallBtn}
                                    onClick={() => act(() => productionApi.requestInspection(woId, op.id), 'Failed to request inspection.', 'Inspection requested — Quality has been notified.')}>
                                    {op.inspection_status === 'failed' ? 'Re-inspect' : 'Request Inspection'}
                                  </button>
                                )}
                                <button data-tour="production-wo-op-complete-btn" type="button" disabled={busy || (op.requires_inspection && !inspPassed)} style={{ ...smallBtn, opacity: op.requires_inspection && !inspPassed ? 0.5 : 1 }}
                                  title={op.requires_inspection && !inspPassed ? 'Needs a passed Quality inspection first' : ''}
                                  onClick={() => act(() => productionApi.completeOperation(woId, op.id), 'Failed to complete operation.')}>
                                  Complete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {shownTab === 'output' && (
            <>
              {wo.status === 'in_progress' && canReceive && (
                <div data-tour="production-wo-receive" style={{ ...sectionStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <p style={{ ...sectionTitle, margin: '0 0 4px' }}>Receive Finished Goods into Store</p>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                      {remaining} {wo.product_uom || ''} still to receive. Every quality-gate operation must have a passed inspection before output can be received.
                    </p>
                  </div>
                  <button data-tour="production-wo-receive-open-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => { setPopupError(''); setReceiveOpen(true) }}>Receive Output</button>
                </div>
              )}
              <div data-tour="production-wo-movements" style={sectionStyle}>
                <p style={sectionTitle}>Store Ledger Movements ({movements.length})</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                    <thead><tr>{['Date', 'Movement', 'Item', 'Qty', ...(seeCosting ? ['Order Value'] : []), 'Location', 'Batch', 'By', 'Remarks'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={movements.length} />}</th>)}</tr></thead>
                    <tbody>
                      {movements.length === 0 ? (
                        <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No stock has moved for this work order yet.</td></tr>
                      ) : movements.map((m) => (
                        <tr key={m.id}>
                          <td style={tdStyle}>{formatDate(m.transaction_date)}</td>
                          <td style={tdStyle}><span style={pill(m.transaction_type === 'receipt' || m.transaction_type === 'quality_in' || m.transaction_type === 'quality_release' ? '#16A34A' : m.transaction_type === 'quality_block' ? '#DC2626' : m.transaction_type === 'issue' ? '#2563EB' : '#7C3AED')}>{TXN_LABELS[m.transaction_type] || m.transaction_type}</span></td>
                          <td style={tdStyle}>{m.item_code} — {m.item_name}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtQty(m.quantity)}</td>
                          {seeCosting && <td style={tdStyle} title={m.order_unit_cost != null ? `@ ${inr(m.order_unit_cost)} per unit` : undefined}>{m.order_value != null ? inr(m.order_value) : '—'}</td>}
                          <td style={tdStyle}>{m.location_name || '—'}</td>
                          <td style={tdStyle}>{m.batch_number || '—'}</td>
                          <td style={tdStyle}>{m.created_by_name || '—'}</td>
                          <td style={tdStyle}>{m.remarks || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {shownTab === 'time' && (
            <div data-tour="production-wo-time-logs" style={sectionStyle}>
              <p style={sectionTitle}>Time Logs</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr>{['Date', 'Operation', 'Workstation', 'Operator', 'Hours', 'Good', 'Scrap', 'Remarks', ''].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={logs.length} />}</th>)}</tr></thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No time booked yet. Use &quot;Log Time&quot; on the Operations tab or the Shop Floor board.</td></tr>
                    ) : logs.map((l) => {
                      const op = wo.operations.find((o) => o.id === l.operation_id)
                      const locked = !executing || op?.status === 'completed'
                      return (
                        <tr key={l.id}>
                          <td style={tdStyle}>{formatDate(l.log_date)}</td>
                          <td style={tdStyle}>{l.operation_label || '—'}</td>
                          <td style={tdStyle}>{l.workstation_name || '—'}</td>
                          <td style={tdStyle}>{l.operator_name || '—'}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{l.hours}</td>
                          <td style={tdStyle}>{fmtQty(l.qty_good)}</td>
                          <td style={tdStyle}>{fmtQty(l.qty_scrap)}</td>
                          <td style={tdStyle}>{l.remarks || '—'}</td>
                          <td style={tdStyle}>
                            {!locked && canDelete('production', 'shop_floor', (l as { created_by_id?: number | null } | null)?.created_by_id ?? null) && (
                              <button type="button" disabled={busy} style={{ ...smallBtn, color: DANGER.primary, borderColor: DANGER.border }}
                                onClick={() => act(() => productionApi.deleteTimeLog(l.id), 'Failed to delete time log.', 'Time log removed.')}>Remove</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {shownTab === 'costing' && costing && (
            <>
              <div data-tour="production-wo-costing-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
                {[
                  ['Estimated Cost', inr(costing.estimated_total_cost), `${inr(costing.estimated_material_cost)} material + ${inr(costing.estimated_labour_cost)} labour`],
                  ['Actual Cost', inr(costing.actual_total_cost), `${inr(costing.actual_material_cost)} material + ${inr(costing.actual_labour_cost)} labour`],
                  ['Variance', `${costing.variance >= 0 ? '+' : ''}${inr(costing.variance)}`, costing.variance_percent != null ? `${costing.variance_percent >= 0 ? '+' : ''}${costing.variance_percent}% vs estimate` : 'No estimate'],
                  ['Cost per Unit', costing.cost_per_unit != null ? inr(costing.cost_per_unit) : '—', `Hours ${costing.actual_hours} of ${costing.planned_hours} planned`],
                  ['Received to Stock', inr(costing.cost_relieved ?? 0), 'Finished goods are received at the order’s actual cost'],
                  ['Open on Order', inr(costing.open_cost ?? 0), wo.status === 'completed' || wo.status === 'closed' ? 'Variance left on the delivered order' : 'Work in progress — counted in closing stock'],
                ].map(([label, value, sub]) => (
                  <div key={label} style={{ ...sectionStyle, marginBottom: 0, padding: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
                    <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: label === 'Variance' ? (costing.variance > 0 ? '#DC2626' : '#16A34A') : TEXT.heading }}>{value}</p>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>
                  </div>
                ))}
              </div>
              <div data-tour="production-wo-costing-items" style={sectionStyle}>
                <p style={sectionTitle}>Material Cost by Item</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                    <thead><tr>{['Item', 'Unit Cost', 'Required', 'Consumed', 'Estimated', 'Actual'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={costing.materials.length} />}</th>)}</tr></thead>
                    <tbody>
                      {costing.materials.map((c) => (
                        <tr key={c.item_id}>
                          <td style={tdStyle}>{c.item_code} — {c.item_name}</td>
                          <td style={tdStyle}>{c.unit_cost ? inr(c.unit_cost) : <span style={{ color: '#b45309' }}>not set</span>}</td>
                          <td style={tdStyle}>{fmtQty(c.required_qty)}</td>
                          <td style={tdStyle}>{fmtQty(c.consumed_qty)}</td>
                          <td style={tdStyle}>{inr(c.estimated_cost)}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{inr(c.actual_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '12px 0 0' }}>
                  Computed live from Store standard (or moving-average) costs, material issued net of returns, and hours × each workstation&apos;s hourly rate.
                </p>
              </div>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={{ release: canApprove ? 'Release to shop floor?' : 'Submit for release?', complete: 'Complete work order?', close: 'Close work order?', delete: 'Delete draft work order?' }[confirm || 'release']}
        message={{
          release: !canApprove ? 'A work-order approver is asked to release it. It stays a draft (locked for editing) until they decide.' : 'Its operations appear on the Shop Floor board and its material is reserved in Store (as much as is free). The planned quantity locks.',
          complete: `Marks production finished with ${wo ? fmtQty(wo.quantity_completed) : 0} of ${wo?.quantity_planned ?? 0} received. Remember to return any unused material.`,
          close: 'Closing locks the work order and its costs for reporting. This cannot be undone.',
          delete: 'This draft and its planned material and operations will be removed.',
        }[confirm || 'release']}
        confirmLabel={{ release: canApprove ? 'Release' : 'Submit', complete: 'Complete', close: 'Close', delete: 'Delete' }[confirm || 'release']}
        danger={confirm === 'delete'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      {wo && (
        <JobWorkLinkDialog wo={wo} op={jobWorkOp} onClose={() => setJobWorkOp(null)}
          onLinked={() => { setJobWorkOp(null); load() }} />
      )}
      {wo && editing && (
        <FormSheet tour="production-wo-edit-form" icon="edit" title="Edit Work Order" subtitle={`${wo.wo_number} · ${wo.product_code} — ${wo.product_name}`} onClose={() => setEditing(false)} busy={busy}
          footer={<>
            <button data-tour="production-wo-edit-cancel-btn" type="button" onClick={() => setEditing(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="production-wo-edit-save-btn" type="button" onClick={saveEdit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={popupError} />
              <SheetSection icon="box" title="Order">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div data-tour="production-wo-edit-qty" style={{ flex: '1 1 140px' }}>
                    <label style={sheetLabel}>Quantity {wo.status === 'draft' && <Req />}</label>
                    <input style={sheetInput} type="number" min={0} step="any" value={edit.quantity_planned} disabled={wo.status !== 'draft'}
                      title={wo.status !== 'draft' ? 'Locked once released' : ''} onChange={(e) => setEdit({ ...edit, quantity_planned: e.target.value })} />
                    {wo.status !== 'draft' && <p style={sheetHint}>Locked once released — material is reserved for it.</p>}
                  </div>
                  <div data-tour="production-wo-edit-priority" style={{ flex: '1 1 140px' }}>
                    <label style={sheetLabel}>Priority</label>
                    <Select style={sheetInput} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                      {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                </div>
                <div data-tour="production-wo-edit-machine" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Machine / Project</label>
                  <SearchableSelect value={edit.erp_project_id} onChange={(v) => setEdit({ ...edit, erp_project_id: v })} options={toOptions(projects, '— Stock build —')} />
                </div>
                <div data-tour="production-wo-edit-order-project" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Order Project — Vehicle / Lot</label>
                  <OrderProjectPicker value={editOp} onChange={(v) => setEditOp(v)} disabled={!!wo.rrv_build_id}
                    placeholder={wo.rrv_build_id ? 'Follows the RRV build' : 'Pick OP / vehicle or lot…'} />
                  {wo.rrv_build_id && <p style={sheetHint}>Part of an RRV build — it works for the build&apos;s vehicle.</p>}
                </div>
              </SheetSection>
              <SheetSection icon="calendar" title="Schedule & Responsibility">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div data-tour="production-wo-edit-start" style={{ flex: '1 1 150px' }}>
                    <label style={sheetLabel}>Planned Start</label>
                    <DateField value={edit.planned_start_date} onChange={(v) => setEdit({ ...edit, planned_start_date: v })} />
                  </div>
                  <div data-tour="production-wo-edit-end" style={{ flex: '1 1 150px' }}>
                    <label style={sheetLabel}>Planned End</label>
                    <DateField value={edit.planned_end_date} onChange={(v) => setEdit({ ...edit, planned_end_date: v })} />
                  </div>
                </div>
                <div data-tour="production-wo-edit-supervisor" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Supervisor</label>
                  <SearchableSelect value={edit.supervisor_id} onChange={(v) => setEdit({ ...edit, supervisor_id: v })} options={toOptions(users.filter((u) => allowSupervisor(u.id) || u.id === wo?.supervisor_id))} />
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="building" title="Store Locations">
                <div data-tour="production-wo-edit-source">
                  <label style={sheetLabel}>Issue Materials From</label>
                  <SearchableSelect value={edit.source_location_id} onChange={(v) => setEdit({ ...edit, source_location_id: v })} options={toOptions(locations)} />
                </div>
                <div data-tour="production-wo-edit-target" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Receive Output Into</label>
                  <SearchableSelect value={edit.target_location_id} onChange={(v) => setEdit({ ...edit, target_location_id: v })} options={toOptions(locations)} />
                </div>
                <p style={sheetHint}>Both are needed before the order can be released.</p>
              </SheetSection>
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <div data-tour="production-wo-edit-remarks">
                  <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
                </div>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {wo && materialMode && (
        <FormSheet tour="production-wo-material-form" icon={materialMode === 'issue' ? 'box' : 'undo'} title={materialMode === 'issue' ? 'Issue Materials from Store' : 'Return Unused Material'}
          subtitle={`${wo.wo_number} · ${wo.product_code} — ${wo.product_name}`} onClose={() => setMaterialMode(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setMaterialMode(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="production-wo-material-post-btn" type="button" onClick={submitMaterials} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>
              <SheetIcon name={materialMode === 'issue' ? 'send' : 'undo'} size={16} />{busy ? 'Posting…' : materialMode === 'issue' ? 'Post Issue' : 'Post Return'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="list" title="Lines">
              <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>
                      {['Item', 'Required', 'Outstanding', 'Reserved', `Free${wo.source_location_name ? ' at source' : ''}`, materialMode === 'issue' ? 'Issue Qty' : 'Return Qty'].map((h, i) => (
                        <th key={h} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 11.5, fontWeight: 600, color: SHEET.MUTED, background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}`, whiteSpace: 'nowrap' }}>{h}{i === 0 && <RowCount count={wo.materials.length} />}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wo.materials.map((m) => {
                      const short = m.outstanding_qty > m.reserved_qty + m.available_qty + 1e-9
                      const cell: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: SHEET.BODY, borderBottom: `1px solid ${SHEET.LINE}`, verticalAlign: 'middle' }
                      return (
                        <tr key={m.id}>
                          <td style={{ ...cell, fontWeight: 600, color: SHEET.INK }}>{m.item_code} — {m.item_name}</td>
                          <td style={cell}>{fmtQty(m.required_qty)} {m.uom || ''}</td>
                          <td style={{ ...cell, fontWeight: 600 }}>{fmtQty(m.outstanding_qty)}</td>
                          <td style={cell}>{fmtQty(m.reserved_qty)}</td>
                          <td style={{ ...cell, color: short && m.outstanding_qty > 0 ? '#DC2626' : SHEET.BODY }}>{wo.source_location_id ? fmtQty(m.available_qty) : '—'}</td>
                          <td style={{ ...cell, width: 140 }}>
                            <input style={{ ...sheetInput, padding: '7px 10px' }} type="number" min={0} step="any" value={materialQty[m.item_id] ?? ''}
                              onChange={(e) => setMaterialQty({ ...materialQty, [m.item_id]: e.target.value })} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {materialMode === 'issue' && (
                <p style={sheetHint}>Pre-filled with what&apos;s outstanding, capped at what&apos;s reserved plus free. If any line is short the whole issue is rejected and nothing moves.</p>
              )}
            </SheetSection>
            <SheetSection icon="building" title="Store & Remarks">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div data-tour="production-wo-material-location" style={{ flex: '1 1 260px' }}>
                  <label style={sheetLabel}>{materialMode === 'issue' ? 'Issue From' : 'Return Into'}</label>
                  <SearchableSelect value={materialLocation} onChange={setMaterialLocation}
                    options={toOptions(locations, `Default — ${wo.source_location_name || 'not set'}`)} />
                </div>
                <div style={{ flex: '1 1 260px' }}>
                  <label style={sheetLabel}>Remarks <Optional /></label>
                  <input style={sheetInput} value={materialRemarks} onChange={(e) => setMaterialRemarks(e.target.value)} />
                </div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {wo && logOp && (
        <FormSheet width={580} tour="production-wo-log-form" icon="clock" title="Log Time" subtitle={`Op ${logOp.sequence} ${logOp.operation_name} · ${wo.wo_number}`} onClose={() => setLogOp(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setLogOp(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={submitLog} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="clock" size={16} />{busy ? 'Saving…' : 'Book Time'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="clock" title="Time">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 170px' }}>
                  <label style={sheetLabel}>Date</label>
                  <DateField value={logDate} onChange={setLogDate} />
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <label style={sheetLabel}>Hours <Req /></label>
                  <input style={sheetInput} type="number" min={0} max={24} step="0.25" value={logHours} onChange={(e) => setLogHours(e.target.value)} autoFocus />
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={sheetLabel}>Operator</label>
                <SearchableSelect value={logOperator} onChange={setLogOperator} options={toOptions(users.filter((u) => allowOperator(u.id)), '— Me —')} />
              </div>
              <p style={sheetHint}>Booked hours × the workstation&apos;s rate is the order&apos;s actual labour cost.</p>
            </SheetSection>
            <SheetSection icon="box" title="Yield">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>Good Qty</label>
                  <input style={sheetInput} type="number" min={0} step="any" value={logGood} onChange={(e) => setLogGood(e.target.value)} />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>Scrap Qty</label>
                  <input style={sheetInput} type="number" min={0} step="any" value={logScrap} onChange={(e) => setLogScrap(e.target.value)} />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
              <input style={sheetInput} value={logRemarks} onChange={(e) => setLogRemarks(e.target.value)} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {wo && receiveOpen && (
        <FormSheet width={580} tour="production-wo-receive-form" icon="box" iconColor="#16A34A" title="Receive Finished Goods" subtitle={`${wo.wo_number} · ${wo.product_code} — ${wo.product_name}`} onClose={() => setReceiveOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setReceiveOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="production-wo-receive-btn" type="button" onClick={submitReceipt} disabled={busy} style={sheetBtn('primary', '#16A34A', busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : `Receive into ${wo.target_location_name || 'Store'}`}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="box" title="Output">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div data-tour="production-wo-receive-qty" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>Quantity <Req /> <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(max {remaining})</span></label>
                  <input style={sheetInput} type="number" min={0} max={remaining} step="any" value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} autoFocus />
                </div>
                <div data-tour="production-wo-receive-batch" style={{ flex: '1 1 190px' }}>
                  <label style={sheetLabel}>Batch / Serial</label>
                  <input style={sheetInput} value={receiveBatch} placeholder={wo.wo_number} onChange={(e) => setReceiveBatch(e.target.value)} />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
              <input style={sheetInput} value={receiveRemarks} onChange={(e) => setReceiveRemarks(e.target.value)} />
              <p style={sheetHint}>Every quality-gate operation must have a passed inspection before output can be received. The batch defaults to the WO number for traceability.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ReasonSheet
        open={noYieldOp !== null}
        icon="check"
        iconColor="#16A34A"
        title="Complete Without Yield"
        subtitle={noYieldOp ? `Op ${noYieldOp.sequence} ${noYieldOp.operation_name} · ${wo?.wo_number || ''}` : ''}
        label="Reason"
        hint="This step needs a yield confirmation. Give the reason it produced no good units (e.g. all scrapped, done on another order) — it is kept on the operation."
        placeholder="Reason…"
        confirmLabel="Complete Step"
        busyLabel="Completing…"
        requireValue
        requiredMessage="A reason is required to complete a step without yield."
        onConfirm={async (reason) => {
          const op = noYieldOp
          if (!op) return
          const msg = await run(() => productionEngineeringApi.completeOperation(woId, op.id, { no_yield_reason: reason }), 'Failed to complete operation.')
          if (msg) return msg
          setNoYieldOp(null)
        }}
        onCancel={() => setNoYieldOp(null)}
      />
      <ReasonSheet
        open={cancelOpen}
        danger
        icon="x"
        title="Cancel Work Order"
        subtitle={wo ? `${wo.wo_number} · ${wo.product_code} — ${wo.product_name}` : ''}
        label="Reason for cancelling"
        hint="Any issued material must be returned to Store first. The reason is kept on the record."
        placeholder="Reason for cancelling…"
        confirmLabel="Cancel Work Order"
        busyLabel="Cancelling…"
        requireValue
        requiredMessage="A reason is required to cancel a work order."
        onConfirm={async (reason) => {
          const msg = await run(() => productionApi.cancelWorkOrder(woId, reason), 'Failed to cancel work order.', 'Work order cancelled.')
          if (msg) return msg
          setCancelOpen(false)
        }}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  )
}
