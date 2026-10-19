'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import QualityNav from '@/components/quality/QualityNav'
import LotList from '@/components/quality/LotList'
import { PageHeader } from '@/components/quality/QualityBits'
import { primaryBtnStyle } from '@/components/shared/ui'

function LotsInner() {
  const router = useRouter()
  const { can } = useCan()
  const params = useSearchParams()
  return (
    <>
      <PageHeader title="Inspection Lots">
        {can('quality', 'inspection_lots', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/lots/new')} style={primaryBtnStyle}>+ Manual Lot</button>)}
      </PageHeader>
      <LotList initialType={params.get('type') || ''} />
    </>
  )
}

export default function InspectionLotsPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <QualityNav />
      <Suspense fallback={null}><LotsInner /></Suspense>
    </div>
  )
}
