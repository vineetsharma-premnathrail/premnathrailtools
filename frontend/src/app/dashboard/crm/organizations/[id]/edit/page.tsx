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
  const [error, setError] = useState('')

  useEffect(() => {
    if (isAuthorized && orgId) {
      setError('')
      crmApi.getOrganization(orgId).then(setOrg).catch(() => setError('Failed to load organization.'))
    }
  }, [isAuthorized, orgId])

  if (isLoading || !isAuthorized) return null

  if (error) {
    return (
      <div>
        <CrmNav />
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      </div>
    )
  }

  if (!org) return null

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
