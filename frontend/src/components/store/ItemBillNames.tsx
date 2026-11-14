'use client'

// Item Master › item › "Names on vendor bills" (owner, 2026-11-13): what each vendor's bill calls
// this item, learnt from the "Name on invoice" of goods receipts. The next bill from that vendor with
// the same name fills this item on the receipt by itself.

import { useEffect, useState } from 'react'
import { Section, RowCount, TableScroll, thStyle, tdStyle, numThStyle, numTdStyle } from '@/components/shared/ui'
import { prePoStoreApi, BillName } from '@/lib/prePoApi'
import { formatDate } from '@/lib/format'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'

export default function ItemBillNames({ itemId }: { itemId: number }) {
  const [rows, setRows] = useState<BillName[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    prePoStoreApi.billNames({ store_item_id: itemId })
      .then((r) => { if (live) { setRows(r); setError('') } })
      .catch((err) => { if (live) { setRows([]); setError(extractErrorMessages(err, "Couldn't load the names on vendor bills — reload the page.").join(' ')) } })
    return () => { live = false }
  }, [itemId])

  return (
    <Section title="Names on vendor bills" style={{ marginBottom: 20 }}>
      <div data-tour="item-detail-bill-names">
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <span style={{ fontSize: 11.5, color: TEXT.muted }}>
          What each vendor&apos;s bill calls this item, from the Name on invoice of goods receipts. The next bill from that vendor with the same name fills this item by itself.
        </span>
        <TableScroll maxHeight={280} minWidth={560} style={{ marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Vendor <RowCount count={rows?.length ?? 0} /></th>
                <th style={thStyle}>Name on the bill</th>
                <th style={numThStyle}>Times used</th>
                <th style={thStyle}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={4} style={tdStyle}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} style={{ ...tdStyle, color: TEXT.muted }}>No vendor bill name yet. It is saved when a goods receipt line for this item has a Name on invoice.</td></tr>
              ) : rows.map((r) => (
                <tr key={`${r.vendor_id}-${r.name_key}`}>
                  <td style={tdStyle}>{r.vendor_name || '—'}</td>
                  <td style={tdStyle}>{r.invoice_name}</td>
                  <td style={numTdStyle}>{r.times_used}</td>
                  <td style={tdStyle}>{r.last_used_on ? formatDate(r.last_used_on) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </Section>
  )
}
