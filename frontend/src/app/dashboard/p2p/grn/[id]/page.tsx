'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi } from '@/lib/api'
import { P2PGoodsReceipt } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, SUCCESS, DANGER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}

const QUALITY_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'partial', label: 'Partially Accepted' },
]

interface InspectionRow {
  accepted_quantity: string
  rejected_quantity: string
  quality_status: string
  rejection_reason: string
}

export default function GoodsReceiptDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const params = useParams()
  const grnId = Number(params.id)

  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const [grn, setGrn] = useState<P2PGoodsReceipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Record<number, InspectionRow>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    goodsReceiptsApi.get(grnId).then((g: P2PGoodsReceipt) => {
      setGrn(g)
      const initial: Record<number, InspectionRow> = {}
      for (const it of g.items) {
        initial[it.id] = {
          accepted_quantity: it.accepted_quantity != null ? String(it.accepted_quantity) : String(it.received_quantity),
          rejected_quantity: it.rejected_quantity != null ? String(it.rejected_quantity) : '0',
          quality_status: it.quality_status !== 'pending' ? it.quality_status : 'passed',
          rejection_reason: it.rejection_reason || '',
        }
      }
      setRows(initial)
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!isAuthorized || !grnId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, grnId])

  if (isLoading || !isAuthorized) return null
  if (loading || !grn) return null

  const setRow = (itemId: number, patch: Partial<InspectionRow>) => {
    setRows((r) => ({ ...r, [itemId]: { ...r[itemId], ...patch } }))
  }

  const complete = async () => {
    setError('')
    setBusy(true)
    try {
      const items = grn.items.map((it) => {
        const r = rows[it.id]
        return {
          item_id: it.id,
          accepted_quantity: Number(r.accepted_quantity || 0),
          rejected_quantity: Number(r.rejected_quantity || 0),
          quality_status: r.quality_status,
          rejection_reason: r.quality_status === 'passed' ? undefined : (r.rejection_reason.trim() || undefined),
        }
      })
      await goodsReceiptsApi.inspect(grn.id, { items })
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to complete quality inspection.')
    } finally {
      setBusy(false)
    }
  }

  const isDraft = grn.status === 'draft'

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{grn.grn_number}</h1>
        </div>
        <button onClick={() => router.push('/dashboard/p2p/grn')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 13 }}>
          <div><span style={{ color: TEXT.muted }}>PO Number: </span><strong style={{ color: TEXT.heading }}>{grn.po_number}</strong></div>
          <div><span style={{ color: TEXT.muted }}>PR Number: </span><strong style={{ color: TEXT.heading }}>{grn.p2p_number || '—'}</strong></div>
          <div><span style={{ color: TEXT.muted }}>Vendor: </span><strong style={{ color: TEXT.heading }}>{grn.vendor_name || '—'}</strong></div>
          <div><span style={{ color: TEXT.muted }}>Received Date: </span><strong style={{ color: TEXT.heading }}>{grn.received_date}</strong></div>
          <div><span style={{ color: TEXT.muted }}>Store Location: </span><strong style={{ color: TEXT.heading }}>{grn.store_location_name || '—'}</strong></div>
          <div><span style={{ color: TEXT.muted }}>Received By: </span><strong style={{ color: TEXT.heading }}>{grn.received_by_name || '—'}</strong></div>
          {grn.status === 'completed' && (
            <div><span style={{ color: TEXT.muted }}>Inspected By: </span><strong style={{ color: TEXT.heading }}>{grn.inspected_by_name || '—'}</strong></div>
          )}
        </div>
        {grn.remarks && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '12px 0 0' }}>Remarks: {grn.remarks}</p>}
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>
          {isDraft ? 'Quality Inspection' : 'Inspection Result'}
        </h2>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {['Item', 'Ordered', 'Received', 'Accepted', 'Rejected', 'Quality Status', 'Rejection Reason'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, borderBottom: `1px solid ${BORDER.normal}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grn.items.map((it) => {
                const r = rows[it.id]
                return (
                  <tr key={it.id}>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.item_name}{it.unit ? ` (${it.unit})` : ''}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.ordered_quantity}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.received_quantity}</td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      {isDraft ? (
                        <input type="number" min={0} max={it.received_quantity} step="any" value={r.accepted_quantity}
                          onChange={(e) => setRow(it.id, { accepted_quantity: e.target.value })} style={{ ...inputStyle, width: 80 }} />
                      ) : (
                        <span style={{ fontWeight: 600, color: SUCCESS.text }}>{it.accepted_quantity ?? '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      {isDraft ? (
                        <input type="number" min={0} max={it.received_quantity} step="any" value={r.rejected_quantity}
                          onChange={(e) => setRow(it.id, { rejected_quantity: e.target.value })} style={{ ...inputStyle, width: 80 }} />
                      ) : (
                        <span style={{ fontWeight: 600, color: it.rejected_quantity ? DANGER.text : TEXT.muted }}>{it.rejected_quantity ?? '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      {isDraft ? (
                        <select value={r.quality_status} onChange={(e) => setRow(it.id, { quality_status: e.target.value })} style={{ ...inputStyle, width: 150 }}>
                          {QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 600, color: it.quality_status === 'passed' ? SUCCESS.text : it.quality_status === 'failed' ? DANGER.text : TEXT.body }}>
                          {QUALITY_OPTIONS.find((o) => o.value === it.quality_status)?.label || it.quality_status}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      {isDraft && r.quality_status !== 'passed' ? (
                        <input value={r.rejection_reason} onChange={(e) => setRow(it.id, { rejection_reason: e.target.value })} style={{ ...inputStyle, width: 180 }} placeholder="Reason" />
                      ) : (
                        <span style={{ fontSize: 12.5, color: TEXT.muted }}>{it.rejection_reason || '—'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {isDraft && (
          <div style={{ marginTop: 16 }}>
            <button disabled={busy} onClick={complete} style={primaryBtn}>{busy ? 'Completing…' : 'Complete Inspection'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
