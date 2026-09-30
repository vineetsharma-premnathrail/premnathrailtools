'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import CircuitForm from '@/components/hydraulic/CircuitForm'

function NewHydCircuitPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemId = searchParams.get('system_id') || ''

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>New Circuit</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 20px' }}>
            The circuit is created as Rev A (draft). Upload the schematic on the next page, then submit it for review.
          </p>
        </div>
        <button onClick={() => router.push(systemId ? `/dashboard/hydraulic/systems/${systemId}` : '/dashboard/hydraulic/circuits')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <CircuitForm
        defaultSystemId={systemId}
        submitLabel="Create Circuit"
        onSubmit={async (payload) => {
          const circuit = await hydraulicApi.createCircuit(payload)
          router.push(`/dashboard/hydraulic/circuits/${circuit.id}`)
        }}
      />
    </div>
  )
}

// useSearchParams needs a Suspense boundary for the static build.
export default function NewHydCircuitPage() {
  return (
    <Suspense fallback={null}>
      <NewHydCircuitPageInner />
    </Suspense>
  )
}
