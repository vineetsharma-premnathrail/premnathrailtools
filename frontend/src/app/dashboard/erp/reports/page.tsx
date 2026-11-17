'use client'

import ErpNav, { useErpTabAccess } from '@/components/erp/ErpNav'
import ModuleDashboardPage from '@/components/reports/ModuleDashboardPage'

export default function ErpReportsPage() {
  const { isAuthorized, isLoading } = useErpTabAccess('reports')
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
