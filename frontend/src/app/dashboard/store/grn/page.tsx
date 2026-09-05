'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StockItem, StoreLocation, StockTransaction } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, SUCCESS } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Field, Row, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'

export default function StoreGrnPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [items, setItems] = useState<StockItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [receipts, setReceipts] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [stockItemId, setStockItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const txns: StockTransaction[] = await storeApi.listTransactions({ limit: 500 })
      setReceipts(txns.filter((t) => t.type === 'receipt'))
    } catch {
      setError('Failed to load GRN entries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    load()
    storeApi.listItems().then(setItems).catch(() => {})
    storeApi.listLocations().then(setLocations).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const resetForm = () => {
    setStockItemId(''); setLocationId(''); setQuantity(''); setRemarks('')
    setFormError('')
    setShowForm(false)
  }

  const handleCreate = async () => {
    setFormError('')
    if (!stockItemId || !locationId || !quantity) { setFormError('Item, location, and quantity are required.'); return }
    setSubmitting(true)
    try {
      await storeApi.stockIn({
        stock_item_id: Number(stockItemId),
        location_id: Number(locationId),
        quantity: Number(quantity),
        remarks: remarks || undefined,
      })
      resetForm()
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFormError(err.response?.data?.detail || 'Failed to post GRN entry.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>G.R.N</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{receipts.length} receipt(s)</p>
        </div>
        {showForm ? (
          <button onClick={resetForm} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            style={{ ...primaryBtnStyle, padding: '12px 22px', fontSize: 14, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
          >
            + New GRN Entry
          </button>
        )}
      </div>

      {(error || formError) && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error || formError}
        </div>
      )}

      {showForm ? (
        <div style={{ width: '100%' }}>
          <Section title="Goods Receipt Details" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Stock Item *">
                <SearchableSelect
                  value={stockItemId}
                  onChange={setStockItemId}
                  options={items.map((i) => ({ value: String(i.id), label: `${i.part_code} — ${i.description}` }))}
                  placeholder="Search item…"
                />
              </Field>
              <Field label="Location *">
                <SearchableSelect
                  value={locationId}
                  onChange={setLocationId}
                  options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
                  placeholder="Search location…"
                />
              </Field>
              <Field label="Quantity *">
                <input type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field label="Remarks">
                <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </Row>
          </Section>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={resetForm} disabled={submitting} type="button" style={secondaryBtnStyle}>
              Cancel
            </button>
            <button onClick={handleCreate} disabled={submitting} type="button" style={{ ...primaryBtnStyle, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Posting…' : 'Post GRN Entry'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Date', 'Item', 'Location', 'Quantity', 'Reference', 'By', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
                {!loading && receipts.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No GRN entries yet.</td></tr>
                )}
                {receipts.map((t) => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13 }}>{t.stock_item_description || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: TEXT.secondary }}>{t.location_name || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: SUCCESS.text }}>{`+${t.quantity}`}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary }}>{t.reference_type || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary }}>{t.performed_by_name || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary }}>{t.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
