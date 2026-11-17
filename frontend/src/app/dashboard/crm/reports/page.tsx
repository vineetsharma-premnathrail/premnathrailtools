'use client'

import CrmNav, { useCrmTabAccess } from '@/components/crm/CrmNav'
import ModuleDashboardPage from '@/components/reports/ModuleDashboardPage'

export default function CrmReportsPage() {
  const { isAuthorized, isLoading } = useCrmTabAccess('reports')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleDashboardPage
      module="crm"
      nav={<CrmNav />}
      title="Reports"
      subtitle="How many leads came in, from where and for which products"
      dataTab={false}
    />
  )
}
