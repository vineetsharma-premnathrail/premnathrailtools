'use client'

import { normalizePriority, priorityLabel } from '@/lib/priority'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { approvalsApi, maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceStoreItemOption, MaintenanceWorkOrder, MaintenanceWorkOrderSpare, MaintenanceWorkOrderTask } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow, primaryBtnStyle, smallSecondaryBtnStyle, chipBtnStyle, smallDangerBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MaintenanceAttachments from '@/components/maintenance/MaintenanceAttachments'
import WorkOrderPermitsCard from '@/components/maintenance/WorkOrderPermitsCard'
import WorkOrderPurchaseCard from '@/components/maintenance/WorkOrderPurchaseCard'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import FormDialog from '@/components/maintenance/FormDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { PermissionAction, useCan } from '@/lib/permissions'
import { SHEET, SheetSection, Optional, Req, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  FAILURE_CATEGORY_LABELS, PRIORITY_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS,
  formatINR, formatMinutes, localInputToIso, nowLocalInput,
} from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }
const PRIORITY_HEX: Record<string, string> = { standard: '#475569', urgent: '#DC2626' }
const RESULT_OPTIONS = [
  { value: 'ok', label: 'OK', hex: '#16A34A' },
  { value: 'not_ok', label: 'Not OK', hex: '#DC2626' },
  { value: 'na', label: 'N/A', hex: '#78716c' },
]
const STEPS = ['draft', 'assigned', 'in_progress', 'completed', 'closed']
const RCA_TYPES = ['breakdown', 'corrective']
const SPARE_ISSUE_STATUSES = ['assigned', 'in_progress', 'on_hold']
const LABOUR_STATUSES = ['assigned', 'in_progress', 'on_hold', 'completed']

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionHead: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 16 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const smallInput: React.CSSProperties = { ...inputStyle, padding: '7px 10px', fontSize: 13 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const numThStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' }
const numTdStyle: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const NUM_HEADS = new Set(['Planned', 'Issued', 'Returned', 'In Stock', 'Cost', 'Hours', 'Rate'])
const primaryBtn: React.CSSProperties = primaryBtnStyle
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2))

function TaskRow({ task, editable, onSave, onDelete }: {
  task: MaintenanceWorkOrderTask
  editable: boolean
  onSave: (payload: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const [measured, setMeasured] = useState(task.measured_value || '')
  const [remarks, setRemarks] = useState(task.remarks || '')

  return (
    <tr>
      <td style={{ ...tdStyle, width: 36, color: TEXT.muted }}>{task.sequence}</td>
      <td style={tdStyle}>
        {task.description}
        {task.expected_value && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>Expected: {task.expected_value}</span>}
      </td>
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        {RESULT_OPTIONS.map((o) => {
          const active = task.result === o.value
          return (
            <button key={o.value} type="button" disabled={!editable} onClick={() => onSave({ result: active ? null : o.value })} style={{
              ...chipBtnStyle(false), marginRight: 4, cursor: editable ? 'pointer' : 'default',
              borderColor: active ? o.hex : BORDER.normal, background: active ? `${o.hex}1a` : 'transparent', color: active ? o.hex : TEXT.muted,
            }}>{o.label}</button>
          )
        })}
      </td>
      <td style={{ ...tdStyle, minWidth: 120 }}>
        {editable ? (
          <input style={smallInput} value={measured} onChange={(e) => setMeasured(e.target.value)}
            onBlur={() => { if (measured !== (task.measured_value || '')) onSave({ measured_value: measured || null }) }} placeholder="Reading" />
        ) : (task.measured_value || '—')}
      </td>
      <td style={{ ...tdStyle, minWidth: 160 }}>
        {editable ? (
          <input style={smallInput} value={remarks} onChange={(e) => setRemarks(e.target.value)}
            onBlur={() => { if (remarks !== (task.remarks || '')) onSave({ remarks: remarks || null }) }} placeholder="Remarks" />
        ) : (task.remarks || '—')}
      </td>
      <td style={{ ...tdStyle, fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{task.done_by_name || '—'}</td>
      <td style={tdStyle}>{editable && <button type="button" onClick={onDelete} style={smallDangerBtnStyle}>Remove</button>}</td>
    </tr>
  )
}

export default function MaintenanceWorkOrderDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can, canFeature } = useCan()
  // Features inside a work order (core/features/maintenance.py).
  const wf = (key: string, action: PermissionAction = 'view') => canFeature('maintenance', 'work_orders', key, action)
  const showCosts = wf('costs')
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const id = resolvedId ?? 0

  const [wo, setWo] = useState<MaintenanceWorkOrder | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  // Role assign-to rules (core/features/maintenance.py) — the server enforces them on save too.
  const allowAssign = useAssigneeFilter('maintenance:work_orders.assign')
  const allowLabour = useAssigneeFilter('maintenance:work_orders.labour')
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Dialog state
  const [prompt, setPrompt] = useState<null | 'hold' | 'reopen' | 'cancel'>(null)
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; danger?: boolean; run: () => Promise<MaintenanceWorkOrder> }>(null)
  const [dialogError, setDialogError] = useState<string | string[]>('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignTo, setAssignTo] = useState('')
  const [completeOpen, setCompleteOpen] = useState(false)
  const [cp, setCp] = useState({ failure_category: '', root_cause: '', action_taken: '', handed_back_at: '', meter_reading: '' })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [dt, setDt] = useState<Record<string, string>>({})
  const [spareOpen, setSpareOpen] = useState<null | { mode: 'issue' | 'plan'; spare?: MaintenanceWorkOrderSpare }>(null)
  const [sp, setSp] = useState({ location_id: '', store_item_id: '', quantity: '', remarks: '' })
  const [itemSearch, setItemSearch] = useState('')
  const [itemOptions, setItemOptions] = useState<MaintenanceStoreItemOption[]>([])
  const [returnSpare, setReturnSpare] = useState<MaintenanceWorkOrderSpare | null>(null)
  const [returnQty, setReturnQty] = useState('')
  const [labourOpen, setLabourOpen] = useState(false)
  const [lb, setLb] = useState({ technician_id: '', start_time: '', end_time: '', hours: '', hourly_rate: '', remarks: '' })
  const [newTask, setNewTask] = useState('')
  // Close-out verification runs through the central approval engine; the old
  // Verify & Close / Reopen buttons stay only for jobs completed before it
  // (no engine request) or while awaiting the requester's confirmation.
  const [closeOutPending, setCloseOutPending] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getWorkOrder(id).then(setWo).catch((err) => setError(extractErrorMessages(err, 'Failed to load work order.')))
      .finally(() => setLoading(false))
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* pickers degrade to empty lists */ })
  }, [isAuthorized, id])

  const woStatus = wo?.status
  useEffect(() => {
    if (!isAuthorized || !id || !woStatus) return
    approvalsApi.entity('maintenance_work_order', id)
      .then((st) => setCloseOutPending(st.current?.status === 'pending'))
      .catch(() => setCloseOutPending(false))
  }, [isAuthorized, id, woStatus])

  const reloadWo = () => {
    maintenanceApi.getWorkOrder(id).then(setWo).catch((err) => setError(extractErrorMessages(err, 'Failed to reload the work order.')))
  }

  // Spare picker: search Store items (spare parts first), with stock at the chosen location.
  useEffect(() => {
    if (!spareOpen || spareOpen.spare) return
    const t = setTimeout(() => {
      maintenanceApi.lookupStoreItems({ search: itemSearch.trim() || undefined, location_id: sp.location_id ? Number(sp.location_id) : undefined })
        .then(setItemOptions)
        .catch((err) => setDialogError(extractErrorMessages(err, 'Failed to search Store items.')))
    }, 250)
    return () => clearTimeout(t)
  }, [spareOpen, itemSearch, sp.location_id])

  const locations = useMemo(() => {
    const all = lookups?.store_locations || []
    // This plant's stores first.
    return [...all].sort((a, b) => Number(b.branch_id === wo?.branch_id) - Number(a.branch_id === wo?.branch_id) || a.name.localeCompare(b.name))
  }, [lookups, wo?.branch_id])

  const run = async (fn: () => Promise<MaintenanceWorkOrder>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      setWo(await fn())
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Same as run(), but keeps a dialog open and shows the error inside it.
  const runInDialog = async (fn: () => Promise<MaintenanceWorkOrder>, fallback: string, close: () => void) => {
    setDialogError('')
    setBusy(true)
    try {
      setWo(await fn())
      close()
    } catch (err) {
      setDialogError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const act = (action: Parameters<typeof maintenanceApi.workOrderAction>[1], payload?: Record<string, unknown>) =>
    run(() => maintenanceApi.workOrderAction(id, action, payload), `Couldn't ${action.replace('_', ' ')} the work order.`)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/work-orders" listLabel="Back to work orders" /></div>)
  if (!id) return <div><MaintenanceNav /></div>

  const s = wo?.status || ''
  // Backend: every job change needs work_orders:edit; reopen / close / cancel need :approve.
  const mayEdit = can('maintenance', 'work_orders', 'edit')
  const mayApprove = can('maintenance', 'work_orders', 'approve')
  const editable = !!wo && s !== 'closed' && s !== 'cancelled' && mayEdit
  const canIssue = SPARE_ISSUE_STATUSES.includes(s) && mayEdit
  const canLabour = LABOUR_STATUSES.includes(s) && mayEdit
  const needsRca = !!wo && RCA_TYPES.includes(wo.wo_type)
  const downtime = wo ? (wo.downtime_minutes ?? wo.live_downtime_minutes) : null

  const openComplete = () => {
    if (!wo) return
    setCp({ failure_category: wo.failure_category || '', root_cause: wo.root_cause || '', action_taken: wo.action_taken || '', handed_back_at: nowLocalInput(), meter_reading: '' })
    setDialogError('')
    setCompleteOpen(true)
  }
  const submitComplete = () => {
    if (needsRca && (!cp.failure_category || !cp.root_cause.trim() || !cp.action_taken.trim())) {
      setDialogError(`A ${WO_TYPE_LABELS[wo!.wo_type].toLowerCase()} job needs the failure category, root cause and action taken before it can be completed.`)
      return
    }
    const pending = wo!.tasks.filter((t) => !t.result)
    if (pending.length) {
      setDialogError(`${pending.length} checklist line${pending.length > 1 ? 's have' : ' has'} no result yet — mark each OK, Not OK or N/A first.`)
      return
    }
    runInDialog(() => maintenanceApi.workOrderAction(id, 'complete', {
      failure_category: cp.failure_category || null,
      root_cause: cp.root_cause.trim() || null,
      action_taken: cp.action_taken.trim() || null,
      handed_back_at: wo!.machine_down ? localInputToIso(cp.handed_back_at) : null,
      meter_reading: wo!.asset_meter_unit && cp.meter_reading.trim() ? Number(cp.meter_reading) : null,
    }), 'Failed to complete the work order.', () => setCompleteOpen(false))
  }

  const openDetails = () => {
    if (!wo) return
    setDt({
      title: wo.title, wo_type: wo.wo_type, priority: normalizePriority(wo.priority), description: wo.description || '',
      planned_start: wo.planned_start || '', planned_end: wo.planned_end || '', estimated_hours: wo.estimated_hours != null ? String(wo.estimated_hours) : '',
      external_vendor_id: wo.external_vendor_id ? String(wo.external_vendor_id) : '', external_cost: wo.external_cost ? String(wo.external_cost) : '',
    })
    setDialogError('')
    setDetailsOpen(true)
  }
  const submitDetails = () => {
    if (!dt.title.trim()) { setDialogError('Title is required.'); return }
    if (dt.planned_start && dt.planned_end && dt.planned_end < dt.planned_start) { setDialogError("Planned end can't be before planned start."); return }
    const hrs = dt.estimated_hours.trim() ? Number(dt.estimated_hours) : null
    const ext = dt.external_cost.trim() ? Number(dt.external_cost) : 0
    if ((hrs != null && (Number.isNaN(hrs) || hrs < 0)) || Number.isNaN(ext) || ext < 0) { setDialogError('Hours and external cost must be positive numbers.'); return }
    runInDialog(() => maintenanceApi.updateWorkOrder(id, {
      title: dt.title.trim(), wo_type: dt.wo_type, priority: dt.priority, description: dt.description.trim() || null,
      planned_start: dt.planned_start || null, planned_end: dt.planned_end || null, estimated_hours: hrs,
      external_vendor_id: dt.external_vendor_id ? Number(dt.external_vendor_id) : null,
      // Only users with Maintenance costs see (and so send) the external cost.
      ...(showCosts ? { external_cost: ext } : {}),
    }), 'Failed to save details.', () => setDetailsOpen(false))
  }

  const openSpare = (mode: 'issue' | 'plan', spare?: MaintenanceWorkOrderSpare) => {
    const defaultLoc = locations.find((l) => l.branch_id === wo?.branch_id) || locations[0]
    setSp({
      location_id: spare ? String(spare.location_id) : defaultLoc ? String(defaultLoc.id) : '',
      store_item_id: spare ? String(spare.store_item_id) : '',
      quantity: spare ? fmtQty(Math.max(spare.qty_planned - spare.qty_issued, 0) || 1) : '1',
      remarks: '',
    })
    setItemSearch('')
    setItemOptions([])
    setDialogError('')
    setSpareOpen({ mode, spare })
  }
  const submitSpare = () => {
    const qty = Number(sp.quantity)
    if (!sp.quantity || Number.isNaN(qty) || qty <= 0) { setDialogError('Quantity must be greater than 0.'); return }
    const spare = spareOpen!.spare
    if (!spare && (!sp.store_item_id || !sp.location_id)) { setDialogError('Pick the store location and the spare part.'); return }
    if (spareOpen!.mode === 'plan') {
      runInDialog(() => maintenanceApi.planSpare(id, { store_item_id: Number(sp.store_item_id), location_id: Number(sp.location_id), qty_planned: qty, remarks: sp.remarks.trim() || null }),
        'Failed to add the spare.', () => setSpareOpen(null))
    } else {
      runInDialog(() => maintenanceApi.issueSpare(id, spare
        ? { spare_id: spare.id, quantity: qty, remarks: sp.remarks.trim() || null }
        : { store_item_id: Number(sp.store_item_id), location_id: Number(sp.location_id), quantity: qty, remarks: sp.remarks.trim() || null }),
      'Failed to issue the spare from Store.', () => setSpareOpen(null))
    }
  }
  const submitReturn = () => {
    const qty = Number(returnQty)
    if (!returnQty || Number.isNaN(qty) || qty <= 0) { setDialogError('Quantity must be greater than 0.'); return }
    runInDialog(() => maintenanceApi.returnSpare(id, { spare_id: returnSpare!.id, quantity: qty }), 'Failed to return the spare to Store.', () => setReturnSpare(null))
  }

  const openLabour = () => {
    setLb({ technician_id: wo?.assigned_to_id ? String(wo.assigned_to_id) : '', start_time: '', end_time: '', hours: '', hourly_rate: '', remarks: '' })
    setDialogError('')
    setLabourOpen(true)
  }
  const submitLabour = () => {
    if (!lb.technician_id) { setDialogError('Pick the technician.'); return }
    const start = localInputToIso(lb.start_time)
    const end = localInputToIso(lb.end_time)
    const hours = lb.hours.trim() ? Number(lb.hours) : null
    if (!hours && !(start && end)) { setDialogError('Enter the hours worked, or both a start and end time.'); return }
    if (start && end && new Date(end) <= new Date(start)) { setDialogError('End time must be after start time.'); return }
    if (hours != null && (Number.isNaN(hours) || hours <= 0 || hours > 24)) { setDialogError('Hours must be between 0 and 24 for one entry.'); return }
    const rate = lb.hourly_rate.trim() ? Number(lb.hourly_rate) : 0
    if (Number.isNaN(rate) || rate < 0) { setDialogError('Hourly rate must be zero or more.'); return }
    runInDialog(() => maintenanceApi.addLabour(id, {
      technician_id: Number(lb.technician_id), start_time: start, end_time: end, hours, hourly_rate: rate, remarks: lb.remarks.trim() || null,
    }), 'Failed to log labour.', () => setLabourOpen(false))
  }

  const addTask = async () => {
    if (!newTask.trim()) return
    const ok = await run(() => maintenanceApi.addTask(id, { description: newTask.trim() }), 'Failed to add checklist line.')
    if (ok) setNewTask('')
  }

  const selectedItem = itemOptions.find((i) => String(i.id) === sp.store_item_id)
  const techs = lookups?.technicians || []
  const techOptions = techs.filter((t) => allowAssign(t.id) || t.id === wo?.assigned_to_id).map((t) => ({ value: String(t.id), label: t.name }))
  // Your own time is always allowed (server rule).
  const labourOptions = techs.filter((t) => allowLabour(t.id) || t.id === user?.id).map((t) => ({ value: String(t.id), label: t.name }))

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Work Order
          </p>
          <h1 data-tour="maint-wod-status" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {wo?.wo_number || 'Work Order'}
            {wo && <Pill label={WO_STATUS_LABELS[s] || s} hex={STATUS_HEX[s] || '#78716c'} />}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {wo && mayEdit && wf('assign', 'edit') && s === 'draft' && <button data-tour="maint-wo-assign-btn" type="button" disabled={busy} onClick={() => { setAssignTo(''); setDialogError(''); setAssignOpen(true) }} style={primaryBtn}>Assign Technician</button>}
          {wo && mayEdit && s === 'assigned' && <button data-tour="maint-wo-start-btn" type="button" disabled={busy} onClick={() => act('start')} style={primaryBtn}>Start Job</button>}
          {wo && mayEdit && s === 'in_progress' && <button data-tour="maint-wo-complete-btn" type="button" disabled={busy} onClick={openComplete} style={primaryBtn}>Mark Completed</button>}
          {wo && mayEdit && s === 'on_hold' && <button data-tour="maint-wo-resume-btn" type="button" disabled={busy} onClick={() => act('resume')} style={primaryBtn}>Resume</button>}
          {wo && mayApprove && wf('close_out', 'approve') && s === 'completed' && !closeOutPending && (
            <button data-tour="maint-wo-close-btn" type="button" disabled={busy || wo.awaiting_confirmation} onClick={() => setConfirm({
              title: `Close ${wo.wo_number}?`, message: 'This verifies the job and freezes its cost. The asset returns to Operational if nothing else is open on it.',
              label: 'Verify & Close', danger: false, run: () => maintenanceApi.workOrderAction(id, 'close'),
            })} style={{ ...primaryBtn, opacity: wo.awaiting_confirmation ? 0.5 : 1, cursor: wo.awaiting_confirmation ? 'not-allowed' : 'pointer' }}
              title={wo.awaiting_confirmation ? `Waiting for ${wo.requester_name || 'the requester'} to confirm the machine is OK` : undefined}>
              Verify &amp; Close
            </button>
          )}
          {wo && mayEdit && s === 'in_progress' && <button data-tour="maint-wo-hold-btn" type="button" disabled={busy} onClick={() => setPrompt('hold')} style={secondaryBtnStyle}>Put On Hold</button>}
          {wo && mayEdit && wf('assign', 'edit') && ['assigned', 'in_progress', 'on_hold'].includes(s) && (
            <button data-tour="maint-wo-reassign-btn" type="button" disabled={busy} onClick={() => { setAssignTo(wo.assigned_to_id ? String(wo.assigned_to_id) : ''); setDialogError(''); setAssignOpen(true) }} style={secondaryBtnStyle}>Reassign</button>
          )}
          {wo && mayApprove && wf('close_out', 'edit') && s === 'completed' && !closeOutPending && <button data-tour="maint-wo-reopen-btn" type="button" disabled={busy} onClick={() => setPrompt('reopen')} style={secondaryBtnStyle}>Reopen</button>}
          {editable && <button data-tour="maint-wo-edit-btn" type="button" disabled={busy} onClick={openDetails} style={secondaryBtnStyle}>Edit Details</button>}
          {wo && mayApprove && wf('close_out', 'cancel') && ['draft', 'assigned', 'on_hold'].includes(s) && <button data-tour="maint-wo-cancel-btn" type="button" disabled={busy} onClick={() => setPrompt('cancel')} style={dangerBtnStyle}>Cancel</button>}
          <button data-tour="maint-wod-back" type="button" onClick={() => router.push('/dashboard/maintenance/work-orders')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {!wo && !error && loading && (
        <div style={{ ...sectionStyle, fontSize: 13, color: TEXT.muted }}>Loading work order…</div>
      )}

      {wo && (
        <>
          {s !== 'cancelled' && (
            <div data-tour="maint-wod-stepper" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {STEPS.map((step, i) => {
                const idx = STEPS.indexOf(s === 'on_hold' ? 'in_progress' : s)
                const done = i <= idx
                return (
                  <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 9999,
                      background: done ? '#16A34A1a' : 'rgba(0,0,0,0.04)', color: done ? '#15803d' : TEXT.muted,
                    }}>{step === 'in_progress' && s === 'on_hold' ? 'On Hold' : WO_STATUS_LABELS[step]}</span>
                    {i < STEPS.length - 1 && <span style={{ color: TEXT.muted, fontSize: 12 }}>→</span>}
                  </div>
                )
              })}
            </div>
          )}

          {wo.awaiting_confirmation && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e', fontSize: 13 }}>
              Waiting for {wo.requester_name || 'the requester'} to confirm the machine is working ({wo.request_number}). You can close the job once they confirm.
            </div>
          )}
          {s !== 'draft' && (
            <ApprovalPanel key={`${wo.id}-${s}`} entityType="maintenance_work_order" entityId={wo.id} title="Close-out approval"
              onChanged={reloadWo} />
          )}
          {s === 'on_hold' && wo.hold_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(147,51,234,0.06)', border: '1px solid rgba(147,51,234,0.25)', color: '#6b21a8', fontSize: 13 }}>
              On hold: {wo.hold_reason}
            </div>
          )}
          {s === 'cancelled' && wo.cancel_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              Cancelled: {wo.cancel_reason}
            </div>
          )}
          {wo.requester_comment && s === 'in_progress' && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              Sent back: {wo.requester_comment}
            </div>
          )}

          <DetailCard tour="maint-wod-summary">
            <DetailSummary
              title={wo.title}
              text={wo.description || undefined}
              meta={<>
                <Pill label={priorityLabel(wo.priority)} hex={PRIORITY_HEX[normalizePriority(wo.priority)]} />
                <span>· {WO_TYPE_LABELS[wo.wo_type] || wo.wo_type}</span>
                <span>· Technician <strong style={{ color: TEXT.heading }}>{wo.assigned_to_name || 'Unassigned'}</strong></span>
                {wo.machine_down && <span style={{ color: '#DC2626', fontWeight: 600 }}>· Machine down {formatMinutes(downtime)}</span>}
              </>}
            />
            <DetailGroup title="Asset & Source">
              <DetailRow label="Asset">
                <span onClick={() => router.push(recordPath('/dashboard/maintenance/assets', wo, 'asset_id'))} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                  {[wo.asset_code, wo.asset_name].filter(Boolean).join(' — ')}
                </span>
              </DetailRow>
              <DetailRow label="Plant">{wo.branch_name}</DetailRow>
              <DetailRow label="From Request">
                {wo.request_id ? (
                  <span onClick={() => router.push(recordPath('/dashboard/maintenance/requests', wo, 'request_id'))} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                    {wo.request_number || 'Request'}{wo.requester_name ? ` · raised by ${wo.requester_name}` : ''}
                  </span>
                ) : null}
              </DetailRow>
              {wo.pm_plan_id && (
                <div data-tour="maint-wod-pm-plan">
                  <DetailRow label="From PM Plan">
                    <span onClick={() => router.push(recordPath('/dashboard/maintenance/schedule', wo, 'pm_plan_id'))} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                      {wo.pm_plan_code || `#${wo.pm_plan_id}`}
                    </span>
                    {wo.pm_due_date && ` · due ${formatDate(wo.pm_due_date)}`}
                  </DetailRow>
                </div>
              )}
            </DetailGroup>
            <DetailGroup title="Schedule & Time" last={!(wo.failure_category || wo.root_cause || wo.action_taken)}>
              <DetailRow label="Planned">{wo.planned_start ? `${formatDate(wo.planned_start)}${wo.planned_end ? ` → ${formatDate(wo.planned_end)}` : ''}` : null}</DetailRow>
              <DetailRow label="Estimated Hours">{wo.estimated_hours != null ? `${wo.estimated_hours} h` : null}</DetailRow>
              <DetailRow label="Started">{wo.actual_start ? formatDateTime(wo.actual_start) : null}</DetailRow>
              <DetailRow label="Finished">{wo.actual_end ? formatDateTime(wo.actual_end) : null}</DetailRow>
              {wo.machine_down && <DetailRow label="Machine Down Since">{wo.downtime_start ? formatDateTime(wo.downtime_start) : null}</DetailRow>}
              {wo.machine_down && <DetailRow label={wo.downtime_minutes != null ? 'Downtime' : 'Down For (live)'}>{formatMinutes(downtime)}</DetailRow>}
              {wo.verified_at && <DetailRow label="Closed By">{`${wo.verified_by_name || '—'} · ${formatDateTime(wo.verified_at)}`}</DetailRow>}
            </DetailGroup>
            {(wo.failure_category || wo.root_cause || wo.action_taken) && (
              <DetailGroup title="Failure Analysis" last>
                <DetailRow label="Failure Category">{wo.failure_category ? FAILURE_CATEGORY_LABELS[wo.failure_category] || wo.failure_category : null}</DetailRow>
                <DetailRow label="Root Cause">{wo.root_cause}</DetailRow>
                <DetailRow label="Action Taken">{wo.action_taken}</DetailRow>
              </DetailGroup>
            )}
          </DetailCard>

          {wf('checklist') && <div data-tour="maint-wod-checklist" style={sectionStyle}>
            <div style={sectionHead}>
              <p style={sectionTitle}>Checklist</p>
              {wo.tasks.length > 0 && <span style={{ fontSize: 12, color: TEXT.muted }}>{wo.tasks.filter((t) => t.result).length} of {wo.tasks.length} done</span>}
            </div>
            {wo.tasks.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead><tr>{['#', 'Check', 'Result', 'Measured', 'Remarks', 'By', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={wo.tasks.length} />}</th>)}</tr></thead>
                  <tbody>
                    {wo.tasks.map((t) => (
                      <TaskRow key={`${t.id}-${t.measured_value ?? ""}-${t.remarks ?? ""}`} task={t} editable={editable && wf('checklist', 'edit')}
                        onSave={(payload) => run(() => maintenanceApi.updateTask(id, t.id, payload), 'Failed to update checklist line.')}
                        onDelete={() => setConfirm({ title: 'Remove checklist line?', message: t.description, label: 'Remove', run: () => maintenanceApi.deleteTask(id, t.id) })} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editable && wf('checklist', 'create') && (
              <div style={{ display: 'flex', gap: 10, marginTop: wo.tasks.length ? 12 : 0, flexWrap: 'wrap' }}>
                <input data-tour="maint-wod-add-check" style={{ ...smallInput, flex: '1 1 280px', maxWidth: 480 }} value={newTask} onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask() } }} placeholder="Add a check, e.g. Inspect coupling for wear" />
                <button type="button" disabled={busy || !newTask.trim()} onClick={addTask} style={smallBtn}>+ Add</button>
              </div>
            )}
            {!editable && wo.tasks.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No checklist on this job.</p>}
          </div>}

          {wf('spares') && <div data-tour="maint-wod-spares" style={sectionStyle}>
            <div style={sectionHead}>
              <p style={sectionTitle}>Spares</p>
              {editable && wf('spares', 'create') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {canIssue && <button data-tour="maint-wo-issue-spare-btn" type="button" disabled={busy} onClick={() => openSpare('issue')} style={smallBtn}>Issue from Store</button>}
                  <button data-tour="maint-wo-plan-spare-btn" type="button" disabled={busy} onClick={() => openSpare('plan')} style={smallBtn}>+ Plan Spare</button>
                </div>
              )}
            </div>
            {wo.spares.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares on this job. Issued spares are taken out of Store stock against {wo.wo_number}.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr>{['Item', 'Store', 'Planned', 'Issued', 'Returned', 'In Stock', ...(showCosts ? ['Cost'] : []), ''].map((h, hi) => <th key={h} style={NUM_HEADS.has(h) ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={wo.spares.length} />}</th>)}</tr></thead>
                  <tbody>
                    {wo.spares.map((sp2) => {
                      const outstanding = sp2.qty_issued - sp2.qty_returned
                      return (
                        <tr key={sp2.id}>
                          <td style={tdStyle}>
                            <span style={{ fontWeight: 600 }}>{sp2.item_code}</span> {sp2.item_name}
                            {sp2.remarks && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{sp2.remarks}</span>}
                          </td>
                          <td style={tdStyle}>{sp2.location_name || '—'}</td>
                          <td style={numTdStyle}>{fmtQty(sp2.qty_planned)} {sp2.uom || ''}</td>
                          <td style={numTdStyle}>{fmtQty(sp2.qty_issued)}</td>
                          <td style={numTdStyle}>{fmtQty(sp2.qty_returned)}</td>
                          <td style={{ ...numTdStyle, color: sp2.available_qty != null && sp2.available_qty < sp2.qty_planned - sp2.qty_issued ? '#DC2626' : TEXT.body }}>
                            {sp2.available_qty != null ? fmtQty(sp2.available_qty) : '—'}
                          </td>
                          {showCosts && <td style={numTdStyle}>{formatINR(sp2.net_cost)}</td>}
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            {canIssue && wf('spares', 'create') && <button type="button" onClick={() => openSpare('issue', sp2)} style={{ ...smallBtn, marginRight: 6 }}>Issue</button>}
                            {editable && wf('spares', 'edit') && outstanding > 0 && <button type="button" onClick={() => { setReturnQty(fmtQty(outstanding)); setDialogError(''); setReturnSpare(sp2) }} style={{ ...smallBtn, marginRight: 6 }}>Return</button>}
                            {editable && wf('spares', 'delete') && sp2.qty_issued === 0 && (
                              <button type="button" onClick={() => setConfirm({ title: 'Remove spare line?', message: `${sp2.item_code} ${sp2.item_name || ''}`, label: 'Remove', run: () => maintenanceApi.deleteSpare(id, sp2.id) })} style={smallDangerBtnStyle}>Remove</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>}

          {wf('labour') && <div data-tour="maint-wod-labour" style={sectionStyle}>
            <div style={sectionHead}>
              <p style={sectionTitle}>Labour</p>
              {canLabour && wf('labour', 'create') && <button data-tour="maint-wo-log-time-btn" type="button" disabled={busy} onClick={openLabour} style={smallBtn}>+ Log Time</button>}
            </div>
            {wo.labour_logs.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No time logged yet.{canLabour && wf('labour', 'create') ? ' Use + Log Time to record hours spent on this job.' : ''}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead><tr>{['Technician', 'From', 'To', 'Hours', ...(showCosts ? ['Rate', 'Cost'] : []), 'Remarks', ''].map((h, hi) => <th key={h} style={NUM_HEADS.has(h) ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={wo.labour_logs.length} />}</th>)}</tr></thead>
                  <tbody>
                    {wo.labour_logs.map((l) => (
                      <tr key={l.id}>
                        <td style={tdStyle}>{l.technician_name || '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDateTime(l.start_time)}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDateTime(l.end_time)}</td>
                        <td style={numTdStyle}>{fmtQty(l.hours)}</td>
                        {showCosts && <td style={numTdStyle}>{l.hourly_rate ? formatINR(l.hourly_rate) : '—'}</td>}
                        {showCosts && <td style={numTdStyle}>{l.cost ? formatINR(l.cost) : '—'}</td>}
                        <td style={tdStyle}>{l.remarks || '—'}</td>
                        <td style={tdStyle}>
                          {editable && wf('labour', 'delete') && (
                            <button type="button" onClick={() => setConfirm({ title: 'Delete labour entry?', message: `${fmtQty(l.hours)} h by ${l.technician_name || 'technician'}`, label: 'Delete', run: () => maintenanceApi.deleteLabour(id, l.id) })} style={smallDangerBtnStyle}>Delete</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>}

          {showCosts && <div data-tour="maint-wod-cost" style={sectionStyle}>
            <div style={sectionHead}><p style={sectionTitle}>Cost</p></div>
            <div style={gridStyle}>
              <InfoRow label="Spares" value={formatINR(wo.spares_cost)} />
              <InfoRow label="Labour" value={formatINR(wo.labour_cost)} />
              <InfoRow label="External" value={`${formatINR(wo.external_cost)}${wo.external_vendor_name ? ` · ${wo.external_vendor_name}` : ''}`} />
              {(wo.procured_cost || 0) > 0 && <InfoRow label="Outside service (billed)" value={formatINR(wo.procured_cost)} />}
              <InfoRow label="Total" value={formatINR(wo.total_cost)} />
            </div>
          </div>}

          {wf('permits') && <WorkOrderPermitsCard woId={id} woStatus={wo.status} permitRequired={!!wo.permit_required} assignedToId={wo.assigned_to_id ?? null} onChanged={reloadWo} />}
          {wf('purchase') && <WorkOrderPurchaseCard woId={id} woStatus={wo.status} onChanged={reloadWo} />}

          {wf('documents') && <div data-tour="maint-wod-files" style={sectionStyle}>
            <div style={sectionHead}><p style={sectionTitle}>Service Reports &amp; Photos</p></div>
            <MaintenanceAttachments entityType="work_order" entityId={id} canUpload={s !== 'closed' && s !== 'cancelled' && wf('documents', 'create')}
              canDeleteFiles={wf('documents', 'delete')} defaultDocType="service_report" />
          </div>}
        </>
      )}

      {/* ── Dialogs ── */}
      <ReasonSheet
        open={!!prompt}
        icon={prompt === 'hold' ? 'clock' : prompt === 'reopen' ? 'undo' : 'x'}
        requireValue
        title={prompt === 'hold' ? 'Put job on hold?' : prompt === 'reopen' ? 'Reopen this job?' : 'Cancel this work order?'}
        message={prompt === 'hold' ? 'Say what you\'re waiting for — spares, vendor, shutdown window…' : prompt === 'reopen' ? 'The job goes back to In Progress.' : 'Planned spares are dropped. If it came from a request, the request goes back to Acknowledged.'}
        placeholder="Reason…"
        confirmLabel={prompt === 'hold' ? 'Put On Hold' : prompt === 'reopen' ? 'Reopen' : 'Cancel Work Order'}
        danger={prompt === 'cancel'}
        onConfirm={(reason) => {
          const which = prompt!
          setPrompt(null)
          if (!reason.trim()) { setError('A reason is required.'); return }
          act(which, { reason: reason.trim() })
        }}
        onCancel={() => setPrompt(null)}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.label}
        danger={confirm?.danger !== false}
        onConfirm={() => { const c = confirm!; setConfirm(null); run(c.run, `${c.label} failed.`) }}
        onCancel={() => setConfirm(null)}
      />

      <FormDialog open={assignOpen} icon="user" title={s === 'draft' ? 'Assign technician' : 'Reassign technician'}
        subtitle={`${wo?.wo_number || 'Work order'} — the technician is notified and the job moves to Assigned.`}
        error={dialogError} confirmLabel="Assign" busy={busy}
        onConfirm={() => {
          if (!assignTo) { setDialogError('Pick a technician.'); return }
          runInDialog(() => maintenanceApi.workOrderAction(id, 'assign', { assigned_to_id: Number(assignTo) }), 'Failed to assign.', () => setAssignOpen(false))
        }}
        onCancel={() => setAssignOpen(false)}>
        <SheetSection icon="user" title="Technician">
          <label style={sheetLabel}>Technician <Req /></label>
          <SearchableSelect value={assignTo} onChange={setAssignTo} placeholder="Select technician…" options={techOptions} />
          {techOptions.length === 0 && <p style={sheetHint}>No technicians found. Give maintenance staff the Maintenance module in User Management.</p>}
        </SheetSection>
      </FormDialog>

      <FormDialog open={completeOpen} icon="check" iconColor="#16A34A" title="Mark job completed"
        subtitle={`${wo?.wo_number || 'Work order'} — record what failed and what was done.`}
        error={dialogError} confirmLabel="Mark Completed" busy={busy}
        onConfirm={submitComplete} onCancel={() => setCompleteOpen(false)}>
        <SheetSection icon="alert" title="Root Cause Analysis" extra={needsRca ? undefined : <Optional />}>
          <label style={sheetLabel}>Failure Category {needsRca && <Req />}</label>
          <Select data-tour="maint-woc-failure" style={sheetInput} value={cp.failure_category} onChange={(e) => setCp({ ...cp, failure_category: e.target.value })}>
            <option value="">— Select —</option>
            {Object.entries(FAILURE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Root Cause {needsRca && <Req />}</label>
          <textarea data-tour="maint-woc-root-cause" style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={cp.root_cause} onChange={(e) => setCp({ ...cp, root_cause: e.target.value })} placeholder="Why did it fail?" />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Action Taken {needsRca && <Req />}</label>
          <textarea data-tour="maint-woc-action" style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={cp.action_taken} onChange={(e) => setCp({ ...cp, action_taken: e.target.value })} placeholder="What was done to fix it?" />
        </SheetSection>
        {(wo?.machine_down || wo?.asset_meter_unit) && (
          <SheetSection icon="clock" title="Hand-back">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {wo?.machine_down && (
                <div style={{ flex: '1 1 220px', maxWidth: 260 }}>
                  <label style={sheetLabel}>Machine Handed Back At</label>
                  <input data-tour="maint-woc-handed-back" style={sheetInput} type="datetime-local" value={cp.handed_back_at} max={nowLocalInput()} onChange={(e) => setCp({ ...cp, handed_back_at: e.target.value })} />
                  <p style={sheetHint}>Ends the downtime clock.</p>
                </div>
              )}
              {wo?.asset_meter_unit && (
                <div style={{ flex: '1 1 220px', maxWidth: 260 }}>
                  <label style={sheetLabel}>Counter reading now ({wo.asset_meter_unit}) <Req /></label>
                  <input style={sheetInput} type="number" min={0} value={cp.meter_reading} onChange={(e) => setCp({ ...cp, meter_reading: e.target.value })} placeholder={wo.asset_meter_reading != null ? `Last: ${wo.asset_meter_reading}` : ''} />
                  <p style={sheetHint}>Booked in the reading history; restarts counter-based PM plans.</p>
                </div>
              )}
            </div>
          </SheetSection>
        )}
      </FormDialog>

      <FormDialog open={detailsOpen} icon="edit" title="Edit work order details"
        subtitle={`${wo?.wo_number || 'Work order'} — title, type, plan and outside service.`}
        error={dialogError} confirmLabel="Save" busy={busy}
        onConfirm={submitDetails} onCancel={() => setDetailsOpen(false)}>
        <SheetSection icon="list" title="Basic Information">
          <label style={sheetLabel}>Title <Req /></label>
          <input data-tour="maint-wodt-title" style={sheetInput} value={dt.title || ''} onChange={(e) => setDt({ ...dt, title: e.target.value })} maxLength={200} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={sheetLabel}>Type</label>
              <Select data-tour="maint-wodt-type" style={sheetInput} value={dt.wo_type || ''} onChange={(e) => setDt({ ...dt, wo_type: e.target.value })}>
                {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label style={sheetLabel}>Priority</label>
              <Select data-tour="maint-wodt-priority" style={sheetInput} value={dt.priority || ''} onChange={(e) => setDt({ ...dt, priority: e.target.value })}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Instructions</label>
          <textarea data-tour="maint-wodt-instructions" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={dt.description || ''} onChange={(e) => setDt({ ...dt, description: e.target.value })} />
        </SheetSection>
        <SheetSection icon="calendar" title="Schedule">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-tour="maint-wodt-planned" style={{ flex: '1 1 150px' }}>
              <label style={sheetLabel}>Planned Start</label>
              <DateField value={dt.planned_start || ''} onChange={(v) => setDt({ ...dt, planned_start: v })} />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={sheetLabel}>Planned End</label>
              <DateField value={dt.planned_end || ''} onChange={(v) => setDt({ ...dt, planned_end: v })} />
            </div>
            <div style={{ flex: '0 1 110px' }}>
              <label style={sheetLabel}>Est. Hours</label>
              <input data-tour="maint-wodt-est-hours" style={sheetInput} type="number" min={0} step="0.5" value={dt.estimated_hours || ''} onChange={(e) => setDt({ ...dt, estimated_hours: e.target.value })} />
            </div>
          </div>
        </SheetSection>
        <SheetSection icon="tool" title="Outside Service" extra={<Optional />}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-tour="maint-wodt-vendor" style={{ flex: '1 1 220px' }}>
              <label style={sheetLabel}>External Service Vendor</label>
              <SearchableSelect value={dt.external_vendor_id || ''} onChange={(v) => setDt({ ...dt, external_vendor_id: v })} placeholder="None"
                options={[{ value: '', label: '— None —' }, ...(lookups?.vendors || []).map((v) => ({ value: String(v.id), label: v.name }))]} />
            </div>
            {showCosts && <div style={{ flex: '0 1 150px' }}>
              <label style={sheetLabel}>External Cost (₹)</label>
              <input data-tour="maint-wodt-ext-cost" style={sheetInput} type="number" min={0} step="0.01" value={dt.external_cost || ''} onChange={(e) => setDt({ ...dt, external_cost: e.target.value })} />
            </div>}
          </div>
        </SheetSection>
      </FormDialog>

      <FormDialog open={!!spareOpen} icon="box" title={spareOpen?.mode === 'plan' ? 'Plan a spare' : spareOpen?.spare ? `Issue ${spareOpen.spare.item_code}` : 'Issue spare from Store'}
        subtitle={spareOpen?.mode === 'plan' ? `Reserve a spare for ${wo?.wo_number || 'this job'} — nothing leaves Store yet.` : `Takes the spare out of Store stock against ${wo?.wo_number || 'this job'}.`}
        error={dialogError} confirmLabel={spareOpen?.mode === 'plan' ? 'Add to Plan' : 'Issue'} busy={busy}
        onConfirm={submitSpare} onCancel={() => setSpareOpen(null)}>
        {spareOpen?.spare ? (
          <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 16px' }}>
            {spareOpen.spare.item_name} from {spareOpen.spare.location_name}. Issued so far: {fmtQty(spareOpen.spare.qty_issued)} of {fmtQty(spareOpen.spare.qty_planned)} planned
            {spareOpen.spare.available_qty != null && ` · ${fmtQty(spareOpen.spare.available_qty)} in stock`}.
          </p>
        ) : (
          <SheetSection icon="search" title="Spare Part">
            <label style={sheetLabel}>Store Location <Req /></label>
            <Select data-tour="maint-wosp-location" style={sheetInput} value={sp.location_id} onChange={(e) => setSp({ ...sp, location_id: e.target.value, store_item_id: '' })}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Spare Part <Req /></label>
            <input data-tour="maint-wosp-item" style={sheetInput} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search by item code, name or part number…" />
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6, border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              {itemOptions.length === 0 ? (
                <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: 0, padding: 10 }}>No matching Store items.</p>
              ) : itemOptions.map((it) => {
                const active = String(it.id) === sp.store_item_id
                return (
                  <div key={it.id} onClick={() => setSp({ ...sp, store_item_id: String(it.id) })} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', cursor: 'pointer', fontSize: 13,
                    background: active ? '#eff6ff' : 'transparent', borderTop: `1px solid ${SHEET.LINE}`,
                  }}>
                    <span><b>{it.item_code}</b> {it.item_name}{it.item_type === 'spare_part' ? '' : <span style={{ color: SHEET.MUTED }}> · {it.item_type}</span>}</span>
                    {it.available_qty != null && (
                      <span style={{ whiteSpace: 'nowrap', color: it.available_qty > 0 ? '#16A34A' : '#DC2626', fontWeight: 600 }}>{fmtQty(it.available_qty)} {it.uom || ''}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </SheetSection>
        )}
        <SheetSection icon="box" title="Quantity">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 140px' }}>
              <label style={sheetLabel}>Quantity{selectedItem?.uom ? ` (${selectedItem.uom})` : spareOpen?.spare?.uom ? ` (${spareOpen.spare.uom})` : ''} <Req /></label>
              <input data-tour="maint-wosp-qty" style={sheetInput} type="number" min={0} step="any" value={sp.quantity} onChange={(e) => setSp({ ...sp, quantity: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <label style={sheetLabel}>Remarks</label>
              <input data-tour="maint-wosp-remarks" style={sheetInput} value={sp.remarks} onChange={(e) => setSp({ ...sp, remarks: e.target.value })} />
            </div>
          </div>
          {spareOpen?.mode === 'issue' && <p style={sheetHint}>This posts an issue in the Store stock ledger against {wo?.wo_number}.</p>}
        </SheetSection>
      </FormDialog>

      <FormDialog open={!!returnSpare} icon="undo" title={`Return ${returnSpare?.item_code || ''} to Store`}
        subtitle="Unused quantity goes back into Store stock." error={dialogError} confirmLabel="Return" busy={busy}
        onConfirm={submitReturn} onCancel={() => setReturnSpare(null)}>
        <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 14px' }}>
          {returnSpare && `${fmtQty(returnSpare.qty_issued - returnSpare.qty_returned)} ${returnSpare.uom || ''} still out on this job. Unused quantity goes back to ${returnSpare.location_name}.`}
        </p>
        <div style={{ maxWidth: 160 }}>
          <label style={sheetLabel}>Quantity <Req /></label>
          <input style={sheetInput} type="number" min={0} step="any" value={returnQty} onChange={(e) => setReturnQty(e.target.value)} />
        </div>
      </FormDialog>

      <FormDialog open={labourOpen} icon="clock" title="Log labour"
        subtitle={`Time spent on ${wo?.wo_number || 'this job'} — adds to its labour cost.`}
        error={dialogError} confirmLabel="Log Time" busy={busy}
        onConfirm={submitLabour} onCancel={() => setLabourOpen(false)}>
        <SheetSection icon="user" title="Technician">
          <div data-tour="maint-wolb-technician">
            <label style={sheetLabel}>Technician <Req /></label>
            <SearchableSelect value={lb.technician_id} onChange={(v) => setLb({ ...lb, technician_id: v })} placeholder="Select technician…" options={labourOptions} />
          </div>
        </SheetSection>
        <SheetSection icon="clock" title="Time">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={sheetLabel}>From</label>
              <input data-tour="maint-wolb-from" style={sheetInput} type="datetime-local" value={lb.start_time} onChange={(e) => setLb({ ...lb, start_time: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={sheetLabel}>To</label>
              <input data-tour="maint-wolb-to" style={sheetInput} type="datetime-local" value={lb.end_time} onChange={(e) => setLb({ ...lb, end_time: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ flex: '0 1 120px' }}>
              <label style={sheetLabel}>Or Hours</label>
              <input data-tour="maint-wolb-hours" style={sheetInput} type="number" min={0} step="0.25" value={lb.hours} onChange={(e) => setLb({ ...lb, hours: e.target.value })} />
            </div>
            {showCosts && <div style={{ flex: '0 1 140px' }}>
              <label style={sheetLabel}>Rate / hr (₹)</label>
              <input data-tour="maint-wolb-rate" style={sheetInput} type="number" min={0} step="0.01" value={lb.hourly_rate} onChange={(e) => setLb({ ...lb, hourly_rate: e.target.value })} placeholder="0" />
            </div>}
          </div>
          <p style={sheetHint}>Enter the hours, or both a start and end time.</p>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
          <input data-tour="maint-wolb-remarks" style={sheetInput} value={lb.remarks} onChange={(e) => setLb({ ...lb, remarks: e.target.value })} />
        </SheetSection>
      </FormDialog>
    </div>
  )
}
