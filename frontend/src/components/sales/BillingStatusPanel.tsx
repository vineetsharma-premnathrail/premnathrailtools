'use client'

// Billing Plan tab of a confirmed order: each milestone's status (not due →
// due → invoice requested → invoiced → settled), what was invoiced and what
// can be billed now. Sales marks a drawing-approval / inspection / other
// milestone due and asks Accounts for the invoice; Finance raises it from
// Finance › Sales › Billing Due.

import { useCallback, useEffect, useState } from 'react'
import { SalesOrder, SalesBillingDue } from '@/types'
import { salesApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import DateField from '@/components/erp/DateField'
import { smallSecondaryBtnStyle } from '@/components/shared/ui'
import { h2Style, thStyle, tdStyle, Pill, ErrorBanner } from '@/components/sales/SalesUi'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { formatINR } from '@/components/sales/labels'

const STATUS_LABELS: Record<string, string> = {
  not_due: 'Not due', due: 'Due', invoice_requested: 'Invoice requested', invoiced: 'Invoiced', settled: 'Settled', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  not_due: '#94a3b8', due: '#F59E0B', invoice_requested: '#8B5CF6', invoiced: '#2563EB', settled: '#16A34A', cancelled: '#78716c',
}
const MANUAL = ['drawing_approval', 'inspection', 'other']
const smallBtn: React.CSSProperties = { ...smallSecondaryBtnStyle }

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BillingStatusPanel({ order }: { order: SalesOrder }) {
  const [rows, setRows] = useState<SalesBillingDue[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [due, setDue] = useState<{ m: SalesBillingDue; on: string; reference: string } | null>(null)
  const [dueError, setDueError] = useState<string | string[]>('')
  useEscapeKey(!!due && !busy, () => setDue(null))

  const load = useCallback(() => { salesApi.orderBilling(order.id).then(setRows).catch((err) => setError(extractErrorMessages(err, 'Could not load the billing status.'))) }, [order.id])
  useEffect(() => { load() }, [load, order])

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setError(''); setNotice('')
    try { await fn(); setNotice(done); load() } catch (err) { setError(extractErrorMessages(err, 'The billing action failed.')) } finally { setBusy(false) }
  }

  return (
    <div data-tour="sales-detail-billing-status" style={{ marginTop: 16 }}>
      <h2 style={h2Style}>Billing status</h2>
      <ErrorBanner error={error} />
      {notice && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['#', 'Milestone', 'Amount', 'Status', 'Due since', 'Due date', 'Invoiced', 'Billable now', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.billing_line_id}>
                <td style={tdStyle}>{m.sequence}</td>
                <td style={tdStyle}>{m.percent}% {m.milestone_label.toLowerCase()}
                  {m.invoices.length > 0 && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{m.invoices.map(([, n]) => (n.startsWith('DRAFT-') ? 'draft invoice' : n)).join(', ')}</div>}</td>
                <td style={tdStyle}>{formatINR(m.amount)}</td>
                <td style={tdStyle}><Pill label={STATUS_LABELS[m.status] || m.status} hex={STATUS_HEX[m.status] || '#78716c'} /></td>
                <td style={tdStyle}>{m.triggered_on ? formatDate(m.triggered_on) : '—'}</td>
                <td style={{ ...tdStyle, color: m.overdue ? '#b91c1c' : undefined }}>{m.due_date ? formatDate(m.due_date) : '—'}</td>
                <td style={tdStyle}>{formatINR(m.invoiced_amount)}{m.reserved_amount > 0.5 ? <div style={{ fontSize: 11, color: TEXT.muted }}>+ {formatINR(m.reserved_amount)} draft</div> : null}</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{formatINR(m.due_amount)}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {order.can.mark_milestone_due && MANUAL.includes(m.milestone_type) && !m.triggered_on && (
                      <button style={smallBtn} disabled={busy} onClick={() => { setDueError(''); setDue({ m, on: todayIso(), reference: '' }) }}>Mark due</button>
                    )}
                    {order.can.request_invoice && m.due_amount > 0.5 && m.status !== 'invoice_requested' && (
                      <button style={smallBtn} disabled={busy} onClick={() => run(() => salesApi.requestInvoice(m.billing_line_id), 'Accounts was asked to raise the invoice.')}>Request invoice</button>
                    )}
                    {order.can.raise_invoice && m.due_amount > 0.5 && (
                      <a href="/dashboard/finance/sales" style={{ ...smallBtn, textDecoration: 'none' }}>Raise in Finance</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>
        The advance falls due on confirmation; dispatch / delivery / commissioning milestones per unit as they happen; inspection when
        a third-party inspection call is accepted; retention once every unit&apos;s warranty has ended. Drawing approval and other
        milestones are marked due here. Finance raises the invoice from Finance › Sales › Billing Due.
      </p>

      {due && (
        <FormSheet tour="sales-billing-due-form" width={580} icon="flag" iconColor="#F59E0B" title="Mark Milestone Due"
          subtitle={`${due.m.percent}% ${due.m.milestone_label.toLowerCase()} · ${formatINR(due.m.amount)}`} onClose={() => setDue(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setDue(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" disabled={!due.on || busy} style={sheetBtn('primary', '#F59E0B', !due.on || busy)}
              onClick={async () => {
                const d = due
                setBusy(true); setDueError(''); setError(''); setNotice('')
                try {
                  await salesApi.markMilestoneDue(d.m.billing_line_id, { on: d.on, reference: d.reference || null })
                  setNotice('Milestone marked due.')
                  load()
                  setDue(null)
                } catch (err) { setDueError(extractErrorMessages(err, 'The billing action failed.')) } finally { setBusy(false) }
              }}>
              <SheetIcon name="flag" size={16} />{busy ? 'Saving…' : 'Mark due'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={dueError} />
            <SheetSection icon="calendar" title="The event">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>Happened on <Req /></label><DateField value={due.on} onChange={(v) => setDue({ ...due, on: v })} /></div>
                <div style={{ flex: '1 1 200px', minWidth: 180, maxWidth: 300 }}><label style={sheetLabel}>Reference <Optional /></label><input style={sheetInput} value={due.reference} onChange={(e) => setDue({ ...due, reference: e.target.value })} /></div>
              </div>
              <p style={sheetHint}>The date the event happened (e.g. the customer&apos;s drawing approval letter) and its reference.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
