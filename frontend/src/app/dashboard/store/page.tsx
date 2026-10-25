'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreItemCategory } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS, SUCCESS } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, inputStyle, RowCount, Pill } from '@/components/shared/ui'
import ItemImportDialog from '@/components/store/ItemImportDialog'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import { useItemTypes } from '@/components/store/itemTypes'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

const filterSelectStyle: React.CSSProperties = {
  ...inputStyle, width: undefined, background: 'rgba(255,255,255,.7)', textOverflow: 'ellipsis',
}

export default function StoreItemsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const { can } = useCan()
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
  // The table stretches to the bottom of the scrolling <main> (measured, so nav/filter wrapping never
  // leaves a gap) without overshooting it — the page itself never scrolls, only the table does.
  const tableRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState<number>()
  useLayoutEffect(() => {
    const fit = () => {
      const el = tableRef.current
      if (!el) return
      const main = el.closest('main')
      const top = el.getBoundingClientRect().top + (main?.scrollTop ?? 0)
      const bottom = main ? main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom) : window.innerHeight
      setTableHeight(Math.max(260, Math.floor(bottom - top) - 12))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  })

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Item Master</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {can('store', 'items', 'export') && <button data-tour="items-export-btn" onClick={exportExcel} disabled={exporting} style={{ ...secondaryBtnStyle, opacity: exporting ? 0.7 : 1 }}>{exporting ? 'Exporting…' : 'Export'}</button>}
          {can('store', 'items', 'import') && <button data-tour="items-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
          {can('store', 'items', 'create') && (
            <button data-tour="items-add-btn" onClick={() => router.push('/dashboard/store/new')} style={primaryBtnStyle}>
              <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Item
            </button>
          )}
        </div>
      </div>

      <ItemImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      <MessageDialog open={!!exportError} variant="error" title="Export Failed" message={exportError} onClose={() => setExportError('')} />
      <MessageDialog open={!!error} variant="error" title="Failed to Load Items" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          data-tour="items-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, name or specification"
          style={{ ...inputStyle, flex: '1 1 360px', minWidth: 260, width: undefined, maxWidth: 520, background: 'rgba(255,255,255,.7)' }}
        />
        <Select
          data-tour="items-type-filter"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setCategoryFilter(''); setSubcategoryFilter('') }}
          style={{ ...filterSelectStyle, width: 150 }}
        >
          <option value="">All Types</option>
          {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        {/* Type → Category → Subcategory: each step appears only once the one before it is picked */}
        {typeFilter && (
          <Select
            data-tour="items-category-filter"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setSubcategoryFilter('') }}
            style={{ ...filterSelectStyle, width: 190 }}
          >
            <option value="">All Categories</option>
            {categoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        )}
        {subcategoryOptions.length > 0 && (
          <Select
            data-tour="items-subcategory-filter"
            value={subcategoryFilter}
            onChange={(e) => setSubcategoryFilter(e.target.value)}
            style={{ ...filterSelectStyle, width: 190 }}
          >
            <option value="">All Subcategories</option>
            {subcategoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        )}
        {hasFilters && (
          <button type="button" onClick={() => { setSearch(''); setTypeFilter(''); setCategoryFilter(''); setSubcategoryFilter('') }}
            style={{ background: 'none', border: 'none', color: BRAND.primaryActive, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Clear filters
          </button>
        )}
      </div>

      <div ref={tableRef} data-tour="items-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', height: tableHeight }}>
        <table style={{ width: '100%', minWidth: 960, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 130 }} /><col style={{ width: 100 }} /><col style={{ width: 130 }} /><col style={{ width: 120 }} />
            <col /><col style={{ width: 70 }} /><col /><col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              {['Code', 'Type', 'Category', 'Subcategory', 'Name', 'UOM', 'Technical Specification', 'Status'].map((h, hi) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', whiteSpace: 'nowrap', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}{hi === 0 && <RowCount count={items.length} />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters ? 'No items match these filters.' : 'No items yet — use + Add Item to create the first one.'}</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.id} onClick={() => router.push(recordPath('/dashboard/store', item))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.item_code}>{item.item_code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{(item.item_type && ITEM_TYPE_LABELS[item.item_type]) || item.item_type || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.category || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.subcategory || '—'}</td>
                <td title={item.item_name} style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{item.uom || '—'}</td>
                <td title={item.description || ''} style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <Pill label={item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1).replace(/_/g, ' ') : '—'} hex={item.status === 'active' ? SUCCESS.hover : TEXT.muted} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
