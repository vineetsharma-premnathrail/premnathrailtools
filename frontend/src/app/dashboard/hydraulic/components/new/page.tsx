'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import ComponentForm from '@/components/hydraulic/ComponentForm'

export default function NewHydComponentPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Component</h1>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/components')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <ComponentForm
        submitLabel="Create Component"
        onSubmit={async (payload) => {
          const comp = await hydraulicApi.createComponent(payload)
          router.push(`/dashboard/hydraulic/components/${comp.id}`)
        }}
      />
    </div>
  )
}
