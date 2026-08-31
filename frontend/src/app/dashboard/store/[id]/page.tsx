'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StockItem, StoreLocation, StockTransaction } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Field, InfoRow, Row, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'

const primaryBtn = primaryBtnStyle
const ghostBtn = secondaryBtnStyle

export default function StockItemDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const params = useParams()
  const router = useRouter()
  const itemId = Number(params.id)

  const [item, setItem] = useState<StockItem | null>(null)
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [txns, setTxns] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activePanel, setActivePanel] = useState<'' | 'in' | 'issue' | 'transfer'>('')

  const [locationId, setLocationId] = useState('')
  const [destLocationId, setDestLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [remarks, setRemarks] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [data, txnList] = await Promise.all([
        storeApi.getItem(itemId),
        storeApi.listTransactions({ stock_item_id: itemId }),
      ])
      setItem(data)
      setTxns(txnList)
    } catch {
      setError('Stock item not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && itemId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, itemId])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listLocations().then(setLocations).catch(() => {})
  }, [isAuthorized])

  const reset = () => { setLocationId(''); setDestLocationId(''); setQuantity(''); setRemarks(''); setActivePanel('') }

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      reset()
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const doStockIn = () => {
    if (!locationId || !quantity) { setError('Select a location and quantity.'); return }
    runAction(() => storeApi.stockIn({ stock_item_id: itemId, location_id: Number(locationId), quantity: Number(quantity), remarks: remarks || undefined }))
  }
  const doIssue = () => {
    if (!locationId || !quantity) { setError('Select a location and quantity.'); return }
    runAction(() => storeApi.issue({ stock_item_id: itemId, location_id: Number(locationId), quantity: Number(quantity), remarks: remarks || undefined }))
  }
  const doTransfer = () => {
    if (!locationId || !destLocationId || !quantity) { setError('Select source, destination, and quantity.'); return }
    if (locationId === destLocationId) { setError('Source and destination must differ.'); return }
    runAction(() => storeApi.transfer({ stock_item_id: itemId, source_location_id: Number(locationId), destination_location_id: Number(destLocationId), quantity: Number(quantity), remarks: remarks || undefined }))
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !item) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!item) return null

  const low = item.quantity_on_hand <= item.reorder_point

  return (
    <div>
      <button onClick={() => router.push('/dashboard/store')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to Stock Items
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{item.description}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: low ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.1)', color: low ? '#dc2626' : '#16a34a' }}>
              {item.quantity_on_hand} on hand
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{item.part_code} · {item.category || 'Uncategorized'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => setActivePanel(activePanel === 'in' ? '' : 'in')} style={ghostBtn}>Stock In</button>
          <button disabled={busy} onClick={() => setActivePanel(activePanel === 'issue' ? '' : 'issue')} style={ghostBtn}>Issue</button>
          <button disabled={busy} onClick={() => setActivePanel(activePanel === 'transfer' ? '' : 'transfer')} style={ghostBtn}>Transfer</button>
          {low && (
            <button
              onClick={() => {
                const params = new URLSearchParams({
                  item_name: item.description,
                  make: item.make || '',
                  part_code: item.part_code,
                  unit: item.unit || '',
                  quantity: String(item.reorder_quantity || 1),
                  category: item.category || '',
                })
                router.push(`/dashboard/p2p/new?${params.toString()}`)
              }}
              style={primaryBtn}
            >
              Raise Procure-to-Pay Request
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {activePanel && (
        <Section title={activePanel === 'in' ? 'Stock In' : activePanel === 'issue' ? 'Issue Stock' : 'Transfer Stock'} style={{ marginBottom: 20 }}>
          <Row>
            <Field label={activePanel === 'transfer' ? 'Source Location' : 'Location'}>
              <SearchableSelect
                value={locationId}
                onChange={setLocationId}
                options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
                placeholder="Search location…"
              />
            </Field>
            {activePanel === 'transfer' && (
              <Field label="Destination Location">
                <SearchableSelect
                  value={destLocationId}
                  onChange={setDestLocationId}
                  options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
                  placeholder="Search location…"
                />
              </Field>
            )}
            <Field label="Quantity">
              <input type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label="Remarks">
              <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </Row>
          <button disabled={busy} onClick={activePanel === 'in' ? doStockIn : activePanel === 'issue' ? doIssue : doTransfer} style={primaryBtn}>
            {activePanel === 'in' ? 'Post Stock In' : activePanel === 'issue' ? 'Post Issue' : 'Post Transfer'}
          </button>
        </Section>
      )}

      <Section title="Item Details" style={{ marginBottom: 20 }}>
        <Row>
          <InfoRow label="Make" value={item.make || '—'} />
          <InfoRow label="UOM" value={item.unit || '—'} />
          <InfoRow label="Reorder Point" value={String(item.reorder_point)} />
          <InfoRow label="Reorder Quantity" value={String(item.reorder_quantity)} />
          <InfoRow label="Standard Cost" value={item.standard_cost != null ? String(item.standard_cost) : '—'} />
          <InfoRow label="Status" value={item.status} />
        </Row>
      </Section>

      <Section title="Transaction History" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              {['Date', 'Type', 'Location', 'Quantity', 'Reference', 'By', 'Remarks'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No transactions yet.</td></tr>
            )}
            {txns.map((t) => (
              <tr key={t.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, textTransform: 'capitalize' }}>{t.type.replace('_', ' ')}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{t.location_name || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: t.quantity < 0 ? '#dc2626' : '#16a34a' }}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary }}>{t.reference_type || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary }}>{t.performed_by_name || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary }}>{t.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}
