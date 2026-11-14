'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useProductsAccess } from '@/components/products/useProductsAccess'
import { useCan } from '@/lib/permissions'
import { productsApi } from '@/lib/api'
import { FinishedProduct } from '@/types'
import { TEXT } from '@/lib/theme'
import ProductsNav from '@/components/products/ProductsNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ProductSalesPanels from '@/components/products/ProductSalesPanels'
import ProductSalesResources from '@/components/crm/library/ProductSalesResources'
import { Section, DetailCard, DetailSummary, DetailGroup, DetailRow, dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import {
  ErrorBanner, PageHeader, Pill, PRODUCT_STATUS_HEX, PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS,
} from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'
import { useVisibility } from '@/lib/visibility'
import { VisSection } from '@/lib/visibilityComponents'
import { sampleProduct } from '@/lib/productsPreviewSamples'

export default function ProductDetailPage() {
  const { isAuthorized, isLoading } = useProductsAccess()
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()
  const ref = useParams().id as string
  // Role visibility of this page; in the Role editor's preview it shows a sample product and loads nothing.
  const vis = useVisibility('crm:products')
  const { id: recordId, error: linkError } = useRecordId(vis.preview ? null : ref)
  const id = recordId ?? 0
  const [p, setP] = useState<FinishedProduct | null>(vis.preview ? sampleProduct : null)
  const [error, setError] = useState<string | string[]>('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (isAuthorized && id && !vis.preview) productsApi.get(id).then(setP).catch((e) => setError(extractErrorMessages(e, 'Failed to load the product.')))
  }, [isAuthorized, id, vis.preview])

  if (isLoading || !isAuthorized) return null
  if (linkError && !vis.preview) return (<div><ProductsNav /><InvalidRecordLink message={linkError} listHref="/dashboard/products" listLabel="Back to products" /></div>)

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
      {!vis.preview && <ProductsNav />}
      <PageHeader title={p ? `${p.code} — ${p.name}` : 'Product'}>
        {p && !vis.preview && can('crm', 'products', 'edit') && (
          <button type="button" style={primaryBtnStyle} onClick={() => router.push(`/dashboard/products/${ref}/edit`)}>Edit</button>
        )}
        {p && !vis.preview && p.status === 'development' && canDelete('crm', 'products', p.created_by_id) && (
          <button type="button" style={dangerBtnStyle} onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
        {!vis.preview && <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/products')}>← Back</button>}
      </PageHeader>
      <ErrorBanner error={error} />

      {p && (
        <>
          {/* One card: what the product is, then its master data and description. */}
          <DetailCard>
            <VisSection vis={vis} k="detail_summary">
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
            </VisSection>
            <VisSection vis={vis} k="detail_master_data">
            <DetailGroup title="Master data" last={!vis.preview && !vis.showSection('detail_description')}>
              <DetailRow label="Model number">{p.model_number}</DetailRow>
              <DetailRow label="Unit">{p.uom}</DetailRow>
              <DetailRow label="HSN code">{p.hsn_code}</DetailRow>
              <DetailRow label="Warranty">{p.warranty_months != null ? `${p.warranty_months} months` : null}</DetailRow>
              <DetailRow label="Store item">{p.store_item_code ? `${p.store_item_code} — ${p.store_item_name}` : 'Not linked'}</DetailRow>
            </DetailGroup>
            </VisSection>
            <VisSection vis={vis} k="detail_description">
            <DetailGroup title="Description" last>
              <DetailRow label="Description">{p.description}</DetailRow>
            </DetailGroup>
            </VisSection>
          </DetailCard>

          {canFeature('crm', 'products', 'specifications', 'view') && <VisSection vis={vis} k="detail_specifications"><Section title="Technical specifications" style={{ marginBottom: 16 }}>
            {(() => {
              // Free text, one per line; a product saved before 2026-10-28 falls back to its old rows.
              const text = p.technical_specification || p.specifications.map((r) => `${r.parameter}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`).join('\n')
              return text
                ? <div style={{ fontSize: 13.5, color: TEXT.body, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{text}</div>
                : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No specifications recorded yet.</p>
            })()}
          </Section></VisSection>}

          {/* Pricing loads the product's prices — not drawn for the preview's sample product. */}
          {!vis.preview && <ProductSalesPanels productId={p.id} />}

          {/* Knowledge Hub documents linked to this product (needs CRM › Knowledge Hub › View). */}
          {!vis.preview && <ProductSalesResources product={p} />}
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
