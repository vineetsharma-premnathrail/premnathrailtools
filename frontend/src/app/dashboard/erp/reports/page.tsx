'use client'

import { useRequireApp } from '@/hooks/useAuth'
import ErpNav from '@/components/erp/ErpNav'
import ModuleDashboardPage from '@/components/reports/ModuleDashboardPage'

export default function ErpReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleDashboardPage
      module="erp"
      nav={<ErpNav />}
      title="Reports"
      subtitle="Service performance at a glance"
    />
  )
}
