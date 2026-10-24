'use client'

// Products list — shown in CRM → Settings (was its own Masters page).

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallDangerBtnStyle, smallSecondaryBtnStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

interface Product {
  created_by_id?: number | null
  id: number
  name: string
  model_number: string | null
  category: string | null
  unit: string | null
  default_price: number | null
  description: string | null
}

const emptyForm = { name: '', model_number: '', category: '', unit: '', default_price: '', description: '' }

export default function ProductsManager() {
  // Settings › Edit adds/edits/removes list entries; removing also needs to be your own entry (or admin).
  const { user, can } = useCan()
  const canEditList = can('crm', 'settings', 'edit')
  const canRemove = (createdById?: number | null) => canEditList && (user?.role === 'admin' || (createdById != null && createdById === user?.id))
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | string[]>('')
  const [errorTitle, setErrorTitle] = useState('Cannot Save Product')
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null)

  const load = (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    crmApi.listProducts().then(setProducts).catch((err) => { setErrorTitle('Cannot Load Products'); setError(extractErrorMessages(err, 'Could not load the product list. Reload the page; if it persists, check your CRM access.')) }).finally(() => setLoading(false))
  }

  // First load (`loading` already starts true); deferred so the effect itself sets no state.
   
  useEffect(() => { Promise.resolve().then(() => load(false)) }, [])

  const startEdit = (p: Product) => {
    setEditingId(p.id)
    setForm({
      name: p.name, model_number: p.model_number || '', category: p.category || '', unit: p.unit || '',
      default_price: p.default_price != null ? String(p.default_price) : '', description: p.description || '',
    })
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setForm(emptyForm); setShowForm(false); setFormError('') }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const payload = { ...form, default_price: form.default_price ? Number(form.default_price) : undefined }
    setSaving(true)
    try {
      if (editingId) await crmApi.updateProduct(editingId, payload)
      else await crmApi.createProduct(payload)
      cancelForm()
      load()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to save product.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await crmApi.deleteProduct(id)
      load()
    } catch (err) {
      setErrorTitle('Cannot Delete Product')
      setError(extractErrorMessages(err, 'The product was not deleted. Reload the page and try again; if it persists, check your CRM access.'))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '0 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Products</h2>
        </div>
        {canEditList && (
        <button
          onClick={() => { cancelForm(); setShowForm(true) }}
          data-tour="prod-add-btn"
          style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
        >
          + Add Product
        </button>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete product?"
        message={`Delete product "${pendingDelete?.name ?? ''}"? It disappears from the quotation pickers and cannot be undone.`}
        onConfirm={() => { const row = pendingDelete; setPendingDelete(null); if (row) remove(row.id) }}
        onCancel={() => setPendingDelete(null)}
      />
      <MessageDialog
        open={Array.isArray(error) ? error.length > 0 : !!error}
        variant="error"
        title={errorTitle}
        message={error}
        onClose={() => setError('')}
      />

      {showForm && (
        <FormSheet width={640} icon={editingId ? 'edit' : 'box'} title={editingId ? 'Edit Product' : 'Add Product'} subtitle="Offered in the inquiry, tender and quotation product pickers." onClose={cancelForm} busy={saving}
          footer={<>
            <button type="button" onClick={cancelForm} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="submit" form="prod-form" data-tour="prod-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name={editingId ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Product'}
            </button>
          </>}>
          <form id="prod-form" onSubmit={save} style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="box" title="Product Details">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>

          <div data-tour="prod-name" style={{ flex: '1 1 220px', minWidth: 180 }}>
            <label style={sheetLabel}>Name <Req /></label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required style={sheetInput} />
          </div>
          <div data-tour="prod-model" style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={sheetLabel}>Model Number</label>
            <input value={form.model_number} onChange={(e) => setForm((f) => ({ ...f, model_number: e.target.value }))} style={sheetInput} />
          </div>
          <div data-tour="prod-category" style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={sheetLabel}>Category</label>
            <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={sheetInput} />
          </div>
          <div data-tour="prod-unit" style={{ flex: '0 1 100px', minWidth: 90 }}>
            <label style={sheetLabel}>Unit</label>
            <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} style={sheetInput} />
          </div>
          <div data-tour="prod-price" style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={sheetLabel}>Default Price</label>
            <input type="number" value={form.default_price} onChange={(e) => setForm((f) => ({ ...f, default_price: e.target.value }))} style={sheetInput} />
          </div>
          <div data-tour="prod-description" style={{ flex: '1 1 100%' }}>
            <label style={sheetLabel}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ ...sheetInput, resize: 'vertical' }} />
          </div>
              </div>
            </SheetSection>
          </form>
        </FormSheet>
      )}

      <div data-tour="prod-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
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
              products.map((p, rowIdx) => (
                <tr key={p.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.model_number || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.category || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.unit || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{p.default_price != null ? p.default_price.toLocaleString() : '—'}</td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                    {canRemove(p.created_by_id) && <button onClick={() => startEdit(p)} data-tour={rowIdx === 0 ? 'prod-row-edit-btn' : undefined} style={{ ...smallSecondaryBtnStyle }}>Edit</button>}
                    {canRemove(p.created_by_id) && <button onClick={() => setPendingDelete(p)} data-tour={rowIdx === 0 ? 'prod-row-delete-btn' : undefined} style={{ ...smallDangerBtnStyle }}>Delete</button>}
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
