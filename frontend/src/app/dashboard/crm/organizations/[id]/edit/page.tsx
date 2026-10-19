'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Organization } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationForm from '@/components/crm/OrganizationForm'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function EditOrganizationPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: orgId, error: linkError } = useRecordId(ref)
  const [org, setOrg] = useState<Organization | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isAuthorized && orgId) {
      crmApi.getOrganization(orgId).then(setOrg).catch((err) => setError(extractErrorMessages(err, 'Could not load this customer organization — check your connection and reload; if it persists your account may lack access to this module.').join(' ')))
    }
  }, [isAuthorized, orgId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><CrmNav /><InvalidRecordLink message={linkError} listHref="/dashboard/crm/organizations" listLabel="Back to customer organizations" /></div>)

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
      <OrganizationForm
        nav={<CrmNav />}
        initial={org}
        title="Edit Customer Organization"
        breadcrumb={<><span onClick={() => router.push(`/dashboard/crm/organizations/${ref}`)} style={{ cursor: 'pointer' }}>{org.name}</span> › Edit</>}
        submitLabel="Save Changes"
        onCancel={() => router.push(`/dashboard/crm/organizations/${ref}`)}
        onSubmit={(payload) => crmApi.updateOrganization(orgId!, payload)}
        onSaved={() => router.push(`/dashboard/crm/organizations/${ref}`)}
      />
  )
}
