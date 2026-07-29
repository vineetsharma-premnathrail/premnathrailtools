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
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push(`/dashboard/crm/organizations/${orgId}`)} style={{ cursor: 'pointer' }}>{org.name}</span> › Edit
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Edit Organization</h1>
      </div>

      <OrganizationForm
        initial={org}
        submitLabel="Save Changes"
        onCancel={() => router.push(`/dashboard/crm/organizations/${orgId}`)}
        onSubmit={(payload) => crmApi.updateOrganization(orgId, payload)}
        onSaved={() => router.push(`/dashboard/crm/organizations/${orgId}`)}
      />
    </div>
  )
}
