'use client'

// Product detail extras: the product's country-wise prices. Order book and
// quotation history were removed from the product page (owner, 2026-10-29).

import { useCan } from '@/lib/permissions'
import PriceConditionsPanel from '@/components/products/PriceConditionsPanel'
import { TEXT } from '@/lib/theme'
import { Section } from '@/components/shared/ui'

export default function ProductSalesPanels({ productId }: { productId: number }) {
  // Product › Products › Prices & sales values (sensitive switch).
  const { canFeature, can } = useCan()
  const seePrices = canFeature('sales', 'products', 'prices', 'view')

  if (!seePrices || !can('sales', 'pricing', 'view')) return null
  return (
    <Section title="Pricing" style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>List price and country-wise prices for this product. Sales orders and quotations take the price of the customer&apos;s country, else the list price; with no price the line is priced per quotation.</p>
      <PriceConditionsPanel productId={productId} emptyText="No prices for this product" />
    </Section>
  )
}
