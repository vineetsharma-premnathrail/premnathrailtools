'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesOrder, SalesAttachment, SalesTimelineEntry, SalesOrderLineInput, SalesOrderScheduleInput, SalesBillingLineInput } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallSecondaryBtnStyle, RowCount, pillStyle, TableScroll, numThStyle, numTdStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import SalesNav from '@/components/sales/SalesNav'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { useCan } from '@/lib/permissions'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormPage, FormSheet, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import OrderTermsFields, { OrderTerms } from '@/components/sales/OrderTermsFields'
import { LinesEditor, ScheduleEditor, BillingPlanEditor, syncVehicleRows } from '@/components/sales/OrderEditors'
import DeliveryPanel from '@/components/sales/DeliveryPanel'
import BillingStatusPanel from '@/components/sales/BillingStatusPanel'
import AmendmentPanel from '@/components/sales/AmendmentPanel'
import ProformaPanel from '@/components/sales/ProformaPanel'
import {
  SO_STATUS_LABELS, SO_STATUS_HEX, LEVEL_LABELS, DEVIATION_LABELS, PRICE_BASIS_LABELS, LD_PERIOD_LABELS, LD_BASIS_LABELS,
  WARRANTY_RULE_LABELS, MILESTONE_LABELS, LINE_TYPE_LABELS, DOC_TYPE_LABELS, ORDER_TYPE_LABELS, ORDER_CATEGORY_LABELS, formatINR, formatMoney,
} from '@/components/sales/labels'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { ProjectUnitChip } from '@/components/sales/ProjectUnitPicker'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import CreditReleaseDialog from '@/components/finance/CreditReleaseDialog'
import SoCrmDocuments from '@/components/sales/SoCrmDocuments'

const TABS = [
  ['overview', 'Overview'], ['lines', 'Lines'], ['schedule', 'Delivery Schedule'], ['billing', 'Billing Plan'],
  ['amendments', 'Amendments'], ['documents', 'Documents'], ['approvals', 'Approvals'], ['timeline', 'Timeline'],
] as const
// Sub-tab → its Sales › Sales Orders feature (Organization › Role & Permissions). Overview is the base view.
const TAB_FEATURE: Record<string, string> = {
  lines: 'lines', schedule: 'schedule', billing: 'billing_plan', amendments: 'amendments', documents: 'documents', approvals: 'approvals', timeline: 'timeline',
}
const STEPS = ['draft', 'pending_approval', 'confirmed', 'in_execution', 'partially_delivered', 'delivered', 'closed']
const TERM_KEYS = [
  'order_type', 'customer_po_number', 'customer_po_date', 'customer_po_received_date', 'contract_reference', 'currency',
  'purchaser_name', 'paying_authority', 'price_basis', 'freight_terms', 'insurance_terms', 'payment_terms_label', 'inspection_agency',
  'third_party_inspection_required', 'ld_applicable', 'ld_rate_percent', 'ld_rate_period', 'ld_basis', 'ld_max_percent',
  'warranty_months_from_delivery', 'warranty_months_from_commissioning', 'warranty_rule', 'warranty_terms_text',
  'delivery_terms_text', 'special_conditions',
] as const

type Prompt = { action: string; title: string; message: string; confirm: string; danger: boolean; require: boolean; field: 'reason' | 'comment' }

/** A draft's editable block — the FormPage look in place, with its own Save button. */
function DraftBlock({ title, subtitle, icon, tour, busy, saveLabel, onSave, children }: {
  title: string; subtitle: string; icon: 'doc' | 'list' | 'truck' | 'rupee'; tour?: string; busy: boolean; saveLabel: string; onSave: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <FormPage icon={icon} title={title} subtitle={subtitle} tour={tour}
        footer={<button type="button" disabled={busy} onClick={onSave} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : saveLabel}</button>}>
        <div style={{ padding: '20px 24px 4px' }}>{children}</div>
      </FormPage>
    </div>
  )
}

export default function SalesOrderDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('sales')
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const search = useSearchParams()
  const { id: soIdResolved, error: linkError } = useRecordId(id)
  const soId = soIdResolved ?? 0
  const [so, setSo] = useState<SalesOrder | null>(null)
  const [tab, setTab] = useState<string>(search.get('tab') || 'overview')
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [creditRelease, setCreditRelease] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])
  const [terms, setTerms] = useState<OrderTerms>({})
  const [lines, setLines] = useState<SalesOrderLineInput[]>([])
  const [rows, setRows] = useState<SalesOrderScheduleInput[]>([])
  const [billing, setBilling] = useState<SalesBillingLineInput[]>([])
  const [attachments, setAttachments] = useState<SalesAttachment[]>([])
  const [timeline, setTimeline] = useState<SalesTimelineEntry[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [docType, setDocType] = useState('customer_po')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')
  const { can, canFeature } = useCan()
  const feat = (f: string, a: 'view' | 'create' | 'edit' | 'delete' = 'view') => canFeature('sales', 'orders', f, a)
  // Same rule as the server (views.prices_hidden): Prices & margins, or editing the lines.
  const seePrices = feat('prices') || feat('lines', 'edit')
  useEscapeKey(uploadOpen && !busy, () => setUploadOpen(false))

  const adopt = useCallback((o: SalesOrder) => {
    setSo(o)
    const t: OrderTerms = {}
    TERM_KEYS.forEach((k) => { t[k] = (o as unknown as Record<string, string | number | boolean | null>)[k] })
    setTerms(t)
    setLines(o.lines.map((l) => ({ id: l.id, line_number: l.line_number, line_type: l.line_type, crm_product_id: l.crm_product_id, rrv_model: l.rrv_model, description: l.description,
      specification: l.specification, customer_line_ref: l.customer_line_ref, hsn_sac_code: l.hsn_sac_code, uom: l.uom, quantity: l.quantity,
      unit_price: l.unit_price, discount_percent: l.discount_percent, gst_rate: l.gst_rate,
      product_id: l.product_id, list_price: l.list_price, price_override_reason: l.price_override_reason })))
    setRows(o.schedules.filter((r) => r.status !== 'cancelled').map((r) => ({ id: r.id, line_number: r.line_number || 0, quantity: r.quantity, consignee_name: r.consignee_name,
      consignee_address: r.consignee_address, consignee_gstin: r.consignee_gstin, consignee_state_code: r.consignee_state_code,
      ship_to_address_id: r.ship_to_address_id ?? null, contract_delivery_date: r.contract_delivery_date })))
    setBilling(o.billing_lines.filter((b) => b.status !== 'cancelled').map((b) => ({ id: b.id, milestone_type: b.milestone_type, description: b.description, percent: b.percent, per_unit: b.per_unit, due_days: b.due_days })))
  }, [])

  const load = useCallback(() => {
    salesApi.getOrder(soId).then(adopt).catch((err) => setError(extractErrorMessages(err, 'Failed to load the sales order.')))
  }, [soId, adopt])

  useEffect(() => { if (isAuthorized && soId) { load(); salesApi.lookupAgencies().then(setAgencies).catch(() => setAgencies([])) } }, [isAuthorized, soId, load])
  useEffect(() => {
    if (!isAuthorized || !soId) return
    if (tab === 'documents' && feat('documents')) salesApi.listAttachments('sales_order', soId).then(setAttachments).catch((err) => setError(extractErrorMessages(err, 'Failed to load documents.')))
    if (tab === 'timeline' && feat('timeline')) salesApi.timeline(soId).then(setTimeline).catch((err) => setError(extractErrorMessages(err, 'Failed to load the timeline.')))
  }, [isAuthorized, tab, soId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<SalesOrder | unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'display_number' in (res as object)) adopt(res as SalesOrder)
      else load()
      if (done) setNotice(done)
    } catch (err) {
      setError(extractErrorMessages(err, 'The action failed.'))
    } finally { setBusy(false) }
  }

  async function openPdf() {
    try {
      const blob = await salesApi.oaPdf(soId)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err) { setError(extractErrorMessages(err, 'Failed to open the acknowledgement PDF.')) }
  }

  async function openAttachment(a: SalesAttachment) {
    try { window.open(URL.createObjectURL(await salesApi.attachmentContent(a.id)), '_blank') } catch (err) { setError(extractErrorMessages(err, `Failed to open ${a.filename}.`)) }
  }

  async function upload() {
    if (!files.length) { setUploadError('Choose at least one file to upload.'); return }
    setBusy(true); setUploadError('')
    try {
      await salesApi.uploadAttachments('sales_order', soId, files, docType)
      setFiles([])
      setAttachments(await salesApi.listAttachments('sales_order', soId))
      setUploadOpen(false)
    } catch (err) { setUploadError(extractErrorMessages(err, 'Upload failed.')) } finally { setBusy(false) }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><SalesNav /><InvalidRecordLink message={linkError} listHref="/dashboard/sales/orders" listLabel="Back to sales orders" /></div>)
  if (!so) return (<div><SalesNav /><PageHeader title="Sales order" backHref="/dashboard/sales/orders" /><ErrorBanner error={error} /></div>)

  const c = so.can
  const isDraft = so.status === 'draft'
  const stepIdx = STEPS.indexOf(so.status === 'on_hold' ? 'confirmed' : so.status)
  const ask = (p: Prompt) => setPrompt(p)
  // Attachments: upload / delete need 'edit' on Sales › Sales Orders (backend _require_edit)
  // plus the Documents feature's create / delete.
  const canEditDocs = can('sales', 'orders', 'edit')
  const canUploadDocs = canEditDocs && feat('documents', 'create')
  const canDeleteDocs = canEditDocs && feat('documents', 'delete')
  const visibleTabs = TABS.filter(([k]) => !TAB_FEATURE[k] || feat(TAB_FEATURE[k]))
  const shown = visibleTabs.some(([k]) => k === tab) ? tab : 'overview'
  const editLines = c.edit && feat('lines', 'edit')
  const editSchedule = c.edit && feat('schedule', 'edit')
  const editBilling = c.edit && feat('billing_plan', 'edit')

  return (
    <div>
      <SalesNav />
      <PageHeader
        title={<span>{so.display_number} <span style={{ verticalAlign: 'middle' }}><Pill label={SO_STATUS_LABELS[so.status] || so.status} hex={SO_STATUS_HEX[so.status] || '#78716c'} /></span></span>}
        subtitle={<>{so.customer_name} · PO {so.customer_po_number || '—'}{seePrices ? ` · ${formatMoney(so.grand_total, so.currency)} incl. GST` : ''}{so.amendment_no ? ` · amendment ${so.amendment_no}` : ''}</>}
        backHref="/dashboard/sales/orders"
      >
        <div data-tour="sales-detail-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {c.submit && <button style={primaryBtnStyle} disabled={busy} onClick={() => run(() => salesApi.action(soId, 'submit'), 'Submitted for approval.')}>Submit for approval</button>}
          {c.approve && <button style={primaryBtnStyle} disabled={busy} onClick={() => ask({ action: 'approve', title: `Approve as ${LEVEL_LABELS[so.next_approval_level || ''] || 'approver'}`, message: 'Optional comment (required when approving as an admin stand-in).', confirm: 'Approve', danger: false, require: false, field: 'comment' })}>Approve</button>}
          {c.approve && <button style={secondaryBtnStyle} disabled={busy} onClick={() => ask({ action: 'return', title: 'Return for changes', message: 'What must the maker change?', confirm: 'Return', danger: false, require: true, field: 'reason' })}>Return</button>}
          {c.approve && <button style={dangerBtnStyle} disabled={busy} onClick={() => ask({ action: 'reject', title: 'Reject the order', message: 'Rejection is final — the order is cancelled. Say why.', confirm: 'Reject', danger: true, require: true, field: 'reason' })}>Reject</button>}
          {c.issue_oa && <button style={secondaryBtnStyle} disabled={busy} onClick={() => run(() => salesApi.action(soId, 'issue-oa'), 'Order acknowledgement marked as issued.')}>{so.oa_issued_at ? 'Re-issue OA' : 'Mark OA issued'}</button>}
          {c.hold && <button style={secondaryBtnStyle} disabled={busy} onClick={() => ask({ action: 'hold', title: 'Put the order on hold', message: 'Why is the order on hold?', confirm: 'Hold', danger: false, require: true, field: 'reason' })}>Hold</button>}
          {c.resume && <button style={secondaryBtnStyle} disabled={busy} onClick={() => run(() => salesApi.action(soId, 'resume'), 'Order resumed.')}>Resume</button>}
          {c.short_close && <button style={dangerBtnStyle} disabled={busy} onClick={() => ask({ action: 'short-close', title: 'Short-close the order', message: 'The customer cancels the balance quantity. Open vehicles are cancelled. Quote the customer letter.', confirm: 'Short-close', danger: true, require: true, field: 'reason' })}>Short-close</button>}
          {c.close && <button style={secondaryBtnStyle} disabled={busy} onClick={() => ask({ action: 'close', title: 'Close the order', message: 'Note anything still open (e.g. retention not yet invoiced).', confirm: 'Close', danger: false, require: true, field: 'reason' })}>Close</button>}
          {c.cancel && <button style={dangerBtnStyle} disabled={busy} onClick={() => ask({ action: 'cancel', title: 'Cancel the order', message: 'Why is the order cancelled? Planned builds linked to it are released to Production.', confirm: 'Cancel order', danger: true, require: true, field: 'reason' })}>Cancel order</button>}
          {c.delete && <button style={dangerBtnStyle} disabled={busy} onClick={() => setConfirmDelete(true)}>Delete draft</button>}
        </div>
      </PageHeader>

      {(so.pm_project_id || so.order_project) && (() => {
        const pmId = so.pm_project_id ?? so.order_project?.id
        const pmCode = so.pm_project_code ?? so.order_project?.project_code ?? so.order_project?.op_number ?? ''
        const canOpen = can('projects', 'all_projects', 'view') && !!pmId
        return (
          <div data-tour="sales-detail-order-project" style={{ marginBottom: 12 }}>
            <ProjectUnitChip
              opNumber={`Project ${pmCode}`.trim()}
              onClick={canOpen ? () => router.push(recordPath('/dashboard/projects', { id: pmId })) : undefined}
              title={canOpen ? 'Open this order’s project in Project Management' : 'The project of this order (Project Management › All Projects)'}
            />
          </div>
        )
      })()}

      <div data-tour="sales-detail-stepper" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <span key={s} style={{ ...pillStyle(i <= stepIdx && stepIdx >= 0 ? '#c2410c' : TEXT.muted), fontSize: 11.5, padding: '5px 11px', ...(i <= stepIdx && stepIdx >= 0 ? {} : { background: 'rgba(0,0,0,.04)' }) }}>
            {i + 1}. {SO_STATUS_LABELS[s]}
          </span>
        ))}
      </div>

      <ErrorBanner error={error} />
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}
      {so.status === 'pending_approval' && (
        <div style={{ ...sectionStyle, padding: 14, borderLeft: '4px solid #F59E0B' }}>
          {so.approval_via_engine ? (
            <>Waiting for <b>{so.approval_stage || 'approval'}</b> ({so.next_approvers.join(', ') || 'nobody set up'}). Decide below, or in My Approvals.</>
          ) : (
            <>Waiting for the <b>{LEVEL_LABELS[so.next_approval_level || ''] || '—'}</b> ({so.next_approvers.join(', ') || 'nobody set up'}). Approval chain up to <b>{LEVEL_LABELS[so.required_approval_level || '']}</b></>
          )}
          {so.deviation_flags.length ? <> — non-standard terms: {so.deviation_flags.map((f) => DEVIATION_LABELS[f] || f).join(', ')}</> : null}.
          {seePrices && so.credit?.exceeded && <div style={{ color: '#b91c1c', marginTop: 6 }}>Credit check: open orders {formatINR(so.credit.open_order_value)}{so.credit.ar_outstanding ? <> + unpaid invoices {formatINR(so.credit.ar_outstanding)}</> : null} exceed the customer&apos;s credit limit {formatINR(so.credit.credit_limit)}.</div>}
          {so.credit?.blocked && (
            <div style={{ color: '#b91c1c', marginTop: 6 }}>
              On credit hold: {(so.credit.block_reasons || []).join('; ')}.{' '}
              {so.credit.pending_release ? <>Release {so.credit.pending_release.release_number} is waiting for a Finance approver.</>
                : /* ui-audit-ignore-next-line adhoc-button — inline text link inside a sentence */
                  <button type="button" style={{ background: 'none', border: 'none', padding: 0, color: '#0f766e', fontWeight: 700, cursor: 'pointer' }} onClick={() => setCreditRelease(true)}>Request credit release</button>}
            </div>
          )}
          {so.credit?.release && <div style={{ color: '#15803d', marginTop: 6 }}>Credit block released ({so.credit.release.release_number}) until {formatDate(so.credit.release.valid_until)}.</div>}
        </div>
      )}
      {creditRelease && so.credit && (
        <CreditReleaseDialog position={{ customer_id: so.credit.customer_id ?? so.customer_id, customer_name: so.customer_name || '', block_reasons: so.credit.block_reasons || [],
          exposure: so.credit.exposure ?? 0, credit_limit: so.credit.credit_limit || null, overdue_amount: so.credit.overdue_amount ?? 0 }}
          salesOrderId={so.id} soNumber={so.display_number}
          onClose={() => setCreditRelease(false)} onDone={() => { setCreditRelease(false); load() }} />
      )}
      {so.approval_via_engine && so.status === 'pending_approval' && shown !== 'approvals' && (
        <div data-tour="sales-detail-approval"><ApprovalPanel entityType="sales_order" entityId={so.id} onChanged={load} /></div>
      )}
      {so.return_comment && isDraft && <div style={{ ...sectionStyle, padding: 14, borderLeft: '4px solid #2563EB' }}>Returned for changes: {so.return_comment}</div>}
      {so.open_amendment_id && <div style={{ ...sectionStyle, padding: 14, borderLeft: '4px solid #7c3aed' }}>An amendment is open — see the Amendments tab.</div>}

      <div data-tour="sales-detail-tabs" style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.08)', marginBottom: 16, flexWrap: 'wrap' }}>
        {visibleTabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', padding: '9px 12px', marginBottom: -1, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            color: shown === k ? '#FF6A2A' : '#78716c', borderBottom: shown === k ? '2px solid #FF6A2A' : '2px solid transparent' }}>{label}</button>
        ))}
      </div>

      {shown === 'overview' && (
        <>
          {/* One card: what the order is (summary), then customer, order progress and
              — once it is no longer a draft — the contract terms as label–value rows. */}
          <DetailCard tour="sales-detail-overview">
            <DetailSummary
              title={so.customer_name || 'Customer not set'}
              text={`${ORDER_CATEGORY_LABELS[so.order_category || 'new_project']} · ${ORDER_TYPE_LABELS[so.order_type] || 'Sales'} order${so.service_machine_label ? ` — machine ${so.service_machine_label}${so.service_requests?.length ? ` (${so.service_requests.map((r) => r.request_number).join(', ')})` : ''}` : so.source_label ? ` — from ${so.source_label}${so.source_quotation_number ? ` ${so.source_quotation_number}` : ''}` : ''}.`}
              meta={<>
                <Pill label={SO_STATUS_LABELS[so.status] || so.status} hex={SO_STATUS_HEX[so.status] || '#78716c'} />
                {seePrices && <><span style={{ color: '#cbd5e1' }}>·</span><span>Order value <strong style={{ color: '#0f172a' }}>{formatMoney(so.grand_total, so.currency)}</strong> incl. GST</span></>}
                <span style={{ color: '#cbd5e1' }}>·</span><span>{so.units_delivered} of {so.units_total} units delivered</span>
                <span style={{ color: '#cbd5e1' }}>·</span><span>Sales owner: <strong style={{ color: '#0f172a' }}>{so.sales_owner_name || '—'}</strong></span>
              </>}
            />
            <DetailGroup title="Customer">
              <DetailRow label="GSTIN">{so.customer_gstin}</DetailRow>
              <DetailRow label="Contact Person">{so.customer_contact_name}</DetailRow>
              <DetailRow label="Billing address">{so.billing_address}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Order" last={c.edit}>
              {seePrices && <DetailRow label="Value">{`${formatMoney(so.taxable_total, so.currency)} + GST ${formatMoney(so.gst_total, so.currency)} = ${formatMoney(so.grand_total, so.currency)}`}</DetailRow>}
              <DetailRow label="Confirmed">{so.confirmed_at ? `${formatDate(so.confirmed_at)}${so.confirmed_by_name ? ` by ${so.confirmed_by_name}` : ''}` : null}</DetailRow>
              <DetailRow label="Order acknowledgement issued">{so.oa_issued_at ? formatDate(so.oa_issued_at) : null}</DetailRow>
              {so.hold_reason && so.status === 'on_hold' && <DetailRow label="Hold reason">{so.hold_reason}</DetailRow>}
              {so.cancel_reason && <DetailRow label="Cancelled because">{so.cancel_reason}</DetailRow>}
              {so.short_close_reason && <DetailRow label="Short-closed because">{so.short_close_reason}</DetailRow>}
            </DetailGroup>
            {!c.edit && (
              <DetailGroup title="Contract terms" last>
                <DetailRow label="Customer PO">{so.customer_po_number ? `${so.customer_po_number}${so.customer_po_date ? ` · ${formatDate(so.customer_po_date)}` : ''}` : null}</DetailRow>
                {!so.customer_po_number && so.loa_number && (
                  <DetailRow label="PO / LOA no.">{`${so.loa_number}${so.loa_date ? ` · ${formatDate(so.loa_date)}` : ''}`}</DetailRow>
                )}
                <DetailRow label="Purchase Person Name">{so.purchaser_name}</DetailRow>
                <DetailRow label="Currency">{so.currency && so.currency !== 'INR' ? `${so.currency} (label only, amounts not converted)` : 'INR'}</DetailRow>
                <DetailRow label="Paying authority">{so.paying_authority}</DetailRow>
                <DetailRow label="Price basis">{PRICE_BASIS_LABELS[so.price_basis]}</DetailRow>
                <DetailRow label="Freight / insurance">{[so.freight_terms, so.insurance_terms].filter(Boolean).join(' / ') || null}</DetailRow>
                <DetailRow label="Inspection">{so.inspection_agency ? `${so.inspection_agency.toUpperCase()}${so.third_party_inspection_required ? ' (third-party inspection required)' : ''}` : null}</DetailRow>
                <DetailRow label="Liquidated damages">{so.ld_applicable ? `${so.ld_rate_percent}% ${LD_PERIOD_LABELS[so.ld_rate_period || ''] || ''} of ${LD_BASIS_LABELS[so.ld_basis || ''] || ''}, ${so.ld_max_percent == null ? 'no cap' : `cap ${so.ld_max_percent}%`}` : 'Not applicable'}</DetailRow>
                <DetailRow label="Warranty">{so.warranty_rule ? `${so.warranty_months_from_delivery ?? '—'} months from delivery / ${so.warranty_months_from_commissioning ?? '—'} months from commissioning — ${WARRANTY_RULE_LABELS[so.warranty_rule]}` : null}</DetailRow>
                <DetailRow label="Delivery terms">{so.delivery_terms_text}</DetailRow>
                <DetailRow label="Special conditions">{so.special_conditions}</DetailRow>
              </DetailGroup>
            )}
          </DetailCard>
          {c.edit && (
            <DraftBlock icon="doc" title="Contract terms" subtitle="Draft — PO, commercial, LD, warranty and delivery terms." busy={busy} saveLabel="Save terms"
              onSave={() => run(() => salesApi.updateOrder(soId, terms), 'Terms saved.')}>
              <OrderTermsFields v={terms} set={(p) => setTerms((t) => ({ ...t, ...p }))} agencies={agencies} />
            </DraftBlock>
          )}
        </>
      )}

      {shown === 'lines' && editLines && (
        <DraftBlock icon="list" title="Lines" subtitle="Draft — products, quantities and prices as on the customer's PO." busy={busy} saveLabel="Save lines"
          onSave={() => run(() => salesApi.putLines(soId, lines), 'Lines saved — vehicle rows were added to the schedule where needed.')}>
          <LinesEditor lines={lines} onChange={setLines} currency={so.currency} customerId={so.customer_id} priceDate={so.customer_po_date} />
        </DraftBlock>
      )}
      {shown === 'lines' && !editLines && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ ...h2Style, margin: 0 }}>Lines</h2>
          </div>
          {(
            <TableScroll minWidth={900}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['#', 'Type', 'Description', 'Model', 'Cust. ref.', 'Qty', ...(seePrices ? ['Unit price', 'Taxable', 'GST', 'Total'] : []), 'Delivered'].map((h, hi) => <th key={h} style={hi >= 5 ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={so.lines.length} />}</th>)}</tr></thead>
                <tbody>{so.lines.map((l) => (
                  <tr key={l.id}>
                    <td style={tdStyle}>{l.line_number}</td><td style={tdStyle}>{LINE_TYPE_LABELS[l.line_type]}</td><td style={tdStyle}>{l.description}</td>
                    <td style={tdStyle}>{l.rrv_model || '—'}</td><td style={tdStyle}>{l.customer_line_ref || '—'}</td><td style={numTdStyle}>{l.quantity} {l.uom}</td>
                    {seePrices && <><td style={numTdStyle}>{formatMoney(l.unit_price, so.currency)}</td><td style={numTdStyle}>{formatMoney(l.taxable_amount, so.currency)}</td><td style={numTdStyle}>{formatMoney(l.gst_amount, so.currency)} ({l.gst_rate}%)</td>
                    <td style={numTdStyle}>{formatMoney(l.line_total, so.currency)}</td></>}<td style={numTdStyle}>{l.qty_delivered}/{l.qty_scheduled}</td>
                  </tr>))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}

      {shown === 'schedule' && (isDraft && editSchedule ? (
        <DraftBlock icon="truck" title="Delivery schedule" subtitle="Draft — one row per vehicle with its consignee and contractual date." busy={busy} saveLabel="Save schedule"
          onSave={() => run(() => salesApi.putSchedule(soId, rows), 'Schedule saved.')}>
          <ScheduleEditor lines={lines} rows={rows} onChange={setRows} />
          <button type="button" style={{ ...sheetBtn('secondary'), marginTop: 10, marginBottom: 16 }} onClick={() => setRows(syncVehicleRows(lines, rows, so.customer_name || ''))}>Match vehicle rows to line quantities</button>
        </DraftBlock>
      ) : isDraft ? (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Delivery schedule</h2>
          <ScheduleEditor lines={lines} rows={rows} onChange={setRows} readOnly />
        </div>
      ) : so.status === 'pending_approval' ? (
        <div style={sectionStyle}><h2 style={h2Style}>Delivery schedule</h2><ScheduleEditor lines={lines} rows={rows} onChange={() => undefined} readOnly /></div>
      ) : <DeliveryPanel order={so} onChange={adopt} />)}

      {shown === 'billing' && editBilling && (
        <DraftBlock icon="rupee" title="Billing plan" subtitle="Draft — when each part of the order value is invoiced (must total 100%)." busy={busy} saveLabel="Save billing plan"
          onSave={() => run(() => salesApi.putBillingPlan(soId, billing), 'Billing plan saved.')}>
          <BillingPlanEditor rows={billing} onChange={setBilling} grandTotal={so.grand_total} currency={so.currency} />
        </DraftBlock>
      )}
      {shown === 'billing' && !editBilling && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ ...h2Style, margin: 0 }}>Billing plan</h2>
          </div>
          <BillingPlanEditor rows={billing} onChange={setBilling} grandTotal={so.grand_total} currency={so.currency} readOnly />
          {(so.so_number ? <BillingStatusPanel order={so} /> : <p style={{ fontSize: 12, color: TEXT.muted }}>Milestones start falling due once the order is confirmed. {so.billing_lines.map((b) => `${MILESTONE_LABELS[b.milestone_type] || b.milestone_type}: ${b.status.replace(/_/g, ' ')}`).join(' · ')}</p>)}
        </div>
      )}
      {shown === 'billing' && so.so_number && seePrices && feat('proforma') && <ProformaPanel order={so} />}

      {shown === 'amendments' && <AmendmentPanel order={so} userId={user?.id} onApplied={load} />}

      {shown === 'documents' && (
        <>
          {so.so_number && seePrices && (
            <div data-tour="sales-detail-oa" style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ ...h2Style, margin: 0 }}>Order acknowledgement{so.amendment_no ? ` — amendment ${so.amendment_no}` : ''}</h2>
                <button style={secondaryBtnStyle} onClick={openPdf}>Download PDF</button>
              </div>
              <ManagedDocumentPanel entityType="sales_order_ack" entityId={so.id} revision={so.amendment_no || 0} canModify={!!c.issue_oa}
                recordLabel="order acknowledgement" downloadName={`OA-${(so.so_number || '').replace(/[^A-Za-z0-9._-]+/g, '-')}`} />
            </div>
          )}
          <div data-tour="sales-detail-docs" style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <h2 style={{ ...h2Style, margin: 0 }}>Attachments</h2>
              {canUploadDocs && (
                <button data-tour="sales-detail-docs-upload" type="button" style={sheetBtn('primary')} disabled={busy} onClick={() => { setUploadError(''); setUploadOpen(true) }}>
                  <SheetIcon name="upload" size={15} />Upload documents
                </button>
              )}
            </div>
            {uploadOpen && (
              <FormSheet tour="sales-detail-docs-form" width={580} icon="upload" title="Upload Documents" subtitle={`${so.display_number} · customer PO, LOA, letters and other order files`}
                onClose={() => setUploadOpen(false)} busy={busy}
                footer={<>
                  <button type="button" onClick={() => setUploadOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
                  <button type="button" onClick={upload} disabled={busy || !files.length} style={sheetBtn('primary', SHEET.BLUE, busy || !files.length)}>
                    <SheetIcon name="upload" size={16} />{busy ? 'Uploading…' : 'Upload'}
                  </button>
                </>}>
                <div style={{ padding: '20px 24px' }}>
                  <ErrorBanner error={uploadError} />
                  <SheetSection icon="doc" title="Document">
                    <div style={{ maxWidth: 260 }}>
                      <label style={sheetLabel}>Document type <Req /></label>
                      <Select style={sheetInput} value={docType} onChange={(e) => setDocType(e.target.value)}>
                        {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </div>
                  </SheetSection>
                  <SheetSection icon="clip" title="Files">
                    <FileDropZone files={files} onChange={setFiles} />
                    <p style={sheetHint}>The customer PO (or LOA) is required before the order can be submitted for approval.</p>
                  </SheetSection>
                </div>
              </FormSheet>
            )}
            {attachments.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No attachments yet{canUploadDocs ? ' — use Upload documents.' : '.'} The customer PO (or LOA) is required before submitting.</p> : (
              <TableScroll>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['File', 'Type', 'Uploaded by', 'On', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={attachments.length} />}</th>)}</tr></thead>
                  <tbody>{attachments.map((a) => (
                    <tr key={a.id}>
                      <td style={tdStyle}><span onClick={() => openAttachment(a)} title={`Open ${a.filename}`} style={{ color: '#FF6A2A', cursor: 'pointer', fontWeight: 600, overflowWrap: 'anywhere' }}>{a.filename}</span></td>
                      <td style={tdStyle}>{DOC_TYPE_LABELS[a.doc_type] || a.doc_type}</td>
                      <td style={tdStyle}>{a.created_by_name}</td>
                      <td style={tdStyle}>{formatDate(a.created_at)}</td>
                      <td style={tdStyle}>{canDeleteDocs && <button style={{ ...smallSecondaryBtnStyle, color: '#b91c1c' }} onClick={() => run(async () => { await salesApi.deleteAttachment(a.id); setAttachments(await salesApi.listAttachments('sales_order', soId)) })}>Delete</button>}</td>
                    </tr>))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </div>
          {(so.source_inquiry_id || so.source_tender_id) && <SoCrmDocuments so={so} canEdit={canUploadDocs} />}
        </>
      )}

      {shown === 'approvals' && so.approval_via_engine && <ApprovalPanel entityType="sales_order" entityId={so.id} onChanged={load} />}
      {shown === 'approvals' && (!so.approval_via_engine || so.approvals.length > 0) && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>{so.approval_via_engine ? 'Earlier decisions (before Approval Workflows)' : 'Approval history'}</h2>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>Who approves sales orders, and above which order value, is set in Organization › Approval Workflows (Sales order).</p>
          {so.approvals.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No decisions yet.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Round', 'Level', 'Decision', 'By', 'When', 'Comment'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={so.approvals.length} />}</th>)}</tr></thead>
                <tbody>{so.approvals.map((a) => (
                  <tr key={a.id}>
                    <td style={tdStyle}>{a.revision}</td><td style={tdStyle}>{LEVEL_LABELS[a.level]}</td>
                    <td style={tdStyle}><Pill label={a.decision} hex={a.decision === 'approved' ? '#16A34A' : a.decision === 'returned' ? '#2563EB' : '#DC2626'} /></td>
                    <td style={tdStyle}>{a.approver_name}{a.stand_in ? ' (admin stand-in)' : ''}</td><td style={tdStyle}>{formatDateTime(a.decided_at)}</td><td style={tdStyle}>{a.comment || '—'}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {shown === 'timeline' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Timeline</h2>
          {timeline.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No history yet.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {timeline.map((t) => <li key={t.id} style={{ fontSize: 13, marginBottom: 6 }}><span style={{ color: TEXT.muted }}>{formatDateTime(t.at)} · {t.by || 'system'}:</span> {t.summary || `${t.action} ${t.field || ''}`}
                {t.details?.length > 0 && (
                  <details style={{ marginTop: 2 }}>
                    <summary style={{ cursor: 'pointer', color: TEXT.muted, fontSize: 12 }}>{t.details.length} changes in this save</summary>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: TEXT.muted, fontSize: 12 }}>{t.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </details>
                )}</li>)}
            </ul>
          )}
        </div>
      )}

      <ReasonSheet open={!!prompt} title={prompt?.title || ''} message={prompt?.message} confirmLabel={prompt?.confirm} danger={prompt?.danger} requireValue={prompt?.require}
        placeholder={prompt?.field === 'comment' ? 'Optional comment…' : 'Reason…'} label={prompt?.field === 'comment' ? 'Comment' : 'Reason'}
        onCancel={() => setPrompt(null)}
        onConfirm={(value) => { const p = prompt; setPrompt(null); if (p) run(() => salesApi.action(soId, p.action, { [p.field]: value }), `${p.confirm} done.`) }} />
      <ConfirmDialog open={confirmDelete} title={`Delete ${so.display_number}?`} message="The draft is removed. Submitted orders are cancelled instead, never deleted." confirmLabel="Delete" danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => { setConfirmDelete(false); try { await salesApi.deleteOrder(soId); router.push('/dashboard/sales/orders') } catch (err) { setError(extractErrorMessages(err, 'Delete failed.')) } }} />
    </div>
  )
}
