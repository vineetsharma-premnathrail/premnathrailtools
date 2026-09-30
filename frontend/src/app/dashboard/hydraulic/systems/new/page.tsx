'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import SystemForm from '@/components/hydraulic/SystemForm'

function NewHydSystemInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultType = searchParams.get('type') === 'pneumatic' ? 'pneumatic' : 'hydraulic'

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New System</h1>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/systems')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <SystemForm
        defaultSystemType={defaultType}
        submitLabel="Create System"
        onSubmit={async (payload) => {
          const system = await hydraulicApi.createSystem(payload)
          router.push(`/dashboard/hydraulic/systems/${system.id}`)
        }}
      />
    </div>
  )
}

export default function NewHydSystemPage() {
  return (
    <Suspense fallback={null}>
      <NewHydSystemInner />
    </Suspense>
  )
}
