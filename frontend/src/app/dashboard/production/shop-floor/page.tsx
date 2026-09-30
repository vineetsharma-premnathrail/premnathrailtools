'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionLookupOption, ProductionQueueEntry } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }
const OP_STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress' }
const OP_STATUS_HEX: Record<string, string> = { pending: '#78716c', in_progress: '#F59E0B' }
const INSP_LABELS: Record<string, string> = { pending: 'Inspection pending', in_progress: 'Inspecting', passed: 'Passed', failed: 'Failed — rework', conditionally_passed: 'Passed (conditional)' }
const INSP_HEX: Record<string, string> = { pending: '#F59E0B', in_progress: '#2563EB', passed: '#16A34A', failed: '#DC2626', conditionally_passed: '#0d9488' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const cardStyle: React.CSSProperties = {
  borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 16,
}
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }
const primarySmall: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 12, fontWeight: 600,
}
const today = () => new Date().toISOString().slice(0, 10)
const fetchQueue = (wsFilter: string): Promise<ProductionQueueEntry[]> =>
  productionApi.getShopFloorQueue(wsFilter ? { workstation_id: Number(wsFilter) } : {})

export default function ShopFloorPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()

  const [queue, setQueue] = useState<ProductionQueueEntry[]>([])
  const [workstations, setWorkstations] = useState<ProductionLookupOption[]>([])
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  const [wsFilter, setWsFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [logFor, setLogFor] = useState<ProductionQueueEntry | null>(null)
  const [logDate, setLogDate] = useState(today())
  const [logHours, setLogHours] = useState('')
  const [logGood, setLogGood] = useState('0')
  const [logScrap, setLogScrap] = useState('0')
  const [logOperator, setLogOperator] = useState('')
  const [logRemarks, setLogRemarks] = useState('')

  const load = useCallback(() => fetchQueue(wsFilter)
    .then(setQueue)
    .catch((err) => setError(extractErrorMessages(err, 'Failed to load the shop-floor queue.')))
    .finally(() => setLoading(false)), [wsFilter])

  useEffect(() => {
    if (!isAuthorized) return
    let cancelled = false
    fetchQueue(wsFilter)
      .then((rows) => { if (!cancelled) setQueue(rows) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load the shop-floor queue.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isAuthorized, wsFilter])

  useEffect(() => {
    if (!isAuthorized) return
    productionApi.lookupWorkstations().then(setWorkstations).catch(() => setWorkstations([]))
    productionApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
  }, [isAuthorized])

  const grouped = useMemo(() => {
    const groups = new Map<string, ProductionQueueEntry[]>()
    for (const q of queue) {
      const key = q.workstation_name || 'Unassigned'
      groups.set(key, [...(groups.get(key) || []), q])
    }
    return Array.from(groups.entries())
  }, [queue])

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

  const openLog = (q: ProductionQueueEntry) => {
    setLogFor(q)
    setLogDate(today())
    setLogHours('')
    setLogGood('0')
    setLogScrap('0')
    setLogOperator('')
    setLogRemarks('')
  }

  const submitLog = async () => {
    if (!logFor) return
    const hours = Number(logHours)
    if (!(hours > 0) || hours > 24) { setError('Hours must be more than 0 and at most 24.'); return }
    const ok = await act(() => productionApi.createTimeLog({
      work_order_id: logFor.work_order_id, operation_id: logFor.operation_id, log_date: logDate, hours,
      qty_good: Number(logGood) || 0, qty_scrap: Number(logScrap) || 0,
      operator_id: logOperator ? Number(logOperator) : null, remarks: logRemarks.trim() || null,
    }), 'Failed to book time.', `Booked ${hours} h on ${logFor.wo_number} · ${logFor.operation_name}.`)
    if (ok) setLogFor(null)
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Shop Floor</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '4px 0 0' }}>Open operations on released work orders — running first, then by priority and due date.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 260 }}>
            <SearchableSelect value={wsFilter} onChange={setWsFilter} placeholder="All workstations"
              options={[{ value: '', label: 'All workstations' }, ...workstations.map((w) => ({ value: String(w.id), label: w.label }))]} />
          </div>
          <button type="button" style={secondaryBtnStyle} onClick={load} disabled={loading}>Refresh</button>
        </div>
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

      {logFor && (
        <div style={{ ...cardStyle, marginBottom: 18, border: '1px solid rgba(255,106,42,0.35)' }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 10px' }}>
            Log Time — {logFor.wo_number} · {logFor.sequence} {logFor.operation_name}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={labelStyle}>Date</label>
              <DateField value={logDate} onChange={setLogDate} />
            </div>
            <div style={{ flex: '0 1 100px', minWidth: 90 }}>
              <label style={labelStyle}>Hours *</label>
              <input style={inputStyle} type="number" min={0} max={24} step="0.25" value={logHours} onChange={(e) => setLogHours(e.target.value)} autoFocus />
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
              <SearchableSelect value={logOperator} onChange={setLogOperator} options={[{ value: '', label: '— Me —' }, ...users.map((u) => ({ value: String(u.id), label: u.label }))]} />
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 320 }}>
              <label style={labelStyle}>Remarks</label>
              <input style={inputStyle} value={logRemarks} onChange={(e) => setLogRemarks(e.target.value)} />
            </div>
            <button type="button" style={secondaryBtnStyle} onClick={() => setLogFor(null)}>Cancel</button>
            <button type="button" disabled={busy} style={{ ...primarySmall, padding: '10px 18px', fontSize: 13 }} onClick={submitLog}>Book Time</button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : queue.length === 0 ? (
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open operations. Release a work order to put its routing on the shop floor.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {grouped.map(([wsName, entries]) => (
            <div key={wsName}>
              <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>
                {wsName} <span style={{ fontWeight: 500, color: TEXT.muted }}>· {entries.length} operation(s) · {entries.reduce((s, e) => s + Math.max(e.planned_hours - e.actual_hours, 0), 0).toFixed(1)} h remaining</span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {entries.map((q) => {
                  const passed = q.inspection_status === 'passed' || q.inspection_status === 'conditionally_passed'
                  const canRequest = q.requires_inspection && (!q.inspection_status || q.inspection_status === 'failed')
                  const hoursPct = q.planned_hours ? Math.min((q.actual_hours / q.planned_hours) * 100, 100) : 0
                  return (
                    <div key={q.operation_id} style={{ ...cardStyle, borderLeft: `4px solid ${PRIORITY_HEX[q.priority]}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <p onClick={() => router.push(`/dashboard/production/work-orders/${q.work_order_id}`)} style={{ fontSize: 13, fontWeight: 700, color: '#FF6A2A', margin: 0, cursor: 'pointer' }}>{q.wo_number}</p>
                          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT.heading, margin: '2px 0 0' }}>{q.sequence} · {q.operation_name}</p>
                          <p style={{ fontSize: 12, color: TEXT.secondary, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {q.product_name} × {q.quantity_planned}{q.project_label ? ` · ${q.project_label}` : ''}
                          </p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <span style={pill(OP_STATUS_HEX[q.status])}>{OP_STATUS_LABELS[q.status] || q.status}</span>
                          <span style={pill(PRIORITY_HEX[q.priority])}>{PRIORITY_LABELS[q.priority]}</span>
                        </div>
                      </div>
                      {q.instructions && <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>{q.instructions}</p>}
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: TEXT.muted, marginBottom: 4 }}>
                          <span>{q.actual_hours} / {q.planned_hours} h</span>
                          <span>Good {q.qty_good}{q.qty_scrap ? ` · Scrap ${q.qty_scrap}` : ''}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                          <div style={{ width: `${hoursPct}%`, height: '100%', background: q.actual_hours > q.planned_hours ? '#DC2626' : '#F59E0B' }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap', fontSize: 11.5, color: TEXT.muted }}>
                        {q.planned_end_date && <span style={{ color: q.is_overdue ? '#DC2626' : TEXT.muted }}>Due {formatDate(q.planned_end_date)}{q.is_overdue ? ' · overdue' : ''}</span>}
                        {q.requires_inspection && (
                          <span style={pill(q.inspection_status ? INSP_HEX[q.inspection_status] : '#78716c')}>
                            {q.inspection_status ? INSP_LABELS[q.inspection_status] : 'Quality gate'}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                        {q.status === 'pending' && (
                          <button type="button" disabled={busy} style={smallBtn} onClick={() => act(() => productionApi.startOperation(q.work_order_id, q.operation_id), 'Failed to start operation.', `${q.operation_name} started.`)}>Start</button>
                        )}
                        <button type="button" disabled={busy} style={primarySmall} onClick={() => openLog(q)}>Log Time</button>
                        {canRequest && (
                          <button type="button" disabled={busy} style={smallBtn}
                            onClick={() => act(() => productionApi.requestInspection(q.work_order_id, q.operation_id), 'Failed to request inspection.', 'Inspection requested — Quality has been notified.')}>
                            {q.inspection_status === 'failed' ? 'Re-inspect' : 'Request Inspection'}
                          </button>
                        )}
                        <button type="button" disabled={busy || (q.requires_inspection && !passed)}
                          style={{ ...smallBtn, opacity: q.requires_inspection && !passed ? 0.5 : 1 }}
                          title={q.requires_inspection && !passed ? 'Needs a passed Quality inspection first' : ''}
                          onClick={() => act(() => productionApi.completeOperation(q.work_order_id, q.operation_id), 'Failed to complete operation.', `${q.operation_name} completed.`)}>
                          Complete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
