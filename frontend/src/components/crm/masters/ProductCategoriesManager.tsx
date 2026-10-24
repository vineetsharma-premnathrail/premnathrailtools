'use client'

// Product Categories list — shown in CRM → Settings (was its own Masters page).

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallDangerBtnStyle, smallSecondaryBtnStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

interface ProductCategory {
  created_by_id?: number | null
  id: number
  name: string
}

const emptyForm = { name: '' }

export default function ProductCategoriesManager() {
  // Settings › Edit adds/edits/removes list entries; removing also needs to be your own entry (or admin).
  const { user, can } = useCan()
  const canEditList = can('crm', 'settings', 'edit')
  const canRemove = (createdById?: number | null) => canEditList && (user?.role === 'admin' || (createdById != null && createdById === user?.id))
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [errorTitle, setErrorTitle] = useState('Cannot Save Product Category')
  const [pendingDelete, setPendingDelete] = useState<ProductCategory | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | string[]>('')

  const load = (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    crmApi.listProductCategories().then(setCategories).catch((err) => { setErrorTitle('Cannot Load Product Categories'); setError(extractErrorMessages(err, 'Could not load the product categories. Reload the page; if it persists, check your CRM access.')) }).finally(() => setLoading(false))
  }

  // First load (`loading` already starts true); deferred so the effect itself sets no state.
   
  useEffect(() => { Promise.resolve().then(() => load(false)) }, [])

  const startEdit = (c: ProductCategory) => {
    setEditingId(c.id)
    setForm({ name: c.name })
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setForm(emptyForm); setShowForm(false); setFormError('') }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      if (editingId) await crmApi.updateProductCategory(editingId, form)
      else await crmApi.createProductCategory(form)
      cancelForm()
      load()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to save product category.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await crmApi.deleteProductCategory(id)
      load()
    } catch (err) {
      setErrorTitle('Cannot Delete Product Category')
      setError(extractErrorMessages(err, 'The product category was not deleted. Reload the page and try again; if it persists, check your CRM access.'))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '0 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Product Categories</h2>
        </div>
        {canEditList && (
        <button
          onClick={() => { cancelForm(); setShowForm(true) }}
          data-tour="pc-add-btn"
          style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
        >
          + Add Product Category
        </button>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete product category?"
        message={`Delete product category "${pendingDelete?.name ?? ''}"? It disappears from the quotation pickers and cannot be undone.`}
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
        <FormSheet width={520} icon={editingId ? 'edit' : 'tag'} title={editingId ? 'Edit Product Category' : 'Add Product Category'} subtitle="Groups products in the inquiry, tender and quotation pickers." onClose={cancelForm} busy={saving}
          footer={<>
            <button type="button" onClick={cancelForm} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="submit" form="pc-form" data-tour="pc-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name={editingId ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Product Category'}
            </button>
          </>}>
          <form id="pc-form" onSubmit={save} style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="tag" title="Product Category Details">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div data-tour="pc-name">
            <label style={sheetLabel}>Name <Req /></label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required style={sheetInput} />
          </div>
              </div>
            </SheetSection>
          </form>
        </FormSheet>
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
              categories.map((c, rowIdx) => (
                <tr key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                    {canRemove(c.created_by_id) && <button onClick={() => startEdit(c)} data-tour={rowIdx === 0 ? 'pc-row-edit-btn' : undefined} style={{ ...smallSecondaryBtnStyle }}>Edit</button>}
                    {canRemove(c.created_by_id) && <button onClick={() => setPendingDelete(c)} data-tour={rowIdx === 0 ? 'pc-row-delete-btn' : undefined} style={{ ...smallDangerBtnStyle }}>Delete</button>}
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
