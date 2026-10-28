'use client'

// MRP cockpit — MD01N run per plant, MD11-MD13 planned orders (create /
// change / firm / convert to work order or purchase requisition), MD05 MRP
// list, MD06 exception list, and the MD04 drawer per item.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { mrpApi, MrpException, MrpRun, PlannedOrder, PrConversionResult } from '@/lib/mrpApi'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, RowCount } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import StockRequirementsDrawer from '@/components/production/StockRequirementsDrawer'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { canFeature } from '@/lib/permissions'
import { recordPath } from '@/lib/recordRef'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

type Lookup = { id: number; label: string; code?: string | null; extra?: string | null }
type Tab = 'orders' | 'list' | 'exceptions' | 'log'

const STATUS_LABELS: Record<string, string> = { open: 'Open', converted: 'Converted' }
const STATUS_HEX: Record<string, string> = { open: '#2563EB', converted: '#16A34A' }
const PROC_HEX: Record<string, string> = { make: '#7C3AED', buy: '#0891B2' }
const EXC_HEX: Record<string, string> = {
  reschedule_in: '#F59E0B', reschedule_out: '#2563EB', cancel: '#7C3AED', start_in_past: '#DC2626', finish_in_past: '#DC2626',
  below_safety_stock: '#F59E0B', no_product_item: '#DC2626', item_inactive: '#DC2626', bom_cycle: '#DC2626', no_lead_time: '#78716c', beyond_horizon: '#78716c',
}
const PR_CATEGORIES: Record<string, string> = { '': 'Suggest from Item Master', MKT: 'Market Items', PNH: 'Pneumatic & Hydraulic', RAW: 'Raw Material', ELE: 'Electrical', HWC: 'Hardware & Consumables', JOB: 'Job Work', OTH: 'Others' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle
const fmt = (n: number) => +n.toFixed(4)
const errorBox = (msg: string) => (
  <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{msg}</div>
)

function safePath(base: string, row: object, key: string): string | null {
  try { return recordPath(base, row, key) } catch { return null }
}

export default function MrpPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('production')
  const router = useRouter()
  // Planning features (core/features/production.py) mirror each MRP route.
  const pf = (feature: string, action: Parameters<typeof canFeature>[4]) => canFeature(user, 'production', 'planning', feature, action)
  const canRunMrp = pf('mrp_run', 'edit')
  const canEdit = pf('planned_orders', 'edit')
  const canDeletePo = pf('planned_orders', 'delete')
  const canCreate = pf('planned_orders', 'create')
  const canToWo = pf('convert_wo', 'create')
  const canPr = !!user?.apps?.includes('p2p') && pf('convert_pr', 'create')
  const canSelect = canEdit || canPr

  const [branches, setBranches] = useState<Lookup[]>([])
  const [branchId, setBranchId] = useState('')
  const [horizon, setHorizon] = useState('365')
  const [includeDraft, setIncludeDraft] = useState(true)
  const [includeUnassigned, setIncludeUnassigned] = useState(true)
  const [running, setRunning] = useState(false)

  const [tab, setTab] = useState<Tab>('orders')
  const [runs, setRuns] = useState<MrpRun[]>([])
  const [runDetail, setRunDetail] = useState<MrpRun | null>(null)
  const [orders, setOrders] = useState<PlannedOrder[]>([])
  const [exceptions, setExceptions] = useState<MrpException[]>([])
  const [excCode, setExcCode] = useState('')
  const [excLabels, setExcLabels] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState('open')
  const [procFilter, setProcFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [md04Item, setMd04Item] = useState<number | null>(null)

  const [editing, setEditing] = useState<PlannedOrder | null>(null)
  const [editForm, setEditForm] = useState({ quantity: '', start_date: '', finish_date: '', firmed: false })
  const [deleting, setDeleting] = useState<PlannedOrder | null>(null)
  const [converting, setConverting] = useState<PlannedOrder | null>(null)
  const [prOpen, setPrOpen] = useState(false)
  const [prForm, setPrForm] = useState({ category_code: '', priority: 'medium', save_as_draft: false, remarks: '' })
  const [prResult, setPrResult] = useState<PrConversionResult | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState({ item_id: '', quantity: '', finish_date: '', procurement: '', remarks: '' })
  const [itemOptions, setItemOptions] = useState<Lookup[]>([])
  const [busy, setBusy] = useState(false)

  const fail = (err: unknown, fallback: string) => setError(extractErrorMessages(err, fallback).join(' '))

  const loadOrders = useCallback(() => {
    mrpApi.listPlannedOrders({ status: statusFilter || 'all', procurement: procFilter || undefined, branch_id: branchId || undefined, search: search.trim() || undefined })
      .then((rows) => { setOrders(rows); setSelected((sel) => sel.filter((id) => rows.some((r) => r.id === id && r.status === 'open'))) })
      .catch((err) => fail(err, 'Failed to load planned orders.'))
  }, [statusFilter, procFilter, branchId, search])

  const loadRuns = useCallback(() => {
    mrpApi.listRuns(branchId ? { branch_id: branchId } : {}).then(async (rows) => {
      setRuns(rows)
      const last = rows.find((r) => r.status === 'completed')
      setRunDetail(last ? await mrpApi.getRun(last.id) : null)
    }).catch((err) => fail(err, 'Failed to load MRP runs.'))
  }, [branchId])

  useEffect(() => {
    if (!isAuthorized) return
    productionApi.lookupBranches().then(setBranches).catch(() => setBranches([]))
    mrpApi.parameters().then((p) => {
      setExcLabels(p.exception_labels)
      setHorizon(String(p.parameters.planning_horizon_days ?? 365))
      setIncludeDraft(!!p.parameters.include_draft_work_orders)
    }).catch(() => undefined)
  }, [isAuthorized])
  useEffect(() => { if (isAuthorized) loadOrders() }, [isAuthorized, loadOrders])
  useEffect(() => { if (isAuthorized) loadRuns() }, [isAuthorized, loadRuns])
  useEffect(() => {
    if (!isAuthorized) return
    mrpApi.exceptions({ run_id: runDetail?.id, code: excCode || undefined }).then(setExceptions).catch((err) => fail(err, 'Failed to load exception messages.'))
  }, [isAuthorized, runDetail, excCode])

  const runMrp = async () => {
    setRunning(true); setError(''); setNotice('')
    try {
      const run = await mrpApi.run({
        branch_id: branchId ? Number(branchId) : null, include_unassigned: branchId ? includeUnassigned : null,
        planning_horizon_days: Number(horizon) || null, include_draft_work_orders: includeDraft,
      })
      setNotice(`${run.run_number} completed: ${run.planned_orders_created} planned order(s) (${run.make_orders} make, ${run.buy_orders} buy), ${run.exceptions_count} exception message(s).`)
      setRunDetail(run)
      loadRuns(); loadOrders()
    } catch (err) { fail(err, 'The MRP run failed.') } finally { setRunning(false) }
  }

  const openEdit = (o: PlannedOrder) => {
    setEditing(o)
    setEditForm({ quantity: String(o.quantity), start_date: o.start_date, finish_date: o.finish_date, firmed: o.firmed })
  }
  const saveEdit = async () => {
    if (!editing) return
    setBusy(true); setError('')
    try {
      await mrpApi.updatePlannedOrder(editing.id, { quantity: Number(editForm.quantity), start_date: editForm.start_date, finish_date: editForm.finish_date, firmed: editForm.firmed })
      setEditing(null); loadOrders()
    } catch (err) { fail(err, 'Failed to save the planned order.') } finally { setBusy(false) }
  }
  const firm = async (ids: number[]) => {
    setError('')
    try { await mrpApi.firmPlannedOrders(ids); setNotice(`${ids.length} planned order(s) firmed — the next MRP run keeps them.`); loadOrders() }
    catch (err) { fail(err, 'Failed to firm the planned order(s).') }
  }
  const doDelete = async () => {
    if (!deleting) return
    const o = deleting
    setDeleting(null); setError('')
    try { await mrpApi.deletePlannedOrder(o.id); loadOrders() } catch (err) { fail(err, 'Failed to delete the planned order.') }
  }
  const doConvertWo = async () => {
    if (!converting) return
    const o = converting
    setConverting(null); setError(''); setBusy(true)
    try {
      const res = await mrpApi.convertToWorkOrder(o.id)
      setNotice(`${o.order_number} converted to draft work order ${res.converted_number}. Set its stores and release it from Work Orders.`)
      loadOrders()
    } catch (err) { fail(err, 'Failed to convert the planned order to a work order.') } finally { setBusy(false) }
  }
  const doConvertPr = async () => {
    setBusy(true); setError('')
    const ids = orders.filter((o) => selected.includes(o.id) && o.procurement === 'buy' && o.status === 'open').map((o) => o.id)
    try {
      const res = await mrpApi.convertToRequisition({ planned_order_ids: ids, category_code: prForm.category_code || null, priority: prForm.priority,
        save_as_draft: prForm.save_as_draft, remarks: prForm.remarks.trim() || null })
      setPrResult(res); setSelected([]); loadOrders()
    } catch (err) { fail(err, 'Failed to raise the purchase requisition.'); setPrOpen(false) } finally { setBusy(false) }
  }
  const searchItems = (q: string) => {
    productionApi.lookupItems({ search: q || undefined, limit: 50 }).then(setItemOptions).catch(() => setItemOptions([]))
  }
  useEffect(() => { if (newOpen) searchItems('') }, [newOpen])
  const createOrder = async () => {
    setBusy(true); setError('')
    try {
      await mrpApi.createPlannedOrder({ item_id: Number(newForm.item_id), quantity: Number(newForm.quantity), finish_date: newForm.finish_date,
        procurement: newForm.procurement || null, branch_id: branchId ? Number(branchId) : null, remarks: newForm.remarks.trim() || null })
      newDraft.clear()
      setNewOpen(false); setNewForm({ item_id: '', quantity: '', finish_date: '', procurement: '', remarks: '' }); loadOrders()
    } catch (err) { fail(err, 'Failed to create the planned order.') } finally { setBusy(false) }
  }

  const newDraft = useFormDraft(newOpen ? 'production-planned-order-new' : null, newForm,
    (d) => setNewForm({ item_id: d.item_id ?? '', quantity: d.quantity ?? '', finish_date: d.finish_date ?? '', procurement: d.procurement ?? '', remarks: d.remarks ?? '' }))

  const popupOpen = !!editing || prOpen || newOpen
  const openSelected = useMemo(() => orders.filter((o) => selected.includes(o.id) && o.status === 'open'), [orders, selected])
  const selectedBuy = openSelected.filter((o) => o.procurement === 'buy')
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  if (isLoading || !isAuthorized) return null

  const tabBtn = (key: Tab, label: string) => (
    <button key={key} type="button" onClick={() => setTab(key)} style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer',
      color: tab === key ? '#FF6A2A' : TEXT.secondary, borderBottom: tab === key ? '2px solid #FF6A2A' : '2px solid transparent' }}>{label}</button>
  )

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Production Planning</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Material Requirements Planning</h1>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '6px 0 0', maxWidth: 760 }}>
            MRP nets Sales Order schedules, RRV builds without work orders, work-order requirements and reservations against stock, open PR / PO and
            work-order receipts, level by level through the BOMs, and proposes planned orders: make → work order, buy → purchase requisition.
          </p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/production/planning')}>← Back</button>
      </div>

      {error && !popupOpen && errorBox(error)}
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}

      <div style={sectionStyle}>
        <p style={sectionTitle}>MRP Run</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <label style={labelStyle}>Plant</label>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inputStyle}>
              <option value="">Company-wide (all plants)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </Select>
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Horizon (days)</label>
            <input type="number" min={7} max={1825} value={horizon} onChange={(e) => setHorizon(e.target.value)} style={inputStyle} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, paddingBottom: 9 }}>
            <input type="checkbox" checked={includeDraft} onChange={(e) => setIncludeDraft(e.target.checked)} /> Count draft work orders
          </label>
          {branchId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, paddingBottom: 9 }} title="Sales orders, work orders and stores with no plant set">
              <input type="checkbox" checked={includeUnassigned} onChange={(e) => setIncludeUnassigned(e.target.checked)} /> Include documents without a plant
            </label>
          )}
          {canRunMrp && <button type="button" style={{ ...primaryBtnStyle, opacity: running ? 0.6 : 1 }} disabled={running} onClick={runMrp}>{running ? 'Running…' : 'Run MRP'}</button>}
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
          {runDetail ? `Last run ${runDetail.run_number} — ${runDetail.branch_name || 'Company-wide'}, ${formatDateTime(runDetail.finished_at)} by ${runDetail.run_by_name || '—'}: ${runDetail.items_planned} item(s), ${runDetail.planned_orders_created} planned order(s), ${runDetail.exceptions_count} exception(s).` : 'MRP has not been run yet for this plant.'}
          {' '}A run replaces the open planned orders of the previous run for the same plant; firmed and converted orders are kept.
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${BORDER.light}`, marginBottom: 14, flexWrap: 'wrap' }}>
          {tabBtn('orders', `Planned Orders (${orders.filter((o) => o.status === 'open').length})`)}
          {tabBtn('list', 'MRP List')}
          {tabBtn('exceptions', `Exceptions${runDetail ? ` · ${runDetail.exceptions_count}` : ''}`)}
          {tabBtn('log', 'Run Log')}
        </div>

        {tab === 'orders' && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <input placeholder="Search order, item or demand…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 300 }} />
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, flex: '0 1 140px' }}>
                <option value="open">Open</option><option value="converted">Converted</option><option value="all">All</option>
              </Select>
              <Select value={procFilter} onChange={(e) => setProcFilter(e.target.value)} style={{ ...inputStyle, flex: '0 1 130px' }}>
                <option value="">Make + buy</option><option value="make">Make</option><option value="buy">Buy</option>
              </Select>
              <div style={{ flex: 1 }} />
              {canEdit && openSelected.length > 0 && <button type="button" style={secondaryBtnStyle} onClick={() => firm(openSelected.map((o) => o.id))}>Firm selected ({openSelected.length})</button>}
              {canPr && selectedBuy.length > 0 && (
                <button type="button" style={primaryBtnStyle} onClick={() => { setPrResult(null); setPrOpen(true) }}>Convert to PR ({selectedBuy.length})</button>
              )}
              {canCreate && <button type="button" style={secondaryBtnStyle} onClick={() => setNewOpen(true)}>+ New planned order</button>}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
                <thead><tr>{['', 'Planned Order', 'Item', 'Type', 'Qty', 'Start', 'Finish', 'For (pegged demand)', 'Status', ''].map((h, i) => <th key={i} style={thStyle}>{h}{i === 0 && <RowCount count={orders.length} />}</th>)}</tr></thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No planned orders — run MRP to plan the open demand.</td></tr>
                  ) : orders.map((o) => {
                    const woPath = o.converted_type === 'work_order' ? safePath('/dashboard/production/work-orders', o, 'converted_ref_id') : null
                    const prPath = o.converted_type === 'purchase_requisition' ? safePath('/dashboard/p2p', o, 'converted_ref_id') : null
                    return (
                      <tr key={o.id}>
                        <td style={tdStyle}>{o.status === 'open' && canSelect && <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />}</td>
                        <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                          {o.order_number}
                          {o.firmed && <span style={{ ...pill('#16A34A'), marginLeft: 6 }}>Firmed</span>}
                          {o.source === 'manual' && <span style={{ ...pill('#78716c'), marginLeft: 6 }}>Manual</span>}
                        </td>
                        <td style={tdStyle}>
                          <span onClick={() => setMd04Item(o.item_id)} style={{ cursor: 'pointer', color: '#2563EB' }} title="Stock / requirements list">{o.item_code} — {o.item_name}</span>
                          {o.parent_order_number && <div style={{ fontSize: 11, color: TEXT.muted }}>component of {o.parent_order_number}</div>}
                        </td>
                        <td style={tdStyle}><span style={pill(PROC_HEX[o.procurement])}>{o.procurement === 'make' ? 'Make' : 'Buy'}</span></td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmt(o.quantity)} {o.uom || ''}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: o.start_in_past ? '#DC2626' : TEXT.body, fontWeight: o.start_in_past ? 700 : 400 }} title={o.start_in_past ? 'Start / order date is in the past' : ''}>{formatDate(o.start_date)}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(o.finish_date)}</td>
                        <td style={tdStyle}>
                          {o.demand_label || '—'}
                          {o.order_project_label && <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 2 }} title="Project unit">{o.order_project_label}</div>}
                        </td>
                        <td style={tdStyle}>
                          <span style={pill(STATUS_HEX[o.status] || '#78716c')}>{STATUS_LABELS[o.status] || o.status}</span>
                          {o.converted_number && (
                            <div style={{ fontSize: 11.5, marginTop: 4 }}>
                              {woPath || prPath ? <span style={{ color: '#2563EB', cursor: 'pointer' }} onClick={() => router.push((woPath || prPath) as string)}>{o.converted_number}</span> : o.converted_number}
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          {o.status === 'open' && (canEdit || canDeletePo || canToWo || canPr) && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {canEdit && <button type="button" style={smallBtn} onClick={() => openEdit(o)}>Change</button>}
                              {canEdit && !o.firmed && <button type="button" style={smallBtn} onClick={() => firm([o.id])}>Firm</button>}
                              {o.procurement === 'make' && canToWo && <button type="button" style={smallBtn} disabled={busy} onClick={() => setConverting(o)}>To WO</button>}
                              {o.procurement === 'buy' && canPr && <button type="button" style={smallBtn} onClick={() => { setSelected([o.id]); setPrResult(null); setPrOpen(true) }}>To PR</button>}
                              {canDeletePo && <button type="button" style={smallDangerBtnStyle} onClick={() => setDeleting(o)}>Delete</button>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'list' && (
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr>{['Level', 'Item', 'Type', 'Stock', 'Safety', 'Requirements', 'Receipts', 'Planned', 'Ending Available', 'Exceptions'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={runDetail?.item_results?.length ?? 0} />}</th>)}</tr></thead>
              <tbody>
                {!runDetail?.item_results?.length ? (
                  <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No MRP run yet for this plant.</td></tr>
                ) : runDetail.item_results.map((r) => (
                  <tr key={r.item_id} onClick={() => setMd04Item(r.item_id)} style={{ cursor: 'pointer' }}>
                    <td style={tdStyle}>{r.low_level_code}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.item_code} — {r.item_name}</td>
                    <td style={tdStyle}><span style={pill(PROC_HEX[r.procurement])}>{r.procurement === 'make' ? 'Make' : 'Buy'}</span></td>
                    <td style={tdStyle}>{fmt(r.stock)} {r.uom || ''}</td>
                    <td style={tdStyle}>{fmt(r.safety_stock)}</td>
                    <td style={tdStyle}>{fmt(r.requirements_qty)}</td>
                    <td style={tdStyle}>{fmt(r.receipts_qty)}</td>
                    <td style={tdStyle}>{r.planned_orders ? `${fmt(r.planned_qty)} (${r.planned_orders})` : '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: r.ending_available < 0 ? '#DC2626' : TEXT.heading }}>{fmt(r.ending_available)}</td>
                    <td style={tdStyle}>{r.exceptions ? <span style={pill('#F59E0B')}>{r.exceptions}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'exceptions' && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <Select value={excCode} onChange={(e) => setExcCode(e.target.value)} style={{ ...inputStyle, maxWidth: 320 }}>
                <option value="">All exception messages</option>
                {Object.entries(excLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead><tr>{['Exception', 'Item', 'Unit', 'Date', 'Suggested', 'Message'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={exceptions.length} />}</th>)}</tr></thead>
                <tbody>
                  {exceptions.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No exception messages in the last run.</td></tr>
                  ) : exceptions.map((e) => (
                    <tr key={e.id}>
                      <td style={tdStyle}><span style={pill(EXC_HEX[e.code] || '#78716c')}>{e.label || e.code}</span></td>
                      <td style={tdStyle}>{e.item_id ? <span style={{ color: '#2563EB', cursor: 'pointer' }} onClick={() => setMd04Item(e.item_id)}>{e.item_code} — {e.item_name}</span> : '—'}</td>
                      <td style={tdStyle}>{e.element_ref || '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{e.element_date ? formatDate(e.element_date) : '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{e.suggested_date ? formatDate(e.suggested_date) : '—'}</td>
                      <td style={tdStyle}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'log' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {runs.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No MRP runs yet.</p>}
            {runs.map((r) => (
              <div key={r.id} style={{ borderBottom: `1px solid ${BORDER.light}`, paddingBottom: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>
                  {r.run_number} · {r.branch_name || 'Company-wide'} · {formatDateTime(r.started_at)} · {r.run_by_name || '—'}{' '}
                  <span style={pill(r.status === 'completed' ? '#16A34A' : r.status === 'failed' ? '#DC2626' : '#F59E0B')}>{r.status}</span>
                </p>
                {r.log.map((l, i) => <p key={i} style={{ fontSize: 12.5, color: l.level === 'error' ? '#DC2626' : TEXT.secondary, margin: '2px 0' }}>{l.message}</p>)}
                {r.error && <p style={{ fontSize: 12.5, color: '#DC2626', margin: '2px 0' }}>{r.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <StockRequirementsDrawer itemId={md04Item} branchId={branchId ? Number(branchId) : null} onClose={() => setMd04Item(null)} />

      <ConfirmDialog open={!!deleting} title="Delete planned order?" message={deleting ? `${deleting.order_number} (${deleting.item_code}, ${fmt(deleting.quantity)} ${deleting.uom || ''}) will be removed. The next MRP run plans the demand again unless it is covered otherwise.` : ''}
        confirmLabel="Delete" onConfirm={doDelete} onCancel={() => setDeleting(null)} />
      <ConfirmDialog open={!!converting} danger={false} title="Convert to work order?" confirmLabel="Convert"
        message={converting ? `${converting.order_number} becomes a draft work order for ${fmt(converting.quantity)} ${converting.uom || ''} of ${converting.item_code}, ${formatDate(converting.start_date)} → ${formatDate(converting.finish_date)}, from the item's active BOM.` : ''}
        onConfirm={doConvertWo} onCancel={() => setConverting(null)} />

      {editing && (
        <FormSheet width={580} icon="edit" title={`Change ${editing.order_number}`} subtitle={`${editing.item_code} — ${editing.item_name}`}
          onClose={() => setEditing(null)} busy={busy}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" style={sheetBtn('primary', SHEET.BLUE, busy)} disabled={busy} onClick={saveEdit}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error && errorBox(error)}
            <SheetSection icon="calendar" title="Quantity & Dates">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 130px' }}><label style={sheetLabel}>Quantity</label><input type="number" min={0} value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} style={sheetInput} /></div>
                <div style={{ flex: '0 1 165px' }}><label style={sheetLabel}>Start</label><DateField value={editForm.start_date} onChange={(v) => setEditForm({ ...editForm, start_date: v })} /></div>
                <div style={{ flex: '0 1 165px' }}><label style={sheetLabel}>Finish</label><DateField value={editForm.finish_date} onChange={(v) => setEditForm({ ...editForm, finish_date: v })} /></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, marginTop: 14 }}>
                <input type="checkbox" checked={editForm.firmed} onChange={(e) => setEditForm({ ...editForm, firmed: e.target.checked })} /> Firmed (kept by the next MRP run)
              </label>
              <p style={sheetHint}>Changing the quantity or a date firms the order automatically.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {prOpen && (
        <FormSheet width={580} icon="cart" title="Convert to purchase requisition"
          subtitle={prResult ? 'Result of the conversion.' : `${selectedBuy.length} buy planned order(s) → one requisition per category and project.`}
          onClose={() => { setPrOpen(false); setPrResult(null) }} busy={busy}
          footer={prResult ? (
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => { setPrOpen(false); setPrResult(null) }}>Close</button>
          ) : (<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setPrOpen(false)}>Cancel</button>
            <button type="button" style={sheetBtn('primary', SHEET.BLUE, busy || selectedBuy.length === 0)} disabled={busy || selectedBuy.length === 0} onClick={doConvertPr}><SheetIcon name="send" size={16} />{busy ? 'Raising…' : 'Raise PR'}</button>
          </>)}>
          <div style={{ padding: '20px 24px' }}>
            {prResult ? (
              <>
                {prResult.created.map((c) => (
                  <p key={c.pr_id} style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 8px' }}>
                    <b>{c.p2p_number}</b> ({c.status.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}) — {c.project_label}, {c.category_code}: {c.planned_orders.join(', ')}
                  </p>
                ))}
                {prResult.errors.map((e, i) => <div key={i}>{errorBox(`${e.planned_orders.join(', ')}: ${typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)}`)}</div>)}
              </>
            ) : (
              <>
                {error && errorBox(error)}
                <p style={{ ...sheetHint, margin: '0 0 16px' }}>
                  Lines come from the Item Master. It goes to the Purchase Requisition approvers set in Organization › Approval Workflows unless saved as a draft.
                </p>
                <SheetSection icon="tag" title="Requisition">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 220px' }}>
                      <label style={sheetLabel}>PR Category</label>
                      <Select value={prForm.category_code} onChange={(e) => setPrForm({ ...prForm, category_code: e.target.value })} style={sheetInput}>
                        {Object.entries(PR_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </div>
                    <div style={{ flex: '0 1 140px' }}>
                      <label style={sheetLabel}>Priority</label>
                      <Select value={prForm.priority} onChange={(e) => setPrForm({ ...prForm, priority: e.target.value })} style={sheetInput}>
                        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                      </Select>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, marginTop: 14 }}>
                    <input type="checkbox" checked={prForm.save_as_draft} onChange={(e) => setPrForm({ ...prForm, save_as_draft: e.target.checked })} /> Save as draft (submit from Procurement later)
                  </label>
                </SheetSection>
                <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                  <textarea value={prForm.remarks} onChange={(e) => setPrForm({ ...prForm, remarks: e.target.value })} rows={2} style={{ ...sheetInput, resize: 'vertical' }} />
                </SheetSection>
              </>
            )}
          </div>
        </FormSheet>
      )}

      {newOpen && (
        <FormSheet width={580} icon="plus" title="New planned order" subtitle="A manual, firmed planned order for one item." onClose={() => setNewOpen(false)} busy={busy}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setNewOpen(false)}>Cancel</button>
            <button type="button" style={sheetBtn('primary', SHEET.BLUE, busy || !newForm.item_id || !newForm.quantity || !newForm.finish_date)} disabled={busy || !newForm.item_id || !newForm.quantity || !newForm.finish_date} onClick={createOrder}>
              <SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Create'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <DraftBanner draft={newDraft} />
            {error && errorBox(error)}
            <SheetSection icon="box" title="Item & Quantity">
              <label style={sheetLabel}>Item <Req /></label>
              <SearchableSelect value={newForm.item_id} onChange={(v) => setNewForm({ ...newForm, item_id: v })} placeholder="Search the Item Master…"
                options={itemOptions.map((i) => ({ value: String(i.id), label: i.label }))} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <div style={{ flex: '0 1 130px' }}><label style={sheetLabel}>Quantity <Req /></label><input type="number" min={0} value={newForm.quantity} onChange={(e) => setNewForm({ ...newForm, quantity: e.target.value })} style={sheetInput} /></div>
                <div style={{ flex: '0 1 175px' }}><label style={sheetLabel}>Needed by (finish) <Req /></label><DateField value={newForm.finish_date} onChange={(v) => setNewForm({ ...newForm, finish_date: v })} /></div>
                <div style={{ flex: '0 1 150px' }}>
                  <label style={sheetLabel}>Procurement</label>
                  <Select value={newForm.procurement} onChange={(e) => setNewForm({ ...newForm, procurement: e.target.value })} style={sheetInput}>
                    <option value="">From BOM</option><option value="make">Make</option><option value="buy">Buy</option>
                  </Select>
                </div>
              </div>
              <p style={sheetHint}>Manual planned orders are firmed; the start date is back-scheduled from the lead time{branchId ? ' for the selected plant' : ''}.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <input value={newForm.remarks} onChange={(e) => setNewForm({ ...newForm, remarks: e.target.value })} style={sheetInput} />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
