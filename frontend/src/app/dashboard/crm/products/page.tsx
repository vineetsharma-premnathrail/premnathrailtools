'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, inputStyle } from '@/components/crm/ui'
import { BRAND, TEXT, GLASS, SHADOWS } from '@/lib/theme'

interface Product {
  id: number
  name: string
  model_number: string | null
  category: string | null
  unit: string | null
  default_price: number | null
  description: string | null
}

const emptyForm = { name: '', model_number: '', category: '', unit: '', default_price: '', description: '' }

export default function ProductsPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)

  const load = () => {
    setLoading(true)
    crmApi.listProducts().then(setProducts).catch(() => setError('Failed to load products.')).finally(() => setLoading(false))
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const startEdit = (p: Product) => {
    setEditingId(p.id)
    setForm({
      name: p.name, model_number: p.model_number || '', category: p.category || '', unit: p.unit || '',
      default_price: p.default_price != null ? String(p.default_price) : '', description: p.description || '',
    })
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setForm(emptyForm); setShowForm(false) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const payload = { ...form, default_price: form.default_price ? Number(form.default_price) : undefined }
    try {
      if (editingId) await crmApi.updateProduct(editingId, payload)
      else await crmApi.createProduct(payload)
      cancelForm()
      load()
    } catch {
      setError('Failed to save product.')
    }
  }

  const remove = async (id: number) => {
    try { await crmApi.deleteProduct(id); load() } catch { setError('Failed to delete product.') }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      <CrmNav />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '16px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Product List</h1>
        <button
          onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
        >
          {showForm ? 'Cancel' : '+ Add Product'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={save} style={{ marginBottom: 20, padding: 16, borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 220px', minWidth: 180 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required style={inputStyle} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Model Number</label>
            <input value={form.model_number} onChange={(e) => setForm((f) => ({ ...f, model_number: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Category</label>
            <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex: '0 1 100px', minWidth: 90 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Unit</label>
            <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Default Price</label>
            <input type="number" value={form.default_price} onChange={(e) => setForm((f) => ({ ...f, default_price: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex: '1 1 100%' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div style={{ flex: '1 1 100%' }}>
            <button type="submit" style={primaryBtnStyle}>{editingId ? 'Save Changes' : 'Save Product'}</button>
          </div>
        </form>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              {['Name', 'Model No.', 'Category', 'Unit', 'Default Price', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 700, color: TEXT.secondary }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>Loading…</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>No products yet.</td></tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.model_number || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.category || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.unit || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.default_price != null ? p.default_price.toLocaleString() : '—'}</td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                    <button onClick={() => startEdit(p)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}>Edit</button>
                    <button onClick={() => remove(p.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
