'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceStoreItemOption, MaintenanceWorkOrder, MaintenanceWorkOrderSpare, MaintenanceWorkOrderTask } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import MaintenanceAttachments from '@/components/maintenance/MaintenanceAttachments'
import FormDialog from '@/components/maintenance/FormDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  FAILURE_CATEGORY_LABELS, PRIORITY_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS,
  formatINR, formatMinutes, localInputToIso, nowLocalInput,
} from '@/components/maintenance/labels'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }
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
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const linkStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', marginRight: 10 }
const primaryBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}
const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }

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
              fontSize: 11.5, fontWeight: 700, padding: '4px 10px', marginRight: 4, borderRadius: 9999, cursor: editable ? 'pointer' : 'default',
              border: `1px solid ${active ? o.hex : BORDER.normal}`, background: active ? `${o.hex}1a` : 'transparent', color: active ? o.hex : TEXT.muted,
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
      <td style={{ ...tdStyle, fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{task.done_by_name || ''}</td>
      <td style={tdStyle}>{editable && <span onClick={onDelete} style={{ ...linkStyle, color: '#DC2626' }}>Remove</span>}</td>
    </tr>
  )
}

export default function MaintenanceWorkOrderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const params = useParams()
  const id = Number(params.id)

  const [wo, setWo] = useState<MaintenanceWorkOrder | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)

  // Dialog state
  const [prompt, setPrompt] = useState<null | 'hold' | 'reopen' | 'cancel'>(null)
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; danger?: boolean; run: () => Promise<MaintenanceWorkOrder> }>(null)
  const [dialogError, setDialogError] = useState<string | string[]>('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignTo, setAssignTo] = useState('')
  const [completeOpen, setCompleteOpen] = useState(false)
  const [cp, setCp] = useState({ failure_category: '', root_cause: '', action_taken: '', handed_back_at: '' })
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

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getWorkOrder(id).then(setWo).catch((err) => setError(extractErrorMessages(err, 'Failed to load work order.')))
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* pickers degrade to empty lists */ })
  }, [isAuthorized, id])

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

  const s = wo?.status || ''
  const editable = !!wo && s !== 'closed' && s !== 'cancelled'
  const canIssue = SPARE_ISSUE_STATUSES.includes(s)
  const canLabour = LABOUR_STATUSES.includes(s)
  const needsRca = !!wo && RCA_TYPES.includes(wo.wo_type)
  const downtime = wo ? (wo.downtime_minutes ?? wo.live_downtime_minutes) : null

  const openComplete = () => {
    if (!wo) return
    setCp({ failure_category: wo.failure_category || '', root_cause: wo.root_cause || '', action_taken: wo.action_taken || '', handed_back_at: nowLocalInput() })
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
    }), 'Failed to complete the work order.', () => setCompleteOpen(false))
  }

  const openDetails = () => {
    if (!wo) return
    setDt({
      title: wo.title, wo_type: wo.wo_type, priority: wo.priority, description: wo.description || '',
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
      external_vendor_id: dt.external_vendor_id ? Number(dt.external_vendor_id) : null, external_cost: ext,
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
  const techOptions = (lookups?.technicians || []).map((t) => ({ value: String(t.id), label: t.name }))

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Work Order
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {wo?.wo_number || 'Work Order'}
            {wo && (
              <>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[s]}1a`, color: STATUS_HEX[s] }}>{WO_STATUS_LABELS[s] || s}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[wo.priority]}1a`, color: PRIORITY_HEX[wo.priority] }}>{PRIORITY_LABELS[wo.priority] || wo.priority}</span>
              </>
            )}
          </h1>
          {wo && <p style={{ fontSize: 14, color: TEXT.body, margin: '6px 0 0' }}>{wo.title}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {wo && s === 'draft' && <button type="button" disabled={busy} onClick={() => { setAssignTo(''); setDialogError(''); setAssignOpen(true) }} style={primaryBtn}>Assign Technician</button>}
          {wo && s === 'assigned' && <button type="button" disabled={busy} onClick={() => act('start')} style={primaryBtn}>Start Job</button>}
          {wo && s === 'in_progress' && <button type="button" disabled={busy} onClick={openComplete} style={primaryBtn}>Mark Completed</button>}
          {wo && s === 'on_hold' && <button type="button" disabled={busy} onClick={() => act('resume')} style={primaryBtn}>Resume</button>}
          {wo && s === 'completed' && (
            <button type="button" disabled={busy || wo.awaiting_confirmation} onClick={() => setConfirm({
              title: `Close ${wo.wo_number}?`, message: 'This verifies the job and freezes its cost. The asset returns to Operational if nothing else is open on it.',
              label: 'Verify & Close', danger: false, run: () => maintenanceApi.workOrderAction(id, 'close'),
            })} style={{ ...primaryBtn, opacity: wo.awaiting_confirmation ? 0.5 : 1, cursor: wo.awaiting_confirmation ? 'not-allowed' : 'pointer' }}
              title={wo.awaiting_confirmation ? `Waiting for ${wo.requester_name || 'the requester'} to confirm the machine is OK` : undefined}>
              Verify &amp; Close
            </button>
          )}
          {wo && s === 'in_progress' && <button type="button" disabled={busy} onClick={() => setPrompt('hold')} style={secondaryBtnStyle}>Put On Hold</button>}
          {wo && ['assigned', 'in_progress', 'on_hold'].includes(s) && (
            <button type="button" disabled={busy} onClick={() => { setAssignTo(wo.assigned_to_id ? String(wo.assigned_to_id) : ''); setDialogError(''); setAssignOpen(true) }} style={secondaryBtnStyle}>Reassign</button>
          )}
          {wo && s === 'completed' && <button type="button" disabled={busy} onClick={() => setPrompt('reopen')} style={secondaryBtnStyle}>Reopen</button>}
          {editable && <button type="button" disabled={busy} onClick={openDetails} style={secondaryBtnStyle}>Edit Details</button>}
          {wo && ['draft', 'assigned', 'on_hold'].includes(s) && <button type="button" disabled={busy} onClick={() => setPrompt('cancel')} style={dangerBtnStyle}>Cancel</button>}
          <button type="button" onClick={() => router.push('/dashboard/maintenance/work-orders')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {wo && (
        <>
          {s !== 'cancelled' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {STEPS.map((step, i) => {
                const idx = STEPS.indexOf(s === 'on_hold' ? 'in_progress' : s)
                const done = i <= idx
                return (
                  <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 9999,
                      background: done ? 'rgba(255,106,42,0.12)' : 'rgba(0,0,0,0.04)', color: done ? '#FF6A2A' : TEXT.muted,
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

          <div style={sectionStyle}>
            <div style={gridStyle}>
              <div onClick={() => router.push(`/dashboard/maintenance/assets/${wo.asset_id}`)} style={{ cursor: 'pointer' }}>
                <InfoRow label="Asset" value={`${wo.asset_code || ''} — ${wo.asset_name || ''}`} />
              </div>
              <InfoRow label="Plant" value={wo.branch_name || '—'} />
              <InfoRow label="Type" value={WO_TYPE_LABELS[wo.wo_type] || wo.wo_type} />
              <InfoRow label="Technician" value={wo.assigned_to_name || 'Unassigned'} />
              {wo.request_id ? (
                <div onClick={() => router.push(`/dashboard/maintenance/requests/${wo.request_id}`)} style={{ cursor: 'pointer' }}>
                  <InfoRow label="From Request" value={`${wo.request_number || ''} · ${wo.requester_name || ''}`} />
                </div>
              ) : <InfoRow label="From Request" value="—" />}
              <InfoRow label="Planned" value={wo.planned_start ? `${formatDate(wo.planned_start)}${wo.planned_end ? ` → ${formatDate(wo.planned_end)}` : ''}` : '—'} />
              <InfoRow label="Est. Hours" value={wo.estimated_hours != null ? String(wo.estimated_hours) : '—'} />
              <InfoRow label="Started" value={formatDateTime(wo.actual_start)} />
              <InfoRow label="Finished" value={formatDateTime(wo.actual_end)} />
              {wo.machine_down && <InfoRow label="Down Since" value={formatDateTime(wo.downtime_start)} />}
              {wo.machine_down && <InfoRow label={wo.downtime_minutes != null ? 'Downtime' : 'Down For (live)'} value={formatMinutes(downtime)} />}
              {wo.verified_at && <InfoRow label="Closed By" value={`${wo.verified_by_name || ''} · ${formatDateTime(wo.verified_at)}`} />}
            </div>
            {wo.description && <div style={{ marginTop: 16 }}><InfoRow label="Instructions" value={wo.description} /></div>}
            {(wo.failure_category || wo.root_cause || wo.action_taken) && (
              <div style={{ ...gridStyle, marginTop: 16 }}>
                <InfoRow label="Failure Category" value={wo.failure_category ? FAILURE_CATEGORY_LABELS[wo.failure_category] || wo.failure_category : '—'} />
                <InfoRow label="Root Cause" value={wo.root_cause || '—'} />
                <InfoRow label="Action Taken" value={wo.action_taken || '—'} />
              </div>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={sectionHead}>
              <p style={sectionTitle}>Checklist</p>
              {wo.tasks.length > 0 && <span style={{ fontSize: 12, color: TEXT.muted }}>{wo.tasks.filter((t) => t.result).length} of {wo.tasks.length} done</span>}
            </div>
            {wo.tasks.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead><tr>{['#', 'Check', 'Result', 'Measured', 'Remarks', 'By', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {wo.tasks.map((t) => (
                      <TaskRow key={`${t.id}-${t.measured_value ?? ""}-${t.remarks ?? ""}`} task={t} editable={editable}
                        onSave={(payload) => run(() => maintenanceApi.updateTask(id, t.id, payload), 'Failed to update checklist line.')}
                        onDelete={() => setConfirm({ title: 'Remove checklist line?', message: t.description, label: 'Remove', run: () => maintenanceApi.deleteTask(id, t.id) })} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editable && (
              <div style={{ display: 'flex', gap: 10, marginTop: wo.tasks.length ? 12 : 0, flexWrap: 'wrap' }}>
                <input style={{ ...smallInput, flex: '1 1 280px', maxWidth: 480 }} value={newTask} onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask() } }} placeholder="Add a check, e.g. Inspect coupling for wear" />
                <button type="button" disabled={busy || !newTask.trim()} onClick={addTask} style={smallBtn}>+ Add</button>
              </div>
            )}
            {!editable && wo.tasks.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No checklist on this job.</p>}
          </div>

          <div style={sectionStyle}>
            <div style={sectionHead}>
              <p style={sectionTitle}>Spares</p>
              {editable && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {canIssue && <button type="button" disabled={busy} onClick={() => openSpare('issue')} style={smallBtn}>Issue from Store</button>}
                  <button type="button" disabled={busy} onClick={() => openSpare('plan')} style={smallBtn}>+ Plan Spare</button>
                </div>
              )}
            </div>
            {wo.spares.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares on this job. Issued spares are taken out of Store stock against {wo.wo_number}.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr>{['Item', 'Store', 'Planned', 'Issued', 'Returned', 'In Stock', 'Cost', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
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
                          <td style={tdStyle}>{fmtQty(sp2.qty_planned)} {sp2.uom || ''}</td>
                          <td style={tdStyle}>{fmtQty(sp2.qty_issued)}</td>
                          <td style={tdStyle}>{fmtQty(sp2.qty_returned)}</td>
                          <td style={{ ...tdStyle, color: sp2.available_qty != null && sp2.available_qty < sp2.qty_planned - sp2.qty_issued ? '#DC2626' : TEXT.body }}>
                            {sp2.available_qty != null ? fmtQty(sp2.available_qty) : '—'}
                          </td>
                          <td style={tdStyle}>{formatINR(sp2.net_cost)}</td>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            {canIssue && <span onClick={() => openSpare('issue', sp2)} style={linkStyle}>Issue</span>}
                            {editable && outstanding > 0 && <span onClick={() => { setReturnQty(fmtQty(outstanding)); setDialogError(''); setReturnSpare(sp2) }} style={linkStyle}>Return</span>}
                            {editable && sp2.qty_issued === 0 && (
                              <span onClick={() => setConfirm({ title: 'Remove spare line?', message: `${sp2.item_code} ${sp2.item_name || ''}`, label: 'Remove', run: () => maintenanceApi.deleteSpare(id, sp2.id) })}
                                style={{ ...linkStyle, color: '#DC2626' }}>Remove</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={sectionHead}>
              <p style={sectionTitle}>Labour</p>
              {canLabour && <button type="button" disabled={busy} onClick={openLabour} style={smallBtn}>+ Log Time</button>}
            </div>
            {wo.labour_logs.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No time logged yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead><tr>{['Technician', 'From', 'To', 'Hours', 'Rate', 'Cost', 'Remarks', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {wo.labour_logs.map((l) => (
                      <tr key={l.id}>
                        <td style={tdStyle}>{l.technician_name || '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDateTime(l.start_time)}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDateTime(l.end_time)}</td>
                        <td style={tdStyle}>{fmtQty(l.hours)}</td>
                        <td style={tdStyle}>{l.hourly_rate ? formatINR(l.hourly_rate) : '—'}</td>
                        <td style={tdStyle}>{l.cost ? formatINR(l.cost) : '—'}</td>
                        <td style={tdStyle}>{l.remarks || ''}</td>
                        <td style={tdStyle}>
                          {editable && (
                            <span onClick={() => setConfirm({ title: 'Delete labour entry?', message: `${fmtQty(l.hours)} h by ${l.technician_name || 'technician'}`, label: 'Delete', run: () => maintenanceApi.deleteLabour(id, l.id) })}
                              style={{ ...linkStyle, color: '#DC2626' }}>Delete</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={sectionHead}><p style={sectionTitle}>Cost</p></div>
            <div style={gridStyle}>
              <InfoRow label="Spares" value={formatINR(wo.spares_cost)} />
              <InfoRow label="Labour" value={formatINR(wo.labour_cost)} />
              <InfoRow label="External" value={`${formatINR(wo.external_cost)}${wo.external_vendor_name ? ` · ${wo.external_vendor_name}` : ''}`} />
              <InfoRow label="Total" value={formatINR(wo.total_cost)} />
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={sectionHead}><p style={sectionTitle}>Service Reports &amp; Photos</p></div>
            <MaintenanceAttachments entityType="work_order" entityId={id} canUpload={editable} defaultDocType="service_report" />
          </div>
        </>
      )}

      {/* ── Dialogs ── */}
      <PromptDialog
        open={!!prompt}
        title={prompt === 'hold' ? 'Put job on hold?' : prompt === 'reopen' ? 'Reopen this job?' : 'Cancel this work order?'}
        message={prompt === 'hold' ? 'Say what you\'re waiting for — spares, vendor, shutdown window…' : prompt === 'reopen' ? 'The job goes back to In Progress.' : 'Planned spares are dropped. If it came from a request, the request goes back to Acknowledged.'}
        placeholder="Reason (required)…"
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

      <FormDialog open={assignOpen} title={s === 'draft' ? 'Assign technician' : 'Reassign technician'} error={dialogError} confirmLabel="Assign" busy={busy}
        onConfirm={() => {
          if (!assignTo) { setDialogError('Pick a technician.'); return }
          runInDialog(() => maintenanceApi.workOrderAction(id, 'assign', { assigned_to_id: Number(assignTo) }), 'Failed to assign.', () => setAssignOpen(false))
        }}
        onCancel={() => setAssignOpen(false)}>
        <label style={labelStyle}>Technician</label>
        <SearchableSelect value={assignTo} onChange={setAssignTo} placeholder="Select technician…" options={techOptions} />
        {techOptions.length === 0 && <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>No technicians found. Give maintenance staff the Maintenance module in User Management.</p>}
      </FormDialog>

      <FormDialog open={completeOpen} title="Mark job completed" error={dialogError} confirmLabel="Mark Completed" busy={busy}
        onConfirm={submitComplete} onCancel={() => setCompleteOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Failure Category{needsRca ? ' *' : ''}</label>
            <select style={inputStyle} value={cp.failure_category} onChange={(e) => setCp({ ...cp, failure_category: e.target.value })}>
              <option value="">— Select —</option>
              {Object.entries(FAILURE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Root Cause{needsRca ? ' *' : ''}</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={cp.root_cause} onChange={(e) => setCp({ ...cp, root_cause: e.target.value })} placeholder="Why did it fail?" />
          </div>
          <div>
            <label style={labelStyle}>Action Taken{needsRca ? ' *' : ''}</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={cp.action_taken} onChange={(e) => setCp({ ...cp, action_taken: e.target.value })} placeholder="What was done to fix it?" />
          </div>
          {wo?.machine_down && (
            <div style={{ maxWidth: 240 }}>
              <label style={labelStyle}>Machine Handed Back At</label>
              <input style={inputStyle} type="datetime-local" value={cp.handed_back_at} max={nowLocalInput()} onChange={(e) => setCp({ ...cp, handed_back_at: e.target.value })} />
              <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }}>Ends the downtime clock.</p>
            </div>
          )}
        </div>
      </FormDialog>

      <FormDialog open={detailsOpen} title="Edit work order details" error={dialogError} confirmLabel="Save" busy={busy}
        onConfirm={submitDetails} onCancel={() => setDetailsOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={dt.title || ''} onChange={(e) => setDt({ ...dt, title: e.target.value })} maxLength={200} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={dt.wo_type || ''} onChange={(e) => setDt({ ...dt, wo_type: e.target.value })}>
                {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={dt.priority || ''} onChange={(e) => setDt({ ...dt, priority: e.target.value })}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 110px' }}>
              <label style={labelStyle}>Est. Hours</label>
              <input style={inputStyle} type="number" min={0} step="0.5" value={dt.estimated_hours || ''} onChange={(e) => setDt({ ...dt, estimated_hours: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={labelStyle}>Planned Start</label>
              <DateField value={dt.planned_start || ''} onChange={(v) => setDt({ ...dt, planned_start: v })} />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={labelStyle}>Planned End</label>
              <DateField value={dt.planned_end || ''} onChange={(v) => setDt({ ...dt, planned_end: v })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={labelStyle}>External Service Vendor</label>
              <SearchableSelect value={dt.external_vendor_id || ''} onChange={(v) => setDt({ ...dt, external_vendor_id: v })} placeholder="None"
                options={[{ value: '', label: '— None —' }, ...(lookups?.vendors || []).map((v) => ({ value: String(v.id), label: v.name }))]} />
            </div>
            <div style={{ flex: '0 1 150px' }}>
              <label style={labelStyle}>External Cost (₹)</label>
              <input style={inputStyle} type="number" min={0} step="0.01" value={dt.external_cost || ''} onChange={(e) => setDt({ ...dt, external_cost: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Instructions</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={dt.description || ''} onChange={(e) => setDt({ ...dt, description: e.target.value })} />
          </div>
        </div>
      </FormDialog>

      <FormDialog open={!!spareOpen} title={spareOpen?.mode === 'plan' ? 'Plan a spare' : spareOpen?.spare ? `Issue ${spareOpen.spare.item_code}` : 'Issue spare from Store'}
        error={dialogError} confirmLabel={spareOpen?.mode === 'plan' ? 'Add to Plan' : 'Issue'} busy={busy}
        onConfirm={submitSpare} onCancel={() => setSpareOpen(null)}>
        {spareOpen?.spare ? (
          <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 12px' }}>
            {spareOpen.spare.item_name} from {spareOpen.spare.location_name}. Issued so far: {fmtQty(spareOpen.spare.qty_issued)} of {fmtQty(spareOpen.spare.qty_planned)} planned
            {spareOpen.spare.available_qty != null && ` · ${fmtQty(spareOpen.spare.available_qty)} in stock`}.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Store Location</label>
              <select style={inputStyle} value={sp.location_id} onChange={(e) => setSp({ ...sp, location_id: e.target.value, store_item_id: '' })}>
                <option value="">— Select —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Spare Part</label>
              <input style={inputStyle} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search by item code, name or part number…" />
              <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6, border: `1px solid ${BORDER.light}`, borderRadius: 10 }}>
                {itemOptions.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0, padding: 10 }}>No matching Store items.</p>
                ) : itemOptions.map((it) => {
                  const active = String(it.id) === sp.store_item_id
                  return (
                    <div key={it.id} onClick={() => setSp({ ...sp, store_item_id: String(it.id) })} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', cursor: 'pointer', fontSize: 13,
                      background: active ? 'rgba(255,106,42,0.1)' : 'transparent', borderTop: `1px solid ${BORDER.light}`,
                    }}>
                      <span><b>{it.item_code}</b> {it.item_name}{it.item_type === 'spare_part' ? '' : <span style={{ color: TEXT.muted }}> · {it.item_type}</span>}</span>
                      {it.available_qty != null && (
                        <span style={{ whiteSpace: 'nowrap', color: it.available_qty > 0 ? '#16A34A' : '#DC2626', fontWeight: 600 }}>{fmtQty(it.available_qty)} {it.uom || ''}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 140px' }}>
            <label style={labelStyle}>Quantity{selectedItem?.uom ? ` (${selectedItem.uom})` : spareOpen?.spare?.uom ? ` (${spareOpen.spare.uom})` : ''}</label>
            <input style={inputStyle} type="number" min={0} step="any" value={sp.quantity} onChange={(e) => setSp({ ...sp, quantity: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={labelStyle}>Remarks</label>
            <input style={inputStyle} value={sp.remarks} onChange={(e) => setSp({ ...sp, remarks: e.target.value })} />
          </div>
        </div>
        {spareOpen?.mode === 'issue' && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '8px 0 0' }}>This posts an issue in the Store stock ledger against {wo?.wo_number}.</p>}
      </FormDialog>

      <FormDialog open={!!returnSpare} title={`Return ${returnSpare?.item_code || ''} to Store`} error={dialogError} confirmLabel="Return" busy={busy}
        onConfirm={submitReturn} onCancel={() => setReturnSpare(null)}>
        <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 12px' }}>
          {returnSpare && `${fmtQty(returnSpare.qty_issued - returnSpare.qty_returned)} ${returnSpare.uom || ''} still out on this job. Unused quantity goes back to ${returnSpare.location_name}.`}
        </p>
        <div style={{ maxWidth: 160 }}>
          <label style={labelStyle}>Quantity</label>
          <input style={inputStyle} type="number" min={0} step="any" value={returnQty} onChange={(e) => setReturnQty(e.target.value)} />
        </div>
      </FormDialog>

      <FormDialog open={labourOpen} title="Log labour" error={dialogError} confirmLabel="Log Time" busy={busy}
        onConfirm={submitLabour} onCancel={() => setLabourOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Technician</label>
            <SearchableSelect value={lb.technician_id} onChange={(v) => setLb({ ...lb, technician_id: v })} placeholder="Select technician…" options={techOptions} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>From</label>
              <input style={inputStyle} type="datetime-local" value={lb.start_time} onChange={(e) => setLb({ ...lb, start_time: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>To</label>
              <input style={inputStyle} type="datetime-local" value={lb.end_time} onChange={(e) => setLb({ ...lb, end_time: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 120px' }}>
              <label style={labelStyle}>Or Hours</label>
              <input style={inputStyle} type="number" min={0} step="0.25" value={lb.hours} onChange={(e) => setLb({ ...lb, hours: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 140px' }}>
              <label style={labelStyle}>Rate / hr (₹)</label>
              <input style={inputStyle} type="number" min={0} step="0.01" value={lb.hourly_rate} onChange={(e) => setLb({ ...lb, hourly_rate: e.target.value })} placeholder="0" />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Remarks</label>
              <input style={inputStyle} value={lb.remarks} onChange={(e) => setLb({ ...lb, remarks: e.target.value })} />
            </div>
          </div>
        </div>
      </FormDialog>
    </div>
  )
}
