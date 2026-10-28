'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import SalesNav from '@/components/sales/SalesNav'
import PriceConditionsPanel from '@/components/products/PriceConditionsPanel'
import { useCan } from '@/lib/permissions'
import { Section } from '@/components/shared/ui'

export default function SalesSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const { can } = useCan()
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="Sales settings" nav={<SalesNav />} backHref="/dashboard/sales"
      load={salesApi.getSettings} save={salesApi.saveSettings} reset={salesApi.resetSetting}
      extraSections={can('sales', 'pricing', 'view') ? (
        <Section title="Prices" style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>
            Spare prices, service rates (labour hour, visit, km, stay day — used by Service billing) and freight / general discounts. Product prices are kept inside each product.
          </p>
          <PriceConditionsPanel itemKinds={['spare', 'service', 'any']} emptyText="No spare, service or freight prices" />
        </Section>
      ) : null} />
  )
}
