'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { purchaseApi } from '@/lib/api'
import { PurchaseRequisition } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  po_raised: 'PO Raised',
  partially_received: 'Partially Received',
  received: 'Received',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6',
  approved: '#8b5cf6',
  po_raised: '#f59e0b',
  partially_received: '#f97316',
  received: '#0ea5e9',
  closed: '#22c55e',
  rejected: '#dc2626',
  cancelled: '#94a3b8',
}

const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const PRIORITY_HEX: Record<string, string> = { low: '#64748b', medium: '#f59e0b', high: '#dc2626' }

interface AuditEntry {
  id: number
  action: string
  summary?: string
  performed_by: string
  performed_at?: string
}

export default function PurchaseRequisitionDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const params = useParams()
  const router = useRouter()
  const prId = Number(params.id)

  const [pr, setPr] = useState<PurchaseRequisition | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ vendor: '', po_number: '', po_date: '', expected_delivery_date: '', notes: '' })
  const [remarksDraft, setRemarksDraft] = useState<Record<number, string>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await purchaseApi.get(prId)
      setPr(data)
      setForm({
        vendor: data.vendor || '',
        po_number: data.po_number || '',
        po_date: data.po_date || '',
        expected_delivery_date: data.expected_delivery_date || '',
        notes: data.notes || '',
      })
      setRemarksDraft(Object.fromEntries((data.items || []).map((it: any) => [it.id, it.remarks || ''])))
      purchaseApi.getAuditTrail(prId).then(setAudit).catch(() => {})
    } catch {
      setError('Purchase requisition not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && prId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, prId])

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setActionError('')
    try {
      await fn()
      await load()
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const saveDetails = () =>
    runAction(() =>
      purchaseApi.update(prId, {
        vendor: form.vendor || undefined,
        po_number: form.po_number || undefined,
        po_date: form.po_date || undefined,
        expected_delivery_date: form.expected_delivery_date || undefined,
        notes: form.notes || undefined,
      })
    )

  const reject = () => {
    const reason = window.prompt('Reason for rejecting this PR (optional):') || undefined
    runAction(() => purchaseApi.reject(prId, reason))
  }

  const cancel = () => {
    const reason = window.prompt('Reason for cancelling this PR (optional):') || undefined
    runAction(() => purchaseApi.cancel(prId, reason))
  }

  const saveRemarks = (itemId: number) =>
    runAction(() => purchaseApi.updateItem(prId, itemId, { remarks: remarksDraft[itemId] || '' }))

  const changeStatus = (newStatus: string) => {
    if (!pr || newStatus === pr.status) return
    if (!window.confirm(`Manually change status from "${STATUS_LABELS[pr.status] || pr.status}" to "${STATUS_LABELS[newStatus] || newStatus}"? This bypasses the normal approve/receive workflow.`)) return
    runAction(() => purchaseApi.update(prId, { status: newStatus }))
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Not found.'}</p>

  const statusColor = STATUS_HEX[pr.status] || '#64748b'
  const isTerminal = ['closed', 'rejected', 'cancelled'].includes(pr.status)
  const canEditDetails = !isTerminal

  return (
    <div>
      <button onClick={() => router.push('/dashboard/purchase')} style={{ ...linkBtnStyle, marginBottom: 12 }}>← Back to Purchase Requisitions</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: 0 }}>{pr.pr_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {STATUS_LABELS[pr.status] || pr.status}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[pr.priority] || '#64748b'}1a`, color: PRIORITY_HEX[pr.priority] || '#64748b' }}>
              {PRIORITY_LABELS[pr.priority] || pr.priority} Priority
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>
            {pr.project_label || `Project #${pr.project_id}`} ·{' '}
            <Link href={`/dashboard/erp/service-requests/${pr.service_request_id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
              SR {pr.sr_request_number}
            </Link>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            disabled={busy}
            value={pr.status}
            onChange={(e) => changeStatus(e.target.value)}
            title="Manually override status"
            style={{ ...secondaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', paddingRight: 8 }}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {pr.status === 'submitted' && (
            <button disabled={busy} onClick={() => runAction(() => purchaseApi.approve(prId))} style={primaryBtnStyle}>Approve</button>
          )}
          {['submitted', 'approved'].includes(pr.status) && (
            <button disabled={busy} onClick={reject} style={dangerBtnStyle}>Reject</button>
          )}
          {!isTerminal && pr.status !== 'received' && (
            <button disabled={busy} onClick={cancel} style={secondaryBtnStyle}>Cancel</button>
          )}
          {pr.status === 'received' && (
            <button disabled={busy} onClick={() => runAction(() => purchaseApi.close(prId))} style={primaryBtnStyle}>Close PR</button>
          )}
        </div>
      </div>

      {actionError && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {actionError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Machine / Client">
          <InfoRow label="Machine / Asset" value={pr.project_label || '—'} />
          <InfoRow label="Client" value={pr.client_company || '—'} />
          <InfoRow label="Site" value={pr.site_name || '—'} />
          <InfoRow label="Raised" value={pr.created_at ? new Date(pr.created_at).toLocaleString() : '—'} />
        </Card>

        <Card title="Vendor & PO Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Vendor">
              <input disabled={!canEditDetails} value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} style={inputStyle} />
            </Field>
            <Field label="PO Number">
              <input disabled={!canEditDetails} value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} style={inputStyle} />
            </Field>
            <Field label="PO Date">
              <input type="date" disabled={!canEditDetails} value={form.po_date} onChange={(e) => setForm((f) => ({ ...f, po_date: e.target.value }))} style={inputStyle} />
            </Field>
            <Field label="Expected Delivery">
              <input type="date" disabled={!canEditDetails} value={form.expected_delivery_date} onChange={(e) => setForm((f) => ({ ...f, expected_delivery_date: e.target.value }))} style={inputStyle} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea disabled={!canEditDetails} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          {canEditDetails && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button disabled={busy} onClick={saveDetails} style={primaryBtnStyle}>Save Details</button>
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card title="Requisition Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <InfoRow label="Requested By" value={pr.raised_by_name || '—'} />
            <InfoRow label="Department" value={pr.department || '—'} />
            <InfoRow label="Priority" value={PRIORITY_LABELS[pr.priority] || pr.priority || '—'} />
            <InfoRow label="Required By" value={pr.required_by_date ? new Date(pr.required_by_date).toLocaleDateString() : '—'} />
            <InfoRow label="Category" value={pr.category_label || pr.category_code || '—'} />
            <InfoRow label="Requirement Type" value={pr.requirement_type || '—'} />
            <InfoRow label="Approver" value={pr.approver_name || '—'} />
          </div>
          <InfoRow label="Reason for Purchase" value={pr.purchase_reason || '—'} />
        </Card>
      </div>

      <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Material', 'Part No.', 'Qty Requested', 'Qty Received', 'Status', 'Photos', 'Remarks'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pr.items.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{item.material_name}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716c' }}>{item.part_number || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{item.quantity_requested} {item.unit}</td>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{item.quantity_received} {item.unit}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: item.item_status === 'received' ? '#16a34a' : item.item_status === 'partial' ? '#f97316' : '#a8a29e' }}>
                    {item.item_status}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', minWidth: 120 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(item.attachments || []).length === 0 && <span style={{ fontSize: 12, color: '#a8a29e' }}>—</span>}
                    {(item.attachments || []).map((att) => (
                      <img
                        key={att.id}
                        src={att.sharepoint_url}
                        alt={att.filename}
                        onClick={() => setLightboxUrl(att.sharepoint_url || null)}
                        title="View photo"
                        style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.08)' }}
                      />
                    ))}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', minWidth: 200 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={remarksDraft[item.id] ?? ''}
                      onChange={(e) => setRemarksDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                      placeholder="Add remarks…"
                      style={{ ...inputStyle, padding: '6px 10px', fontSize: 12.5 }}
                    />
                    {(remarksDraft[item.id] ?? '') !== (item.remarks || '') && (
                      <button disabled={busy} onClick={() => saveRemarks(item.id)} style={{ ...primaryBtnStyle, padding: '6px 10px', fontSize: 11 }}>Save</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out' }}
        >
          <img src={lightboxUrl} alt="Material photo" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }} />
        </div>
      )}

      <p style={{ fontSize: 12.5, color: '#a8a29e', margin: '0 0 8px' }}>
        Materials are marked received on the Service Request&apos;s Materials tab by the service team — this PR advances to &quot;Received&quot; automatically once every item is fully received, and can then be closed here.
      </p>

      {audit.length > 0 && (
        <Card title="Audit Trail">
          {audit.map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <span style={{ fontSize: 12.5, color: '#57534e' }}>{e.summary || e.action}</span>
              <span style={{ fontSize: 11.5, color: '#a8a29e', whiteSpace: 'nowrap' }}>{e.performed_at ? new Date(e.performed_at).toLocaleString() : ''}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fa9b9b', margin: '0 0 12px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: '#1f1108', margin: 0 }}>{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>{label}</p>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)',
  color: '#fff',
  cursor: 'pointer',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  color: '#57534e',
  cursor: 'pointer',
}

const dangerBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid rgba(220,38,38,0.25)',
  background: 'rgba(220,38,38,0.06)',
  color: '#b91c1c',
  cursor: 'pointer',
}

const linkBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#78716c',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
}
