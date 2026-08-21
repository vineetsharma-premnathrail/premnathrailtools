'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Organization } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationForm from '@/components/crm/OrganizationForm'

export default function EditOrganizationPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const orgId = Number(params.id)
  const [org, setOrg] = useState<Organization | null>(null)

  useEffect(() => {
    if (isAuthorized && orgId) crmApi.getOrganization(orgId).then(setOrg)
  }, [isAuthorized, orgId])

  if (isLoading || !isAuthorized || !org) return null

  return (
    <div>
      <CrmNav />

      <OrganizationForm
        initial={org}
        title="Edit Organization"
        breadcrumb={<><span onClick={() => router.push(`/dashboard/crm/organizations/${orgId}`)} style={{ cursor: 'pointer' }}>{org.name}</span> › Edit</>}
        submitLabel="Save Changes"
        onCancel={() => router.push(`/dashboard/crm/organizations/${orgId}`)}
        onSubmit={(payload) => crmApi.updateOrganization(orgId, payload)}
        onSaved={() => router.push(`/dashboard/crm/organizations/${orgId}`)}
      />
    </div>
  )
}
