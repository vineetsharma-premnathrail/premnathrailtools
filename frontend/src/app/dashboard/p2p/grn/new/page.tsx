'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi, storeApi } from '@/lib/api'
import { P2PReceivablePurchaseOrder, StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}

export default function NewGoodsReceiptPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPoId = searchParams.get('po_id')

  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const [pos, setPos] = useState<P2PReceivablePurchaseOrder[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [poId, setPoId] = useState(initialPoId || '')
  const [storeLocationId, setStoreLocationId] = useState('')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [receivedQty, setReceivedQty] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    goodsReceiptsApi.listPendingPurchaseOrders().then(setPos).catch(() => {})
    storeApi.listLocations().then(setLocations).catch(() => {})
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null
  if (!isPurchaseTeam) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Only the Purchase team can record a goods receipt.</p>

  const selectedPo = pos.find((p) => String(p.id) === poId)

  const save = async () => {
    setError('')
    if (!poId) { setError('Select a purchase order.'); return }
    const items = (selectedPo?.items || [])
      .map((it) => ({ po_item_id: it.id, received_quantity: Number(receivedQty[it.id] || 0) }))
      .filter((it) => it.received_quantity > 0)
    if (items.length === 0) { setError('Enter a received quantity for at least one item.'); return }

    setBusy(true)
    try {
      const grn = await goodsReceiptsApi.create({
        purchase_order_id: Number(poId),
        store_location_id: storeLocationId ? Number(storeLocationId) : undefined,
        received_date: receivedDate,
        remarks: remarks.trim() || undefined,
        items,
      })
      router.push(`/dashboard/p2p/grn/${grn.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to record goods receipt.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Record Goods Receipt</h1>
        </div>
        <button onClick={() => router.push('/dashboard/p2p/grn')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ flex: '1 1 320px', minWidth: 260 }}>
            <label style={labelStyle}>Purchase Order *</label>
            <SearchableSelect
              value={poId}
              onChange={(v) => { setPoId(v); setReceivedQty({}) }}
              options={pos.map((p) => ({ value: String(p.id), label: `${p.po_number} — ${p.vendor_name || 'No vendor'}${p.p2p_number ? ` (${p.p2p_number})` : ''}` }))}
              placeholder="Search a purchase order awaiting receipt…"
            />
          </div>
          <div style={{ flex: '0 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Store Location</label>
            <select style={inputStyle} value={storeLocationId} onChange={(e) => setStoreLocationId(e.target.value)}>
              <option value="">-- None --</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Received Date *</label>
            <DateField value={receivedDate} onChange={setReceivedDate} />
          </div>
        </div>
      </div>

      {selectedPo && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Line Items</h2>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
              <thead>
                <tr>
                  {['Item', 'Unit', 'Ordered Qty', 'Received Qty *'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, borderBottom: `1px solid ${BORDER.normal}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedPo.items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.item_name}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.unit || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.quantity}</td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      <input
                        type="number" min={0} max={it.quantity} step="any"
                        value={receivedQty[it.id] || ''}
                        onChange={(e) => setReceivedQty((q) => ({ ...q, [it.id]: e.target.value }))}
                        style={{ ...inputStyle, width: 110 }}
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Delivery note reference, condition on arrival, etc." />
          </div>

          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
            Quality inspection (accepted/rejected quantities) is recorded as a separate step after this receipt is saved.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button disabled={busy || !selectedPo} onClick={save} style={primaryBtn}>{busy ? 'Saving…' : 'Save Goods Receipt'}</button>
        <button disabled={busy} onClick={() => router.push('/dashboard/p2p/grn')} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </div>
  )
}
