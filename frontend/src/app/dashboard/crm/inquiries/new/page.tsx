'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import InquiryForm from '@/components/crm/InquiryForm'

export default function NewInquiryPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/inquiries')} style={{ cursor: 'pointer' }}>Inquiries</span> › New
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>New Inquiry</h1>
      </div>

      <InquiryForm
        submitLabel="Create Inquiry"
        onCancel={() => router.push('/dashboard/crm/inquiries')}
        onSubmit={async (payload) => {
          const created = await crmApi.createInquiry(payload)
          router.push(`/dashboard/crm/inquiries/${created.id}`)
        }}
      />
    </div>
  )
}
