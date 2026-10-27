'use client'

import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import ModuleDashboardPage from '@/components/reports/ModuleDashboardPage'

export default function CrmReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
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
