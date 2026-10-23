'use client'

// Product Mapping (COMMPR01 merge): legacy CRM catalogue rows and free-text
// product fields that no exact code / name+model match could link to the
// product master. Pick the product once — every row with the same text is
// linked. Nothing is ever matched by similarity.

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { productsApi } from '@/lib/api'
import { productMappingApi, MappingGroup } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import ProductsNav from '@/components/products/ProductsNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Section, secondaryBtnStyle } from '@/components/shared/ui'
import { ErrorBanner, PageHeader, tableWrapStyle, tdStyle, thStyle } from '@/components/products/ProductBits'
import { TEXT } from '@/lib/theme'

const SOURCE_ORDER = ['crm_products', 'inquiries', 'inquiry_lines', 'quotation_lines', 'so_lines']

export default function ProductMappingPage() {
  const { isAuthorized, isLoading } = useRequireApp('products')
  const { can } = useCan()
  const [data, setData] = useState<Record<string, MappingGroup[]>>({})
  const [sources, setSources] = useState<Record<string, string>>({})
  const [products, setProducts] = useState<{ value: string; label: string }[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    productMappingApi.unmapped().then((d) => {
      const { sources: s, ...rest } = d as { sources: Record<string, string> } & Record<string, MappingGroup[]>
      setSources(s)
      setData(rest as Record<string, MappingGroup[]>)
      setError('')
    }).catch((e) => setError(extractErrorMessages(e, 'Could not load the unmapped products.')))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    load()
    productsApi.list().then((ps) => setProducts(ps.filter((p) => p.status !== 'discontinued')
      .map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}${p.model_number ? ` (${p.model_number})` : ''}` })))).catch(() => setProducts([]))
  }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null
  const canEdit = can('sales', 'product_mapping', 'edit')

  const assign = async (source: string, g: MappingGroup, productId: string) => {
    if (!productId) return
    setBusy(true)
    try {
      const r = await productMappingApi.assign({ source, product_id: Number(productId), crm_product_id: g.crm_product_id, text: g.text, model: g.model })
      setNotice(`${r.updated} row(s) linked.`)
      load()
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not map the product.'))
    } finally {
      setBusy(false)
    }
  }
  const autoLink = async () => {
    setBusy(true)
    try { const r = await productMappingApi.autoLink(); setNotice(`${r.linked} row(s) linked by exact code / name match.`); load() }
    catch (e) { setError(extractErrorMessages(e, 'Exact matching failed.')) }
    finally { setBusy(false) }
  }

  const total = SOURCE_ORDER.reduce((n, k) => n + (data[k]?.length || 0), 0)
  return (
    <div>
      <ProductsNav />
      <PageHeader title="Product Mapping" subtitle="Link old CRM catalogue rows and typed product names to the product master. Only exact matches are linked automatically.">
        {canEdit && <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={autoLink}>Re-run exact match</button>}
      </PageHeader>
      <ErrorBanner error={error} />
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}
      {!loaded && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      {loaded && total === 0 && !error && <p style={{ fontSize: 13, color: TEXT.muted }}>Everything is linked to the product master.</p>}
      {SOURCE_ORDER.filter((k) => (data[k]?.length || 0) > 0).map((k) => (
        <Section key={k} title={`${sources[k] || k} — ${data[k].length} unmapped`} style={{ marginBottom: 16 }}>
          <div style={{ ...tableWrapStyle, maxHeight: 420 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>{['Text as typed', 'Model', 'Rows', 'Map to product'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {data[k].map((g, i) => (
                  <tr key={`${k}-${i}`}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{g.text || '—'}{g.category ? <span style={{ color: TEXT.muted, fontWeight: 400 }}> · {g.category}</span> : null}</td>
                    <td style={tdStyle}>{g.model || '—'}</td>
                    <td style={tdStyle}>{g.count}</td>
                    <td style={{ ...tdStyle, width: 360 }}>
                      {canEdit ? <SearchableSelect value="" onChange={(v) => assign(k, g, v)} options={products} placeholder="Pick the product…" disabled={busy} />
                        : <span style={{ color: TEXT.muted }}>Needs Product Mapping › edit</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </div>
  )
}
