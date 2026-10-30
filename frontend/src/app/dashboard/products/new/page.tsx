'use client'

import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useProductsAccess } from '@/components/products/useProductsAccess'
import ProductsNav from '@/components/products/ProductsNav'
import ProductForm from '@/components/products/ProductForm'

export default function NewProductPage() {
  const { isAuthorized, isLoading } = useProductsAccess()
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <ProductForm nav={<ProductsNav />} onSaved={(p) => router.push(recordPath('/dashboard/products', p))} onCancel={() => router.push('/dashboard/products')} />
  )
}
