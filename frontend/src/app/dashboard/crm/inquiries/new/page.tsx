'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import InquiryForm from '@/components/crm/InquiryForm'
import TenderForm from '@/components/crm/TenderForm'

type Kind = 'inquiry' | 'tender'

export default function NewInquiryOrTenderPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [type, setType] = useState<Kind>(searchParams.get('type') === 'tender' ? 'tender' : 'inquiry')

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/inquiries')} style={{ cursor: 'pointer' }}>Inquiries &amp; Tenders</span> › New
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: '0 0 16px' }}>New Record</h1>

        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)' }}>
          {(['inquiry', 'tender'] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setType(k)}
              style={{
                padding: '8px 20px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textTransform: 'capitalize',
                background: type === k ? '#fff' : 'transparent',
                color: type === k ? '#fa9b9b' : '#78716c',
                boxShadow: type === k ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {type === 'inquiry' ? (
        <InquiryForm
          submitLabel="Create Inquiry"
          onCancel={() => router.push('/dashboard/crm/inquiries')}
          onSubmit={async (payload) => {
            const created = await crmApi.createInquiry(payload)
            router.push(`/dashboard/crm/inquiries/${created.id}`)
          }}
        />
      ) : (
        <TenderForm
          submitLabel="Create Tender"
          onCancel={() => router.push('/dashboard/crm/inquiries')}
          onSubmit={async (payload) => {
            const created = await crmApi.createTender(payload)
            router.push(`/dashboard/crm/tenders/${created.id}`)
          }}
        />
      )}
    </div>
  )
}
