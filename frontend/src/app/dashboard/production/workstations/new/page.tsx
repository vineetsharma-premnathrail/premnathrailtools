'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import WorkstationForm from '@/components/production/WorkstationForm'

export default function NewWorkstationPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Workstation</h1>
        </div>
        <button onClick={() => router.push('/dashboard/production/workstations')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <WorkstationForm
        submitLabel="Create Workstation"
        onSubmit={async (payload) => {
          const ws = await productionApi.createWorkstation(payload)
          router.push(`/dashboard/production/workstations/${ws.id}`)
        }}
      />
    </div>
  )
}
