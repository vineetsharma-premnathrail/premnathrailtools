'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp, hasErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ServiceRequestForm from '@/components/erp/ServiceRequestForm'

export default function EditServiceRequestPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const params = useParams()
  const router = useRouter()
  const srId = Number(params.id)

  const [sr, setSr] = useState<ServiceRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !srId) return
    erpApi.getServiceRequest(srId).then(setSr).catch(() => setError('Service request not found.')).finally(() => setLoading(false))
  }, [isAuthorized, srId])

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !sr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Service request not found.'}</p>

  const canModify = !!user && (user.role === 'admin' || (sr.created_by_id === user.id && hasErpPermission(user, 'sr_edit')))
  if (!canModify) {
    router.push(`/dashboard/erp/service-requests/${srId}`)
    return null
  }

  return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: '#a8a29e', margin: '0 0 6px' }}>
            <span onClick={() => router.push('/dashboard/erp/service-requests')} style={{ cursor: 'pointer' }}>Service Operations</span> › Edit
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: 0 }}>Edit — {sr.request_number}</h1>
        </div>
        <button
          onClick={() => router.push(`/dashboard/erp/service-requests/${srId}`)}
          style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', cursor: 'pointer' }}
        >
          ‹ Back
        </button>
      </div>

      <ServiceRequestForm
        initial={sr}
        lockProject
        submitLabel="Save Changes"
        onCancel={() => router.push(`/dashboard/erp/service-requests/${srId}`)}
        onSubmit={async (payload, files) => {
          delete payload.project_id
          await erpApi.updateServiceRequest(srId, payload)
          if (files.length > 0) {
            await erpApi.uploadAttachments(srId, files)
          }
          router.push(`/dashboard/erp/service-requests/${srId}`)
        }}
      />
    </div>
  )
}
