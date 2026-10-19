'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationForm from '@/components/crm/OrganizationForm'
import { recordPath } from '@/lib/recordRef'

export default function NewOrganizationPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
      <OrganizationForm
        nav={<CrmNav />}
        title="Add Customer Organization"
        breadcrumb={<><span onClick={() => router.push('/dashboard/crm/organizations')} style={{ cursor: 'pointer' }}>Customer Organizations</span> › New</>}
        submitLabel="Save Customer Organization"
        onCancel={() => router.push('/dashboard/crm/organizations')}
        onSubmit={(payload) => crmApi.createOrganization(payload)}
        onSaved={(org) => router.push(recordPath('/dashboard/crm/organizations', org))}
      />
  )
}
