'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StockItem } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import { Field, Row, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'

export default function StoreItemsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [partCode, setPartCode] = useState('')
  const [description, setDescription] = useState('')
  const [make, setMake] = useState('')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')
  const [reorderPoint, setReorderPoint] = useState('0')
  const [reorderQuantity, setReorderQuantity] = useState('0')
  const [standardCost, setStandardCost] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const resetForm = () => {
    setPartCode(''); setDescription(''); setMake(''); setUnit(''); setCategory('')
    setReorderPoint('0'); setReorderQuantity('0'); setStandardCost('')
    setFormError('')
    setShowForm(false)
  }

  const handleCreate = async () => {
    setFormError('')
    if (!partCode.trim() || !description.trim()) { setFormError('Part code and description are required.'); return }
    setSubmitting(true)
    try {
      const item = await storeApi.createItem({
        part_code: partCode.trim(),
        description: description.trim(),
        make: make || undefined,
        unit: unit || undefined,
        category: category || undefined,
        reorder_point: Number(reorderPoint) || 0,
        reorder_quantity: Number(reorderQuantity) || 0,
        standard_cost: standardCost ? Number(standardCost) : undefined,
      })
      router.push(`/dashboard/store/${item.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFormError(err.response?.data?.detail || 'Failed to create stock item.')
    } finally {
      setSubmitting(false)
    }
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await storeApi.listItems({ search: search || undefined, low_stock: lowStockOnly || undefined })
      setItems(data)
    } catch {
      setError('Failed to load stock items.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, lowStockOnly])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Stock Items</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{items.length} item(s)</p>
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
            + New Stock Item
          </button>
        )}
      </div>

      {showForm ? (
        <div style={{ width: '100%' }}>
          {formError && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {formError}
            </div>
          )}

          <Section title="Item Details" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Part Code *">
                <input style={inputStyle} value={partCode} onChange={(e) => setPartCode(e.target.value)} />
              </Field>
              <Field label="Description *">
                <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Make">
                <input style={inputStyle} value={make} onChange={(e) => setMake(e.target.value)} />
              </Field>
              <Field label="UOM">
                <input style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs / kg" />
              </Field>
              <Field label="Category">
                <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
              </Field>
              <Field label="Standard Cost">
                <input type="number" style={inputStyle} value={standardCost} onChange={(e) => setStandardCost(e.target.value)} />
              </Field>
              <Field label="Reorder Point">
                <input type="number" style={inputStyle} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
              </Field>
              <Field label="Reorder Quantity">
                <input type="number" style={inputStyle} value={reorderQuantity} onChange={(e) => setReorderQuantity(e.target.value)} />
              </Field>
            </Row>
          </Section>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={resetForm} disabled={submitting} type="button" style={secondaryBtnStyle}>
              Cancel
            </button>
            <button onClick={handleCreate} disabled={submitting} type="button" style={{ ...primaryBtnStyle, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Creating…' : 'Create Stock Item'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by description or part code…"
              style={{ ...inputStyle, flex: '1 1 260px', width: 'auto' }}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary }}>
              <Checkbox checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
              Low stock only
            </span>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: `${BRAND.primary}0d` }}>
                  {['Part Code', 'Description', 'Make', 'UOM', 'Category', 'On Hand', 'Reorder Point', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stock items yet.</td></tr>
                )}
                {items.map((item) => {
                  const low = item.quantity_on_hand <= item.reorder_point
                  return (
                    <tr key={item.id} onClick={() => router.push(`/dashboard/store/${item.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{item.part_code}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.description}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.make || '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.unit || '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.category || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: low ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.1)', color: low ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                          {item.quantity_on_hand}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.reorder_point}</td>
                      <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                        <span onClick={() => router.push(`/dashboard/store/${item.id}`)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer', marginRight: low ? 14 : 0 }}>View</span>
                        {low && (
                          <span
                            onClick={() => {
                              const params = new URLSearchParams({
                                item_name: item.description, make: item.make || '', part_code: item.part_code,
                                unit: item.unit || '', quantity: String(item.reorder_quantity || 1), category: item.category || '',
                              })
                              router.push(`/dashboard/p2p/new?${params.toString()}`)
                            }}
                            style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}
                          >
                            Raise Procure-to-Pay Request
                          </span>
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
    </div>
  )
}
