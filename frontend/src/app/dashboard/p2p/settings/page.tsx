'use client'

import { useAuth } from '@/hooks/useAuth'
import { canViewTab } from '@/lib/tabAccess'
import { p2pApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import P2PNav from '@/components/p2p/P2PNav'
import PurposeRulesCard from '@/components/p2p/PurposeRulesCard'
import BuyerResponsibilityCard from '@/components/p2p/BuyerResponsibilityCard'

export default function ProcurementSettingsPage() {
  // Procurement › Settings › View opens it (read-only unless allowed to edit) — the tick decides (2026-11-14).
  const { user, isLoading } = useAuth()
  const allowed = !!user && canViewTab('p2p', 'settings', user)
  if (isLoading) return <div><P2PNav /><p role="status" style={{ fontSize: 13 }}>Loading…</p></div>
  if (!allowed) return <div><P2PNav /><p role="alert" style={{ fontSize: 13 }}>You don&apos;t have &apos;View&apos; on Procurement › Settings. Ask an admin to add it to your role in Organization › Role &amp; Permissions.</p></div>
  return (
    <ModuleSettingsPage title="Procurement settings" nav={<P2PNav />} backHref="/dashboard/p2p"
      load={p2pApi.getSettings} save={p2pApi.saveSettings} reset={p2pApi.resetSetting}
      leadSections={<><PurposeRulesCard /><BuyerResponsibilityCard /></>} tourPrefix="p2p-settings" />
  )
}
