'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import BomForm from '@/components/production/BomForm'

export default function NewBomPage() {
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New BOM</h1>
        </div>
        <button onClick={() => router.push('/dashboard/production/bom')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <BomForm
        submitLabel="Save Draft BOM"
        onSubmit={async (payload) => {
          const bom = await productionApi.createBom(payload)
          router.push(`/dashboard/production/bom/${bom.id}`)
        }}
      />
    </div>
  )
}
