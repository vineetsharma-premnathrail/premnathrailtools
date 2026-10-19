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
import { InfoRow, Section, dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
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
          <Section title="Product" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}><Pill text={PRODUCT_STATUS_LABELS[p.status] || p.status} hex={PRODUCT_STATUS_HEX[p.status]} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              <InfoRow label="Type" value={PRODUCT_TYPE_LABELS[p.product_type] || p.product_type} />
              <InfoRow label="Model number" value={p.model_number || '—'} />
              <InfoRow label="Unit" value={p.uom} />
              <InfoRow label="HSN code" value={p.hsn_code || '—'} />
              <InfoRow label="Warranty" value={p.warranty_months != null ? `${p.warranty_months} months` : '—'} />
              <InfoRow label="Store item" value={p.store_item_code ? `${p.store_item_code} — ${p.store_item_name}` : 'Not linked'} />
              <InfoRow label="Created by" value={p.created_by_name || '—'} />
            </div>
            {p.short_description && <p style={{ fontSize: 13.5, color: TEXT.body, margin: '14px 0 0', fontWeight: 600 }}>{p.short_description}</p>}
            {p.description && <p style={{ fontSize: 13, color: TEXT.body, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{p.description}</p>}
          </Section>

          <Section title="Applications" style={{ marginBottom: 16 }}>
            {p.applications.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No applications tagged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {p.applications.map((a) => <Pill key={a.id} text={a.is_active ? a.name : `${a.name} (retired)`} hex="#7c3aed" />)}
              </div>
            )}
          </Section>

          {canFeature('sales', 'products', 'specifications', 'view') && <Section title="Technical specifications" style={{ marginBottom: 16 }}>
            {p.specifications.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No specifications recorded yet.</p>
            ) : (
              <div style={{ ...tableWrapStyle, maxHeight: 'none' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead><tr>{['Parameter', 'Value', 'Unit'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
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
