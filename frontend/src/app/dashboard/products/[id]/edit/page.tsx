'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { productsApi } from '@/lib/api'
import { FinishedProduct } from '@/types'
import ProductsNav from '@/components/products/ProductsNav'
import ProductForm from '@/components/products/ProductForm'
import { ErrorBanner, PageHeader } from '@/components/products/ProductBits'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

export default function EditProductPage() {
  const { isAuthorized, isLoading } = useRequireApp('products')
  const router = useRouter()
  const ref = useParams().id as string
  const { id: recordId, error: linkError } = useRecordId(ref)
  const id = recordId ?? 0
  const [product, setProduct] = useState<FinishedProduct | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (isAuthorized && id) productsApi.get(id).then(setProduct).catch((e) => setError(extractErrorMessages(e, 'Failed to load the product.')))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProductsNav /><InvalidRecordLink message={linkError} listHref="/dashboard/products" listLabel="Back to products" /></div>)

  const back = () => router.push(`/dashboard/products/${ref}`)
  if (product) return <ProductForm nav={<ProductsNav />} initial={product} onSaved={back} onCancel={back} />
  return (
    <div>
      <ProductsNav />
      <PageHeader title="Edit Product">
        <button type="button" style={secondaryBtnStyle} onClick={back}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />
    </div>
  )
}
