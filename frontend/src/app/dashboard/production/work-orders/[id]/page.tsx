'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import {
  ProductionLookupOption, ProductionStockMovement, ProductionTimeLog, ProductionWorkOrder,
  ProductionWorkOrderCosting, ProductionWorkOrderOperation,
} from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
const OP_STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' }
const OP_STATUS_HEX: Record<string, string> = { pending: '#78716c', in_progress: '#F59E0B', completed: '#16A34A' }
const INSP_LABELS: Record<string, string> = { pending: 'Inspection pending', in_progress: 'Inspecting', passed: 'Passed', failed: 'Failed', conditionally_passed: 'Passed (conditional)' }
const INSP_HEX: Record<string, string> = { pending: '#F59E0B', in_progress: '#2563EB', passed: '#16A34A', failed: '#DC2626', conditionally_passed: '#0d9488' }
const TXN_LABELS: Record<string, string> = { issue: 'Issued', return_in: 'Returned', receipt: 'Output received' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }
const dangerBtn: React.CSSProperties = { ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const fmtQty = (n: number) => +n.toFixed(4)
const today = () => new Date().toISOString().slice(0, 10)
const toOptions = (rows: ProductionLookupOption[], none = '— None —') => [{ value: '', label: none }, ...rows.map((r) => ({ value: String(r.id), label: r.label }))]

interface WorkOrderBundle {
  wo: ProductionWorkOrder
  movements: ProductionStockMovement[]
  logs: ProductionTimeLog[]
  costing: ProductionWorkOrderCosting
}

async function fetchBundle(woId: number): Promise<WorkOrderBundle> {
  const [wo, movements, logs, costing] = await Promise.all([
    productionApi.getWorkOrder(woId), productionApi.getStockMovements(woId),
    productionApi.listTimeLogs({ work_order_id: woId }), productionApi.getCosting(woId),
  ])
  return { wo, movements, logs, costing }
}

type Tab = 'materials' | 'operations' | 'output' | 'time' | 'costing'
type Confirm = 'release' | 'complete' | 'close' | 'delete' | null

export default function WorkOrderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const params = useParams()
  const woId = Number(params.id)

  const [wo, setWo] = useState<ProductionWorkOrder | null>(null)
  const [tab, setTab] = useState<Tab>('materials')
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

  const [movements, setMovements] = useState<ProductionStockMovement[]>([])
  const [logs, setLogs] = useState<ProductionTimeLog[]>([])
  const [costing, setCosting] = useState<ProductionWorkOrderCosting | null>(null)
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  const [locations, setLocations] = useState<ProductionLookupOption[]>([])
  const [projects, setProjects] = useState<ProductionLookupOption[]>([])

  // Material issue / return
  const [materialMode, setMaterialMode] = useState<'issue' | 'return' | null>(null)
  const [materialQty, setMaterialQty] = useState<Record<number, string>>({})
  const [materialLocation, setMaterialLocation] = useState('')
  const [materialRemarks, setMaterialRemarks] = useState('')

  // Output receipt
  const [receiveQty, setReceiveQty] = useState('')
  const [receiveBatch, setReceiveBatch] = useState('')
  const [receiveRemarks, setReceiveRemarks] = useState('')

  // Time log
  const [logOp, setLogOp] = useState<ProductionWorkOrderOperation | null>(null)
  const [logDate, setLogDate] = useState(today())
  const [logHours, setLogHours] = useState('')
  const [logGood, setLogGood] = useState('0')
  const [logScrap, setLogScrap] = useState('0')
  const [logOperator, setLogOperator] = useState('')
  const [logRemarks, setLogRemarks] = useState('')

  // Edit details
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<Record<string, string>>({})

  const applyBundle = useCallback((b: WorkOrderBundle) => {
    setWo(b.wo)
    setMovements(b.movements)
    setLogs(b.logs)
    setCosting(b.costing)
  }, [])

  const load = useCallback(() => fetchBundle(woId)
    .then(applyBundle)
    .catch((err) => setError(extractErrorMessages(err, 'Failed to load work order.'))), [woId, applyBundle])

  useEffect(() => {
    if (!isAuthorized || !woId) return
    let cancelled = false
    fetchBundle(woId)
      .then((b) => { if (!cancelled) applyBundle(b) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load work order.')) })
    productionApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
    productionApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
    productionApi.lookupProjects().then(setProjects).catch(() => setProjects([]))
    return () => { cancelled = true }
  }, [isAuthorized, woId, applyBundle])

  const act = async (fn: () => Promise<unknown>, fallback: string, success?: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      await load()
      if (success) setNotice(success)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
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
    setMaterialMode(mode)
  }

  const submitMaterials = async () => {
    const lines = Object.entries(materialQty)
      .map(([itemId, q]) => ({ item_id: Number(itemId), quantity: Number(q) }))
      .filter((l) => l.quantity > 0)
    if (!lines.length) { setError(`Enter a quantity for at least one item to ${materialMode}.`); return }
    const payload = { lines, location_id: materialLocation ? Number(materialLocation) : null, remarks: materialRemarks.trim() || null }
    const ok = materialMode === 'issue'
      ? await act(() => productionApi.issueMaterials(woId, payload), 'Failed to issue materials.', 'Materials issued from Store.')
      : await act(() => productionApi.returnMaterials(woId, payload), 'Failed to return materials.', 'Materials returned to Store.')
    if (ok) setMaterialMode(null)
  }

  const submitReceipt = async () => {
    const qty = Number(receiveQty)
    if (!(qty > 0)) { setError('Enter the finished quantity to receive.'); return }
    const ok = await act(() => productionApi.receiveOutput(woId, {
      quantity: qty, batch_number: receiveBatch.trim() || null, remarks: receiveRemarks.trim() || null,
    }), 'Failed to receive output.', `${qty} unit(s) received into Store.`)
    if (ok) { setReceiveQty(''); setReceiveBatch(''); setReceiveRemarks('') }
  }

  const openLog = (op: ProductionWorkOrderOperation) => {
    setLogOp(op)
    setLogDate(today())
    setLogHours('')
    setLogGood('0')
    setLogScrap('0')
    setLogOperator('')
    setLogRemarks('')
  }

  const submitLog = async () => {
    if (!logOp) return
    const hours = Number(logHours)
    if (!(hours > 0) || hours > 24) { setError('Hours must be more than 0 and at most 24.'); return }
    const ok = await act(() => productionApi.createTimeLog({
      work_order_id: woId, operation_id: logOp.id, log_date: logDate, hours,
      qty_good: Number(logGood) || 0, qty_scrap: Number(logScrap) || 0,
      operator_id: logOperator ? Number(logOperator) : null, remarks: logRemarks.trim() || null,
    }), 'Failed to book time.', 'Time booked.')
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
    if (wo.status === 'draft') {
      const qty = Number(edit.quantity_planned)
      if (!(qty > 0)) { setError('Planned quantity must be more than zero.'); return }
      payload.quantity_planned = qty
    }
    const ok = await act(() => productionApi.updateWorkOrder(woId, payload), 'Failed to save work order.', 'Work order updated.')
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
    if (which === 'release') await act(() => productionApi.releaseWorkOrder(woId), 'Failed to release work order.', 'Released to the shop floor.')
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

  const executing = wo?.status === 'released' || wo?.status === 'in_progress'
  const editable = wo && ['draft', 'released', 'in_progress'].includes(wo.status)
  const remaining = wo ? fmtQty(wo.quantity_planned - wo.quantity_completed) : 0

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module · Work Order
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{wo?.wo_number || 'Work Order'}</h1>
            {wo && <span style={pill(STATUS_HEX[wo.status])}>{STATUS_LABELS[wo.status] || wo.status}</span>}
            {wo?.is_overdue && <span style={pill('#DC2626')}>Overdue</span>}
          </div>
        </div>
        <button onClick={() => router.push('/dashboard/production/work-orders')} type="button" style={secondaryBtnStyle}>← Back</button>
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
            {wo.status === 'draft' && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('release')}>Release to Shop Floor</button>}
            {wo.status === 'in_progress' && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('complete')}>Complete Work Order</button>}
            {wo.status === 'completed' && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('close')}>Close Work Order</button>}
            {editable && !editing && <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={startEdit}>Edit Details</button>}
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={printJobCard}>Print Job Card</button>
            {editable && wo.status !== 'draft' && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setCancelOpen(true)}>Cancel Work Order</button>}
            {wo.status === 'draft' && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirm('delete')}>Delete Draft</button>}
          </div>

          {editing && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Edit Details</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                  <label style={labelStyle}>Quantity</label>
                  <input style={inputStyle} type="number" min={0} step="any" value={edit.quantity_planned} disabled={wo.status !== 'draft'}
                    title={wo.status !== 'draft' ? 'Locked once released' : ''} onChange={(e) => setEdit({ ...edit, quantity_planned: e.target.value })} />
                </div>
                <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                  <label style={labelStyle}>Priority</label>
                  <select style={inputStyle} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                  <label style={labelStyle}>Planned Start</label>
                  <DateField value={edit.planned_start_date} onChange={(v) => setEdit({ ...edit, planned_start_date: v })} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                  <label style={labelStyle}>Planned End</label>
                  <DateField value={edit.planned_end_date} onChange={(v) => setEdit({ ...edit, planned_end_date: v })} />
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={labelStyle}>Supervisor</label>
                  <SearchableSelect value={edit.supervisor_id} onChange={(v) => setEdit({ ...edit, supervisor_id: v })} options={toOptions(users)} />
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
                  <label style={labelStyle}>Machine / Project</label>
                  <SearchableSelect value={edit.erp_project_id} onChange={(v) => setEdit({ ...edit, erp_project_id: v })} options={toOptions(projects, '— Stock build —')} />
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={labelStyle}>Issue Materials From</label>
                  <SearchableSelect value={edit.source_location_id} onChange={(v) => setEdit({ ...edit, source_location_id: v })} options={toOptions(locations)} />
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={labelStyle}>Receive Output Into</label>
                  <SearchableSelect value={edit.target_location_id} onChange={(v) => setEdit({ ...edit, target_location_id: v })} options={toOptions(locations)} />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={labelStyle}>Remarks</label>
                <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button type="button" style={secondaryBtnStyle} onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" disabled={busy} style={primaryBtn} onClick={saveEdit}>Save</button>
              </div>
            </div>
          )}

          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
              <InfoRow label="Product" value={`${wo.product_code} — ${wo.product_name}`} />
              <InfoRow label="BOM" value={`${wo.bom_number} v${wo.bom_version}`} />
              <InfoRow label="Machine / Project" value={wo.project_label || 'Stock build'} />
              {wo.rrv_build_id && (
                <div onClick={() => router.push(`/dashboard/production/rrv-builds/${wo.rrv_build_id}`)} style={{ cursor: 'pointer' }}>
                  <InfoRow label="RRV build" value={`${wo.rrv_build_number || `#${wo.rrv_build_id}`} · ${wo.build_role === 'main' ? 'main assembly' : 'sub-assembly'} →`} />
                </div>
              )}
              <InfoRow label="Priority" value={PRIORITY_LABELS[wo.priority] || wo.priority} />
              <InfoRow label="Planned" value={`${wo.planned_start_date ? formatDate(wo.planned_start_date) : '—'} → ${wo.planned_end_date ? formatDate(wo.planned_end_date) : '—'}`} />
              <InfoRow label="Actual" value={`${wo.actual_start_at ? formatDateTime(wo.actual_start_at) : '—'} → ${wo.actual_end_at ? formatDateTime(wo.actual_end_at) : '—'}`} />
              <InfoRow label="Issue From" value={wo.source_location_name || 'Not set'} />
              <InfoRow label="Receive Into" value={wo.target_location_name || 'Not set'} />
              <InfoRow label="Supervisor" value={wo.supervisor_name || '—'} />
              <InfoRow label="Plant" value={wo.branch_name || '—'} />
              <InfoRow label="Created By" value={wo.created_by_name || '—'} />
              <InfoRow label="Scrapped" value={`${fmtQty(wo.quantity_scrapped)} ${wo.product_uom || ''}`} />
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: TEXT.secondary, marginBottom: 6 }}>
                <span>Output: {fmtQty(wo.quantity_completed)} of {wo.quantity_planned} {wo.product_uom || ''}</span>
                <span>{wo.progress_percent}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${wo.progress_percent}%`, height: '100%', background: '#16A34A' }} />
              </div>
            </div>
            {wo.remarks && <div style={{ marginTop: 14 }}><InfoRow label="Remarks" value={wo.remarks} /></div>}
            {wo.cancel_reason && <div style={{ marginTop: 14 }}><InfoRow label="Cancel Reason" value={wo.cancel_reason} /></div>}
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
            {([
              ['materials', `Materials${wo.shortage_count ? ` (${wo.shortage_count} short)` : ''}`],
              ['operations', `Operations (${wo.operations.filter((o) => o.status === 'completed').length}/${wo.operations.length})`],
              ['output', 'Output & Stock'],
              ['time', `Time Logs (${logs.length})`],
              ['costing', 'Costing'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} style={{
                padding: '9px 14px', marginBottom: -1, fontSize: 12.5, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                color: tab === key ? '#FF6A2A' : '#78716c', borderBottom: tab === key ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'materials' && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <p style={{ ...sectionTitle, margin: 0 }}>Material Requirement</p>
                {executing && !materialMode && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={primaryBtn} onClick={() => openMaterialMode('issue')}>Issue from Store</button>
                    {wo.shortage_count > 0 && (
                      <button type="button" disabled={busy} style={secondaryBtnStyle}
                        onClick={() => act(() => productionApi.reserveMaterials(woId), 'Failed to reserve material.', 'Reservations topped up from free stock.')}>
                        Top Up Reservation
                      </button>
                    )}
                    <button type="button" style={secondaryBtnStyle} onClick={() => openMaterialMode('return')}>Return Unused</button>
                  </div>
                )}
                {wo.status === 'completed' && !materialMode && (
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
                      {['Item', 'Required', 'Issued', 'Returned', 'Outstanding', 'Reserved', `Free${wo.source_location_name ? ' at source' : ''}`, ...(materialMode ? [materialMode === 'issue' ? 'Issue Qty' : 'Return Qty'] : [])].map((h) => <th key={h} style={thStyle}>{h}</th>)}
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
                          <td style={tdStyle}>{fmtQty(m.required_qty)} {m.uom || ''}</td>
                          <td style={tdStyle}>{fmtQty(m.issued_qty)}</td>
                          <td style={tdStyle}>{fmtQty(m.returned_qty)}</td>
                          <td style={tdStyle}>{wo.status === 'draft' ? '—' : fmtQty(m.reserved_qty)}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtQty(m.outstanding_qty)}</td>
                          <td style={{ ...tdStyle, color: short && m.outstanding_qty > 0 ? '#DC2626' : TEXT.body, fontWeight: short && m.outstanding_qty > 0 ? 600 : 400 }}>
                            {wo.source_location_id ? fmtQty(m.available_qty) : '—'}{short && m.outstanding_qty > 0 && wo.source_location_id ? ' · short' : ''}
                          </td>
                          {materialMode && (
                            <td style={{ ...tdStyle, width: 130 }}>
                              <input style={inputStyle} type="number" min={0} step="any" value={materialQty[m.item_id] ?? ''}
                                onChange={(e) => setMaterialQty({ ...materialQty, [m.item_id]: e.target.value })} />
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {materialMode && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginTop: 14 }}>
                  <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
                    <label style={labelStyle}>{materialMode === 'issue' ? 'Issue From' : 'Return Into'}</label>
                    <SearchableSelect value={materialLocation} onChange={setMaterialLocation}
                      options={toOptions(locations, `Default — ${wo.source_location_name || 'not set'}`)} />
                  </div>
                  <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                    <label style={labelStyle}>Remarks</label>
                    <input style={inputStyle} value={materialRemarks} onChange={(e) => setMaterialRemarks(e.target.value)} />
                  </div>
                  <button type="button" style={secondaryBtnStyle} onClick={() => setMaterialMode(null)}>Cancel</button>
                  <button type="button" disabled={busy} style={primaryBtn} onClick={submitMaterials}>
                    {materialMode === 'issue' ? 'Post Issue' : 'Post Return'}
                  </button>
                </div>
              )}
              {materialMode === 'issue' && (
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
                  Pre-filled with what&apos;s outstanding, capped at what&apos;s reserved plus free. If any line is short the whole issue is rejected and nothing moves.
                </p>
              )}
            </div>
          )}

          {tab === 'operations' && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Routing Operations</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                  <thead>
                    <tr>{['Seq', 'Operation', 'Workstation', 'Hours (actual / plan)', 'Good', 'Scrap', 'Quality', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
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
                          <td style={tdStyle}>{op.workstation_name || '—'}</td>
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
                            {executing && op.status !== 'completed' && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {op.status === 'pending' && <button type="button" disabled={busy} style={smallBtn} onClick={() => act(() => productionApi.startOperation(woId, op.id), 'Failed to start operation.')}>Start</button>}
                                <button type="button" disabled={busy} style={smallBtn} onClick={() => openLog(op)}>Log Time</button>
                                {canRequest && (
                                  <button type="button" disabled={busy} style={smallBtn}
                                    onClick={() => act(() => productionApi.requestInspection(woId, op.id), 'Failed to request inspection.', 'Inspection requested — Quality has been notified.')}>
                                    {op.inspection_status === 'failed' ? 'Re-inspect' : 'Request Inspection'}
                                  </button>
                                )}
                                <button type="button" disabled={busy || (op.requires_inspection && !inspPassed)} style={{ ...smallBtn, opacity: op.requires_inspection && !inspPassed ? 0.5 : 1 }}
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

              {logOp && (
                <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)' }}>
                  <p style={{ ...sectionTitle, marginBottom: 10 }}>Log Time — {logOp.sequence} {logOp.operation_name}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                    <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                      <label style={labelStyle}>Date</label>
                      <DateField value={logDate} onChange={setLogDate} />
                    </div>
                    <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                      <label style={labelStyle}>Hours *</label>
                      <input style={inputStyle} type="number" min={0} max={24} step="0.25" value={logHours} onChange={(e) => setLogHours(e.target.value)} />
                    </div>
                    <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                      <label style={labelStyle}>Good Qty</label>
                      <input style={inputStyle} type="number" min={0} step="any" value={logGood} onChange={(e) => setLogGood(e.target.value)} />
                    </div>
                    <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                      <label style={labelStyle}>Scrap Qty</label>
                      <input style={inputStyle} type="number" min={0} step="any" value={logScrap} onChange={(e) => setLogScrap(e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                      <label style={labelStyle}>Operator</label>
                      <SearchableSelect value={logOperator} onChange={setLogOperator} options={toOptions(users, '— Me —')} />
                    </div>
                    <div style={{ flex: '1 1 200px', maxWidth: 320 }}>
                      <label style={labelStyle}>Remarks</label>
                      <input style={inputStyle} value={logRemarks} onChange={(e) => setLogRemarks(e.target.value)} />
                    </div>
                    <button type="button" style={secondaryBtnStyle} onClick={() => setLogOp(null)}>Cancel</button>
                    <button type="button" disabled={busy} style={primaryBtn} onClick={submitLog}>Book Time</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'output' && (
            <>
              {wo.status === 'in_progress' && (
                <div style={sectionStyle}>
                  <p style={sectionTitle}>Receive Finished Goods into Store</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                    <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                      <label style={labelStyle}>Quantity * (max {remaining})</label>
                      <input style={inputStyle} type="number" min={0} max={remaining} step="any" value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} />
                    </div>
                    <div style={{ flex: '0 1 200px', minWidth: 160 }}>
                      <label style={labelStyle}>Batch / Serial</label>
                      <input style={inputStyle} value={receiveBatch} placeholder={wo.wo_number} onChange={(e) => setReceiveBatch(e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 220px', maxWidth: 360 }}>
                      <label style={labelStyle}>Remarks</label>
                      <input style={inputStyle} value={receiveRemarks} onChange={(e) => setReceiveRemarks(e.target.value)} />
                    </div>
                    <button type="button" disabled={busy} style={primaryBtn} onClick={submitReceipt}>Receive into {wo.target_location_name || 'Store'}</button>
                  </div>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
                    Every quality-gate operation must have a passed inspection before output can be received. The batch defaults to the WO number for traceability.
                  </p>
                </div>
              )}
              <div style={sectionStyle}>
                <p style={sectionTitle}>Store Ledger Movements ({movements.length})</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                    <thead><tr>{['Date', 'Movement', 'Item', 'Qty', 'Location', 'Batch', 'By', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {movements.length === 0 ? (
                        <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No stock has moved for this work order yet.</td></tr>
                      ) : movements.map((m) => (
                        <tr key={m.id}>
                          <td style={tdStyle}>{formatDate(m.transaction_date)}</td>
                          <td style={tdStyle}><span style={pill(m.transaction_type === 'receipt' ? '#16A34A' : m.transaction_type === 'issue' ? '#2563EB' : '#7C3AED')}>{TXN_LABELS[m.transaction_type] || m.transaction_type}</span></td>
                          <td style={tdStyle}>{m.item_code} — {m.item_name}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtQty(m.quantity)}</td>
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

          {tab === 'time' && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Time Logs</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr>{['Date', 'Operation', 'Workstation', 'Operator', 'Hours', 'Good', 'Scrap', 'Remarks', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
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
                            {!locked && (
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

          {tab === 'costing' && costing && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
                {[
                  ['Estimated Cost', inr(costing.estimated_total_cost), `${inr(costing.estimated_material_cost)} material + ${inr(costing.estimated_labour_cost)} labour`],
                  ['Actual Cost', inr(costing.actual_total_cost), `${inr(costing.actual_material_cost)} material + ${inr(costing.actual_labour_cost)} labour`],
                  ['Variance', `${costing.variance >= 0 ? '+' : ''}${inr(costing.variance)}`, costing.variance_percent != null ? `${costing.variance_percent >= 0 ? '+' : ''}${costing.variance_percent}% vs estimate` : 'No estimate'],
                  ['Cost per Unit', costing.cost_per_unit != null ? inr(costing.cost_per_unit) : '—', `Hours ${costing.actual_hours} of ${costing.planned_hours} planned`],
                ].map(([label, value, sub]) => (
                  <div key={label} style={{ ...sectionStyle, marginBottom: 0, padding: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
                    <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: label === 'Variance' ? (costing.variance > 0 ? '#DC2626' : '#16A34A') : TEXT.heading }}>{value}</p>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>
                  </div>
                ))}
              </div>
              <div style={sectionStyle}>
                <p style={sectionTitle}>Material Cost by Item</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                    <thead><tr>{['Item', 'Unit Cost', 'Required', 'Consumed', 'Estimated', 'Actual'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
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
        title={{ release: 'Release to shop floor?', complete: 'Complete work order?', close: 'Close work order?', delete: 'Delete draft work order?' }[confirm || 'release']}
        message={{
          release: 'Its operations appear on the Shop Floor board and its material is reserved in Store (as much as is free). The planned quantity locks.',
          complete: `Marks production finished with ${wo ? fmtQty(wo.quantity_completed) : 0} of ${wo?.quantity_planned ?? 0} received. Remember to return any unused material.`,
          close: 'Closing locks the work order and its costs for reporting. This cannot be undone.',
          delete: 'This draft and its planned material and operations will be removed.',
        }[confirm || 'release']}
        confirmLabel={{ release: 'Release', complete: 'Complete', close: 'Close', delete: 'Delete' }[confirm || 'release']}
        danger={confirm === 'delete'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <PromptDialog
        open={cancelOpen}
        title="Cancel work order?"
        message="Any issued material must be returned to Store first. Give a reason — it's kept on the record."
        placeholder="Reason for cancelling…"
        confirmLabel="Cancel Work Order"
        onConfirm={async (reason) => {
          if (!reason.trim()) { setError('A reason is required to cancel a work order.'); return }
          setCancelOpen(false)
          await act(() => productionApi.cancelWorkOrder(woId, reason.trim()), 'Failed to cancel work order.', 'Work order cancelled.')
        }}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  )
}
