'use client'

import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import ProductsNav from '@/components/products/ProductsNav'
import ProductForm from '@/components/products/ProductForm'

export default function NewProductPage() {
  const { isAuthorized, isLoading } = useRequireApp('products')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <ProductForm nav={<ProductsNav />} onSaved={(p) => router.push(recordPath('/dashboard/products', p))} onCancel={() => router.push('/dashboard/products')} />
  )
}
