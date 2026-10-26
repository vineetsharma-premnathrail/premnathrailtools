'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { productsApi } from '@/lib/api'
import { FinishedProduct } from '@/types'
import { TEXT } from '@/lib/theme'
import ProductsNav from '@/components/products/ProductsNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ProductSalesPanels from '@/components/products/ProductSalesPanels'
import { Section, DetailCard, DetailSummary, DetailGroup, DetailRow, dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  ErrorBanner, PageHeader, Pill, PRODUCT_STATUS_HEX, PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS, tableWrapStyle, tdStyle, thStyle,
} from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'

export default function ProductDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('products')
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()
  const ref = useParams().id as string
  const { id: recordId, error: linkError } = useRecordId(ref)
  const id = recordId ?? 0
  const [p, setP] = useState<FinishedProduct | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (isAuthorized && id) productsApi.get(id).then(setP).catch((e) => setError(extractErrorMessages(e, 'Failed to load the product.')))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProductsNav /><InvalidRecordLink message={linkError} listHref="/dashboard/products" listLabel="Back to products" /></div>)

  const remove = async () => {
    setConfirmDelete(false)
    try {
      await productsApi.remove(id)
      router.push('/dashboard/products')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete the product.'))
    }
  }

  return (
    <div>
      <ProductsNav />
      <PageHeader title={p ? `${p.code} — ${p.name}` : 'Product'}>
        {p && can('sales', 'products', 'edit') && (
          <button type="button" style={primaryBtnStyle} onClick={() => router.push(`/dashboard/products/${ref}/edit`)}>Edit</button>
        )}
        {p && p.status === 'development' && canDelete('sales', 'products', p.created_by_id) && (
          <button type="button" style={dangerBtnStyle} onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/products')}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />

      {p && (
        <>
          {/* One card: what the product is, then its master data and applications. */}
          <DetailCard>
            <DetailSummary
              title={p.name}
              text={p.short_description || undefined}
              meta={<>
                <Pill text={PRODUCT_STATUS_LABELS[p.status] || p.status} hex={PRODUCT_STATUS_HEX[p.status]} />
                <span style={{ color: '#cbd5e1' }}>·</span><span>Code <strong style={{ color: '#0f172a' }}>{p.code}</strong></span>
                <span style={{ color: '#cbd5e1' }}>·</span><span>{PRODUCT_TYPE_LABELS[p.product_type] || p.product_type}</span>
                {p.created_by_name && <><span style={{ color: '#cbd5e1' }}>·</span><span>Created by {p.created_by_name}</span></>}
              </>}
            />
            <DetailGroup title="Master data">
              <DetailRow label="Model number">{p.model_number}</DetailRow>
              <DetailRow label="Unit">{p.uom}</DetailRow>
              <DetailRow label="HSN code">{p.hsn_code}</DetailRow>
              <DetailRow label="Warranty">{p.warranty_months != null ? `${p.warranty_months} months` : null}</DetailRow>
              <DetailRow label="Store item">{p.store_item_code ? `${p.store_item_code} — ${p.store_item_name}` : 'Not linked'}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Description & applications" last>
              <DetailRow label="Description">{p.description}</DetailRow>
              <DetailRow label="Applications">
                {p.applications.length === 0 ? null : (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {p.applications.map((a) => <Pill key={a.id} text={a.is_active ? a.name : `${a.name} (retired)`} hex="#7c3aed" />)}
                  </span>
                )}
              </DetailRow>
            </DetailGroup>
          </DetailCard>

          {canFeature('sales', 'products', 'specifications', 'view') && <Section title="Technical specifications" style={{ marginBottom: 16 }}>
            {p.specifications.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No specifications recorded yet.</p>
            ) : (
              <div style={{ ...tableWrapStyle, maxHeight: 'none' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead><tr>{['Parameter', 'Value', 'Unit'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={p.specifications.length} />}</th>)}</tr></thead>
                  <tbody>
                    {p.specifications.map((s) => (
                      <tr key={s.id}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{s.parameter}</td>
                        <td style={tdStyle}>{s.value}</td>
                        <td style={tdStyle}>{s.unit || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>}

          <ProductSalesPanels productId={p.id} />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete product?"
        message={p ? `${p.code} — ${p.name} will be permanently deleted with its specifications. This can't be undone.` : ''}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
