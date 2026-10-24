'use client'

/** Finance › Sales › Billing Due (SAP VF04): Sales Order billing milestones
 *  that fell due (advance on confirmation, dispatch / delivery /
 *  commissioning of a unit, an accepted inspection, a marked drawing
 *  approval, retention after the warranty) and are not invoiced yet — and
 *  "Create invoice" (VF01): a draft sales invoice copied from the order,
 *  capped at what is left of the milestone / the units that reached it. */
import { useCallback, useEffect, useState } from 'react'
import { accountsApi, salesApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { SalesBillingDue } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import DateField from '@/components/erp/DateField'
import { recordPath } from '@/lib/recordRef'
import {
  inputStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, ErrorBanner, TableWrap, EmptyRow,
} from '@/components/finance/financeUi'
import { ProofPicker, PickedProof, uploadPickedProof } from '@/components/finance/FinanceAttachments'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = {
  not_due: 'Not due', due: 'Due', invoice_requested: 'Invoice requested', invoiced: 'Invoiced', settled: 'Settled', proforma_issued: 'Proforma issued',
}
const STATUS_HEX: Record<string, string> = {
  not_due: '#94a3b8', due: '#f59e0b', invoice_requested: '#8b5cf6', invoiced: '#0ea5e9', settled: '#22c55e', proforma_issued: '#64748b',
}
const SHOW_OPTIONS = [['due', 'Billable now'], ['overdue', 'Overdue'], ['requested', 'Requested by Sales'], ['all', 'All milestones']] as const

type Raise = { m: SalesBillingDue; date: string; rows: number[]; eway: string; vehicle: string; narration: string; proof: PickedProof[] }

export default function SalesBillingDueTab({ soId }: { soId?: number | null }) {
  const { can } = useCan()
  const [rows, setRows] = useState<SalesBillingDue[]>([])
  const [show, setShow] = useState<string>('due')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [raise, setRaise] = useState<Raise | null>(null)
  const [busy, setBusy] = useState(false)
  useEscapeKey(!!raise, () => setRaise(null))

  const load = useCallback(() => {
    setLoading(true)
    salesApi.billingDue({ show, ...(soId ? { so_id: soId } : {}) })
      .then(setRows).catch((err) => setError(extractErrorMessages(err, 'Could not load the billing due list.')))
      .finally(() => setLoading(false))
  }, [show, soId])
  useEffect(() => { load() }, [load])

  async function create() {
    if (!raise) return
    const r = raise
    setBusy(true); setError(''); setNotice('')
    try {
      const inv = await accountsApi.createInvoiceFromSalesOrder({
        so_id: r.m.so_id, billing_plan_line_id: r.m.billing_line_id, schedule_ids: r.m.row_linked ? r.rows : [],
        invoice_date: r.date, narration: r.narration.trim() || null, eway_bill_no: r.eway.trim() || null, vehicle_no: r.vehicle.trim() || null,
      })
      const proofWarning = r.proof.length ? await uploadPickedProof('ar_transaction', inv.id, r.proof, 'The draft sales invoice') : ''
      setRaise(null)
      setNotice(`Draft sales invoice for ${inr(inv.total_amount)} created from ${r.m.so_display} — submit it for approval on the Sales Invoices tab.`)
      if (proofWarning) setError(proofWarning)
      load()
    } catch (err) { setError(extractErrorMessages(err, 'Could not create the invoice from the sales order.')) } finally { setBusy(false) }
  }

  const canCreate = can('accounts', 'sales_invoices', 'create')
  const total = rows.reduce((s, r) => s + (r.due_amount || 0), 0)

  return (
    <div>
      {!raise && <ErrorBanner error={error} />}
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: '0 1 200px' }}>
          <Select data-tour="fin-billing-due-filter" style={inputStyle} value={show} onChange={(e) => setShow(e.target.value)}>
            {SHOW_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div style={{ fontSize: 13, color: TEXT.secondary }}>Billable now: <b>{inr(total)}</b> incl. GST</div>
      </div>
      <TableWrap minWidth={1100}>
        <thead>
          <tr>
            {['Sales order', 'Customer', 'Milestone', 'Status', 'Due since', 'Due date'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
            <th style={numTh}>Milestone</th><th style={numTh}>Invoiced</th><th style={numTh}>Billable now</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={10} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={10} text="Nothing due for invoicing." /> : rows.map((m) => (
            <tr key={m.billing_line_id}>
              <td style={tdStyle}><a href={recordPath('/dashboard/sales/orders', m, 'so_id')} style={{ color: '#FF6A2A', fontWeight: 600 }}>{m.so_display}</a></td>
              <td style={tdStyle}>{m.customer_name}</td>
              <td style={tdStyle}>{m.percent}% {m.milestone_label.toLowerCase()}
                {m.recovers_advance_percent ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>recovers {m.recovers_advance_percent}% of the advance</div> : null}
                {m.invoices.length > 0 && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{m.invoices.map(([, n, s]) => `${n.startsWith('DRAFT-') ? 'draft' : n}${s === 'pending' && !n.startsWith('DRAFT-') ? ' (pending)' : ''}`).join(', ')}</div>}
              </td>
              <td style={tdStyle}><span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[m.status] || '#94a3b8'}1a`, color: STATUS_HEX[m.status] || '#94a3b8', whiteSpace: 'nowrap' }}>{STATUS_LABELS[m.status] || m.status}</span></td>
              <td style={tdStyle}>{m.triggered_on ? dmy(m.triggered_on) : '—'}</td>
              <td style={{ ...tdStyle, color: m.overdue ? '#b91c1c' : undefined, fontWeight: m.overdue ? 700 : 400 }}>{m.due_date ? dmy(m.due_date) : '—'}</td>
              <td style={numTd}>{inr(m.amount)}</td>
              <td style={numTd}>{inr(m.invoiced_amount)}{m.reserved_amount > 0.5 ? <div style={{ fontSize: 11, color: TEXT.muted }}>+ {inr(m.reserved_amount)} draft</div> : null}</td>
              <td style={{ ...numTd, fontWeight: 700 }}>{inr(m.due_amount)}</td>
              <td style={tdStyle}>
                {canCreate && m.due_amount > 0.5 && (
                  <button type="button" style={linkBtnStyle} disabled={busy} onClick={() => setRaise({ m, date: todayIso(), rows: m.rows.filter((r) => r.billable_units > 0).map((r) => r.schedule_id), eway: '', vehicle: '', narration: '', proof: [] })}>Create invoice</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p style={{ fontSize: 12, color: TEXT.muted, marginTop: 8 }}>
        Milestones fall due on their event: advance on order confirmation, dispatch / delivery / commissioning per unit (Store dispatch,
        RRV handover, Sales POD), an accepted third-party inspection, a drawing approval marked by Sales, retention once every warranty ended.
        A draft invoice reserves its amount until it is posted or cancelled; a credit note against it gives the amount back.
      </p>

      {raise && (() => {
        const blocked = busy || !raise.date || (raise.m.row_linked && raise.rows.length === 0)
        return (
          <FormSheet tour="fin-billing-due-raise" width={640} icon="doc" title={`Invoice ${raise.m.percent}% ${raise.m.milestone_label.toLowerCase()}`}
            subtitle={`${raise.m.so_display} · ${raise.m.customer_name}`} onClose={() => setRaise(null)} busy={busy}
            footer={<>
              <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setRaise(null)}>Cancel</button>
              <button type="button" style={sheetBtn('primary', SHEET.BLUE, blocked)} disabled={blocked} onClick={create}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Create draft invoice'}</button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={error} />
              <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 16px', lineHeight: 1.5 }}>
                Customer, GSTIN, place of supply, customer PO and the order lines (item, HSN, rate, GST) are copied from the sales order.
                The draft then goes through the normal approval and posting.
              </p>
              {raise.m.row_linked && (
                <SheetSection icon="box" title="Units to bill">
                  {raise.m.rows.filter((r) => r.billable_units > 0).map((r) => (
                    <label key={r.schedule_id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 4, color: SHEET.BODY }}>
                      <input type="checkbox" checked={raise.rows.includes(r.schedule_id)}
                        onChange={(e) => setRaise({ ...raise, rows: e.target.checked ? [...raise.rows, r.schedule_id] : raise.rows.filter((x) => x !== r.schedule_id) })} />
                      {r.label} — {r.billable_units} unit(s), {r.event_date ? dmy(r.event_date) : ''} · {inr(r.billable_amount)}
                    </label>
                  ))}
                  {raise.rows.length === 0 && <p style={{ ...sheetHint, color: '#b91c1c' }}>Tick at least one unit.</p>}
                </SheetSection>
              )}
              <SheetSection icon="truck" title="Invoice details">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ flex: '0 1 170px' }}><label style={sheetLabel}>Invoice date <Req /></label><DateField value={raise.date} onChange={(v) => setRaise({ ...raise, date: v })} /></div>
                  <div style={{ flex: '0 1 170px' }}><label style={sheetLabel}>E-way bill no.</label><input style={sheetInput} value={raise.eway} onChange={(e) => setRaise({ ...raise, eway: e.target.value })} /></div>
                  <div style={{ flex: '0 1 150px' }}><label style={sheetLabel}>Vehicle no.</label><input style={sheetInput} value={raise.vehicle} onChange={(e) => setRaise({ ...raise, vehicle: e.target.value })} /></div>
                </div>
                <label style={sheetLabel}>Narration <Optional /></label>
                <input style={sheetInput} value={raise.narration} onChange={(e) => setRaise({ ...raise, narration: e.target.value })} />
                <p style={sheetHint}>Defaults to the SO, PO and milestone.</p>
              </SheetSection>
              <SheetSection icon="clip" title="Supporting documents" extra={<Optional />}>
                <ProofPicker entityType="ar_transaction" value={raise.proof} onChange={(v) => setRaise({ ...raise, proof: v })} hint="Customer PO, signed delivery challan / LR copy." />
              </SheetSection>
            </div>
          </FormSheet>
        )
      })()}
    </div>
  )
}
