'use client'

// One ME22N PO amendment: what changes (before → after per line) and its
// approval (central approval engine, entity p2p_po_amendment — the approval
// inbox links here).
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { POAmendment, poAmendmentsApi } from '@/lib/mmPurchasingApi'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: `1px solid ${BORDER.normal}` }
const STATUS_LABELS: Record<string, string> = { pending_approval: 'Waiting for approval', approved: 'Approved — applied', rejected: 'Rejected', returned: 'Returned', withdrawn: 'Withdrawn' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#d97706', approved: '#16a34a', rejected: '#dc2626', returned: '#7c3aed', withdrawn: '#6b7280' }
const FIELD_LABELS: Record<string, string> = { quantity: 'Quantity', unit_price: 'Unit price', tax_rate: 'GST %', delivery_date: 'Delivery date', expected_delivery: 'PO delivery date', delivery_terms: 'Delivery terms' }
const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

export default function POAmendmentPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params?.id as string)
  const [am, setAm] = useState<POAmendment | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try { setAm(await poAmendmentsApi.get(id)); setError('') } catch (err) {
      setError(extractErrorMessages(err, 'Could not open this PO amendment — go back to Purchase Orders and open it again.').join(' '))
    }
  }, [id])
  useEffect(() => { if (isAuthorized) Promise.resolve().then(load) }, [isAuthorized, load])

  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/purchase-orders" listLabel="Back to purchase orders" /></div>)
  if (isLoading || !isAuthorized) return null

  const nameOf = (pid?: number) => am?.before.lines?.find((l) => l.po_item_id === pid)?.item_name || `Line #${pid}`

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45', margin: '0 0 4px' }}>PO {am?.po_number}</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Amendment {am?.amendment_no ?? ''}</h1>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/p2p/purchase-orders')}>← Back</button>
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {am && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[am.status]}1a`, color: STATUS_HEX[am.status] }}>{STATUS_LABELS[am.status] || am.status}</span>
              <span style={{ fontSize: 13 }}>Raised by {am.requested_by_name || '—'}</span>
              <span style={{ fontSize: 13 }}>PO value <b>{fmt(am.old_total?.toFixed(2))}</b> → <b>{fmt(am.new_total?.toFixed(2))}</b></span>
            </div>
            <p style={{ fontSize: 13, margin: '0 0 12px' }}><b>Reason:</b> {am.reason}</p>
            <div style={{ overflow: 'auto', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead><tr>{['Change', 'Line / field', 'Before', 'After'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {am.changes.map((c, i) => (
                    <tr key={i}>
                      <td style={td}>{c.op === 'add' ? 'Line added' : c.op === 'delete' ? 'Line deleted' : c.op === 'header' ? 'PO header' : 'Line changed'}</td>
                      <td style={td}>{c.op === 'add' ? String(c.line?.item_name || '') : c.op === 'header' ? FIELD_LABELS[c.field || ''] : `${nameOf(c.po_item_id)}${c.field ? ` — ${FIELD_LABELS[c.field] || c.field}` : ''}`}</td>
                      <td style={td}>{c.op === 'add' ? '—' : c.op === 'delete' ? 'on the PO' : fmt(c.old)}</td>
                      <td style={td}>{c.op === 'add' ? `${c.line?.quantity} × ${c.line?.unit_price}` : c.op === 'delete' ? 'removed' : fmt(c.new)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {am.decision_comment && <p style={{ fontSize: 12.5, margin: '10px 0 0' }}>Decision comment ({am.decided_by_name}): {am.decision_comment}</p>}
          </div>
          <div style={card}>
            <ApprovalPanel entityType="p2p_po_amendment" entityId={am.id} title="Amendment approval" onChanged={() => load()} />
          </div>
        </>
      )}
    </div>
  )
}
