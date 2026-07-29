'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationForm from '@/components/crm/OrganizationForm'

export default function NewOrganizationPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/organizations')} style={{ cursor: 'pointer' }}>Organizations</span> › New
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Add Organization</h1>
      </div>

      <OrganizationForm
        submitLabel="Create Organization"
        onCancel={() => router.push('/dashboard/crm/organizations')}
        onSubmit={(payload) => crmApi.createOrganization(payload)}
        onSaved={(org) => router.push(`/dashboard/crm/organizations/${org.id}`)}
      />
    </div>
  )
}
