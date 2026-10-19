'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import PmPlanForm from '@/components/maintenance/PmPlanForm'

export default function NewPmPlanPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?asset=<signed ref> pre-selects the asset (from its detail page).
  const presetRef = searchParams.get('asset')
  const { id: presetAsset, error: linkError, loading: presetLoading } = useRecordId(presetRef)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/schedule" listLabel="Back to PM schedule" /></div>)
  if (presetLoading) return <div><MaintenanceNav /></div>

  return (
    <PmPlanForm
      nav={<MaintenanceNav />}
      title="New PM Plan"
      subtitle="A recurring preventive job — the work order is raised automatically a few days before it falls due."
      onBack={() => router.push(presetRef ? `/dashboard/maintenance/assets/${presetRef}` : '/dashboard/maintenance/schedule')}
      presetAssetId={presetAsset}
      submitLabel="Create PM Plan"
      onSubmit={async (payload) => {
        const plan = await maintenanceApi.createPmPlan(payload)
        router.push(recordPath('/dashboard/maintenance/schedule', plan))
      }}
    />
  )
}
