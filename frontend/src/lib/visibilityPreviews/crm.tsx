'use client'

import dynamic from 'next/dynamic'
import type { Organization } from '@/types'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
// Each screen reads vis.preview through useVisibility(key): sample data, nothing saved, nav / Back dropped.
const noop = () => {}
const neverSaves = async (): Promise<never> => { throw new Error('Preview only — nothing is saved.') }

const OrgForm = dynamic(() => import('@/components/crm/OrganizationForm').then((m) => {
  const Form = m.default
  return function OrgFormPreview() {
    return <Form title="New Customer Organization" breadcrumb="CRM › Customer Organizations › New" submitLabel="Save"
      onCancel={noop} onSubmit={neverSaves as unknown as () => Promise<Organization>} onSaved={noop} />
  }
}), { ssr: false })
const OrgDetail = dynamic(() => import('@/components/crm/OrganizationDetailPanel').then((m) => {
  const Panel = m.default
  return function OrgDetailPreview() { return <Panel orgId={-1} /> }
}), { ssr: false })
const OrgList = dynamic(() => import('@/app/dashboard/crm/organizations/page'), { ssr: false })

const InquiryForm = dynamic(() => import('@/components/crm/InquiryForm').then((m) => {
  const Form = m.default
  return function InquiryFormPreview() { return <Form submitLabel="Save" onCancel={noop} onSubmit={neverSaves} /> }
}), { ssr: false })
const TenderForm = dynamic(() => import('@/components/crm/TenderForm').then((m) => {
  const Form = m.default
  return function TenderFormPreview() { return <Form submitLabel="Save" onCancel={noop} onSubmit={neverSaves} /> }
}), { ssr: false })
const InquiryDetail = dynamic(() => import('@/components/crm/InquiryDetailPanel').then((m) => {
  const Panel = m.default
  return function InquiryDetailPreview() { return <Panel inquiryId={-1} /> }
}), { ssr: false })
const TenderDetail = dynamic(() => import('@/components/crm/TenderDetailPanel').then((m) => {
  const Panel = m.default
  return function TenderDetailPreview() { return <Panel tenderId={-1} /> }
}), { ssr: false })
const InquiriesList = dynamic(() => import('@/app/dashboard/crm/inquiries/page'), { ssr: false })

/** CRM screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const crmPreviews: PreviewScreens = {
  'crm:organizations': { form: OrgForm, detail: OrgDetail, list: OrgList },
  'crm:inquiries_tenders': {
    inquiry_form: InquiryForm, tender_form: TenderForm, inquiry_detail: InquiryDetail, tender_detail: TenderDetail, list: InquiriesList,
  },
}
