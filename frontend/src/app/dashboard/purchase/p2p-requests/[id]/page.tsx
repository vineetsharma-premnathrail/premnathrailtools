'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, usersApi } from '@/lib/api'
import { P2PRequest, AuditEntry, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND, GRADIENTS } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', po_raised: 'PO Raised', partially_received: 'Partially Received',
  received: 'Received', closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6', approved: '#8b5cf6', po_raised: '#f59e0b', partially_received: '#f97316',
  received: '#0ea5e9', closed: '#22c55e', rejected: '#dc2626', cancelled: '#94a3b8',
}

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: TEXT.muted, marginBottom: 4 }
const fieldValue: React.CSSProperties = { fontSize: 14, color: TEXT.body, fontWeight: 600 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 8, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.8)', fontSize: 13, outline: 'none' }
const actionBtn: React.CSSProperties = { padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#fff' }

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p style={fieldLabel}>{label}</p>
      <p style={fieldValue}>{value ?? '—'}</p>
    </div>
  )
}

export default function PurchaseTeamRequisitionDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const params = useParams()
  const router = useRouter()
  const id = Number(params.id)

  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Local form state for processing actions
  const [buyerId, setBuyerId] = useState('')
  const [vendor, setVendor] = useState('')
  const [rfqNumber, setRfqNumber] = useState('')
  const [quotation, setQuotation] = useState('')
  const [quotationDate, setQuotationDate] = useState('')
  const [vendorComparison, setVendorComparison] = useState('')
  const [selectedVendor, setSelectedVendor] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState('')
  const [poValue, setPoValue] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [receivedQty, setReceivedQty] = useState('')
  const [grnNumber, setGrnNumber] = useState('')
  const [receiptDate, setReceiptDate] = useState('')
  const [receivingRemarks, setReceivingRemarks] = useState('')

  const load = async () => {
    try {
      const [prData, auditData] = await Promise.all([p2pApi.get(id), p2pApi.getAuditTrail(id)])
      setPr(prData)
      setAudit(auditData)
      setVendor(prData.vendor || '')
      setRfqNumber(prData.rfq_number || '')
      setQuotation(prData.quotation || '')
      setVendorComparison(prData.vendor_comparison || '')
      setSelectedVendor(prData.selected_vendor || '')
      setPoNumber(prData.po_number || '')
      setPoValue(prData.po_value ? String(prData.po_value) : '')
      setExpectedDelivery(prData.expected_delivery || '')
    } catch {
      setError('Failed to load this P2P request.')
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    load()
    usersApi.directory().then(setUsers).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, id])

  const run = async (fn: () => Promise<P2PRequest>) => {
    setBusy(true)
    setError('')
    try {
      const updated = await fn()
      setPr(updated)
      const auditData = await p2pApi.getAuditTrail(id)
      setAudit(auditData)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (error && !pr) return <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>
  if (!pr) return <div style={{ padding: 20, color: TEXT.muted }}>Loading…</div>

  return (
    <div style={{ maxWidth: 1040 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Purchase Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{pr.pr_number}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 9999, background: `${STATUS_HEX[pr.status]}1a`, color: STATUS_HEX[pr.status] }}>
            {STATUS_LABELS[pr.status] || pr.status}
          </span>
          <button onClick={() => router.push('/dashboard/purchase/p2p-requests')} style={{ padding: '8px 16px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Back
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>PR Header</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Field label="Category" value={pr.category_label || pr.category_code} />
          <Field label="Priority" value={<span style={{ textTransform: 'capitalize' }}>{pr.priority}</span>} />
          <Field label="Project" value={pr.project_label} />
          <Field label="Department" value={pr.department} />
          <Field label="Requested By" value={pr.requested_by_name} />
          <Field label="Request Date" value={pr.request_date ? new Date(pr.request_date).toLocaleDateString() : '—'} />
          <Field label="Required Date" value={pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'} />
          <Field label="Approver" value={pr.approver_name} />
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Requirement Details</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['Item Name', 'Part Code', 'Model No.', 'Unit', 'Qty', 'Budget', 'Description', 'Reason', 'Attachments'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pr.items.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600 }}>{item.item_name}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{item.part_code || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{item.model_number || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{item.unit || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{item.quantity}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{item.estimated_budget ?? '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12.5, color: TEXT.secondary }}>{item.description || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12.5, color: TEXT.secondary }}>{item.reason || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>
                    {item.attachments.length === 0 && <span style={{ color: TEXT.muted }}>—</span>}
                    {item.attachments.map((a) => (
                      <a key={a.id} href={a.sharepoint_url} target="_blank" rel="noreferrer" style={{ display: 'block', color: '#2563eb', textDecoration: 'none' }}>
                        {a.filename}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pr.attachments.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={fieldLabel}>Attachments</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {pr.attachments.map((a) => (
                <a key={a.id} href={a.sharepoint_url || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.04)', color: TEXT.body, textDecoration: 'none' }}>
                  {a.filename} <span style={{ color: TEXT.muted }}>({a.doc_type})</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Purchase Processing</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          <Field label="Assigned Buyer" value={pr.assigned_buyer_name} />
          <Field label="Assignment Date" value={pr.assignment_date ? new Date(pr.assignment_date).toLocaleDateString() : '—'} />
          <Field label="Selected Vendor" value={pr.selected_vendor} />
          <Field label="RFQ Number" value={pr.rfq_number} />
          <Field label="PO Number" value={pr.po_number} />
          <Field label="PO Value" value={pr.po_value} />
          <Field label="Expected Delivery" value={pr.expected_delivery ? new Date(pr.expected_delivery).toLocaleDateString() : '—'} />
          <Field label="Ordered / Received / Pending" value={`${pr.ordered_quantity ?? '—'} / ${pr.received_quantity ?? '—'} / ${pr.pending_quantity ?? '—'}`} />
        </div>

        {/* --- submitted: Approve / Reject --- */}
        {pr.status === 'submitted' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button disabled={busy} onClick={() => run(() => p2pApi.approve(pr.id))} style={{ ...actionBtn, background: '#16a34a' }}>Approve</button>
            <button disabled={busy} onClick={() => { const reason = prompt('Reason for rejection (optional):') || undefined; run(() => p2pApi.reject(pr.id, reason)) }} style={{ ...actionBtn, background: '#dc2626' }}>Reject</button>
          </div>
        )}

        {/* --- approved: Assign Buyer / Request Quotations / Select Vendor / Create PO --- */}
        {pr.status === 'approved' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Assign Buyer</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
                  <option value="">Select buyer…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button disabled={busy || !buyerId} onClick={() => run(() => p2pApi.assignBuyer(pr.id, Number(buyerId)))} style={{ ...actionBtn, background: BRAND.primary }}>Assign</button>
              </div>
            </div>

            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Request Quotations / Vendor & RFQ</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
                <input style={inputStyle} placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
                <input style={inputStyle} placeholder="RFQ Number" value={rfqNumber} onChange={(e) => setRfqNumber(e.target.value)} />
                <input style={inputStyle} placeholder="Quotation (amount/ref)" value={quotation} onChange={(e) => setQuotation(e.target.value)} />
                <input type="date" style={inputStyle} value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
                <input style={{ ...inputStyle, gridColumn: 'span 2' }} placeholder="Vendor comparison notes" value={vendorComparison} onChange={(e) => setVendorComparison(e.target.value)} />
              </div>
              <button disabled={busy} onClick={() => run(() => p2pApi.requestQuotations(pr.id, { vendor, rfq_number: rfqNumber, quotation, quotation_date: quotationDate || undefined, vendor_comparison: vendorComparison }))} style={{ ...actionBtn, background: BRAND.primary }}>
                Save Vendor / RFQ
              </button>
            </div>

            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Select Vendor</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <input style={{ ...inputStyle, maxWidth: 260 }} placeholder="Selected vendor" value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)} />
                <button disabled={busy || !selectedVendor} onClick={() => run(() => p2pApi.selectVendor(pr.id, selectedVendor))} style={{ ...actionBtn, background: BRAND.primary }}>Select Vendor</button>
              </div>
            </div>

            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Create PO</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
                <input style={inputStyle} placeholder="PO Number *" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                <input type="date" style={inputStyle} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                <input type="number" style={inputStyle} placeholder="PO Value" value={poValue} onChange={(e) => setPoValue(e.target.value)} />
                <input type="date" style={inputStyle} placeholder="Expected delivery" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
              </div>
              <button
                disabled={busy || !poNumber}
                onClick={() => run(() => p2pApi.createPO(pr.id, {
                  po_number: poNumber, po_date: poDate || undefined, po_value: poValue ? Number(poValue) : undefined, expected_delivery: expectedDelivery || undefined,
                }))}
                style={{ ...actionBtn, background: '#16a34a' }}
              >
                Create PO
              </button>
            </div>

            <div>
              <button disabled={busy} onClick={() => { const reason = prompt('Reason for rejection (optional):') || undefined; run(() => p2pApi.reject(pr.id, reason)) }} style={{ ...actionBtn, background: '#dc2626' }}>Reject</button>
            </div>
          </div>
        )}

        {/* --- po_raised / partially_received: Update Received Quantity --- */}
        {(pr.status === 'po_raised' || pr.status === 'partially_received') && (
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Track Delivery / Update Received Quantity</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
              <input type="number" style={inputStyle} placeholder="Received quantity *" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
              <input style={inputStyle} placeholder="GRN / Receipt Number" value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} />
              <input type="date" style={inputStyle} value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              <input style={inputStyle} placeholder="Receiving remarks" value={receivingRemarks} onChange={(e) => setReceivingRemarks(e.target.value)} />
            </div>
            <button
              disabled={busy || !receivedQty}
              onClick={() => run(() => p2pApi.updateReceipt(pr.id, {
                received_quantity: Number(receivedQty), grn_number: grnNumber || undefined, receipt_date: receiptDate || undefined, receiving_remarks: receivingRemarks || undefined,
              }))}
              style={{ ...actionBtn, background: BRAND.primary }}
            >
              Update Receipt
            </button>
          </div>
        )}

        {/* --- received: Close PR --- */}
        {pr.status === 'received' && (
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Verify Complete Receipt</p>
            <button disabled={busy} onClick={() => run(() => p2pApi.close(pr.id))} style={{ ...actionBtn, background: '#16a34a' }}>Close PR</button>
          </div>
        )}

        {['submitted', 'approved'].includes(pr.status) && (
          <div style={{ marginTop: 16 }}>
            <button disabled={busy} onClick={() => { const reason = prompt('Reason for cancellation (optional):') || undefined; run(() => p2pApi.cancel(pr.id, reason)) }} style={{ ...actionBtn, background: '#64748b' }}>
              Cancel PR
            </button>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: TEXT.heading, margin: '0 0 14px' }}>Audit Trail</h2>
        {audit.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No history yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  {['Date & Time', 'User', 'Action', 'Previous Status', 'New Status', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{entry.performed_at ? new Date(entry.performed_at).toLocaleString() : '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: TEXT.body }}>{entry.performed_by}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: TEXT.secondary, textTransform: 'capitalize' }}>{entry.action.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: TEXT.secondary, textTransform: 'capitalize' }}>{(entry as unknown as { old_status?: string }).old_status || '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: TEXT.secondary, textTransform: 'capitalize' }}>{(entry as unknown as { new_status?: string }).new_status || '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: TEXT.secondary }}>{entry.summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
