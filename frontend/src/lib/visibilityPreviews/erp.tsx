'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

const noop = () => {}

// Loaded on demand so the Role editor does not carry every previewable screen.
const SrForm = dynamic(() => import('@/components/erp/ServiceRequestForm').then((m) => {
  const Form = m.default
  return function SrFormPreview() {
    return (
      <Form title="Create Service Request" subtitle="Log a fault or service job against a machine — warranty cover is checked as you pick it."
        submitLabel="Create Request" onCancel={noop} onSubmit={async () => {}} />
    )
  }
}), { ssr: false })
const SrDetail = dynamic(() => import('@/app/dashboard/erp/service-requests/[id]/page'), { ssr: false })
const SrList = dynamic(() => import('@/app/dashboard/erp/service-requests/page'), { ssr: false })

/** Service & Commissioning screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const erpPreviews: PreviewScreens = {
  'erp:service_requests': { form: SrForm, detail: SrDetail, list: SrList },
}
