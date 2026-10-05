'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreItemCategory } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import ItemImportDialog from '@/components/store/ItemImportDialog'
import StoreNav from '@/components/store/StoreNav'
import { useItemTypes } from '@/components/store/itemTypes'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

export default function StoreItemsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const [items, setItems] = useState<StoreItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const { labels: ITEM_TYPE_LABELS } = useItemTypes(isAuthorized)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [subcategoryFilter, setSubcategoryFilter] = useState('')
  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const filterParams = () => ({
    search: search || undefined,
    item_type: typeFilter || undefined,
    category: categoryFilter || undefined,
    subcategory: subcategoryFilter || undefined,
  })
  // Category options follow the type; subcategory options follow the category.
  const categoryOptions = categories.filter((c) => !c.parent_id && c.item_type && (!typeFilter || c.item_type === typeFilter))
  const pickedCategory = categoryOptions.find((c) => c.name === categoryFilter)
  const subcategoryOptions = pickedCategory ? categories.filter((c) => c.parent_id === pickedCategory.id) : []
  const hasFilters = !!(search.trim() || typeFilter || categoryFilter || subcategoryFilter)

  // Exports exactly what the list shows (same search + filters).
  const exportExcel = async () => {
    setExporting(true)
    try {
      const blob = await storeApi.exportItems(filterParams())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `item_master${typeFilter ? `_${typeFilter}` : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(extractErrorMessages(err, 'Export failed.').join(' '))
    } finally {
      setExporting(false)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const data = await storeApi.listItems(filterParams())
      setItems(data)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load items.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, search, typeFilter, categoryFilter, subcategoryFilter])

  useEffect(() => {
    if (isAuthorized) storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Item Master</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button data-tour="items-export-btn" onClick={exportExcel} disabled={exporting} style={{ ...secondaryBtnStyle, opacity: exporting ? 0.7 : 1 }}>{exporting ? 'Exporting…' : 'Export'}</button>
          <button data-tour="items-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
          <button data-tour="items-add-btn" onClick={() => router.push('/dashboard/store/new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Item
          </button>
        </div>
      </div>

      <ItemImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      <MessageDialog open={!!exportError} variant="error" title="Export Failed" message={exportError} onClose={() => setExportError('')} />
      <MessageDialog open={!!error} variant="error" title="Failed to Load Items" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          data-tour="items-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, code or technical specification…"
          style={{ flex: '1 1 240px', maxWidth: 320, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none' }}
        />
        <select
          data-tour="items-type-filter"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setCategoryFilter(''); setSubcategoryFilter('') }}
          style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none' }}
        >
          <option value="">All Types</option>
          {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setSubcategoryFilter('') }}
          style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none' }}
        >
          <option value="">All Categories</option>
          {categoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select
          value={subcategoryFilter}
          onChange={(e) => setSubcategoryFilter(e.target.value)}
          disabled={!pickedCategory}
          title={pickedCategory ? '' : 'Pick a category first'}
          style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: pickedCategory ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,0.04)', fontSize: 13.5, outline: 'none' }}
        >
          <option value="">All Subcategories</option>
          {subcategoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        {hasFilters && (
          <button type="button" onClick={() => { setSearch(''); setTypeFilter(''); setCategoryFilter(''); setSubcategoryFilter('') }}
            style={{ background: 'none', border: 'none', color: BRAND.primaryActive, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Clear filters
          </button>
        )}
      </div>

      <div data-tour="items-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              {['Code', 'Type', 'Category', 'Subcategory', 'Name', 'UOM', 'Technical Specification', 'Status', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters ? 'No items match these filters.' : 'No items yet — add the first item to the master.'}</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.id} onClick={() => router.push(`/dashboard/store/${item.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap' }}>{item.item_code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{(item.item_type && ITEM_TYPE_LABELS[item.item_type]) || item.item_type || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.category || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.subcategory || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.uom || '—'}</td>
                <td title={item.description || ''} style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: item.status === 'active' ? `${BRAND.primary}1a` : 'rgba(100,116,139,0.12)', color: item.status === 'active' ? BRAND.primaryActive : TEXT.muted, textTransform: 'capitalize' }}>
                    {item.status}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/store/${item.id}`)} style={{ padding: '0 16px', color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
