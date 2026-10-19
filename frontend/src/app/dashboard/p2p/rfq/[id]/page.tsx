'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { rfqApi, purchaseOrdersApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { RFQ, P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const textArea: React.CSSProperties = { ...sheetInput, minHeight: 60, resize: 'vertical' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}
const ghostBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, cursor: 'pointer',
  background: 'transparent', color: TEXT.secondary, fontSize: 13, fontWeight: 600,
}
const PO_WORKFLOW_STAGE_LABELS: Record<string, string> = {
  vendor_quotations: 'Pending PO',
  technical_evaluation: 'Pending PO',
  commercial_evaluation: 'Pending PO',
  vendor_selected: 'Pending PO',
  po_drafted: 'PO Draft',
  po_raised: 'Sent for PO Approval',
  po_approved: 'PO Approved',
  partially_received: 'PO Approved',
  received: 'PO Approved',
  closed: 'PO Approved',
}

const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Locked' }
// Amber while the PO is still pending/awaiting approval, grey for a draft,
// green once the PO is approved (incl. receipt stages after it).
const PO_STAGE_HEX = (label: string) => label === 'PO Approved' ? '#16a34a' : label === 'PO Draft' ? '#64748b' : '#d97706'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}

export default function RfqDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const params = useParams()
  const router = useRouter()
  const { id: rfqId, error: linkError } = useRecordId(params.id as string)
  const isAdmin = user?.role === 'admin'
  // Purchase Orders and the quote comparison are Purchase-desk pages (they redirect anyone else).
  const isPurchaseDesk = isAdmin || !!user?.apps?.includes('purchase')
  const { can, canFeature } = useCan()
  // R.F.Q features (role editor): vendor quotation files, the comparison page, and prices.
  const seeVendorQuotes = canFeature('p2p', 'rfq', 'vendor_quotes', 'view')
  const seeComparison = canFeature('p2p', 'rfq', 'comparison', 'view')
  const seePoPrices = canFeature('p2p', 'purchase_orders', 'prices', 'view') || can('p2p', 'purchase_orders', 'edit')
  // The PO built from this RFQ is Procurement › Purchase Orders work.
  const canCreatePo = isPurchaseDesk && can('p2p', 'purchase_orders', 'create')

  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState('')

  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryLeadTime, setDeliveryLeadTime] = useState('')
  const [lateDeliveryClause, setLateDeliveryClause] = useState('')
  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [comments, setComments] = useState('')

  // --- Purchase Order: created in the application (Purchase Orders page —
  // vendor pick, auto PO number, generated Word document), then priced and
  // sent for approval.
  const [poVendorName, setPoVendorName] = useState('')
  const [poDraft, setPoDraft] = useState<P2PPurchaseOrder | null>(null)
  const [poDraftLoading, setPoDraftLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await rfqApi.get(rfqId!)
      setRfq(data)
      setPaymentTerms(data.payment_terms || '')
      setDeliveryLeadTime(data.delivery_lead_time || '')
      setLateDeliveryClause(data.late_delivery_clause || '')
      setSingleQuotationReason(data.single_quotation_reason || '')
      setComments(data.comments || '')
      // The PO always goes to the L1 vendor.
      const l1 = data.attachments?.find((a: { vendor_tier: string }) => a.vendor_tier === 'L1') || data.attachments?.[0]
      if (l1) setPoVendorName(l1.vendor_name || '')

      if (['po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(data.p2p_status || '')) {
        loadPoDraft(data.p2p_request_id)
      } else {
        setPoDraft(null)
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'RFQ not found, or you do not have access to it.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  const loadPoDraft = async (p2pRequestId: number) => {
    setPoDraftLoading(true)
    try {
      const list = await purchaseOrdersApi.list({ p2p_request_id: p2pRequestId })
      const po: P2PPurchaseOrder | null = list[0] || null
      setPoDraft(po)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the purchase order for this RFQ.'))
    } finally {
      setPoDraftLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && rfqId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, rfqId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/rfq" listLabel="Back to RFQs" /></div>)
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !rfq) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!rfq) return null

  const openAdminEdit = () => {
    setPaymentTerms(rfq.payment_terms || '')
    setDeliveryLeadTime(rfq.delivery_lead_time || '')
    setLateDeliveryClause(rfq.late_delivery_clause || '')
    setSingleQuotationReason(rfq.single_quotation_reason || '')
    setComments(rfq.comments || '')
    setEditError('')
    setEditing(true)
  }

  const saveAdminEdit = async () => {
    setBusy(true)
    setEditError('')
    try {
      await rfqApi.update(rfq.id, {
        payment_terms: paymentTerms.trim() || undefined,
        delivery_lead_time: deliveryLeadTime.trim() || undefined,
        late_delivery_clause: lateDeliveryClause.trim() || undefined,
        single_quotation_reason: singleQuotationReason.trim() || undefined,
        comments: comments.trim() || undefined,
      })
      setEditing(false)
      await load()
    } catch (err) {
      setEditError(extractErrorMessages(err, 'Failed to update RFQ.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const statusColor = RFQ_STATUS_HEX[rfq.status] || '#64748b'

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{rfq.rfq_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {RFQ_STATUS_LABELS[rfq.status]}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Purchase Requisition {rfq.p2p_number || rfq.p2p_request_id}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button data-tour="rfq-detail-back" onClick={() => router.push('/dashboard/p2p/rfq')} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
          {rfq.status === 'locked' && isAdmin && (
            <button data-tour="rfq-detail-admin-edit-btn" disabled={busy} onClick={openAdminEdit} style={ghostBtn}>Admin Edit</button>
          )}
        </div>
      </div>

      <MessageDialog open={!!error} variant="error" title="Cannot Update RFQ" message={error} onClose={() => setError('')} />

      {seeVendorQuotes && (
      <div data-tour="rfq-detail-vendor-quotations" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Supplier / Vendor Quotations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {(['L1', 'L2', 'L3', 'L4'] as const).map((tier) => {
            const attachment = rfq.attachments.find((a) => a.vendor_tier === tier)
            if (!attachment) return null
            return (
              <div key={tier} style={{ borderRadius: 12, border: `1px solid ${BORDER.normal}`, padding: 12 }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{tier} Vendor</p>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading, margin: '0 0 2px' }}>{attachment.vendor_name || '—'}</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 8px' }}>{attachment.vendor_contact || '—'}</p>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getAttachmentBlob(rfq.id, attachment.id), attachment.filename) }}
                  style={{ fontSize: 12.5, color: '#2563eb', textDecoration: 'none' }}
                >
                  {attachment.filename}
                </a>
              </div>
            )
          })}
        </div>
      </div>
      )}

      {rfq.status === 'locked' && rfq.p2p_status && rfq.p2p_status !== 'approved' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Order</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${PO_STAGE_HEX(PO_WORKFLOW_STAGE_LABELS[rfq.p2p_status] || '')}1a`, color: PO_STAGE_HEX(PO_WORKFLOW_STAGE_LABELS[rfq.p2p_status] || '') }}>
                {PO_WORKFLOW_STAGE_LABELS[rfq.p2p_status] || rfq.p2p_status}
              </span>
              {/* PO creation, pricing and approval now live under Purchase Orders. */}
              {isPurchaseDesk && <button type="button" data-tour="rfq-detail-open-po" onClick={() => router.push(recordHref('/dashboard/p2p/purchase-orders/new', rfq, 'id', undefined, 'rfq'))} style={ghostBtn}>Open in Purchase Orders →</button>}
            </div>
          </div>

          {/* No PO yet — next step is creating it in the application: pick the vendor from
              the quotes (L1 by default), the PO number is generated, the PO document is
              built on the letterhead. Nothing is typed in or attached here. */}
          {!['po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(rfq.p2p_status) && (
            <>
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
                Next: select the vendor and create the PO. L1 {poVendorName ? `(${poVendorName}) ` : ''}is pre-selected; the PO number and
                PO document are generated by the system.
              </p>
              {canCreatePo
                ? <button data-tour="rfq-detail-po-create-btn" onClick={() => router.push(recordHref('/dashboard/p2p/purchase-orders/new', rfq, 'id', { create: 1 }, 'rfq'))} style={primaryBtn}>Select Vendor &amp; Create PO →</button>
                : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Creating the PO needs Create access on Procurement › Purchase Orders.</p>}
              {/* ME47/ME49: per-line vendor prices, comparison, line-level award, and one PO per vendor. */}
              {isPurchaseDesk && seeComparison && <button type="button" onClick={() => router.push(`${recordPath('/dashboard/p2p/rfq', rfq)}/comparison`)} style={{ ...ghostBtn, marginLeft: 10 }}>Line quotes &amp; comparison (split by vendor) →</button>}
            </>
          )}

          {/* Stage: po_drafted — the PO is priced and saved on the Purchase Orders page;
              saving it there sends it for approval. Nothing is sent from the RFQ. */}
          {rfq.p2p_status === 'po_drafted' && (
            poDraftLoading ? (
              <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading PO…</p>
            ) : (
              <>
                {poDraft && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
                    <InfoRow label="PO Number" value={poDraft.po_number} />
                    <InfoRow label="Vendor" value={poDraft.vendor_name || '—'} />
                  </div>
                )}
                <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
                  PO created. Enter the prices and save it on the Purchase Orders page — saving sends it for approval. Use “Open in Purchase Orders →”.
                </p>
              </>
            )
          )}

          {/* Stage: po_raised and beyond — PO approval through the approval engine takes over */}
          {['po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(rfq.p2p_status) && (
            <div>
              {poDraft?.po_number && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
                  <InfoRow label="PO Number" value={poDraft.po_number} />
                  <InfoRow label="Vendor" value={poDraft.vendor_name || '—'} />
                  {seePoPrices && <InfoRow label="PO Value (incl. tax)" value={poDraft.total_value != null ? poDraft.total_value.toFixed(2) : '—'} />}
                </div>
              )}
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 12px' }}>
                {rfq.p2p_status === 'po_raised'
                  ? 'This PO has been sent for approval — the requisition page shows who it is waiting for.'
                  : 'This PO has been approved.'}
              </p>
              <button data-tour="rfq-detail-po-view-approval-btn" onClick={() => router.push(`${recordPath('/dashboard/p2p', rfq, 'p2p_request_id')}?from=po-approval`)} style={ghostBtn}>View Approval Status</button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <FormSheet width={580} icon="edit" title={`Admin Edit — ${rfq.rfq_number}`} subtitle="Correct the commercial terms of a locked RFQ. The quotations stay as attached."
          onClose={() => { if (!busy) setEditing(false) }} busy={busy}
          footer={<>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" data-tour="rfq-edit-save" onClick={saveAdminEdit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Changes'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {editError && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{editError}</div>}
            <SheetSection icon="rupee" title="L1 Vendor Commercial Terms">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Payment Terms</label>
                  <input data-tour="rfq-edit-payment-terms" style={sheetInput} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} autoFocus />
                </div>
                <div style={{ flex: '1 1 160px' }}>
                  <label style={sheetLabel}>Delivery Lead Time</label>
                  <input data-tour="rfq-edit-delivery-lead-time" style={sheetInput} value={deliveryLeadTime} onChange={(e) => setDeliveryLeadTime(e.target.value)} />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Late Delivery Clause</label>
              <textarea data-tour="rfq-edit-late-delivery-clause" style={textArea} value={lateDeliveryClause} onChange={(e) => setLateDeliveryClause(e.target.value)} />
            </SheetSection>
            {rfq.is_single_quotation && (
              <SheetSection icon="alert" title="Single Quotation" color="#d97706">
                <label style={sheetLabel}>Reason for Single Quotation</label>
                <textarea data-tour="rfq-edit-single-reason" style={textArea} value={singleQuotationReason} onChange={(e) => setSingleQuotationReason(e.target.value)} />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Comments</label>
                <textarea data-tour="rfq-edit-comments" style={textArea} value={comments} onChange={(e) => setComments(e.target.value)} />
              </SheetSection>
            )}
          </div>
        </FormSheet>
      )}
      <>
          {rfq.is_single_quotation && (
            <div data-tour="rfq-detail-single-quotation" style={sectionStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Single Quotation</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <InfoRow label="Reason for Single Quotation" value={rfq.single_quotation_reason || '—'} />
                <InfoRow label="Comments" value={rfq.comments || '—'} />
              </div>
            </div>
          )}

          <div data-tour="rfq-detail-commercial-terms" style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>L1 Vendor Commercial Terms</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <InfoRow label="Payment Terms" value={rfq.payment_terms || '—'} />
              <InfoRow label="Delivery Lead Time" value={rfq.delivery_lead_time || '—'} />
              <div style={{ gridColumn: '1 / -1' }}>
                <InfoRow label="Late Delivery Clause" value={rfq.late_delivery_clause || '—'} />
              </div>
            </div>
          </div>
      </>

      <div data-tour="rfq-detail-meta" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <InfoRow label="Created By" value={rfq.created_by_name || '—'} />
          <InfoRow label="Created At" value={formatDateTime(rfq.created_at)} />
          <InfoRow label="Locked At" value={formatDateTime(rfq.locked_at)} />
        </div>
      </div>

    </div>
  )
}
