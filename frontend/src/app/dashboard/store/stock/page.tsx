'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockBalance, StoreStockTransaction } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

const MANUAL_TXN_TYPES = [
  { value: 'receipt', label: 'Receipt — stock coming in' },
  { value: 'issue', label: 'Issue — stock going out' },
  { value: 'adjustment_in', label: 'Adjustment (increase)' },
  { value: 'adjustment_out', label: 'Adjustment (decrease)' },
  { value: 'damage', label: 'Damage / write-off' },
]

const TXN_TYPE_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  return_in: 'Return (in)',
  return_out: 'Return (out)',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  adjustment_in: 'Adjustment (+)',
  adjustment_out: 'Adjustment (-)',
  damage: 'Damage',
}

// Tells the reader what kind of document the reference number is.
const REF_TYPE_LABELS: Record<string, string> = {
  p2p_request: 'PR', grn: 'GRN', material_issue: 'Issue', material_return: 'Return',
  stock_adjustment: 'Adjustment', stock_transfer: 'Transfer', maintenance_work_order: 'Work Order',
}

export default function StoreStockPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [balances, setBalances] = useState<StoreStockBalance[]>([])
  const [transactions, setTransactions] = useState<StoreStockTransaction[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [txnType, setTxnType] = useState('receipt')
  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [b, t, i, l] = await Promise.all([
        storeApi.listStockBalances(),
        storeApi.listStockTransactions(),
        storeApi.listItems(),
        storeApi.listLocations(),
      ])
      setBalances(b)
      setTransactions(t)
      setItems(i)
      setLocations(l)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load stock data.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const openModal = () => {
    setTxnType('receipt')
    setItemId('')
    setLocationId('')
    setQuantity('')
    setBatchNumber('')
    setReferenceNumber('')
    setRemarks('')
    setFormErrors([])
    setShowModal(true)
  }

  const handleCreate = async () => {
    const problems: string[] = []
    if (!itemId) problems.push('Item is required.')
    if (!locationId) problems.push('Warehouse is required.')
    if (!quantity || Number(quantity) <= 0) problems.push('Quantity must be greater than zero.')
    if (problems.length) {
      setFormErrors(problems)
      return
    }
    setSaving(true)
    setFormErrors([])
    try {
      await storeApi.createStockTransaction({
        item_id: Number(itemId),
        location_id: Number(locationId),
        transaction_type: txnType,
        quantity: Number(quantity),
        batch_number: batchNumber.trim() || undefined,
        reference_number: referenceNumber.trim() || undefined,
        remarks: remarks.trim() || undefined,
      })
      setShowModal(false)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, 'Failed to post stock entry.'))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stock</h1>
        </div>
        <button data-tour="stock-add-btn" onClick={openModal} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Record Stock Entry
        </button>
      </div>

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Data" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      {showModal && (
        <div onClick={() => !saving && setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 460, width: '100%', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>Record Stock Entry</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Entry Type *</label>
              <select data-tour="stock-txn-type" style={inputStyle} value={txnType} onChange={(e) => setTxnType(e.target.value)}>
                {MANUAL_TXN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item *</label>
              <select data-tour="stock-item" style={inputStyle} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">— Select —</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Warehouse *</label>
              <select data-tour="stock-location" style={inputStyle} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— Select —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Quantity *</label>
                <input data-tour="stock-quantity" type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Batch Number</label>
                <input style={inputStyle} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Reference Number</label>
              <input data-tour="stock-reference" style={inputStyle} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="GRN number, issue number…" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Remarks</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>

            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button data-tour="stock-save-btn" onClick={handleCreate} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Posting…' : 'Post Entry'}</button>
            </div>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Current Balances</p>
      <div data-tour="stock-balances-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', marginBottom: 28, maxHeight: 360 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              {['Item', 'Warehouse', 'On Hand', 'Reserved', 'Available'].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && balances.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stock recorded yet.</td></tr>
            )}
            {balances.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{b.item_code} — {b.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.location_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.on_hand_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.reserved_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: BRAND.primaryActive }}>{b.available_qty} {b.uom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Recent Movements</p>
      <div data-tour="stock-transactions-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 400 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              {['Date', 'Item', 'Warehouse', 'Type', 'Quantity', 'Reference', 'By'].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && transactions.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stock movements yet.</td></tr>
            )}
            {transactions.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{t.transaction_date}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{t.item_code} — {t.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{t.location_name}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${BRAND.primary}1a`, color: BRAND.primaryActive }}>
                    {TXN_TYPE_LABELS[t.transaction_type] || t.transaction_type}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{t.quantity}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>
                  {t.reference_number ? (
                    <>
                      {t.reference_type && REF_TYPE_LABELS[t.reference_type] && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: 'rgba(59,130,246,0.1)', color: '#2563eb', marginRight: 6 }}>{REF_TYPE_LABELS[t.reference_type]}</span>
                      )}
                      {t.reference_number}
                    </>
                  ) : '—'}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{t.created_by_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
