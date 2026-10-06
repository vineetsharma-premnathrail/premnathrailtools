'use client'

import { useRequireApp } from '@/hooks/useAuth'
import QualityNav from '@/components/quality/QualityNav'
import LotList from '@/components/quality/LotList'
import { PageHeader } from '@/components/quality/QualityBits'

export default function MyInspectionsPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <QualityNav />
      <PageHeader title="My Inspections" />
      <p style={{ fontSize: 13, color: '#78716c', margin: '-10px 0 16px' }}>
        Open inspection lots assigned to you, plus unassigned lots anyone can pick up. Lots are created automatically from GRNs and production output for items flagged &ldquo;inspection on receipt&rdquo;.
      </p>
      <LotList mine />
    </div>
  )
}
