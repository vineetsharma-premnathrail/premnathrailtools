'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'

export default function MaintenanceSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="Maintenance settings" nav={<MaintenanceNav />} backHref="/dashboard/maintenance"
      load={maintenanceApi.getSettings} save={maintenanceApi.saveSettings} reset={maintenanceApi.resetSetting}
      tourPrefix="maint-settings" />
  )
}
