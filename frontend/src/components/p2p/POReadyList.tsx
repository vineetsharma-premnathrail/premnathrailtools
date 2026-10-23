'use client'

// "Create PO" view of Purchase Orders: requisitions whose RFQ is done, waiting
// for their PO — or with a PO still in draft. Old RFQs: the L1 vendor is chosen
// (CreatePODialog). Emailed RFQs: lines awarded on the quote comparison — one
// PO per awarded vendor (SplitPoDialog); still-quoting emailed RFQs are hidden.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { rfqApi } from '@/lib/api'
import { RFQ } from '@/types'
import SplitPoDialog from '@/components/p2p/SplitPoDialog'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref } from '@/lib/recordRef'

const READY = new Set(['vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted'])
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }
const isInvite = (r: RFQ) => (r.invite_count || 0) > 0
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#57534e', borderTop: '1px solid rgba(0,0,0,0.05)' }

export default function POReadyList({ onCreate }: { onCreate?: (rfqId: number) => void }) {
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [splitFor, setSplitFor] = useState<RFQ | null>(null)

  useEffect(() => {
    let cancelled = false
    rfqApi.list({ limit: 500 })
      .then((list: RFQ[]) => { if (!cancelled) setRfqs(list.filter((r) => r.status === 'locked' && READY.has(r.p2p_status || '') && (!isInvite(r) || (r.awarded_line_count || 0) > 0))) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the requisitions ready for a PO — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>
        Requisitions whose RFQ is complete — L1 vendor chosen (old RFQs) or lines awarded on the comparison (emailed RFQs). Create the PO(s), price them and send for approval.
      </p>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr>{['Requisition', 'RFQ', 'L1 Vendor', 'Other quotes', 'Stage', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rfqs.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Nothing is waiting for a PO. A requisition appears here once its RFQ is submitted.</td></tr>}
            {rfqs.map((r) => {
              // Awarded on the comparison (emailed RFQs, or an old RFQ awarded there) → one PO per awarded vendor.
              const invite = isInvite(r) || (r.awarded_line_count || 0) > 0
              const l1 = r.attachments.find((a) => a.vendor_tier === 'L1')
              const vendorCell = invite ? (r.awarded_vendors || []).join(', ') : l1?.vendor_name
              const others = invite ? (r.other_quoted_vendors || [])
                : [...new Set(r.attachments.filter((a) => a.vendor_tier !== 'L1' && a.vendor_name).map((a) => `${a.vendor_tier} ${a.vendor_name}`))]
              const drafted = r.p2p_status === 'po_drafted'
              const open = () => {
                if (drafted) router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', undefined, 'rfq'))
                else if (invite) setSplitFor(r)
                else if (onCreate) onCreate(r.id)
                else router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', undefined, 'rfq'))
              }
              return (
                <tr key={r.id} onClick={open} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>{r.p2p_number || `#${r.p2p_request_id}`}</td>
                  <td style={td}>{r.rfq_number}</td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {vendorCell || '—'}
                    {invite && vendorCell && <div style={{ fontSize: 11, fontWeight: 500, color: '#a8a29e' }}>awarded</div>}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>{others.join(', ') || '—'}</td>
                  <td style={td}>
                    {invite && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: '#16a34a1a', color: '#15803d', whiteSpace: 'nowrap', marginRight: 6 }}>
                        Awarded — {r.awarded_line_count} line(s)
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: drafted ? '#f59e0b1a' : '#2563eb1a', color: drafted ? '#b45309' : '#2563eb', whiteSpace: 'nowrap' }}>
                      {drafted ? 'PO in draft' : 'Ready for PO'}
                    </span>
                  </td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={open} style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9, border: 'none', background: '#1f1108', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {drafted ? 'Continue PO' : 'Create PO'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {splitFor && <SplitPoDialog rfq={splitFor} onClose={() => setSplitFor(null)} onDone={(poRow) => {
        const r = splitFor
        setSplitFor(null)
        router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', { po: poRow ? (poRow as { id_ref?: string }).id_ref : undefined }, 'rfq'))
      }} />}
    </div>
  )
}
