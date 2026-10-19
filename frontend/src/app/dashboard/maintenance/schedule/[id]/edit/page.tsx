'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenancePmPlan } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import PmPlanForm from '@/components/maintenance/PmPlanForm'
import { extractErrorMessages } from '@/lib/validation'

export default function EditPmPlanPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const id = resolvedId ?? 0
  const [plan, setPlan] = useState<MaintenancePmPlan | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getPmPlan(id).then(setPlan).catch((err) => setError(extractErrorMessages(err, 'Failed to load the PM plan.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/schedule" listLabel="Back to PM schedule" /></div>)
  if (!id) return <div><MaintenanceNav /></div>

  if (!plan) {
    return (
      <div>
        <MaintenanceNav />
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
        {!error && loading && (
          <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, fontSize: 13, color: TEXT.muted }}>Loading PM plan…</div>
        )}
      </div>
    )
  }

  return (
    <PmPlanForm
      nav={<MaintenanceNav />}
      title={`Edit ${plan.plan_code}`}
      subtitle={plan.title}
      onBack={() => router.push(`/dashboard/maintenance/schedule/${ref}`)}
      notice={plan.open_work_order_number ? (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', color: '#1d4ed8', fontSize: 13 }}>
          {plan.open_work_order_number} is already open for this plan. Checklist and spares changes apply to the next job onwards, not to {plan.open_work_order_number}.
        </div>
      ) : undefined}
      initial={plan}
      submitLabel="Save Changes"
      onSubmit={async (payload) => {
        await maintenanceApi.updatePmPlan(id, payload)
        router.push(`/dashboard/maintenance/schedule/${ref}`)
      }}
    />
  )
}
