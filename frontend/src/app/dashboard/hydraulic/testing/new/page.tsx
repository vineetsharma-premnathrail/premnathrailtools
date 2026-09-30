'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import TestForm from '@/components/hydraulic/TestForm'

// Only plain positive integers are accepted from the query string.
const idParam = (v: string | null) => (v && /^\d+$/.test(v) ? v : '')

function NewTestInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const presetSystemId = idParam(searchParams.get('system_id'))
  const presetComponentId = idParam(searchParams.get('component_id'))

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Test</h1>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/testing')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <TestForm
        presetSystemId={presetSystemId}
        presetComponentId={presetComponentId}
        submitLabel="Create Test"
        onSubmit={async (payload) => {
          const test = await hydraulicApi.createTest(payload)
          router.push(`/dashboard/hydraulic/testing/${test.id}`)
        }}
      />
    </div>
  )
}

export default function NewHydTestPage() {
  return (
    <Suspense fallback={null}>
      <NewTestInner />
    </Suspense>
  )
}
