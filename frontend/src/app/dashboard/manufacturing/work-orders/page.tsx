'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { manufacturingApi } from '@/lib/api'
import { BOM, WorkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import ManufacturingNav from '@/components/manufacturing/ManufacturingNav'
import { Field, Row3, Section, inputStyle, primaryBtnStyle } from '@/components/shared/ui'

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  planned: '#a16207',
  in_progress: '#0284c7',
  completed: '#059669',
  cancelled: '#94a3b8',
}

export default function ManufacturingWorkOrdersPage() {
  const { isAuthorized, isLoading } = useRequireApp('manufacturing')
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [boms, setBoms] = useState<BOM[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [bomId, setBomId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [remarks, setRemarks] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [w, b] = await Promise.all([manufacturingApi.listWorkOrders(), manufacturingApi.listBOMs()])
      setWorkOrders(w)
      setBoms(b)
    } catch {
      setError('Failed to load work orders.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const create = async () => {
    setError('')
    if (!bomId || !quantity) { setError('BOM and quantity are required.'); return }
    setBusy(true)
    try {
      await manufacturingApi.createWorkOrder({ bom_id: Number(bomId), quantity: Number(quantity), remarks: remarks || undefined })
      setBomId(''); setQuantity('1'); setRemarks('')
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create work order.')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (wo: WorkOrder, status: string) => {
    try {
      await manufacturingApi.updateWorkOrder(wo.id, { status })
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to update work order.')
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ManufacturingNav />

      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Manufacturing
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Work Order</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Add Work Order" style={{ marginBottom: 20 }}>
        <Row3>
          <Field label="BOM *">
            <select style={inputStyle} value={bomId} onChange={(e) => setBomId(e.target.value)}>
              <option value="">Select BOM</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Quantity *">
            <input type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Remarks">
            <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </Row3>
        <button disabled={busy} onClick={create} style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add Work Order'}
        </button>
      </Section>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['WO Number', 'BOM', 'Quantity', 'Status', 'Created By', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && workOrders.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No work orders yet.</td></tr>
            )}
            {workOrders.map((w) => (
              <tr key={w.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{w.wo_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{w.bom_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{w.quantity}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[w.status]}1a`, color: STATUS_HEX[w.status], whiteSpace: 'nowrap' }}>
                    {STATUS_LABELS[w.status] || w.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{w.created_by_name || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  {w.status === 'planned' && (
                    <button onClick={() => setStatus(w, 'in_progress')} style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'rgba(2,132,199,0.1)', color: '#0284c7', cursor: 'pointer' }}>
                      Start
                    </button>
                  )}
                  {w.status === 'in_progress' && (
                    <button onClick={() => setStatus(w, 'completed')} style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'rgba(5,150,105,0.1)', color: '#059669', cursor: 'pointer' }}>
                      Complete
                    </button>
                  )}
                  {(w.status === 'planned' || w.status === 'in_progress') && (
                    <button onClick={() => setStatus(w, 'cancelled')} style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'rgba(220,38,38,0.08)', color: '#b91c1c', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
