'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import ActivityForm from '@/components/crm/ActivityForm'

export default function NewActivityPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/activities')} style={{ cursor: 'pointer' }}>Activities</span> › New
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Log Activity</h1>
      </div>

      <ActivityForm
        submitLabel="Log Activity"
        onCancel={() => router.push('/dashboard/crm/activities')}
        onSubmit={async (payload, photos) => {
          const created = await crmApi.createActivity(payload)
          if (photos.length) await crmApi.uploadActivityAttachments(created.id, photos)
          router.push('/dashboard/crm/activities')
        }}
      />
    </div>
  )
}
