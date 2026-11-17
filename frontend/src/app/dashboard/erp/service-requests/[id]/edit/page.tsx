'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp, hasErpPermission } from '@/hooks/useAuth'
import { canChangeRecord } from '@/lib/permissions'
import { erpApi } from '@/lib/api'
import { ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ServiceRequestForm from '@/components/erp/ServiceRequestForm'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function EditServiceRequestPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: srId, error: linkError } = useRecordId(ref)

  const [sr, setSr] = useState<ServiceRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !srId) return
    erpApi.getServiceRequest(srId).then(setSr).catch((err) => setError(extractErrorMessages(err, 'Could not load this service request — check your connection and reload the page.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized, srId])

  // Mirrors the backend: Service Requests › Edit AND the SR inside the role's Service Edit scope (default = SRs
  // you raised or are the assigned engineer of). Anyone else is sent back to the detail page.
  const canModify = !!sr && hasErpPermission(user, 'sr_edit')
    && canChangeRecord(user, 'erp', { ownerIds: [sr.created_by_id], assignedIds: [sr.assigned_service_person_id] })
  useEffect(() => {
    if (sr && user && !canModify) router.push(`/dashboard/erp/service-requests/${ref}`)
  }, [sr, user, canModify, router, ref])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ErpNav /><InvalidRecordLink message={linkError} listHref="/dashboard/erp/service-requests" listLabel="Back to service requests" /></div>)
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !sr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Service request not found — it may be in the Recycle Bin.'}</p>
  if (!canModify) return null

  return (
    <div>
      <ServiceRequestForm
        nav={<ErpNav />}
        title={`Edit — ${sr.request_number}`}
        subtitle={sr.issue_title || 'Service request'}
        initial={sr}
        lockProject
        submitLabel="Save Changes"
        onCancel={() => router.push(`/dashboard/erp/service-requests/${ref}`)}
        onSubmit={async (payload, files) => {
          delete payload.project_id
          await erpApi.updateServiceRequest(srId!, payload)
          if (files.length > 0) {
            await erpApi.uploadAttachments(srId!, files)
          }
          router.push(`/dashboard/erp/service-requests/${ref}`)
        }}
      />
    </div>
  )
}
