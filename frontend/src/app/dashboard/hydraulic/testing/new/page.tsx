'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import TestForm from '@/components/hydraulic/TestForm'

function NewTestInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  // system_id / component_id carry signed record refs (lib/recordRef.ts).
  const sys = useRecordId(searchParams.get('system_id'))
  const comp = useRecordId(searchParams.get('component_id'))
  const linkError = sys.error || comp.error
  const linkLoading = sys.loading || comp.loading
  const presetSystemId = sys.id ? String(sys.id) : ''
  const presetComponentId = comp.id ? String(comp.id) : ''

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/testing" listLabel="Back to tests" /></div>)
  if (linkLoading) return <div><HydraulicNav /></div>

  const back = () => router.push('/dashboard/hydraulic/testing')
  return (
    <TestForm
      nav={<HydraulicNav />}
      title="New Test"
      subtitle="A pressure, leak or functional test of a system or component — record the conditions and readings."
      onBack={back}
      onCancel={back}
      presetSystemId={presetSystemId}
      presetComponentId={presetComponentId}
      submitLabel="Create Test"
      onSubmit={async (payload) => {
        const test = await hydraulicApi.createTest(payload)
        router.push(recordPath('/dashboard/hydraulic/testing', test))
      }}
    />
  )
}

export default function NewHydTestPage() {
  return (
    <Suspense fallback={null}>
      <NewTestInner />
    </Suspense>
  )
}
