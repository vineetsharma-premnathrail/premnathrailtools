'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { rfqApi, purchaseOrdersApi, vendorsApi } from '@/lib/api'
import { rfqInvitesApi, RfqInvite, RfqInvites } from '@/lib/mmPurchasingApi'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { formatDateTime } from '@/lib/format'
import { RFQ, P2PPurchaseOrder, ProcurementVendor } from '@/types'
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

// Emailed RFQs — per-page status maps (repo convention).
const EMAIL_STATUS_HEX: Record<RfqInvite['email_status'], string> = { sent: '#16a34a', failed: '#dc2626', pending: '#64748b' }
const QUOTE_STATUS_HEX: Record<RfqInvite['quote_status'], string> = { quoted: '#16a34a', waiting: '#d97706', overdue: '#dc2626', not_sent: '#64748b' }
const QUOTE_STATUS_LABELS: Record<RfqInvite['quote_status'], string> = { quoted: 'Quoted', waiting: 'Waiting', overdue: 'Overdue', not_sent: 'Not sent' }
const pad2 = (n: number) => String(n).padStart(2, '0')
/** DD-MM-YYYY from an ISO date (date-only strings are not shifted by the timezone). */
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`
}
/** DD-MM HH:mm for a send / reminder timestamp. */
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const invTh: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', borderBottom: `1px solid ${BORDER.normal}` }
const invTd: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#2563eb', fontSize: 12.5, fontWeight: 600 }

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

  // --- Emailed RFQs: invited vendors, send / resend / remind / invite more.
  const [invites, setInvites] = useState<RfqInvites | null>(null)
  const [inviteBusy, setInviteBusy] = useState('')
  const [inviteNotice, setInviteNotice] = useState('')
  const [inviteMoreOpen, setInviteMoreOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await rfqApi.get(rfqId!)
      setRfq(data)
      try {
        setInvites(await rfqInvitesApi.list(rfqId!))
      } catch (err) {
        setInvites(null)
        setError(extractErrorMessages(err, 'Could not load the vendors this RFQ was emailed to.').join(' '))
      }
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
  // Emailed RFQ = has invited vendors. Old RFQs (L1–L4 attachment slots) keep the old layout.
  const inviteList = invites?.invites || []
  const hasInvites = inviteList.length > 0
  const canEditRfq = can('p2p', 'rfq', 'edit')
  const comparisonHref = `${recordPath('/dashboard/p2p/rfq', rfq)}/comparison`

  const runInviteAction = async (key: string, fn: () => Promise<RfqInvites>, done: (r: RfqInvites) => string, fallback: string) => {
    setInviteBusy(key)
    setInviteNotice('')
    try {
      const r = await fn()
      setInvites(r)
      setInviteNotice(done(r))
    } catch (err) {
      setError(extractErrorMessages(err, fallback).join(' '))
    } finally {
      setInviteBusy('')
    }
  }

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

      {hasInvites && invites && (
        <InvitedVendorsSection
          invites={invites}
          canEdit={canEditRfq}
          canOpenComparison={isPurchaseDesk && seeComparison}
          busy={inviteBusy}
          notice={inviteNotice}
          onResend={(inv) => runInviteAction(`resend-${inv.id}`, () => rfqInvitesApi.resend(rfq.id, inv.id),
            (r) => {
              const now = r.invites.find((x) => x.id === inv.id)
              return now?.email_status === 'sent'
                ? `RFQ emailed again to ${inv.vendor_name}.`
                : `${inv.vendor_name}: the email did not go — ${now?.send_error || 'see the Email column'}.`
            }, `Could not resend the RFQ to ${inv.vendor_name}.`)}
          onRemind={() => runInviteAction('remind', () => rfqInvitesApi.remind(rfq.id),
            () => "Reminder emailed to every vendor who hasn't quoted yet.", 'Could not send the reminders.')}
          onSendPending={() => runInviteAction('send', () => rfqInvitesApi.sendPending(rfq.id),
            (r) => {
              const failed = r.invites.filter((x) => x.email_status === 'failed').length
              return failed ? `Emails sent; ${failed} failed — see the Email column for the reason.` : 'Pending emails sent.'
            }, 'Could not send the pending emails.')}
          onInviteMore={() => setInviteMoreOpen(true)}
          onRecordQuote={(inv) => router.push(`${comparisonHref}?vendor=${inv.vendor_id}`)}
          onViewQuote={() => router.push(comparisonHref)}
        />
      )}

      {inviteMoreOpen && invites && (
        <InviteMoreSheet
          rfq={rfq}
          invited={inviteList}
          onClose={() => setInviteMoreOpen(false)}
          onSaved={(r, added) => {
            setInvites(r)
            setInviteMoreOpen(false)
            const failed = r.invites.filter((x) => added.includes(x.vendor_id) && x.email_status !== 'sent')
            setInviteNotice(failed.length
              ? `Invited ${added.length} vendor(s); the email did not go to ${failed.map((f) => f.vendor_name).join(', ')} — see the Email column.`
              : `Invited ${added.length} vendor(s) — the RFQ was emailed to them.`)
          }}
        />
      )}

      {seeVendorQuotes && !hasInvites && (
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
            </div>
          </div>

          {/* No PO yet — next step is creating it in the application: pick the vendor from
              the quotes (L1 by default), the PO number is generated, the PO document is
              built on the letterhead. Nothing is typed in or attached here. */}
          {!['po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(rfq.p2p_status) && (
            <>
              {hasInvites ? (
                <>
                  <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
                    Next: record each vendor&apos;s emailed quote and award the lines on the comparison, then send them to Purchase Orders — the PO(s) are created there.
                  </p>
                  {isPurchaseDesk && seeComparison
                    ? <button type="button" data-tour="rfq-detail-record-quotes-btn" onClick={() => router.push(comparisonHref)} style={primaryBtn}>Record quotes &amp; compare →</button>
                    : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Recording quotes needs the Purchase desk and R.F.Q › Quotation comparison (view) on your role.</p>}
                </>
              ) : (<>
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
                Next: select the vendor and create the PO. L1 {poVendorName ? `(${poVendorName}) ` : ''}is pre-selected; the PO number and
                PO document are generated by the system.
              </p>
              {canCreatePo
                ? <button data-tour="rfq-detail-po-create-btn" onClick={() => router.push(recordHref('/dashboard/p2p/purchase-orders/new', rfq, 'id', { create: 1 }, 'rfq'))} style={primaryBtn}>Select Vendor &amp; Create PO →</button>
                : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Creating the PO needs Create access on Procurement › Purchase Orders.</p>}
              {/* ME47/ME49: per-line vendor prices, comparison, line-level award, and one PO per vendor. */}
              {isPurchaseDesk && seeComparison && <button type="button" onClick={() => router.push(`${recordPath('/dashboard/p2p/rfq', rfq)}/comparison`)} style={{ ...ghostBtn, marginLeft: 10 }}>Line quotes &amp; comparison (split by vendor) →</button>}
              </>)}
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
                  PO created. Enter the prices and save it on the Purchase Orders page — saving sends it for approval. Open it from Purchase Orders › Create PO.
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
            <SheetSection icon="rupee" title={hasInvites ? 'Commercial Terms' : 'L1 Vendor Commercial Terms'}>
              {!hasInvites && (
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
              )}
              <label style={{ ...sheetLabel, marginTop: hasInvites ? 0 : 14 }}>Late Delivery Clause</label>
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
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>{hasInvites ? 'Commercial Terms' : 'L1 Vendor Commercial Terms'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              {/* Emailed RFQs: payment terms and delivery come with each vendor's quote. */}
              {!hasInvites && <InfoRow label="Payment Terms" value={rfq.payment_terms || '—'} />}
              {!hasInvites && <InfoRow label="Delivery Lead Time" value={rfq.delivery_lead_time || '—'} />}
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

/** Emailed RFQ: who it went to, did the email go, have they quoted. */
function InvitedVendorsSection({ invites, canEdit, canOpenComparison, busy, notice, onResend, onRemind, onSendPending, onInviteMore, onRecordQuote, onViewQuote }: {
  invites: RfqInvites
  canEdit: boolean
  canOpenComparison: boolean
  busy: string
  notice: string
  onResend: (inv: RfqInvite) => void
  onRemind: () => void
  onSendPending: () => void
  onInviteMore: () => void
  onRecordQuote: (inv: RfqInvite) => void
  onViewQuote: (inv: RfqInvite) => void
}) {
  const list = invites.invites
  const quoted = list.filter((i) => i.quote_status === 'quoted').length
  const due = invites.quote_due_date
  const duePassed = !!due && due.slice(0, 10) < todayIso()
  const anyUnsent = list.some((i) => i.email_status !== 'sent')
  const anyToRemind = list.some((i) => i.email_status === 'sent' && i.quote_status !== 'quoted')
  const off = !!busy

  return (
    <div data-tour="rfq-detail-invites" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Invited vendors</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: TEXT.secondary }}>
            <span>Quote by <b style={{ color: TEXT.heading }}>{fmtDay(due)}</b></span>
            {duePassed && <span style={pill('#dc2626')}>passed</span>}
            <span>·</span>
            <span><b style={{ color: TEXT.heading }}>{quoted} of {list.length}</b> quoted</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && anyUnsent && (
            <button type="button" data-tour="rfq-detail-send-pending" disabled={off} onClick={onSendPending} style={{ ...ghostBtn, padding: '8px 14px', opacity: off ? 0.6 : 1 }}>
              {busy === 'send' ? 'Sending…' : 'Send pending emails'}
            </button>
          )}
          {canEdit && anyToRemind && (
            <button type="button" data-tour="rfq-detail-remind-all" disabled={off} onClick={onRemind} style={{ ...ghostBtn, padding: '8px 14px', opacity: off ? 0.6 : 1 }}>
              {busy === 'remind' ? 'Sending…' : 'Remind all who haven’t quoted'}
            </button>
          )}
          {canEdit && (
            <button type="button" data-tour="rfq-detail-invite-more" disabled={off} onClick={onInviteMore} style={{ ...ghostBtn, padding: '8px 14px', opacity: off ? 0.6 : 1 }}>
              + Invite more vendors
            </button>
          )}
        </div>
      </div>

      {invites.invite_message && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(100,116,139,0.07)', fontSize: 12.5, color: TEXT.body, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          <span style={{ fontWeight: 600, color: TEXT.muted }}>Note to vendors: </span>{invites.invite_message}
        </div>
      )}
      {notice && <p style={{ fontSize: 12.5, color: '#15803d', margin: '0 0 10px' }}>{notice}</p>}

      <div data-tour="rfq-detail-invites-table" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>{['Vendor', 'Email', 'Email status', 'Reminder', 'Quote', ''].map((h, i) => <th key={i} style={invTh}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((inv) => {
              const emailHex = EMAIL_STATUS_HEX[inv.email_status] || '#64748b'
              const qHex = QUOTE_STATUS_HEX[inv.quote_status] || '#64748b'
              const isQuoted = inv.quote_status === 'quoted'
              const needsResend = inv.email_status !== 'sent'
              return (
                <tr key={inv.id}>
                  <td style={{ ...invTd, fontWeight: 600, color: TEXT.heading }}>{inv.vendor_name}</td>
                  <td style={invTd}>{inv.email || <span style={{ color: '#b91c1c' }}>no email in vendor master</span>}</td>
                  <td style={invTd}>
                    {inv.email_status === 'sent' && <span style={{ color: emailHex }}>Sent {fmtStamp(inv.sent_at)}</span>}
                    {inv.email_status === 'failed' && <span style={{ color: emailHex }}>Failed — {inv.send_error || 'no reason given'}</span>}
                    {inv.email_status === 'pending' && <span style={{ color: emailHex }}>Not sent</span>}
                  </td>
                  <td style={{ ...invTd, whiteSpace: 'nowrap' }}>{inv.reminder_sent_at ? fmtStamp(inv.reminder_sent_at) : '—'}</td>
                  <td style={invTd}>
                    <span style={pill(qHex)}>
                      {isQuoted && inv.quoted_price != null
                        ? `Quoted ₹${inv.quoted_price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                        : QUOTE_STATUS_LABELS[inv.quote_status] || inv.quote_status}
                    </span>
                  </td>
                  <td style={{ ...invTd, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
                      {canEdit && (
                        <button type="button" disabled={off} onClick={() => onResend(inv)}
                          style={needsResend ? { ...linkBtn, opacity: off ? 0.6 : 1 } : { ...linkBtn, fontWeight: 500, fontSize: 11.5, color: TEXT.muted, opacity: off ? 0.6 : 1 }}
                          title="Re-reads the vendor's email from the vendor master and sends the RFQ again">
                          {busy === `resend-${inv.id}` ? 'Sending…' : 'Resend'}
                        </button>
                      )}
                      {canOpenComparison && (isQuoted
                        ? <button type="button" onClick={() => onViewQuote(inv)} style={linkBtn}>View</button>
                        : canEdit && <button type="button" onClick={() => onRecordQuote(inv)} style={linkBtn}>Record quote</button>)}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** After sending: email the RFQ to more vendors from the vendor master. */
function InviteMoreSheet({ rfq, invited, onClose, onSaved }: {
  rfq: RFQ
  invited: RfqInvite[]
  onClose: () => void
  onSaved: (r: RfqInvites, addedVendorIds: number[]) => void
}) {
  const [vendors, setVendors] = useState<ProcurementVendor[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')

  useEffect(() => {
    vendorsApi.list({ status: 'active' })
      .then(setVendors)
      .catch((err) => { setVendors([]); setError(extractErrorMessages(err, 'Could not load the vendor master.').join(' ')) })
  }, [])

  const invitedIds = new Set(invited.map((i) => i.vendor_id))
  const available = (vendors || []).filter((v) => !invitedIds.has(v.id) && !picked.includes(v.id))
  const options = available.map((v) => ({
    value: String(v.id),
    label: `${v.name} (${v.code})${v.contact_email ? ` — ${v.contact_email}` : ' — no email, can’t be invited'}`,
  }))
  const noEmailCount = available.filter((v) => !v.contact_email).length

  const pick = (val: string) => {
    const v = (vendors || []).find((x) => String(x.id) === val)
    if (!v) return
    if (!v.contact_email) {
      setHint(`${v.name} has no email in the vendor master — add it in Procurement › Vendors, then invite them.`)
      return
    }
    setHint('')
    setPicked((s) => [...s, v.id])
  }

  const save = async () => {
    if (!picked.length) { setError('Pick at least one vendor to invite.'); return }
    setBusy(true); setError('')
    try {
      const r = await rfqInvitesApi.add(rfq.id, picked)
      onSaved(r, picked)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not invite the vendors.').join(' '))
      setBusy(false)
    }
  }

  const close = () => { if (!busy) onClose() }

  return (
    <FormSheet width={560} icon="send" title={`Invite more vendors — ${rfq.rfq_number}`} subtitle="The RFQ is emailed to each vendor as soon as you save, with the same quote-by date and note."
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" data-tour="rfq-invite-more-save" onClick={save} disabled={busy || !picked.length} style={sheetBtn('primary', SHEET.BLUE, busy || !picked.length)}>
          <SheetIcon name="send" size={16} />{busy ? 'Sending…' : `Invite & email${picked.length ? ` (${picked.length})` : ''}`}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        <SheetSection icon="building" title="Vendors">
          <label style={sheetLabel}>Add a vendor</label>
          <div data-tour="rfq-invite-more-vendor">
            <SearchableSelect value="" onChange={pick} options={options}
              placeholder={vendors === null ? 'Loading vendors…' : options.length ? 'Search the vendor master…' : 'Every active vendor is already invited'} disabled={vendors === null} />
          </div>
          {hint && <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>{hint}</p>}
          {noEmailCount > 0 && <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '6px 0 0' }}>{noEmailCount} vendor(s) have no email in the vendor master and can&apos;t be invited until one is added (Procurement › Vendors).</p>}
          {picked.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {picked.map((id) => {
                const v = (vendors || []).find((x) => x.id === id)
                if (!v) return null
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderRadius: 10, border: `1px solid ${SHEET.LINE}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK }}>{v.name} <span style={{ fontWeight: 400, color: SHEET.MUTED }}>({v.code})</span></div>
                      <div style={{ fontSize: 12, color: SHEET.MUTED }}>{v.contact_email}</div>
                    </div>
                    <button type="button" onClick={() => setPicked((s) => s.filter((x) => x !== id))} disabled={busy} style={{ ...linkBtn, color: '#b91c1c' }}>Remove</button>
                  </div>
                )
              })}
            </div>
          )}
          {invited.length > 0 && <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '12px 0 0' }}>Already invited: {invited.map((i) => i.vendor_name).join(', ')}</p>}
        </SheetSection>
      </div>
    </FormSheet>
  )
}
