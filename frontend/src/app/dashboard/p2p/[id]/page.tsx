'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', po_raised: 'PO Raised',
  partially_received: 'Partially Received', received: 'Received',
  closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6', approved: '#8b5cf6', po_raised: '#f59e0b',
  partially_received: '#f97316', received: '#0ea5e9', closed: '#22c55e',
  rejected: '#dc2626', cancelled: '#94a3b8',
}

interface AuditEntry {
  id: number
  action: string
  summary?: string
  old_status?: string
  new_status?: string
  performed_by: string
  performed_at?: string
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function MyP2PRequestDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const params = useParams()
  const router = useRouter()
  const prId = Number(params.id)

  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await p2pApi.get(prId)
      setPr(data)
      p2pApi.getAuditTrail(prId).then(setAudit).catch(() => {})
    } catch {
      setError('Purchase requisition not found, or you do not have access to it.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && prId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, prId])

  const cancel = async () => {
    if (!window.confirm('Cancel this PR?')) return
    const reason = window.prompt('Reason for cancelling (optional):') || undefined
    setBusy(true)
    try {
      await p2pApi.cancel(prId, reason)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to cancel.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error || !pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Not found.'}</p>

  const statusColor = STATUS_HEX[pr.status] || '#64748b'
  const canCancel = ['submitted', 'approved'].includes(pr.status)

  return (
    <div>
      <button onClick={() => router.push('/dashboard/p2p')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to My Requisitions
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{pr.pr_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {STATUS_LABELS[pr.status] || pr.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{pr.category_label || pr.category_code} · {pr.project_label || 'No project specified'}</p>
        </div>
        {canCancel && (
          <button disabled={busy} onClick={cancel} style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)', color: '#b91c1c', cursor: 'pointer' }}>
            Cancel Requisition
          </button>
        )}
      </div>

      {pr.status === 'rejected' && pr.rejected_reason && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          Rejected: {pr.rejected_reason}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Request Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <InfoRow label="Department" value={pr.department || '—'} />
          <InfoRow label="Requested By" value={pr.requested_by_name || '—'} />
          <InfoRow label="Request Date" value={new Date(pr.request_date).toLocaleDateString()} />
          <InfoRow label="Required Date" value={pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'} />
          <InfoRow label="Requirement Type" value={pr.requirement_type || '—'} />
          <InfoRow label="Priority" value={pr.priority} />
          <InfoRow label="Approver" value={pr.approver_name || '—'} />
          <InfoRow label="Vendor" value={pr.vendor || '—'} />
        </div>
        {pr.remarks && <div style={{ marginTop: 10 }}><InfoRow label="Remarks" value={pr.remarks} /></div>}
      </div>

      <div style={{ ...sectionStyle, overflow: 'auto' }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Item Details</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              {['SL', 'Item Description', 'Make', 'Part Code', 'UOM', 'Qty', 'Project/Inhouse', 'Category', 'Ship To', 'Attachments'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pr.items.map((it, idx) => (
              <tr key={it.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{idx + 1}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.item_name}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.make || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.part_code || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.unit || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.quantity}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.project_inhouse || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.category || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.ship_to || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
                  {it.attachments.length === 0 && <span style={{ color: TEXT.muted }}>—</span>}
                  {it.attachments.map((a) => (
                    <a key={a.id} href={a.sharepoint_url} target="_blank" rel="noreferrer" style={{ display: 'block', color: BRAND.primaryActive, textDecoration: 'none' }}>
                      {a.filename}
                    </a>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(pr.status === 'po_raised' || pr.status === 'partially_received' || pr.status === 'received' || pr.status === 'closed') && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Purchase Order & Receiving</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <InfoRow label="PO Number" value={pr.po_number || '—'} />
            <InfoRow label="PO Date" value={pr.po_date ? new Date(pr.po_date).toLocaleDateString() : '—'} />
            <InfoRow label="Expected Delivery" value={pr.expected_delivery ? new Date(pr.expected_delivery).toLocaleDateString() : '—'} />
            <InfoRow label="Ordered / Received" value={`${pr.ordered_quantity ?? '—'} / ${pr.received_quantity ?? 0}`} />
          </div>
        </div>
      )}

      {pr.attachments.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Attachments</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pr.attachments.map((a) => (
              <a key={a.id} href={a.sharepoint_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: BRAND.primaryActive, textDecoration: 'none' }}>
                {a.filename} <span style={{ color: TEXT.muted, fontSize: 11 }}>({a.doc_type})</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {audit.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Audit Trail</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {audit.map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${BORDER.light}` }}>
                <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{e.summary || e.action}</span>
                <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{e.performed_at ? new Date(e.performed_at).toLocaleString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}
