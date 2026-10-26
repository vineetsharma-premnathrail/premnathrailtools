'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { productsApi } from '@/lib/api'
import { FinishedProduct, ProductApplication } from '@/types'
import { TEXT } from '@/lib/theme'
import ProductsNav from '@/components/products/ProductsNav'
import { inputStyle, primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  ErrorBanner, PageHeader, Pill, PRODUCT_STATUS_HEX, PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS, tableWrapStyle, tdStyle, thStyle,
} from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'

export default function ProductsPage() {
  const { isAuthorized, isLoading } = useRequireApp('products')
  const { can } = useCan()
  const router = useRouter()
  const [rows, setRows] = useState<FinishedProduct[]>([])
  const [applications, setApplications] = useState<ProductApplication[]>([])
  const [filters, setFilters] = useState({ search: '', product_type: '', status: '', application_id: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (isAuthorized) productsApi.listApplications().then(setApplications).catch(() => {})
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
        {can('sales', 'products', 'create') && (
          <button type="button" style={primaryBtnStyle} onClick={() => router.push('/dashboard/products/new')}>+ New Product</button>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 320 }} placeholder="Search code, name or model…" value={filters.search} onChange={(e) => setF('search', e.target.value)} />
        <Select style={{ ...inputStyle, flex: '0 1 200px' }} value={filters.product_type} onChange={(e) => setF('product_type', e.target.value)}>
          <option value="">All types</option>
          {Object.entries(PRODUCT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select style={{ ...inputStyle, flex: '0 1 170px' }} value={filters.status} onChange={(e) => setF('status', e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(PRODUCT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select style={{ ...inputStyle, flex: '0 1 220px' }} value={filters.application_id} onChange={(e) => setF('application_id', e.target.value)}>
          <option value="">All applications</option>
          {applications.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['Code', 'Name', 'Type', 'Model', 'Applications', 'Status'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
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
                <td style={tdStyle}>{p.applications.length ? p.applications.map((a) => a.name).join(', ') : '—'}</td>
                <td style={tdStyle}><Pill text={PRODUCT_STATUS_LABELS[p.status] || p.status} hex={PRODUCT_STATUS_HEX[p.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
