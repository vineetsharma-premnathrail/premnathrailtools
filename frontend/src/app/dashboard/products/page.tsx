'use client'

import FilterMenu from '@/components/shared/FilterMenu'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useProductsAccess } from '@/components/products/useProductsAccess'
import { useCan } from '@/lib/permissions'
import { productsApi } from '@/lib/api'
import { FinishedProduct } from '@/types'
import { TEXT } from '@/lib/theme'
import ProductsNav from '@/components/products/ProductsNav'
import { inputStyle, primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  ErrorBanner, PageHeader, Pill, PRODUCT_STATUS_HEX, PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS, tableWrapStyle, tdStyle, thStyle,
} from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'

export default function ProductsPage() {
  const { isAuthorized, isLoading } = useProductsAccess()
  const { can } = useCan()
  const router = useRouter()
  const [rows, setRows] = useState<FinishedProduct[]>([])
  const [filters, setFilters] = useState({ search: '', product_type: '', status: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      setLoading(true)
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))
      productsApi.list(params)
        .then((r) => { setRows(r); setError('') })
        .catch((e) => setError(extractErrorMessages(e, 'Failed to load products.')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, filters])

  if (isLoading || !isAuthorized) return null

  const setF = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const open = (row: FinishedProduct) => router.push(recordPath('/dashboard/products', row))

  return (
    <div>
      <ProductsNav />
      <PageHeader title="Products">
        {can('crm', 'products', 'create') && (
          <button type="button" data-tour="prod-new-btn" style={primaryBtnStyle} onClick={() => router.push('/dashboard/products/new')}>+ New Product</button>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input data-tour="prod-search" style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 320 }} placeholder="Search code, name or model…" value={filters.search} onChange={(e) => setF('search', e.target.value)} />
        <FilterMenu
          fields={[
            { key: 'product_type', label: 'Type', value: filters.product_type, allLabel: 'All types',
              options: Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
            { key: 'status', label: 'Status', value: filters.status, allLabel: 'All statuses',
              options: Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
          ]}
          onChange={(k, v) => setF(k as keyof typeof filters, v)}
          onClear={() => setFilters((f) => ({ ...f, product_type: '', status: '' }))}
        />
      </div>

      <div data-tour="prod-table" style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['Code', 'Name', 'Type', 'Model', 'Status'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                {Object.values(filters).some(Boolean) ? 'No products match these filters.' : 'No products yet — add your first finished product (e.g. RRB Sanding Vehicle).'}
              </td></tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} onClick={() => open(p)} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.code}</td>
                <td style={tdStyle}>{p.name}</td>
                <td style={tdStyle}>{PRODUCT_TYPE_LABELS[p.product_type] || p.product_type}</td>
                <td style={tdStyle}>{p.model_number || '—'}</td>
                <td style={tdStyle}><Pill text={PRODUCT_STATUS_LABELS[p.status] || p.status} hex={PRODUCT_STATUS_HEX[p.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
