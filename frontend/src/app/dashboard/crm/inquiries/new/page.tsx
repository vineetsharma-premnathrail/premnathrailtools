'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import InquiryForm from '@/components/crm/InquiryForm'
import TenderForm from '@/components/crm/TenderForm'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

type Kind = 'inquiry' | 'tender'

export default function NewInquiryOrTenderPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [type, setType] = useState<Kind>(searchParams.get('type') === 'tender' ? 'tender' : 'inquiry')
  // Opened from a customer organization (Add Inquiry / Add Tender): the org is
  // pre-filled and locked, and Back / Cancel return to that organization.
  const { id: orgId, error: orgLinkError, loading: orgLoading } = useRecordId(searchParams.get('org'))
  const backParam = searchParams.get('back')
  const backHref = backParam && backParam.startsWith('/dashboard/') ? backParam : '/dashboard/crm/inquiries'

  if (isLoading || !isAuthorized) return null
  if (orgLinkError) return <div><CrmNav /><InvalidRecordLink message={orgLinkError} listHref="/dashboard/crm/organizations" listLabel="Back to customer organizations" /></div>
  if (searchParams.get('org') && (orgLoading || !orgId)) return <div><CrmNav /></div>

  const back = () => router.push(backHref)
  // Inquiry and Tender share this page; the toggle sits above the form card.
  const nav = (
    <>
      <CrmNav />
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 16 }}>
        {(['inquiry', 'tender'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setType(k)}
            data-tour={`new-record-tab-${k}`}
            style={{
              padding: '8px 20px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'capitalize',
              background: type === k ? '#fff' : 'transparent',
              color: type === k ? '#2563eb' : '#64748b',
              boxShadow: type === k ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {k}
          </button>
        ))}
      </div>
    </>
  )

  return type === 'inquiry' ? (
    <InquiryForm
      key={`inq-${orgId ?? ''}`}
      defaultOrgId={orgId ?? undefined}
      nav={nav}
      onBack={back}
      submitLabel="Create Inquiry"
      onCancel={back}
      onSubmit={async (payload) => {
        const created = await crmApi.createInquiry(payload)
        router.push(recordPath('/dashboard/crm/inquiries', created))
      }}
    />
  ) : (
    <TenderForm
      key={`tnd-${orgId ?? ''}`}
      defaultOrgId={orgId ?? undefined}
      nav={nav}
      onBack={back}
      submitLabel="Create Tender"
      onCancel={back}
      onSubmit={async (payload) => {
        const created = await crmApi.createTender(payload)
        router.push(recordPath('/dashboard/crm/tenders', created))
      }}
    />
  )
}
