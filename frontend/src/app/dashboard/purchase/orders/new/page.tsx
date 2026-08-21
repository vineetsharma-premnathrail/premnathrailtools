'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { purchaseOrdersApi, vendorsApi } from '@/lib/api'
import { Vendor, P2PPurchaseOrderItemInput } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'

function emptyItem(): P2PPurchaseOrderItemInput {
  return { item_name: '', make: '', part_code: '', unit: '', quantity: 1, unit_price: undefined, tax_rate: undefined }
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewPurchaseOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState('')
  const [poDate, setPoDate] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  const [items, setItems] = useState<P2PPurchaseOrderItemInput[]>([emptyItem()])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    vendorsApi.list({ qualification_status: 'qualified', limit: 500 }).then(setVendors).catch(() => {})
  }, [isAuthorized])

  const updateItem = (idx: number, field: keyof P2PPurchaseOrderItemInput, value: string | number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }
  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    setError('')
    const filledItems = items.filter((it) => it.item_name)
    if (filledItems.length === 0) { setError('At least one item is required.'); return }

    setSubmitting(true)
    try {
      const vendor = vendors.find((v) => String(v.id) === vendorId)
      const po = await purchaseOrdersApi.create({
        vendor_id: vendorId ? Number(vendorId) : undefined,
        vendor_name: vendor?.name,
        po_date: poDate || undefined,
        expected_delivery: expectedDelivery || undefined,
        delivery_terms: deliveryTerms || undefined,
        items: filledItems.map((it) => ({
          ...it,
          quantity: Number(it.quantity) || 1,
          unit_price: it.unit_price ? Number(it.unit_price) : undefined,
          tax_rate: it.tax_rate ? Number(it.tax_rate) : undefined,
        })),
      })
      router.push(`/dashboard/purchase/orders/${po.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create purchase order.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Purchase Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Purchase Order</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Order Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div>
            <label style={labelStyle}>Vendor</label>
            <SearchableSelect
              value={vendorId}
              onChange={setVendorId}
              options={vendors.map((v) => ({ value: String(v.id), label: v.name }))}
              placeholder="Search qualified vendor…"
            />
          </div>
          <div>
            <label style={labelStyle}>PO Date</label>
            <DateField value={poDate} onChange={setPoDate} />
          </div>
          <div>
            <label style={labelStyle}>Expected Delivery</label>
            <DateField value={expectedDelivery} onChange={setExpectedDelivery} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Delivery Terms</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Item Details</h2>
          <button onClick={addItem} type="button" style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Add Item
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr>
                {['#', 'Item Description *', 'Make', 'Part Code', 'UOM', 'Qty', 'Unit Price', 'Tax %', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: TEXT.muted }}>{idx + 1}</td>
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>
                    <input style={inputStyle} value={item.item_name} onChange={(e) => updateItem(idx, 'item_name', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input style={inputStyle} value={item.make} onChange={(e) => updateItem(idx, 'make', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input style={inputStyle} value={item.part_code} onChange={(e) => updateItem(idx, 'part_code', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 90 }}>
                    <input style={inputStyle} value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} placeholder="pcs / kg" />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 70 }}>
                    <input type="number" style={inputStyle} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 100 }}>
                    <input type="number" style={inputStyle} value={item.unit_price ?? ''} onChange={(e) => updateItem(idx, 'unit_price', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 80 }}>
                    <input type="number" style={inputStyle} value={item.tax_rate ?? ''} onChange={(e) => updateItem(idx, 'tax_rate', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {items.length > 1 && (
                      <span onClick={() => removeItem(idx)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Remove</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.back()} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create Purchase Order'}
        </button>
      </div>
    </div>
  )
}
