'use client'

// Product detail extras (COMMPR01 merge): the product's price conditions,
// product-wise order book (Sales) and quotation history (CRM). Each panel
// shows only when the user has the module that owns the data.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { pricingApi, productMappingApi, PriceCondition } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { formatINR } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'
import { TEXT } from '@/lib/theme'
import { Section } from '@/components/shared/ui'
import { ErrorBanner, tableWrapStyle, tdStyle, thStyle } from '@/components/products/ProductBits'

interface OrderBookRow { so_id: number; so_number: string; status: string; customer_name: string | null; customer_po_number: string | null; po_date: string | null; quantity: number; qty_delivered: number; open_qty: number; unit_price: number | null; taxable_amount: number | null }
interface QuoteRow { quotation_id: number; quot_number: string | null; quote_date: string | null; customer_name: string | null; inquiry_id: number; inquiry_ref: string; quantity: number | null; unit_price: number | null; list_price: number | null; price_override_reason: string | null; customer_response: string | null }

export default function ProductSalesPanels({ productId }: { productId: number }) {
  const { user } = useAuth()
  const apps = (user?.apps as string[] | undefined) || []
  const [prices, setPrices] = useState<PriceCondition[]>([])
  const [book, setBook] = useState<{ rows: OrderBookRow[]; totals: Record<string, number | null> } | null>(null)
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [error, setError] = useState<string | string[]>('')
  // Product › Products features (core/features/products.py): the sections, and the
  // Prices & sales values switch (the server blanks order-book / quotation prices too).
  const { canFeature } = useCan()
  const seePrices = canFeature('products', 'products', 'prices', 'view')
  const seeOrderBook = apps.includes('sales') && canFeature('products', 'products', 'order_book', 'view')
  const seeQuotes = apps.includes('crm') && canFeature('products', 'products', 'quotation_history', 'view')

  useEffect(() => {
    if (!productId) return
    if (seePrices) pricingApi.list({ product_id: productId }).then(setPrices).catch(() => setPrices([]))
    if (seeOrderBook) productMappingApi.orderBook(productId).then(setBook).catch((e) => setError(extractErrorMessages(e, 'Could not load the order book.')))
    if (seeQuotes) productMappingApi.quotationHistory(productId).then((d) => setQuotes(d.quotations || [])).catch(() => setQuotes([]))
  }, [productId, seePrices, seeOrderBook, seeQuotes])

  return (
    <>
      <ErrorBanner error={error} />
      {seePrices && <Section title="Prices (Sales › Pricing)" style={{ marginBottom: 16 }}>
        {prices.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No price conditions — this product is priced per quotation.</p> : (
          <div style={{ ...tableWrapStyle, maxHeight: 320 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>{['Type', 'Customer', 'Value', 'Min. price', 'Valid', 'Today'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {prices.map((c) => (
                  <tr key={c.id}>
                    <td style={tdStyle}>{c.condition_type}</td>
                    <td style={tdStyle}>{c.customer_name || 'All (list)'}</td>
                    <td style={tdStyle}>{c.condition_type === 'discount' ? `${c.percent}%` : formatINR(c.amount)}</td>
                    <td style={tdStyle}>{c.min_price == null ? '—' : formatINR(c.min_price)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(c.valid_from)} → {c.valid_to ? formatDate(c.valid_to) : 'open'}</td>
                    <td style={tdStyle}>{c.is_current ? 'Valid' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>}

      {book && seeOrderBook && (
        <Section title="Order book" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
            Ordered {book.totals.ordered_qty} · open {book.totals.open_qty}{seePrices && <> · order value {formatINR(book.totals.order_value ?? 0)} · open value {formatINR(book.totals.open_value ?? 0)}</>}
          </p>
          {book.rows.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No sales order lines for this product yet.</p> : (
            <div style={{ ...tableWrapStyle, maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                <thead><tr>{['Order', 'Status', 'Customer', 'PO', 'Qty', 'Delivered', 'Open', ...(seePrices ? ['Unit price', 'Value'] : [])].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {book.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={tdStyle}><Link href={recordPath('/dashboard/sales/orders', r, 'so_id')} style={{ color: '#2563eb', fontWeight: 600 }}>{r.so_number}</Link></td>
                      <td style={tdStyle}>{r.status.replace(/_/g, ' ')}</td>
                      <td style={tdStyle}>{r.customer_name || '—'}</td>
                      <td style={tdStyle}>{r.customer_po_number || '—'}</td>
                      <td style={tdStyle}>{r.quantity}</td>
                      <td style={tdStyle}>{r.qty_delivered}</td>
                      <td style={tdStyle}>{r.open_qty}</td>
                      {seePrices && <td style={tdStyle}>{formatINR(r.unit_price ?? 0)}</td>}
                      {seePrices && <td style={tdStyle}>{formatINR(r.taxable_amount ?? 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {seeQuotes && (
        <Section title="Quotation history" style={{ marginBottom: 16 }}>
          {quotes.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No quotation lines linked to this product yet.</p> : (
            <div style={{ ...tableWrapStyle, maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead><tr>{['Quotation', 'Date', 'Customer', 'Inquiry', 'Qty', ...(seePrices ? ['Quoted', 'List', 'Override reason'] : []), 'Response'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {quotes.map((q, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{q.quot_number || '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(q.quote_date)}</td>
                      <td style={tdStyle}>{q.customer_name || '—'}</td>
                      <td style={tdStyle}>{q.inquiry_ref}</td>
                      <td style={tdStyle}>{q.quantity ?? '—'}</td>
                      {seePrices && <td style={tdStyle}>{q.unit_price == null ? '—' : formatINR(q.unit_price)}</td>}
                      {seePrices && <td style={tdStyle}>{q.list_price == null ? '—' : formatINR(q.list_price)}</td>}
                      {seePrices && <td style={tdStyle}>{q.price_override_reason || ''}</td>}
                      <td style={tdStyle}>{q.customer_response || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </>
  )
}
