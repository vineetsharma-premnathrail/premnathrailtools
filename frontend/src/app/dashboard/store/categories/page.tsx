'use client'

import { useEffect, useState } from 'react'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItemCategory } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS, SUCCESS } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import { useItemTypes } from '@/components/store/itemTypes'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

export default function StoreCategoriesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can, canDelete } = useCan()
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
  const [purchaseGl, setPurchaseGl] = useState('')
  const [salesGl, setSalesGl] = useState('')
  const [ledgers, setLedgers] = useState<{ purchase: { value: string; label: string }[]; sales: { value: string; label: string }[] }>({ purchase: [], sales: [] })
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
    if (isAuthorized) {
      load()
      storeApi.getItemMeta().then((m) => setLedgers({
        purchase: m.purchase_ledgers.map((o) => ({ value: String(o.value), label: o.label })),
        sales: m.sales_ledgers.map((o) => ({ value: String(o.value), label: o.label })),
      })).catch(() => setLedgers({ purchase: [], sales: [] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const openModal = () => {
    setName('')
    setCode('')
    setParentId('')
    setItemType('material')
    setIsActive(true)
    setPurchaseGl('')
    setSalesGl('')
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
    setPurchaseGl(c.purchase_gl_account_id ? String(c.purchase_gl_account_id) : '')
    setSalesGl(c.sales_gl_account_id ? String(c.sales_gl_account_id) : '')
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
    const ledgerPayload = { purchase_gl_account_id: purchaseGl ? Number(purchaseGl) : null, sales_gl_account_id: salesGl ? Number(salesGl) : null }
    try {
      if (editing) {
        await storeApi.updateCategory(editing.id, { name: name.trim(), is_active: isActive, ...(editing.parent_id ? {} : { item_type: itemType, ...ledgerPayload }) })
      } else {
        await storeApi.createCategory({ name: name.trim(), code: code.trim() || undefined, parent_id: parentId ? Number(parentId) : undefined, ...(parentId ? {} : { item_type: itemType, ...ledgerPayload }) })
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory · Settings
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Categories</h1>
        </div>
        {can('store', 'categories', 'create') && (
          <button data-tour="cat-add-btn" onClick={openModal} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Category
          </button>
        )}
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
        <FormSheet width={580} icon={editing ? 'edit' : 'tag'} title={editing ? 'Edit Category' : 'Add Category'}
          subtitle={editing ? `“${editing.name}” (${editing.code}) — code and parent are fixed once created.` : 'Group items for reports, codes and Finance ledgers.'}
          onClose={() => setShowModal(false)} busy={saving}
          footer={<>
            <button data-tour="cat-cancel-btn" type="button" onClick={() => setShowModal(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="cat-save-btn" type="button" onClick={handleCreate} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Category'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="list" title="Basic Information">
              <label style={sheetLabel}>Name <Req /></label>
              <input data-tour="cat-name" autoFocus style={sheetInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Raw Materials" />
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                  <label style={sheetLabel}>Code {editing ? '' : <Optional />}</label>
                  <input data-tour="cat-code" style={{ ...sheetInput, ...(editing ? { background: SHEET.SOFT, color: SHEET.MUTED } : {}) }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="RM" disabled={!!editing} />
                </div>
                <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                  <label style={sheetLabel}>Parent Category</label>
                  <Select data-tour="cat-parent" style={{ ...sheetInput, ...(editing ? { background: SHEET.SOFT, color: SHEET.MUTED } : {}) }} value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!!editing}>
                    <option value="">— Top-level category —</option>
                    {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </div>
              </div>
              <p style={sheetHint}>{editing ? 'Code and parent are fixed once created.' : 'Leave the code blank to generate one. Picking a parent makes this a subcategory.'}</p>
            </SheetSection>

            {!parentId && (
              <SheetSection icon="box" title="Item Type">
                <Select style={sheetInput} value={itemType} onChange={(e) => setItemType(e.target.value)}>
                  {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                {editing && <p style={sheetHint}>Its subcategories follow this item type.</p>}
              </SheetSection>
            )}

            {!parentId && (
              <SheetSection icon="rupee" title="Finance Ledgers" extra={<Optional />}>
                <div data-tour="cat-ledgers" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={sheetLabel}>Purchase ledger</label>
                    <SearchableSelect value={purchaseGl} onChange={setPurchaseGl} placeholder="Finance default (Purchases)"
                      options={[{ value: '', label: '— Finance default (Purchases) —' }, ...ledgers.purchase]} />
                  </div>
                  <div>
                    <label style={sheetLabel}>Sales ledger</label>
                    <SearchableSelect value={salesGl} onChange={setSalesGl} placeholder="Finance default (Sales)"
                      options={[{ value: '', label: '— Finance default (Sales) —' }, ...ledgers.sales]} />
                  </div>
                </div>
                <p style={sheetHint}>Every item in this category books to these ledgers unless the item sets its own. Agree them with Finance.</p>
              </SheetSection>
            )}

            {editing && (
              <SheetSection icon="flag" title="Status">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Active
                </label>
              </SheetSection>
            )}
          </div>
        </FormSheet>
      )}

      <div data-tour="cat-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              {['Name', 'Code', 'Item Type', 'Parent', 'Purchase Ledger', 'Status', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && categories.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No categories yet.</td></tr>
            )}
            {categories.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: c.parent_id ? 400 : 600, color: TEXT.body, paddingLeft: c.parent_id ? 32 : 16 }}>
                  {c.parent_id ? '↳ ' : ''}{c.name}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.item_type ? ITEM_TYPE_LABELS[c.item_type] || c.item_type : 'All types'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.parent_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{c.parent_id ? '' : c.purchase_gl_account_name || 'Finance default'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: c.is_active ? `${SUCCESS.primary}1a` : 'rgba(100,116,139,0.12)', color: c.is_active ? SUCCESS.hover : TEXT.muted }}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '0 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {can('store', 'categories', 'edit') && <span onClick={() => openEdit(c)} style={{ color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 14 }}>Edit</span>}
                  {canDelete('store', 'categories', null) && <span onClick={() => setDeleteTarget(c)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
