'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

const noop = () => {}

// Loaded on demand so the Role editor does not carry every previewable screen.
const ProductFormPreview = dynamic(() => import('@/components/products/ProductForm').then((m) => {
  const Form = m.default
  // New-product state; Save / Cancel are disabled inside the form in preview mode.
  return function ProductFormScreen() { return <Form onSaved={noop} onCancel={noop} /> }
}), { ssr: false })
const ProductDetail = dynamic(() => import('@/app/dashboard/products/[id]/page'), { ssr: false })
const ProductList = dynamic(() => import('@/app/dashboard/products/page'), { ssr: false })

/** CRM › Products screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const productsPreviews: PreviewScreens = {
  'crm:products': { form: ProductFormPreview, detail: ProductDetail, list: ProductList },
}
