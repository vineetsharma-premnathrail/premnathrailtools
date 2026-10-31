'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { p2pApi, rfqApi, purchaseOrdersApi, vendorsApi } from '@/lib/api'
import { rfqInvitesApi, RfqInvite, RfqInvites } from '@/lib/mmPurchasingApi'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { formatDate, formatDateTime } from '@/lib/format'
import { RFQ, RFQLine, MyLineRow, P2PPurchaseOrder, ProcurementVendor } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, smallSecondaryBtnStyle, RowCount, Pill, pillStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import DiscardPoDraftDialog, { DiscardPoDraftTarget } from '@/components/p2p/DiscardPoDraftDialog'
import { FormSheet, SheetSection, SheetIcon, SheetError, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const textArea: React.CSSProperties = { ...sheetInput, minHeight: 60, resize: 'vertical' }
const primaryBtn = primaryBtnStyle
const ghostBtn = secondaryBtnStyle
const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e', cancelled: '#94a3b8' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Locked', cancelled: 'Cancelled' }
// A PO of this RFQ: draft = waiting for approval (or returned), issued / acknowledged = approved and with the vendor.
const PO_STATUS: Record<string, { label: string; hex: string }> = {
  draft: { label: 'Draft - not sent for approval', hex: '#d97706' }, issued: { label: 'Approved, with vendor', hex: '#16a34a' },
  acknowledged: { label: 'Approved, with vendor', hex: '#16a34a' }, partially_fulfilled: { label: 'Partly received', hex: '#d97706' },
  fulfilled: { label: 'Received', hex: '#16a34a' }, cancelled: { label: 'Cancelled', hex: '#94a3b8' },
}
const fmtQty = (n: number | null | undefined) => (n == null ? '—' : Number(n.toFixed(3)).toLocaleString('en-IN'))

// Emailed RFQs — per-page status maps (repo convention).
const EMAIL_STATUS_HEX: Record<RfqInvite['email_status'], string> = { sent: '#16a34a', failed: '#dc2626', pending: '#64748b' }
const QUOTE_STATUS_HEX: Record<RfqInvite['quote_status'], string> = { quoted: '#16a34a', waiting: '#d97706', overdue: '#dc2626', not_sent: '#64748b' }
const QUOTE_STATUS_LABELS: Record<RfqInvite['quote_status'], string> = { quoted: 'Quoted', waiting: 'Waiting', overdue: 'Overdue', not_sent: 'Not sent' }
const pad2 = (n: number) => String(n).padStart(2, '0')
/** DD/MM HH:mm for a send / reminder timestamp. */
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
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
  const canViewPos = can('p2p', 'purchase_orders', 'view')
  // The Purchase head (all buyers' lines > Edit) and admins may change any buyer's RFQ lines; a buyer only their own.
  const canWorkAll = isAdmin || canFeature('p2p', 'purchase_requisitions', 'all_lines', 'edit')

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
  // POs uploaded on THIS RFQ (one requisition can have POs on several RFQs, one per buyer).
  const [rfqPos, setRfqPos] = useState<P2PPurchaseOrder[]>([])
  const [posLoading, setPosLoading] = useState(false)
  const [posError, setPosError] = useState('')
  // Discard a draft PO of this RFQ (reason asked in a popup); the notice shows after it is done.
  const [discardTarget, setDiscardTarget] = useState<DiscardPoDraftTarget | null>(null)
  const [poNotice, setPoNotice] = useState('')
  // Draft RFQ lines: add / remove.
  const [addOpen, setAddOpen] = useState(false)
  const [lineBusy, setLineBusy] = useState(false)

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

      if (data.status === 'locked' && canViewPos) loadRfqPos(data.id, data.p2p_request_id)
      else setRfqPos([])
    } catch (err) {
      setError(extractErrorMessages(err, 'RFQ not found, or you do not have access to it.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  const loadRfqPos = async (id: number, p2pRequestId: number) => {
    setPosLoading(true)
    setPosError('')
    try {
      const list: P2PPurchaseOrder[] = await purchaseOrdersApi.list({ p2p_request_id: p2pRequestId })
      setRfqPos(list.filter((po) => po.rfq_id === id).sort((a, b) => (a.po_number || '').localeCompare(b.po_number || '', undefined, { numeric: true })))
    } catch (err) {
      setPosError(extractErrorMessages(err, 'Could not load the purchase orders of this RFQ.').join(' ') + ' Reload the page to try again.')
    } finally {
      setPosLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && rfqId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, rfqId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/rfq" listLabel="Back to RFQs" /></div>)
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !rfq) return (
    // Includes "This RFQ belongs to X - only X or the Purchase head can open its quotes." (403): shown as the server wrote it.
    <div>
      <P2PNav />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button type="button" onClick={() => router.push('/dashboard/p2p/rfq')} style={secondaryBtnStyle}>← Back</button>
      </div>
      <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
        {Array.isArray(error) ? error.join(' ') : error}
      </div>
    </div>
  )
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
        // null (not undefined) so a field the admin cleared is saved as cleared.
        payment_terms: paymentTerms.trim() || null,
        delivery_lead_time: deliveryLeadTime.trim() || null,
        late_delivery_clause: lateDeliveryClause.trim() || null,
        single_quotation_reason: singleQuotationReason.trim() || null,
        comments: comments.trim() || null,
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
  const allLines: RFQLine[] = rfq.items || []
  const activeLines = allLines.filter((l) => !l.withdrawn_at)
  const takenOff = allLines.filter((l) => !!l.withdrawn_at)
  const closedNoLines = rfq.status === 'locked' && allLines.length > 0 && activeLines.length === 0
  const anyOpen = activeLines.some((l) => (l.open_qty ?? 1) > 1e-6)
  const isDraft = rfq.status === 'draft'
  const iOwn = !!user?.id && user.id === rfq.buyer_id
  const canChangeLines = isDraft && canEditRfq && (iOwn || canWorkAll)
  // Discarding a draft PO: the RFQ's own buyer or the Purchase head, with Edit on Purchase Orders (the server checks again).
  const canDiscardDraft = can('p2p', 'purchase_orders', 'edit') && (iOwn || canWorkAll)

  const removeLine = async (line: RFQLine) => {
    setLineBusy(true)
    try {
      await rfqApi.setLines(rfq.id, activeLines.filter((l) => l.pr_item_id !== line.pr_item_id).map((l) => l.pr_item_id))
      await load()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not take ${line.item_name || 'the line'} off this RFQ.`))
    } finally { setLineBusy(false) }
  }

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
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{rfq.rfq_number}</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Request for quotation</p>
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
      <DiscardPoDraftDialog target={discardTarget} onClose={() => setDiscardTarget(null)}
        onDone={(poNumber) => { setDiscardTarget(null); setPoNotice(`Draft PO ${poNumber} discarded. Its quantity is open to order again and its Tally number can be used again.`); load() }} />

      {/* One read-only record card: what this RFQ is, its key facts, then its terms. */}
      <DetailCard tour="rfq-detail-meta">
        <DetailSummary
          title={`Quotations for purchase request ${rfq.p2p_number || rfq.p2p_request_id}`}
          text={rfq.is_single_quotation
            ? 'Single-quotation RFQ — only one vendor quoted; the reason is recorded below.'
            : hasInvites
              ? `Emailed to ${inviteList.length} vendor${inviteList.length === 1 ? '' : 's'} for their quotes.`
              : 'Vendor quotations (L1 = lowest) are attached below.'}
          meta={<>
            {closedNoLines ? <Pill label="Closed - no lines left" hex="#64748b" title="Every line moved to another buyer or was written off. The quotes stay readable." /> : <Pill label={RFQ_STATUS_LABELS[rfq.status] ?? rfq.status} hex={statusColor} />}
            <span>· Buyer <strong style={{ color: TEXT.heading }}>{rfq.buyer_name || '—'}</strong></span>
            <span>· Created {formatDateTime(rfq.created_at)} by <strong style={{ color: TEXT.heading }}>{rfq.created_by_name || '—'}</strong></span>
            {rfq.locked_at && <span>· Locked {formatDateTime(rfq.locked_at)}</span>}
          </>}
        />
        <div data-tour="rfq-detail-commercial-terms">
          <DetailGroup title={hasInvites ? 'Commercial Terms' : 'L1 Vendor Commercial Terms'} last={!rfq.is_single_quotation}>
            {/* Emailed RFQs: payment terms and delivery come with each vendor's quote. */}
            {!hasInvites && <DetailRow label="Payment Terms">{rfq.payment_terms}</DetailRow>}
            {!hasInvites && <DetailRow label="Delivery Lead Time">{rfq.delivery_lead_time}</DetailRow>}
            <DetailRow label="Late Delivery Clause">{rfq.late_delivery_clause}</DetailRow>
          </DetailGroup>
        </div>
        {rfq.is_single_quotation && (
          <div data-tour="rfq-detail-single-quotation">
            <DetailGroup title="Single Quotation" last>
              <DetailRow label="Reason">{rfq.single_quotation_reason}</DetailRow>
              <DetailRow label="Comments">{rfq.comments}</DetailRow>
            </DetailGroup>
          </div>
        )}
      </DetailCard>

      <div data-tour="rfq-detail-lines" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>Lines on this RFQ</h2>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
              {isDraft
                ? 'Vendors quote only these lines. Add or take off lines until the RFQ is sent; after that its lines are fixed.'
                : 'Vendors quoted only these lines. Lines moved to another buyer or written off stay listed in grey.'}
            </p>
          </div>
          {isDraft && (canChangeLines
            ? <button type="button" data-tour="rfq-detail-add-lines" disabled={lineBusy} onClick={() => setAddOpen(true)} style={{ ...smallSecondaryBtnStyle, opacity: lineBusy ? 0.6 : 1 }}>+ Add lines</button>
            : <span style={{ fontSize: 12.5, color: TEXT.muted }}>{canEditRfq ? `Only ${rfq.buyer_name || 'the buyer'} or the Purchase head can change these lines.` : 'Changing lines needs Edit access on Procurement › R.F.Q.'}</span>)}
        </div>
        {allLines.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
            {isDraft ? 'No line is on this RFQ yet. Add the lines you want quotes for.' : 'This RFQ has no line list (it was raised before lines were tracked per RFQ). Its quotes cover the whole requisition.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>{['Item', 'Asked', 'Not yet ordered', 'Status', ''].map((h, i) => <th key={i} style={{ ...invTh, textAlign: i === 1 || i === 2 ? 'right' : 'left' }}>{h}{i === 0 && <RowCount count={allLines.length} />}</th>)}</tr>
              </thead>
              <tbody>
                {[...activeLines, ...takenOff].map((l) => {
                  const gone = !!l.withdrawn_at
                  return (
                    <tr key={l.id} style={gone ? { opacity: 0.55 } : undefined}>
                      <td style={invTd}><span style={{ fontWeight: 600, color: TEXT.heading, textDecoration: gone ? 'line-through' : undefined }}>{l.item_name}</span>
                        <div style={{ fontSize: 11.5, color: TEXT.muted }}>{l.item_code || 'No item code'}</div></td>
                      <td style={{ ...invTd, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtQty(l.quantity)} {l.unit || ''}</td>
                      <td style={{ ...invTd, textAlign: 'right', whiteSpace: 'nowrap' }}>{gone ? '—' : fmtQty(l.open_qty)}</td>
                      <td style={invTd}>{gone ? <span title={l.withdrawn_reason || undefined}>Taken off {formatDate(l.withdrawn_at)}{l.withdrawn_reason ? `: ${l.withdrawn_reason}` : ''}</span> : <span style={{ color: '#166534' }}>On this RFQ</span>}</td>
                      <td style={{ ...invTd, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {!gone && canChangeLines && <button type="button" disabled={lineBusy} onClick={() => removeLine(l)} style={{ ...linkBtn, color: '#b91c1c', opacity: lineBusy ? 0.6 : 1 }}>Remove</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <AddLinesSheet rfq={rfq} currentIds={activeLines.map((l) => l.pr_item_id)}
          onClose={() => setAddOpen(false)} onSaved={async () => { setAddOpen(false); await load() }} />
      )}

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
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

      {rfq.status === 'locked' && (
        <div data-tour="rfq-detail-purchase-orders" style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Purchase orders of this RFQ</h2>

          {canViewPos && posError && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 10px' }}>{posError}</p>}
          {poNotice && <div role="status" style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{poNotice}</div>}
          {canViewPos && posLoading && <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 10px' }}>Loading purchase orders…</p>}
          {canViewPos && !posLoading && rfqPos.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>{['PO', 'Vendor', 'Status', ...(seePoPrices ? ['Value (incl. tax)'] : []), ''].map((h, i) => <th key={i} style={{ ...invTh, textAlign: h.startsWith('Value') ? 'right' : 'left' }}>{h}{i === 0 && <RowCount count={rfqPos.length} />}</th>)}</tr></thead>
                <tbody>
                  {rfqPos.map((po) => {
                    const st = PO_STATUS[po.status] || { label: po.status, hex: '#64748b' }
                    return (
                      <tr key={po.id}>
                        <td style={{ ...invTd, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{po.po_number}</td>
                        <td style={invTd}>{po.vendor_name || '—'}</td>
                        <td style={invTd}><Pill label={st.label} hex={st.hex} /></td>
                        {seePoPrices && <td style={{ ...invTd, textAlign: 'right', whiteSpace: 'nowrap' }}>{po.total_value != null ? `₹${po.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>}
                        <td style={{ ...invTd, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
                            <button type="button" onClick={() => router.push(recordPath('/dashboard/p2p/purchase-orders', po))} style={linkBtn}>Open</button>
                            {po.status === 'draft' && canDiscardDraft && (
                              <button type="button" data-tour="rfq-detail-discard-po-draft" onClick={() => { setPoNotice(''); setDiscardTarget({ rfqId: rfq.id, poId: po.id, poNumber: po.po_number, vendorName: po.vendor_name }) }}
                                style={{ ...linkBtn, color: '#b91c1c' }}
                                title="Throw this draft PO away: its quantity goes back to open and the Tally number can be used again">Discard draft</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canViewPos && !posLoading && !posError && rfqPos.length === 0 && (
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 12px' }}>No PO has been uploaded on this RFQ yet.</p>
          )}

          {closedNoLines ? (
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>This RFQ has no lines left: they moved to another buyer or were written off. The quotes stay readable; nothing more can be awarded or ordered here.</p>
          ) : !anyOpen && allLines.length > 0 ? (
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Every line of this RFQ is on a PO or short-closed, so nothing is left to order here.</p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
                {hasInvites
                  ? "Next: record each vendor's quote on the line quotations page and award each line there (a line can be split between vendors). Then make the PO in Tally for each awarded vendor and upload it on the requisition."
                  : `Next: make the PO in Tally for the chosen vendor (L1 ${poVendorName ? `${poVendorName} ` : ''}is the lowest), then upload it on the requisition with Upload PO. It goes for approval from there.`}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {isPurchaseDesk && seeComparison
                  ? <button type="button" data-tour="rfq-detail-record-quotes-btn" onClick={() => router.push(comparisonHref)} style={primaryBtn}>Line quotes &amp; comparison →</button>
                  : <span style={{ fontSize: 12.5, color: TEXT.muted }}>Recording quotes needs the Purchase desk and R.F.Q › Quotation comparison (view) on your role.</span>}
                {canCreatePo
                  ? <button data-tour="rfq-detail-po-create-btn" onClick={() => router.push(recordPath('/dashboard/p2p', rfq, 'p2p_request_id'))} style={ghostBtn}>Open requisition to upload PO →</button>
                  : <span style={{ fontSize: 12.5, color: TEXT.muted }}>Uploading the PO needs Create access on Procurement › Purchase Orders.</span>}
              </div>
            </>
          )}
          {rfqPos.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <button data-tour="rfq-detail-po-view-approval-btn" onClick={() => router.push(`${recordPath('/dashboard/p2p', rfq, 'p2p_request_id')}?from=po-approval`)} style={ghostBtn}>View approval status</button>
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
            <span>Quote by <b style={{ color: TEXT.heading }}>{formatDate(due)}</b></span>
            {duePassed && <Pill label="Date passed" hex="#dc2626" />}
            <span>·</span>
            <span><b style={{ color: TEXT.heading }}>{quoted} of {list.length}</b> quoted</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && anyUnsent && (
            <button type="button" data-tour="rfq-detail-send-pending" disabled={off} onClick={onSendPending} style={{ ...smallSecondaryBtnStyle, opacity: off ? 0.6 : 1 }}>
              {busy === 'send' ? 'Sending…' : 'Send pending emails'}
            </button>
          )}
          {canEdit && anyToRemind && (
            <button type="button" data-tour="rfq-detail-remind-all" disabled={off} onClick={onRemind} style={{ ...smallSecondaryBtnStyle, opacity: off ? 0.6 : 1 }}>
              {busy === 'remind' ? 'Sending…' : 'Remind all who haven’t quoted'}
            </button>
          )}
          {canEdit && (
            <button type="button" data-tour="rfq-detail-invite-more" disabled={off} onClick={onInviteMore} style={{ ...smallSecondaryBtnStyle, opacity: off ? 0.6 : 1 }}>
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
            <tr>{['Vendor', 'Email', 'Email Status', 'Reminder Sent', 'Quote', ''].map((h, i) => <th key={i} style={invTh}>{h}{i === 0 && <RowCount count={list.length} />}</th>)}</tr>
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
                    <span style={pillStyle(qHex)}>
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

/** Draft RFQ: pick more lines of this requisition for this RFQ's buyer. Eligible = not yet ordered, no RFQ yet, stock check done. */
function AddLinesSheet({ rfq, currentIds, onClose, onSaved }: {
  rfq: RFQ
  currentIds: number[]
  onClose: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<MyLineRow[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    p2pApi.myLines({ p2p_request_id: rfq.p2p_request_id, ...(rfq.buyer_id ? { buyer_id: rfq.buyer_id } : {}), limit: 500 })
      .then((d) => { if (alive) setRows(d.rows) })
      .catch((err) => { if (alive) { setRows([]); setError(extractErrorMessages(err, 'Could not load the lines of this requisition.').join(' ')) } })
    return () => { alive = false }
  }, [rfq.p2p_request_id, rfq.buyer_id])

  const mine = new Set(currentIds)
  const offered = (rows || []).filter((r) => !mine.has(r.pr_item_id))
  const eligible = offered.filter((r) => r.open_to_order > 1e-6 && r.state === 'to_quote' && r.rfqs.every((q) => q.id === rfq.id))
  const blocked = offered.filter((r) => !eligible.includes(r) && r.open_to_order > 1e-6)
  const whyNot = (r: MyLineRow) => {
    const other = r.rfqs.find((q) => q.id !== rfq.id)
    return other ? `already on RFQ ${other.rfq_number}` : r.state_label.toLowerCase()
  }
  const toggle = (id: number) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const close = () => { if (!busy) onClose() }

  const save = async () => {
    if (!picked.length) { setError('Tick at least one line to add.'); return }
    setBusy(true); setError('')
    try {
      await rfqApi.setLines(rfq.id, [...currentIds, ...picked])
      onSaved()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not add the lines to this RFQ.').join(' '))
      setBusy(false)
    }
  }

  return (
    <FormSheet width={600} icon="list" title="Add lines to this RFQ" subtitle={`${rfq.rfq_number} · ${rfq.p2p_number || 'requisition'}${rfq.buyer_name ? ` · buyer ${rfq.buyer_name}` : ''}`}
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" data-tour="rfq-add-lines-save" onClick={save} disabled={busy || !picked.length} style={sheetBtn('primary', SHEET.BLUE, busy || !picked.length)}>
          <SheetIcon name="check" size={16} />{busy ? 'Adding…' : `Add${picked.length ? ` (${picked.length})` : ''}`}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="list" title="Lines you can add">
          {rows === null && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading lines…</p>}
          {rows !== null && eligible.length === 0 && (
            <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No other line of this requisition is ready for an RFQ with this buyer. A line is ready when its stock check is done, it has not been ordered and it is on no other RFQ.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {eligible.map((r) => (
              <label key={r.pr_item_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(r.pr_item_id)} onChange={() => toggle(r.pr_item_id)} disabled={busy} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK }}>{r.item_name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: SHEET.MUTED }}>{r.item_code || 'No item code'}</span>
                </span>
                <span style={{ fontSize: 12.5, color: SHEET.BODY, whiteSpace: 'nowrap' }}>{fmtQty(r.open_to_order)} {r.unit || ''} not yet ordered</span>
              </label>
            ))}
          </div>
          {blocked.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p style={{ ...sheetLabel, marginBottom: 4 }}>Not available now</p>
              {blocked.map((r) => <p key={r.pr_item_id} style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '2px 0' }}>{r.item_name}: {whyNot(r)}</p>)}
            </div>
          )}
        </SheetSection>
      </div>
    </FormSheet>
  )
}
