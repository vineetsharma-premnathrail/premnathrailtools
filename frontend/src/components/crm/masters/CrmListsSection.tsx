'use client'

// CRM → Settings → the lists CRM forms pick from: Products, Product
// Categories, Payment Terms and Document Categories (add / edit / delete each). ?section=… picks
// the list to open (old Masters links redirect here with it).

import { useState } from 'react'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import ProductsManager from './ProductsManager'
import ProductCategoriesManager from './ProductCategoriesManager'
import PaymentTermsManager from './PaymentTermsManager'
import DocumentCategoriesManager from './DocumentCategoriesManager'
import { chipBtnStyle } from '@/components/shared/ui'

const SECTIONS = [
  { key: 'products', label: 'Products' },
  { key: 'product-categories', label: 'Product Categories' },
  { key: 'payment-terms', label: 'Payment Terms' },
  { key: 'document-categories', label: 'Document Categories' },
] as const
type SectionKey = typeof SECTIONS[number]['key']

const fromUrl = (): SectionKey => {
  if (typeof window === 'undefined') return 'products'
  const v = new URLSearchParams(window.location.search).get('section')
  return (SECTIONS.find((s) => s.key === v)?.key) || 'products'
}

export default function CrmListsSection() {
  const [section, setSection] = useState<SectionKey>(fromUrl)

  return (
    <div data-tour="crm-settings-lists" style={{
      borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
      border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Lists used in CRM forms</h2>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
        Products (with their category), product categories, payment terms and document categories offered in inquiries, tenders and quotations.
        Add, edit or remove entries any time — changes show up in the forms straight away.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)} data-tour={`crm-settings-${s.key}`}
            style={chipBtnStyle(section === s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'products' && <ProductsManager />}
      {section === 'product-categories' && <ProductCategoriesManager />}
      {section === 'payment-terms' && <PaymentTermsManager />}
      {section === 'document-categories' && <DocumentCategoriesManager />}
    </div>
  )
}
