'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, inputStyle } from '@/components/crm/ui'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

interface ProductCategory {
  id: number
  name: string
}

const emptyForm = { name: '' }

export default function ProductCategoriesPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [errorTitle, setErrorTitle] = useState('Cannot Save Product Category')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    crmApi.listProductCategories().then(setCategories).catch(() => { setErrorTitle('Failed to Load Product Categories'); setError('Failed to load product categories.') }).finally(() => setLoading(false))
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const startEdit = (c: ProductCategory) => {
    setEditingId(c.id)
    setForm({ name: c.name })
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setForm(emptyForm); setShowForm(false) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (editingId) await crmApi.updateProductCategory(editingId, form)
      else await crmApi.createProductCategory(form)
      cancelForm()
      load()
    } catch (err: any) {
      setErrorTitle('Cannot Save Product Category')
      setError(extractErrorMessages(err, 'Failed to save product category.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await crmApi.deleteProductCategory(id)
      load()
    } catch (err: any) {
      setErrorTitle('Cannot Delete Product Category')
      setError(extractErrorMessages(err, 'Failed to delete product category.'))
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>
      <CrmNav />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '16px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Product Category List</h1>
        <button
          onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          data-tour="pc-add-btn"
          style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
        >
          {showForm ? 'Cancel' : '+ Add Product Category'}
        </button>
      </div>

      <MessageDialog
        open={Array.isArray(error) ? error.length > 0 : !!error}
        variant="error"
        title={errorTitle}
        message={error}
        onClose={() => setError('')}
      />

      {showForm && (
        <form onSubmit={save} style={{ marginBottom: 20, padding: 16, borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div data-tour="pc-name">
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required style={inputStyle} />
          </div>
          <div><button type="submit" data-tour="pc-save" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Product Category'}</button></div>
        </form>
      )}

      <div data-tour="pc-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr>
              {['Name', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 700, color: TEXT.secondary }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={2} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>Loading…</td></tr>
            ) : categories.length === 0 ? (
              <tr><td colSpan={2} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>No product categories yet.</td></tr>
            ) : (
              categories.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                    <button onClick={() => startEdit(c)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}>Edit</button>
                    <button onClick={() => remove(c.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
