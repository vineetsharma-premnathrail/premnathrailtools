'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import TenderForm from '@/components/crm/TenderForm'

export default function NewTenderPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/tenders')} style={{ cursor: 'pointer' }}>Tenders</span> › New
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>New Tender</h1>
      </div>

      <TenderForm
        submitLabel="Create Tender"
        onCancel={() => router.push('/dashboard/crm/tenders')}
        onSubmit={async (payload) => {
          const created = await crmApi.createTender(payload)
          router.push(`/dashboard/crm/tenders/${created.id}`)
        }}
      />
    </div>
  )
}
