'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { Field, Row, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'

export default function NewStockItemPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

  const [partCode, setPartCode] = useState('')
  const [description, setDescription] = useState('')
  const [make, setMake] = useState('')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')
  const [reorderPoint, setReorderPoint] = useState('0')
  const [reorderQuantity, setReorderQuantity] = useState('0')
  const [standardCost, setStandardCost] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')
    if (!partCode.trim() || !description.trim()) { setError('Part code and description are required.'); return }
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
      setError(err.response?.data?.detail || 'Failed to create stock item.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%', maxWidth: 780 }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Store Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Stock Item</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
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
        <button onClick={() => router.back()} type="button" style={secondaryBtnStyle}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ ...primaryBtnStyle, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create Stock Item'}
        </button>
      </div>
    </div>
  )
}
