'use client'

// Amendments tab of a sales order: raise an amendment (customer PO change),
// edit the proposed order, see the old → new diff, submit for approval, and
// cancel. Approval runs in the central engine (<ApprovalPanel>, Organization ›
// Approval Workflows); amendments submitted before that keep the old buttons.
// Applying happens on the backend at final approval.

import { useCallback, useEffect, useState } from 'react'
import { SalesAmendment, SalesOrder, SalesOrderLineInput, SalesOrderScheduleInput, SalesBillingLineInput } from '@/types'
import { salesApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner } from '@/components/sales/SalesUi'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetHint } from '@/components/shared/FormSheet'
import OrderTermsFields, { OrderTerms } from '@/components/sales/OrderTermsFields'
import { LinesEditor, ScheduleEditor, BillingPlanEditor, lineTotals, syncVehicleRows } from '@/components/sales/OrderEditors'
import { LEVEL_LABELS, DEVIATION_LABELS, formatINR } from '@/components/sales/labels'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', pending_approval: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#9ca3af' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }

// Only amendable header fields (the keys of the proposal) go back to the server.
function pickHeader(a: SalesAmendment, h: OrderTerms): OrderTerms {
  const out: OrderTerms = {}
  Object.keys(a.proposed.header).forEach((k) => { out[k] = h[k] ?? null })
  return out
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

export default function AmendmentPanel({ order, userId, onApplied }: { order: SalesOrder; userId: number | undefined; onApplied: () => void }) {
  const [items, setItems] = useState<SalesAmendment[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [rejectFor, setRejectFor] = useState<SalesAmendment | null>(null)
  const [cancelFor, setCancelFor] = useState<SalesAmendment | null>(null)
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])
  // working copy of the open draft's proposal
  const [header, setHeader] = useState<OrderTerms>({})
  const [lines, setLines] = useState<SalesOrderLineInput[]>([])
  const [rows, setRows] = useState<SalesOrderScheduleInput[]>([])
  const [billing, setBilling] = useState<SalesBillingLineInput[]>([])
  // Buttons follow the backend's tab actions (routes/amendments.py).
  const { can, canFeature } = useCan()
  // Tab action + the Amendments feature (Sales › Sales Orders › Amendments).
  const amend = (a: 'edit' | 'submit' | 'cancel' | 'approve') => canFeature('sales', 'orders', 'amendments', a)
  const canEdit = can('sales', 'orders', 'edit') && amend('edit')
  const canSubmit = canEdit && can('sales', 'orders', 'submit') && amend('submit')
  const canCancel = can('sales', 'orders', 'cancel') && amend('cancel')
  const canDecide = can('sales', 'orders', 'approve') && amend('approve')

  const load = useCallback(() => {
    salesApi.listAmendments(order.id).then((list) => {
      setItems(list)
      const draft = list.find((a) => a.status === 'draft')
      if (draft) {
        setHeader(draft.proposed.header as OrderTerms)
        setLines(draft.proposed.lines)
        setRows(draft.proposed.schedule)
        setBilling(draft.proposed.billing_plan)
      }
    }).catch((err) => setError(extractErrorMessages(err, 'Failed to load amendments.')))
  }, [order.id])

  useEffect(() => { load(); salesApi.lookupAgencies().then(setAgencies).catch(() => setAgencies([])) }, [load])

  async function run(fn: () => Promise<unknown>, applied = false) {
    setBusy(true); setError('')
    try { await fn(); load(); if (applied) onApplied() } catch (err) { setError(extractErrorMessages(err, 'The amendment action failed.')) } finally { setBusy(false) }
  }

  const draft = items.find((a) => a.status === 'draft')
  const pending = items.find((a) => a.status === 'pending_approval')
  const total = lines.reduce((s, l) => s + lineTotals(l).total, 0)

  return (
    <div>
      <ErrorBanner error={error} />
      {!draft && !pending && order.can.amend && (
        <div style={{ marginBottom: 16 }}>
          <button data-tour="sales-amend-new" style={primaryBtnStyle} disabled={busy} onClick={() => setNewOpen(true)}>+ New amendment</button>
          <span style={{ fontSize: 12.5, color: TEXT.muted, marginLeft: 12 }}>For a customer PO amendment: dates, quantities, prices, consignees or terms.</span>
        </div>
      )}

      {draft && (
        <div style={{ marginBottom: 20 }}>
          <FormPage tour="sales-amend-draft" icon="edit" title={`Amendment ${draft.amendment_no} (draft)`} subtitle={draft.reason}
            footer={<>
              {canCancel && (
                <button type="button" style={{ ...sheetBtn('secondary', '#b91c1c', busy), color: '#b91c1c', borderColor: 'rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.06)', marginRight: 'auto' }} disabled={busy} onClick={() => setCancelFor(draft)}>
                  <SheetIcon name="x" size={15} />Cancel amendment
                </button>
              )}
              {canEdit && (
                <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => run(() => salesApi.updateAmendment(draft.id, { header: pickHeader(draft, header), lines, schedule: rows, billing_plan: billing }))}>
                  <SheetIcon name="check" size={15} />{busy ? 'Saving…' : 'Save changes'}
                </button>
              )}
              {canSubmit && (
                <button data-tour="sales-amend-submit" type="button" style={sheetBtn('primary', SHEET.BLUE, busy)} disabled={busy}
                  onClick={() => run(async () => { await salesApi.updateAmendment(draft.id, { header: pickHeader(draft, header), lines, schedule: rows, billing_plan: billing }); await salesApi.amendmentAction(draft.id, 'submit') })}>
                  <SheetIcon name="send" size={16} />Submit for approval
                </button>
              )}
            </>}>
            <SheetColumns
              left={<>
                <p style={{ ...sheetHint, margin: '0 0 16px' }}>Edit the order as the customer&apos;s letter asks. To drop units, remove their delivery rows (or set a line&apos;s quantity to 0). Started builds block removal.</p>
                <OrderTermsFields v={header} set={(p) => setHeader((h) => ({ ...h, ...p }))} agencies={agencies} />
              </>}
              right={
                <SheetSection icon="rupee" title="Summary">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: SHEET.BODY }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Current order value</span><b>{formatINR(order.grand_total)}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Proposed value</span><b>{formatINR(Math.round(total * 100) / 100)}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Lines</span><b>{lines.length}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Delivery rows</span><b>{rows.length}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Changes so far</span><b>{draft.changes.length}</b></div>
                  </div>
                  <p style={sheetHint}>The changes table refreshes when you save.</p>
                </SheetSection>
              }
            />
            <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
              <SheetSection icon="list" title="Lines">
                <LinesEditor lines={lines} onChange={(next) => { setLines(next); setRows((r) => syncVehicleRows(next, r, order.customer_name || '')) }} />
              </SheetSection>
            </div>
            <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
              <SheetSection icon="truck" title="Delivery schedule">
                <ScheduleEditor lines={lines} rows={rows} onChange={setRows} />
              </SheetSection>
            </div>
            <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
              <SheetSection icon="rupee" title="Billing plan">
                <BillingPlanEditor rows={billing} onChange={setBilling} grandTotal={total} />
              </SheetSection>
            </div>
            <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
              <SheetSection icon="history" title="Changes (old → new)">
                <ChangesTable a={draft} />
              </SheetSection>
            </div>
          </FormPage>
        </div>
      )}

      {items.filter((a) => a.status !== 'draft').map((a) => (
        <div key={a.id} style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ ...h2Style, margin: 0 }}>Amendment {a.amendment_no} — {a.reason}</h2>
              <div style={{ fontSize: 12.5, color: TEXT.muted, marginTop: 4 }}>
                {a.customer_amendment_ref ? `Customer ref. ${a.customer_amendment_ref} · ` : ''}value change {formatINR(a.value_change)}
                {a.required_approval_level ? ` · needs ${LEVEL_LABELS[a.required_approval_level]}` : ''}
                {a.next_approval_level ? ` · waiting for ${LEVEL_LABELS[a.next_approval_level]}` : ''}
                {a.approval_stage ? ` · waiting for ${a.approval_stage}` : ''}
                {a.deviation_flags.length ? ` · non-standard terms: ${a.deviation_flags.map((f) => DEVIATION_LABELS[f] || f).join(', ')}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Pill label={STATUS_LABELS[a.status] || a.status} hex={STATUS_HEX[a.status] || '#78716c'} />
              {a.status === 'pending_approval' && !a.approval_via_engine && a.submitted_by_id !== userId && canDecide && (
                <>
                  <button style={primaryBtnStyle} disabled={busy} onClick={() => run(() => salesApi.amendmentAction(a.id, 'approve', {}), true)}>Approve</button>
                  <button style={dangerBtnStyle} disabled={busy} onClick={() => setRejectFor(a)}>Reject</button>
                </>
              )}
              {a.status === 'pending_approval' && canCancel && <button style={secondaryBtnStyle} disabled={busy} onClick={() => setCancelFor(a)}>Cancel amendment</button>}
            </div>
          </div>
          {a.rejection_reason && <p style={{ fontSize: 13, color: '#b91c1c' }}>Rejected: {a.rejection_reason}</p>}
          <ChangesTable a={a} />
          {a.approval_via_engine && (
            <div style={{ marginTop: 14 }}>
              <ApprovalPanel entityType="sales_amendment" entityId={a.id} title={`Approval of amendment ${a.amendment_no}`} onChanged={() => { load(); onApplied() }} />
            </div>
          )}
          {a.approvals.length > 0 && (
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '8px 0 0' }}>
              {a.approvals.map((x) => `${LEVEL_LABELS[x.level]}: ${x.decision} by ${x.approver_name} on ${formatDate(x.decided_at)}`).join(' · ')}
            </p>
          )}
        </div>
      ))}
      {items.length === 0 && !order.can.amend && <p style={{ fontSize: 13, color: TEXT.muted }}>No amendments. Amendments are raised once the order is confirmed.</p>}

      <ReasonSheet open={newOpen} title="New amendment" message="Why is the order changing? Quote the customer's amendment letter (reference and what it asks for)."
        placeholder="e.g. CR letter 12/2026: vehicle 3 to be delivered 4 weeks later" confirmLabel="Create" danger={false} requireValue icon="edit" label="Reason for the amendment"
        onCancel={() => setNewOpen(false)}
        onConfirm={(reason) => { setNewOpen(false); run(() => salesApi.createAmendment(order.id, { reason })) }} />
      <ReasonSheet open={!!rejectFor} title={`Reject amendment ${rejectFor?.amendment_no ?? ''}`} message="Say why — the maker sees this."
        confirmLabel="Reject" requireValue onCancel={() => setRejectFor(null)}
        onConfirm={(reason) => { const a = rejectFor; setRejectFor(null); if (a) run(() => salesApi.amendmentAction(a.id, 'reject', { reason })) }} />
      <ConfirmDialog open={!!cancelFor} title={`Cancel amendment ${cancelFor?.amendment_no ?? ''}?`} message="The order stays as it is. You can raise a new amendment later."
        confirmLabel="Cancel amendment" cancelLabel="Keep" danger onCancel={() => setCancelFor(null)}
        onConfirm={() => { const a = cancelFor; setCancelFor(null); if (a) run(() => salesApi.amendmentAction(a.id, 'cancel')) }} />
    </div>
  )
}

function ChangesTable({ a }: { a: SalesAmendment }) {
  if (!a.changes.length) return <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '12px 0 0' }}>No changes yet (save to refresh the diff).</p>
  return (
    <div style={{ marginTop: 14, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead><tr>{['Where', 'Field', 'Old', 'New'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
        <tbody>
          {a.changes.map((c, i) => (
            <tr key={i}>
              <td style={tdStyle}>{c.ref}</td>
              <td style={tdStyle}>{c.field ? c.field.replace(/_/g, ' ') : '—'}</td>
              <td style={{ ...tdStyle, color: '#b91c1c' }}>{show(c.old)}</td>
              <td style={{ ...tdStyle, color: '#15803d' }}>{show(c.new)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
