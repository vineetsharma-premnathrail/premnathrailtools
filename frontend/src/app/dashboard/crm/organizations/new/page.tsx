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

      <OrganizationForm
        title="Add Organization"
        breadcrumb={<><span onClick={() => router.push('/dashboard/crm/organizations')} style={{ cursor: 'pointer' }}>Organizations</span> › New</>}
        submitLabel="Save Organization"
        onCancel={() => router.push('/dashboard/crm/organizations')}
        onSubmit={(payload) => crmApi.createOrganization(payload)}
        onSaved={(org) => router.push(`/dashboard/crm/organizations/${org.id}`)}
      />
    </div>
  )
}
