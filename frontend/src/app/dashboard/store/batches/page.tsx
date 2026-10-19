'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeBatchesApi } from '@/lib/api'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'

// Batch management (SAP MSC3N / MMBE by batch): every heat a vendor supplied
// on a GRN, with its mill TC and where its stock is now.

interface StoreBatchRow {
  id: number; item_code?: string | null; item_name?: string | null; uom?: string | null; batch_number: string; heat_number?: string | null
  vendor_name?: string | null; grn_number?: string | null; received_qty: number; received_date?: string | null; expiry_date?: string | null
  tc_number?: string | null; has_tc_document: boolean; status: string
  total: { free: number; quality: number; blocked: number; vendor: number }
}

const STATUS_LABELS: Record<string, string> = { active: 'Active', blocked: 'Blocked' }
const STATUS_HEX: Record<string, string> = { active: '#16a34a', blocked: '#dc2626' }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }
const fmtDate = (d?: string | null) => (d ? d.split('-').reverse().join('-') : '—')

export default function StoreBatchesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const [q, setQ] = useState('')
  const [inStock, setInStock] = useState(true)
  const [rows, setRows] = useState<StoreBatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      setLoading(true)
      storeBatchesApi.list({ q: q.trim() || undefined, in_stock: inStock })
        .then(setRows).catch((err) => setError(extractErrorMessages(err, 'Could not load batches.'))).finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, q, inStock])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store &amp; Inventory</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Batches</h1>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '6px 0 0' }}>
          Batch-tracked items (Item Master &ldquo;Batch tracked&rdquo;) carry the vendor&apos;s heat number and mill TC from the GRN. Open a batch to trace where it went.
        </p>
      </div>
      <MessageDialog open={!!error} variant="error" title="Batches" message={error} onClose={() => setError('')} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input style={{ ...inputStyle, flex: '1 1 260px', maxWidth: 380 }} placeholder="Search batch, heat no., TC no., vendor or item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> Only batches with stock
        </label>
      </div>
      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead><tr>{['Batch', 'Heat no.', 'Item', 'Vendor / GRN', 'Received', 'Mill TC', 'Free', 'Quality', 'Blocked', 'With vendor', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={12} style={{ ...td, textAlign: 'center' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={12} style={{ ...td, textAlign: 'center' }}>No batches{q ? ' match the search' : ''}.</td></tr>}
            {!loading && rows.map((b) => (
              <tr key={b.id} onClick={() => router.push(recordPath('/dashboard/store/batches', b))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{b.batch_number}</td>
                <td style={td}>{b.heat_number || '—'}</td>
                <td style={td}>{b.item_code} — {b.item_name}</td>
                <td style={td}>{b.vendor_name || '—'}{b.grn_number && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{b.grn_number}</div>}</td>
                <td style={td}>{b.received_qty} {b.uom} · {fmtDate(b.received_date)}{b.expiry_date && <div style={{ fontSize: 11.5, color: TEXT.muted }}>Expires {fmtDate(b.expiry_date)}</div>}</td>
                <td style={td}>{b.tc_number || '—'}{b.has_tc_document ? ' · scan' : ''}</td>
                <td style={{ ...td, fontWeight: 600, color: BRAND.primaryActive }}>{b.total.free || '—'}</td>
                <td style={td}>{b.total.quality || '—'}</td>
                <td style={td}>{b.total.blocked || '—'}</td>
                <td style={td}>{b.total.vendor || '—'}</td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[b.status]}1a`, color: STATUS_HEX[b.status], whiteSpace: 'nowrap' }}>{STATUS_LABELS[b.status] || b.status}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(recordPath('/dashboard/store/batches', b))} style={{ padding: '0 16px', color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Trace</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
