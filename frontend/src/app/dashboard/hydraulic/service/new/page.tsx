'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import ServiceRecordForm from '@/components/hydraulic/ServiceRecordForm'
import { SERVICE_TYPE_LABELS } from '@/components/hydraulic/labels'

const idParam = (v: string | null) => (v && /^\d+$/.test(v) ? v : '')

function NewServiceRecordInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemId = idParam(searchParams.get('system_id'))
  const planId = idParam(searchParams.get('plan_id'))
  const type = searchParams.get('type') || ''

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Service Job</h1>
        </div>
        <button onClick={() => router.push(planId ? `/dashboard/hydraulic/maintenance/${planId}` : '/dashboard/hydraulic/service')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <ServiceRecordForm
        defaults={{ systemId, planId, serviceType: SERVICE_TYPE_LABELS[type] ? type : undefined }}
        submitLabel="Create Service Job"
        onSubmit={async (payload) => {
          const rec = await hydraulicApi.createServiceRecord(payload)
          router.push(`/dashboard/hydraulic/service/${rec.id}`)
        }}
      />
    </div>
  )
}

export default function NewHydServiceRecordPage() {
  return (
    <Suspense fallback={null}>
      <NewServiceRecordInner />
    </Suspense>
  )
}
