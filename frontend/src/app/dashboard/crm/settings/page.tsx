'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import CrmNav from '@/components/crm/CrmNav'
import CrmListsSection from '@/components/crm/masters/CrmListsSection'

export default function CrmSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="CRM settings" nav={<CrmNav />} backHref="/dashboard/crm"
      load={crmApi.getSettings} save={crmApi.saveSettings} reset={crmApi.resetSetting}
      leadSections={<CrmListsSection />} tourPrefix="crm-settings" />
  )
}
