'use client'

import { useAuth } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import P2PNav from '@/components/p2p/P2PNav'
import ApprovalFlowCard from '@/components/p2p/ApprovalFlowCard'
import PurposeRulesCard from '@/components/p2p/PurposeRulesCard'

export default function ProcurementSettingsPage() {
  // Requesters hold `p2p`, the purchase team `purchase` — either may open Settings (read-only unless allowed to edit).
  const { user, isLoading } = useAuth()
  const allowed = !!user && (user.role === 'admin' || !!user.apps?.some((a) => a === 'p2p' || a === 'purchase'))
  if (isLoading) return <div><P2PNav /><p role="status" style={{ fontSize: 13 }}>Loading…</p></div>
  if (!allowed) return <div><P2PNav /><p role="alert" style={{ fontSize: 13 }}>You don&apos;t have access to Procurement settings. Ask an admin to give you the Procurement app.</p></div>
  return (
    <ModuleSettingsPage title="Procurement settings" nav={<P2PNav />} backHref="/dashboard/p2p"
      load={p2pApi.getSettings} save={p2pApi.saveSettings} reset={p2pApi.resetSetting}
      leadSections={<><ApprovalFlowCard /><PurposeRulesCard /></>} tourPrefix="p2p-settings" />
  )
}
