'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItemCategory } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import { useItemTypes } from '@/components/store/itemTypes'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

export default function StoreCategoriesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const { types: ITEM_TYPES, labels: ITEM_TYPE_LABELS } = useItemTypes(isAuthorized)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [parentId, setParentId] = useState('')
  const [itemType, setItemType] = useState('material')
  const [isActive, setIsActive] = useState(true)
  const [editing, setEditing] = useState<StoreItemCategory | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<StoreItemCategory | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      setCategories(await storeApi.listCategories())
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load categories.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const openModal = () => {
    setName('')
    setCode('')
    setParentId('')
    setItemType('material')
    setIsActive(true)
    setEditing(null)
    setFormErrors([])
    setShowModal(true)
  }

  const openEdit = (c: StoreItemCategory) => {
    setName(c.name)
    setCode(c.code)
    setParentId(c.parent_id ? String(c.parent_id) : '')
    setItemType(c.item_type || 'material')
    setIsActive(c.is_active)
    setEditing(c)
    setFormErrors([])
    setShowModal(true)
  }

  const handleCreate = async () => {
    const problems: string[] = []
    if (!name.trim()) problems.push('Name is required.')
    if (problems.length) {
      setFormErrors(problems)
      return
    }
    setSaving(true)
    setFormErrors([])
    try {
      if (editing) {
        await storeApi.updateCategory(editing.id, { name: name.trim(), is_active: isActive, ...(editing.parent_id ? {} : { item_type: itemType }) })
      } else {
        await storeApi.createCategory({ name: name.trim(), code: code.trim() || undefined, parent_id: parentId ? Number(parentId) : undefined, item_type: parentId ? undefined : itemType })
      }
      setShowModal(false)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, editing ? 'Failed to update category.' : 'Failed to create category.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await storeApi.deleteCategory(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err) {
      setDeleteErrors(extractErrorMessages(err, 'Failed to delete category.'))
      setDeleteTarget(null)
    }
  }

  const topLevel = categories.filter((c) => !c.parent_id)
  const parentOptions = topLevel // subcategories can't themselves have children

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory · Settings
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Categories</h1>
        </div>
        <button data-tour="cat-add-btn" onClick={openModal} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Category
        </button>
      </div>

      <StoreSettingsNav />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Categories" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={deleteErrors.length > 0} variant="error" title="Cannot Delete Category" message={deleteErrors} onClose={() => setDeleteErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this category?"
        message={`This permanently removes "${deleteTarget?.name}". This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {showModal && (
        <div onClick={() => !saving && setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>{editing ? 'Edit Category' : 'Add Category'}</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Name *</label>
              <input data-tour="cat-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Raw Materials" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>{editing ? 'Code (fixed once created)' : 'Code (blank = auto)'}</label>
              <input data-tour="cat-code" style={{ ...inputStyle, ...(editing ? { background: 'rgba(0,0,0,0.04)', color: TEXT.muted } : {}) }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="RM" disabled={!!editing} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>{editing ? 'Parent Category (fixed once created)' : 'Parent Category (makes this a subcategory)'}</label>
              <select data-tour="cat-parent" style={{ ...inputStyle, ...(editing ? { background: 'rgba(0,0,0,0.04)', color: TEXT.muted } : {}) }} value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!!editing}>
                <option value="">— Top-level category —</option>
                {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {!parentId && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item Type</label>
                <select style={inputStyle} value={itemType} onChange={(e) => setItemType(e.target.value)}>
                  {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {editing && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>Its subcategories follow this item type.</div>}
              </div>
            )}

            {editing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Active
              </label>
            )}

            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button data-tour="cat-save-btn" onClick={handleCreate} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Category'}</button>
            </div>
          </div>
        </div>
      )}

      <div data-tour="cat-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr>
              {['Name', 'Code', 'Item Type', 'Parent', 'Status', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && categories.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No categories yet.</td></tr>
            )}
            {categories.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: c.parent_id ? 400 : 600, color: TEXT.body, paddingLeft: c.parent_id ? 32 : 16 }}>
                  {c.parent_id ? '↳ ' : ''}{c.name}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.item_type ? ITEM_TYPE_LABELS[c.item_type] || c.item_type : 'All types'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.parent_name || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: c.is_active ? `${BRAND.primary}1a` : 'rgba(100,116,139,0.12)', color: c.is_active ? BRAND.primaryActive : TEXT.muted }}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '0 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span onClick={() => openEdit(c)} style={{ color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 14 }}>Edit</span>
                  <span onClick={() => setDeleteTarget(c)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
