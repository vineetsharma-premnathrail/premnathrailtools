'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, usersApi, vendorsApi, storeApi } from '@/lib/api'
import { P2PRequest, DirectoryUser, Vendor, StockItem, StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'

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


const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, cursor: 'pointer',
  background: '#fff', color: TEXT.secondary, fontSize: 13, fontWeight: 600,
}
const dangerBtn: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10,
  border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)', color: '#b91c1c', cursor: 'pointer',
}

export default function MyP2PRequestDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromApproval = searchParams.get('from') === 'approval'
  const prId = Number(params.id)

  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [storeLocations, setStoreLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [activePanel, setActivePanel] = useState<'' | 'edit' | 'assign' | 'quotation' | 'vendor' | 'po' | 'receipt'>('')
  const [confirmAction, setConfirmAction] = useState<'' | 'approve' | 'close'>('')
  const [promptAction, setPromptAction] = useState<'' | 'cancel' | 'reject'>('')

  const [editProjectLabel, setEditProjectLabel] = useState('')
  const [editRequiredDate, setEditRequiredDate] = useState('')
  const [editRequirementType, setEditRequirementType] = useState('')
  const [editPriority, setEditPriority] = useState('medium')
  const [editRemarks, setEditRemarks] = useState('')

  const [assignBuyerId, setAssignBuyerId] = useState('')
  const [assignDate, setAssignDate] = useState('')

  const [qVendor, setQVendor] = useState('')
  const [qRfqNumber, setQRfqNumber] = useState('')
  const [qQuotation, setQQuotation] = useState('')
  const [qQuotationDate, setQQuotationDate] = useState('')
  const [qVendorComparison, setQVendorComparison] = useState('')

  const [selectedVendor, setSelectedVendor] = useState('')

  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState('')
  const [poValue, setPoValue] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [orderedQuantity, setOrderedQuantity] = useState('')

  const [receivedQuantity, setReceivedQuantity] = useState('')
  const [grnNumber, setGrnNumber] = useState('')
  const [receiptDate, setReceiptDate] = useState('')
  const [receivingRemarks, setReceivingRemarks] = useState('')
  const [storeLocationId, setStoreLocationId] = useState('')

  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await p2pApi.get(prId)
      setPr(data)
      setEditProjectLabel(data.project_label || '')
      setEditRequiredDate(data.required_date || '')
      setEditRequirementType(data.requirement_type || '')
      setEditPriority(data.priority || 'medium')
      setEditRemarks(data.remarks || '')
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

  useEffect(() => {
    if (!isPurchaseTeam) return
    usersApi.directory().then(setUsers).catch(() => {})
    vendorsApi.list({ limit: 500 }).then(setVendors).catch(() => {})
    storeApi.listItems({ limit: 1000 }).then(setStockItems).catch(() => {})
    storeApi.listLocations().then(setStoreLocations).catch(() => {})
  }, [isPurchaseTeam])

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setActivePanel('')
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => setPromptAction('cancel')
  const approve = () => setConfirmAction('approve')
  const reject = () => setPromptAction('reject')
  const close = () => setConfirmAction('close')

  const confirmActionDo = () => {
    const action = confirmAction
    setConfirmAction('')
    if (action === 'approve') runAction(() => p2pApi.approve(prId))
    if (action === 'close') runAction(() => p2pApi.close(prId))
  }

  const promptActionDo = (reason: string) => {
    const action = promptAction
    setPromptAction('')
    if (action === 'cancel') runAction(() => p2pApi.cancel(prId, reason || undefined))
    if (action === 'reject') runAction(() => p2pApi.reject(prId, reason || undefined))
  }

  const saveEdit = () => runAction(() =>
    p2pApi.update(prId, {
      project_label: editProjectLabel || undefined,
      required_date: editRequiredDate || undefined,
      requirement_type: editRequirementType || undefined,
      priority: editPriority,
      remarks: editRemarks || undefined,
    })
  )

  const saveAssignBuyer = () => {
    if (!assignBuyerId) { setError('Select a buyer.'); return }
    runAction(() => p2pApi.assignBuyer(prId, Number(assignBuyerId), assignDate || undefined))
  }

  const saveQuotation = () => runAction(() =>
    p2pApi.requestQuotations(prId, {
      vendor: qVendor || undefined,
      rfq_number: qRfqNumber || undefined,
      quotation: qQuotation || undefined,
      quotation_date: qQuotationDate || undefined,
      vendor_comparison: qVendorComparison || undefined,
    })
  )

  const saveSelectVendor = () => {
    if (!selectedVendor.trim()) { setError('Enter the selected vendor.'); return }
    runAction(() => p2pApi.selectVendor(prId, selectedVendor.trim()))
  }

  const saveCreatePO = () => {
    if (!poNumber.trim()) { setError('Enter a PO number.'); return }
    runAction(() =>
      p2pApi.createPO(prId, {
        po_number: poNumber.trim(),
        po_date: poDate || undefined,
        po_value: poValue ? Number(poValue) : undefined,
        expected_delivery: expectedDelivery || undefined,
        ordered_quantity: orderedQuantity ? Number(orderedQuantity) : undefined,
      })
    )
  }

  const saveReceipt = () => {
    if (!receivedQuantity) { setError('Enter received quantity.'); return }
    runAction(() =>
      p2pApi.updateReceipt(prId, {
        received_quantity: Number(receivedQuantity),
        grn_number: grnNumber || undefined,
        receipt_date: receiptDate || undefined,
        receiving_remarks: receivingRemarks || undefined,
        store_location_id: storeLocationId ? Number(storeLocationId) : undefined,
      })
    )
  }

  const linkStock = async (itemId: number, stockItemId: string) => {
    setBusy(true)
    setError('')
    try {
      await p2pApi.linkItemToStock(prId, itemId, stockItemId ? Number(stockItemId) : null)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to link stock item.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!pr) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Not found.</p>

  const statusColor = STATUS_HEX[pr.status] || '#64748b'
  const isAssignedApprover = !!user?.id && pr.approver_id === user.id
  const canApproveOrReject = (isPurchaseTeam || isAssignedApprover) && pr.status === 'submitted'
  const canCancel = ['submitted', 'approved'].includes(pr.status)
  const canApproveReject = fromApproval && canApproveOrReject
  const canRejectStill = fromApproval && canApproveOrReject
  const canAssignBuyer = isPurchaseTeam && pr.status === 'approved'
  const canQuoteOrSelectVendorOrPO = isPurchaseTeam && pr.status === 'approved'
  const canReceive = isPurchaseTeam && ['po_raised', 'partially_received'].includes(pr.status)
  const canClose = isPurchaseTeam && pr.status === 'received'
  const canEdit = isPurchaseTeam && !['closed', 'cancelled', 'rejected'].includes(pr.status)

  return (
    <div>
      <button onClick={() => router.push('/dashboard/p2p')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to My Requisitions
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{pr.p2p_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {STATUS_LABELS[pr.status] || pr.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{pr.category_label || pr.category_code} · {pr.project_label || 'No project specified'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canApproveReject && (
            <button disabled={busy} onClick={approve} style={primaryBtn}>Approve</button>
          )}
          {canRejectStill && (
            <button disabled={busy} onClick={reject} style={dangerBtn}>Reject</button>
          )}
          {canClose && (
            <button disabled={busy} onClick={close} style={primaryBtn}>Close Request</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {pr.status === 'rejected' && pr.rejected_reason && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          Rejected: {pr.rejected_reason}
        </div>
      )}
      {pr.status === 'cancelled' && pr.cancelled_reason && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)', color: '#475569', fontSize: 13 }}>
          Cancelled: {pr.cancelled_reason}
        </div>
      )}

      {activePanel === 'edit' && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Edit Details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Project</label>
              <input style={inputStyle} value={editProjectLabel} onChange={(e) => setEditProjectLabel(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Required Date</label>
              <DateField value={editRequiredDate} onChange={setEditRequiredDate} />
            </div>
            <div>
              <label style={labelStyle}>Requirement Type</label>
              <input style={inputStyle} value={editRequirementType} onChange={(e) => setEditRequirementType(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Remarks</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
            </div>
          </div>
          <button disabled={busy} onClick={saveEdit} style={primaryBtn}>Save Changes</button>
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Request Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <InfoRow label="Department" value={pr.department || '—'} />
          <InfoRow label="Requested By" value={pr.requested_by_name || '—'} />
          <InfoRow label="Approver" value={pr.approver_name || '—'} />
          <InfoRow label="Request Date" value={new Date(pr.request_date).toLocaleDateString()} />
          <InfoRow label="Required Date" value={pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'} />
          <InfoRow label="Requirement Type" value={pr.requirement_type || '—'} />
          <InfoRow label="Priority" value={pr.priority} />
        </div>
        {pr.remarks && <div style={{ marginTop: 10 }}><InfoRow label="Remarks" value={pr.remarks} /></div>}
      </div>

      <div style={{ ...sectionStyle, overflow: 'auto' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Item Details</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              {['SL', 'Item Description', 'Make', 'Part Code', 'UOM', 'Qty', 'Project/Inhouse', 'Category', 'Ship To', 'Attachments', ...(isPurchaseTeam ? ['Stock Item'] : [])].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
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
                    <a key={a.id} href={a.sharepoint_url} target="_blank" rel="noreferrer" style={{ display: 'block', color: TEXT.heading, textDecoration: 'none' }}>
                      {a.filename}
                    </a>
                  ))}
                </td>
                {isPurchaseTeam && (
                  <td style={{ padding: '8px 10px', minWidth: 180 }}>
                    <select
                      disabled={busy}
                      style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                      value={it.stock_item_id ? String(it.stock_item_id) : ''}
                      onChange={(e) => linkStock(it.id, e.target.value)}
                    >
                      <option value="">Not linked…</option>
                      {stockItems.map((si) => (
                        <option key={si.id} value={si.id}>{si.description} ({si.part_code})</option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isPurchaseTeam && (canAssignBuyer || canQuoteOrSelectVendorOrPO || canReceive) && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Processing</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canAssignBuyer && (
                <button disabled={busy} onClick={() => setActivePanel(activePanel === 'assign' ? '' : 'assign')} style={ghostBtn}>Assign Buyer</button>
              )}
              {canQuoteOrSelectVendorOrPO && (
                <>
                  <button disabled={busy} onClick={() => setActivePanel(activePanel === 'quotation' ? '' : 'quotation')} style={ghostBtn}>Vendor / RFQ</button>
                  <button disabled={busy} onClick={() => setActivePanel(activePanel === 'vendor' ? '' : 'vendor')} style={ghostBtn}>Select Vendor</button>
                  <button disabled={busy} onClick={() => setActivePanel(activePanel === 'po' ? '' : 'po')} style={ghostBtn}>Create PO</button>
                </>
              )}
              {canReceive && (
                <button disabled={busy} onClick={() => setActivePanel(activePanel === 'receipt' ? '' : 'receipt')} style={ghostBtn}>Update Receipt</button>
              )}
            </div>
          </div>

          {activePanel === 'assign' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Buyer</label>
                <SearchableSelect
                  value={assignBuyerId}
                  onChange={setAssignBuyerId}
                  options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                  placeholder="Search buyer…"
                />
              </div>
              <div>
                <label style={labelStyle}>Assignment Date</label>
                <DateField value={assignDate} onChange={setAssignDate} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button disabled={busy} onClick={saveAssignBuyer} style={primaryBtn}>Assign Buyer</button>
              </div>
            </div>
          )}

          {activePanel === 'quotation' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Vendor</label>
                <input style={inputStyle} value={qVendor} onChange={(e) => setQVendor(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>RFQ Number</label>
                <input style={inputStyle} value={qRfqNumber} onChange={(e) => setQRfqNumber(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Quotation Reference</label>
                <input style={inputStyle} value={qQuotation} onChange={(e) => setQQuotation(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Quotation Date</label>
                <DateField value={qQuotationDate} onChange={setQQuotationDate} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Vendor Comparison</label>
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={qVendorComparison} onChange={(e) => setQVendorComparison(e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button disabled={busy} onClick={saveQuotation} style={primaryBtn}>Save Vendor / RFQ Details</button>
              </div>
            </div>
          )}

          {activePanel === 'vendor' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Selected Vendor</label>
                <SearchableSelect
                  value={vendors.find((v) => v.name === selectedVendor)?.id ? String(vendors.find((v) => v.name === selectedVendor)?.id) : ''}
                  onChange={(id) => setSelectedVendor(vendors.find((v) => String(v.id) === id)?.name || '')}
                  options={vendors.map((v) => ({ value: String(v.id), label: `${v.name}${v.qualification_status !== 'qualified' ? ` (${v.qualification_status})` : ''}` }))}
                  placeholder={pr.selected_vendor || 'Search vendor…'}
                />
                {selectedVendor && vendors.find((v) => v.name === selectedVendor)?.qualification_status !== 'qualified' && (
                  <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>
                    ⚠ This vendor is not yet marked "qualified" — confirm with Vendor Development before raising a PO.
                  </p>
                )}
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button disabled={busy} onClick={saveSelectVendor} style={primaryBtn}>Select Vendor</button>
              </div>
            </div>
          )}

          {activePanel === 'po' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>PO Number *</label>
                <input style={inputStyle} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>PO Date</label>
                <DateField value={poDate} onChange={setPoDate} />
              </div>
              <div>
                <label style={labelStyle}>PO Value</label>
                <input type="number" style={inputStyle} value={poValue} onChange={(e) => setPoValue(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Expected Delivery</label>
                <DateField value={expectedDelivery} onChange={setExpectedDelivery} />
              </div>
              <div>
                <label style={labelStyle}>Ordered Quantity</label>
                <input type="number" style={inputStyle} value={orderedQuantity} onChange={(e) => setOrderedQuantity(e.target.value)} placeholder={String(pr.items.reduce((s, i) => s + i.quantity, 0))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button disabled={busy} onClick={saveCreatePO} style={primaryBtn}>Raise Purchase Order</button>
              </div>
            </div>
          )}

          {activePanel === 'receipt' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Received Quantity *</label>
                <input type="number" style={inputStyle} value={receivedQuantity} onChange={(e) => setReceivedQuantity(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>GRN Number</label>
                <input style={inputStyle} value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Receipt Date</label>
                <DateField value={receiptDate} onChange={setReceiptDate} />
              </div>
              {pr.items.some((it) => it.stock_item_id) && (
                <div>
                  <label style={labelStyle}>Store Location *</label>
                  <SearchableSelect
                    value={storeLocationId}
                    onChange={setStoreLocationId}
                    options={storeLocations.map((l) => ({ value: String(l.id), label: l.name }))}
                    placeholder="Where does this stock land?"
                  />
                  <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }}>
                    Required — {pr.items.filter((it) => it.stock_item_id).length} item(s) are linked to a stock catalog entry and will post a stock-in transaction.
                  </p>
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Receiving Remarks</label>
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={receivingRemarks} onChange={(e) => setReceivingRemarks(e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button disabled={busy} onClick={saveReceipt} style={primaryBtn}>Save Receipt</button>
              </div>
            </div>
          )}
        </div>
      )}

      {(pr.status === 'po_raised' || pr.status === 'partially_received' || pr.status === 'received' || pr.status === 'closed') && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Purchase Order & Receiving</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <InfoRow label="PO Number" value={pr.po_number || '—'} />
            <InfoRow label="PO Date" value={pr.po_date ? new Date(pr.po_date).toLocaleDateString() : '—'} />
            <InfoRow label="Expected Delivery" value={pr.expected_delivery ? new Date(pr.expected_delivery).toLocaleDateString() : '—'} />
            <InfoRow label="Ordered / Received" value={`${pr.ordered_quantity ?? '—'} / ${pr.received_quantity ?? 0}`} />
            <InfoRow label="GRN Number" value={pr.grn_number || '—'} />
            <InfoRow label="Receipt Date" value={pr.receipt_date ? new Date(pr.receipt_date).toLocaleDateString() : '—'} />
          </div>
        </div>
      )}

      {pr.attachments.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Attachments</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pr.attachments.map((a) => (
              <a key={a.id} href={a.sharepoint_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: TEXT.heading, textDecoration: 'none' }}>
                {a.filename} <span style={{ color: TEXT.muted, fontSize: 11 }}>({a.doc_type})</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction === 'approve'}
        title="Approve this PR?"
        message="This will move the requisition forward for buyer assignment."
        confirmLabel="Approve"
        danger={false}
        onConfirm={confirmActionDo}
        onCancel={() => setConfirmAction('')}
      />
      <ConfirmDialog
        open={confirmAction === 'close'}
        title="Close this PR?"
        message="This confirms all items were received satisfactorily."
        confirmLabel="Close Request"
        danger={false}
        onConfirm={confirmActionDo}
        onCancel={() => setConfirmAction('')}
      />
      <PromptDialog
        open={promptAction === 'cancel'}
        title="Cancel this PR?"
        placeholder="Reason for cancelling (optional)"
        confirmLabel="Cancel Requisition"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
      <PromptDialog
        open={promptAction === 'reject'}
        title="Reject this PR?"
        placeholder="Reason for rejecting (optional)"
        confirmLabel="Reject"
        onConfirm={promptActionDo}
        onCancel={() => setPromptAction('')}
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}
