'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import SparePartForm from '@/components/hydraulic/SparePartForm'

function NewSpareInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const raw = searchParams.get('component_id') || ''
  const componentId = /^\d+$/.test(raw) ? raw : ''

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Spare Part</h1>
        </div>
        <button onClick={() => router.push(componentId ? `/dashboard/hydraulic/components/${componentId}` : '/dashboard/hydraulic/spares')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <SparePartForm
        defaultComponentId={componentId}
        submitLabel="Create Spare"
        onSubmit={async (payload) => {
          const spare = await hydraulicApi.createSpare(payload)
          router.push(`/dashboard/hydraulic/spares/${spare.id}`)
        }}
      />
    </div>
  )
}

export default function NewHydSparePartPage() {
  return (
    <Suspense fallback={null}>
      <NewSpareInner />
    </Suspense>
  )
}
