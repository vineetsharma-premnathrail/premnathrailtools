'use client'

// Product detail extras: the product's prices,
// product-wise order book (Sales) and quotation history (CRM). Each panel
// shows only when the user has the module that owns the data.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { productMappingApi } from '@/lib/sdServiceApi'
import PriceConditionsPanel from '@/components/products/PriceConditionsPanel'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { formatINR, SO_STATUS_LABELS, SO_STATUS_HEX } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'
import { TEXT } from '@/lib/theme'
import { Section, RowCount, Pill, numThStyle, numTdStyle } from '@/components/shared/ui'
import { ErrorBanner, tableWrapStyle, tdStyle, thStyle } from '@/components/products/ProductBits'

interface OrderBookRow { so_id: number; so_number: string; status: string; customer_name: string | null; customer_po_number: string | null; po_date: string | null; quantity: number; qty_delivered: number; open_qty: number; unit_price: number | null; taxable_amount: number | null }
interface QuoteRow { quotation_id: number; quot_number: string | null; quote_date: string | null; customer_name: string | null; inquiry_id: number; inquiry_ref: string; quantity: number | null; unit_price: number | null; list_price: number | null; price_override_reason: string | null; customer_response: string | null }

export default function ProductSalesPanels({ productId }: { productId: number }) {
  const { user } = useAuth()
  const apps = (user?.apps as string[] | undefined) || []
  const [book, setBook] = useState<{ rows: OrderBookRow[]; totals: Record<string, number | null> } | null>(null)
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [error, setError] = useState<string | string[]>('')
  // Product › Products features (core/features/products.py): the sections, and the
  // Prices & sales values switch (the server blanks order-book / quotation prices too).
  const { canFeature, can } = useCan()
  const seePrices = canFeature('sales', 'products', 'prices', 'view')
  const seeOrderBook = apps.includes('sales') && canFeature('sales', 'products', 'order_book', 'view')
  const seeQuotes = apps.includes('crm') && canFeature('sales', 'products', 'quotation_history', 'view')

  useEffect(() => {
    if (!productId) return
    if (seeOrderBook) productMappingApi.orderBook(productId).then(setBook).catch((e) => setError(extractErrorMessages(e, 'Could not load the order book.')))
    if (seeQuotes) productMappingApi.quotationHistory(productId).then((d) => setQuotes(d.quotations || [])).catch(() => setQuotes([]))
  }, [productId, seePrices, seeOrderBook, seeQuotes])

  return (
    <>
      <ErrorBanner error={error} />
      {seePrices && can('sales', 'pricing', 'view') && <Section title="Pricing" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>List price, customer-specific prices and discounts for this product. Sales orders and quotations default their price from here; with no price the line is priced per quotation.</p>
        <PriceConditionsPanel productId={productId} emptyText="No prices for this product" />
      </Section>}

      {book && seeOrderBook && (
        <Section title="Order book" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
            Ordered {book.totals.ordered_qty} · open {book.totals.open_qty}{seePrices && <> · order value {formatINR(book.totals.order_value ?? 0)} · open value {formatINR(book.totals.open_value ?? 0)}</>}
          </p>
          {book.rows.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No sales order lines for this product yet.</p> : (
            <div style={{ ...tableWrapStyle, maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                <thead><tr>{['Order', 'Status', 'Customer', 'PO', 'Qty', 'Delivered', 'Open', ...(seePrices ? ['Unit price', 'Value'] : [])].map((h, hi) => <th key={h} style={hi >= 4 ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={book.rows.length} />}</th>)}</tr></thead>
                <tbody>
                  {book.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={tdStyle}><Link href={recordPath('/dashboard/sales/orders', r, 'so_id')} style={{ color: '#2563eb', fontWeight: 600 }}>{r.so_number}</Link></td>
                      <td style={tdStyle}><Pill label={SO_STATUS_LABELS[r.status] || r.status.replace(/_/g, ' ')} hex={SO_STATUS_HEX[r.status] || '#78716c'} /></td>
                      <td style={tdStyle}>{r.customer_name || '—'}</td>
                      <td style={tdStyle}>{r.customer_po_number || '—'}</td>
                      <td style={numTdStyle}>{r.quantity}</td>
                      <td style={numTdStyle}>{r.qty_delivered}</td>
                      <td style={numTdStyle}>{r.open_qty}</td>
                      {seePrices && <td style={numTdStyle}>{formatINR(r.unit_price ?? 0)}</td>}
                      {seePrices && <td style={numTdStyle}>{formatINR(r.taxable_amount ?? 0)}</td>}
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
                <thead><tr>{['Quotation', 'Date', 'Customer', 'Inquiry', 'Qty', ...(seePrices ? ['Quoted', 'List', 'Override reason'] : []), 'Response'].map((h, hi) => <th key={h} style={h === 'Qty' || h === 'Quoted' || h === 'List' ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={quotes.length} />}</th>)}</tr></thead>
                <tbody>
                  {quotes.map((q, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{q.quot_number || '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(q.quote_date)}</td>
                      <td style={tdStyle}>{q.customer_name || '—'}</td>
                      <td style={tdStyle}>{q.inquiry_ref}</td>
                      <td style={numTdStyle}>{q.quantity ?? '—'}</td>
                      {seePrices && <td style={numTdStyle}>{q.unit_price == null ? '—' : formatINR(q.unit_price)}</td>}
                      {seePrices && <td style={numTdStyle}>{q.list_price == null ? '—' : formatINR(q.list_price)}</td>}
                      {seePrices && <td style={tdStyle}>{q.price_override_reason || '—'}</td>}
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
