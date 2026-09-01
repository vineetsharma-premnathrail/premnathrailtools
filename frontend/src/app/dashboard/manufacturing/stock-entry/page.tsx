'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { manufacturingApi } from '@/lib/api'
import { Material, StockEntry, WorkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import ManufacturingNav from '@/components/manufacturing/ManufacturingNav'
import { Field, Row3, Section, inputStyle, primaryBtnStyle } from '@/components/shared/ui'

const TYPE_LABELS: Record<string, string> = { receipt: 'Receipt', issue: 'Issue', adjustment: 'Adjustment' }
const TYPE_HEX: Record<string, string> = { receipt: '#059669', issue: '#dc2626', adjustment: '#a16207' }

export default function ManufacturingStockEntryPage() {
  const { isAuthorized, isLoading } = useRequireApp('manufacturing')
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [materialId, setMaterialId] = useState('')
  const [type, setType] = useState('receipt')
  const [quantity, setQuantity] = useState('')
  const [workOrderId, setWorkOrderId] = useState('')
  const [remarks, setRemarks] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [e, m, w] = await Promise.all([manufacturingApi.listStockEntries(), manufacturingApi.listMaterials(), manufacturingApi.listWorkOrders()])
      setEntries(e)
      setMaterials(m)
      setWorkOrders(w)
    } catch {
      setError('Failed to load stock entries.')
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
    if (!materialId || !quantity) { setError('Material and quantity are required.'); return }
    setBusy(true)
    try {
      await manufacturingApi.createStockEntry({
        material_id: Number(materialId),
        type,
        quantity: Number(quantity),
        work_order_id: workOrderId ? Number(workOrderId) : undefined,
        remarks: remarks || undefined,
      })
      setMaterialId(''); setQuantity(''); setWorkOrderId(''); setRemarks('')
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create stock entry.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Manufacturing
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Stock Entry</h1>

      <ManufacturingNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Add Stock Entry" style={{ marginBottom: 20 }}>
        <Row3>
          <Field label="Material *">
            <select style={inputStyle} value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Select material</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Type *">
            <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="receipt">Receipt</option>
              <option value="issue">Issue</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </Field>
          <Field label="Quantity *">
            <input type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </Row3>
        <Row3>
          <Field label="Work Order">
            <select style={inputStyle} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">—</option>
              {workOrders.map((w) => (
                <option key={w.id} value={w.id}>{w.wo_number}</option>
              ))}
            </select>
          </Field>
          <Field label="Remarks">
            <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </Row3>
        <button disabled={busy} onClick={create} style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add Stock Entry'}
        </button>
      </Section>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Material', 'Type', 'Quantity', 'Work Order', 'Remarks', 'By'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stock entries yet.</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{e.material_code} — {e.material_name}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${TYPE_HEX[e.type]}1a`, color: TYPE_HEX[e.type], whiteSpace: 'nowrap' }}>
                    {TYPE_LABELS[e.type] || e.type}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{e.quantity}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{e.wo_number || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{e.remarks || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{e.created_by_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
