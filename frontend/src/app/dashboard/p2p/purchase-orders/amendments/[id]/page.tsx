'use client'

// One ME22N PO amendment: what changes (before → after per line) and its
// approval (central approval engine, entity p2p_po_amendment — the approval
// inbox links here).
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { POAmendment, poAmendmentsApi } from '@/lib/mmPurchasingApi'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
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
const fmt = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(v.slice(0, 10))
  return String(v)
}
const rupees = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const fmtField = (field: string | null | undefined, v: unknown) => (field === 'unit_price' && typeof v === 'number' ? rupees(v) : fmt(v))

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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>PO Amendment {am?.amendment_no ?? ''}</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>A change to an approved purchase order — applied to the PO only after it is approved.</p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/p2p/purchase-orders')}>← Back</button>
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {am && (
        <>
          <DetailCard>
            <DetailSummary
              title={`${am.changes.length} change${am.changes.length === 1 ? '' : 's'} to PO ${am.po_number || '—'}`}
              text={am.reason}
              meta={<>
                <Pill label={STATUS_LABELS[am.status] || am.status} hex={STATUS_HEX[am.status] || '#78716c'} />
                <span>· Raised by <strong style={{ color: TEXT.heading }}>{am.requested_by_name || '—'}</strong>{am.created_at ? ` on ${formatDate(am.created_at)}` : ''}</span>
                <span>· PO value <strong style={{ color: TEXT.heading }}>{rupees(am.old_total)}</strong> → <strong style={{ color: TEXT.heading }}>{rupees(am.new_total)}</strong></span>
              </>}
            />
            <DetailGroup title="What changes" last={!am.decision_comment}>
            <div style={{ overflow: 'auto', border: `1px solid ${BORDER.normal}`, borderRadius: 10, margin: '8px 0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead><tr>{['Change', 'Line / Field', 'Before', 'After'].map((h, i) => <th key={h} style={th}>{h}{i === 0 && <RowCount count={am.changes.length} />}</th>)}</tr></thead>
                <tbody>
                  {am.changes.map((c, i) => (
                    <tr key={i}>
                      <td style={td}>{c.op === 'add' ? 'Line added' : c.op === 'delete' ? 'Line deleted' : c.op === 'header' ? 'PO header' : 'Line changed'}</td>
                      <td style={td}>{c.op === 'add' ? String(c.line?.item_name || '') : c.op === 'header' ? FIELD_LABELS[c.field || ''] : `${nameOf(c.po_item_id)}${c.field ? ` — ${FIELD_LABELS[c.field] || c.field}` : ''}`}</td>
                      <td style={td}>{c.op === 'add' ? '—' : c.op === 'delete' ? 'On the PO' : fmtField(c.field, c.old)}</td>
                      <td style={td}>{c.op === 'add' ? `${fmt(c.line?.quantity)} × ${rupees(typeof c.line?.unit_price === 'number' ? c.line.unit_price : null)}` : c.op === 'delete' ? 'Removed' : fmtField(c.field, c.new)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </DetailGroup>
            {am.decision_comment && (
              <DetailGroup title="Decision" last>
                <DetailRow label="Decided by">{am.decided_by_name ? `${am.decided_by_name}${am.decided_at ? ` on ${formatDate(am.decided_at)}` : ''}` : null}</DetailRow>
                <DetailRow label="Comment">{am.decision_comment}</DetailRow>
              </DetailGroup>
            )}
          </DetailCard>
          <div style={card}>
            <ApprovalPanel entityType="p2p_po_amendment" entityId={am.id} title="Amendment approval" onChanged={() => load()} />
          </div>
        </>
      )}
    </div>
  )
}
