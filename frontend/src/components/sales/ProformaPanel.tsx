'use client'

// Proforma invoices (SAP VA01 PF / F-37 down-payment request) of a confirmed
// order: one per advance milestone, numbered PI/<FY>/NNNN, issued as a managed
// Word document ("Save & Edit in Word" primary, PDF secondary). No ledger
// posting — Finance records the customer's advance against the same milestone.

import { useEffect, useState } from 'react'
import { salesProformaApi } from '@/lib/sdApi'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { SalesOrder, SalesProforma } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { smallPrimaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, RowCount } from '@/components/shared/ui'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner } from '@/components/sales/SalesUi'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { formatINR } from '@/components/sales/labels'
import { formatDate } from '@/lib/format'

const STATUS_HEX: Record<string, string> = { issued: '#2563EB', cancelled: '#78716c', converted: '#16A34A' }

export default function ProformaPanel({ order }: { order: SalesOrder }) {
  const { can, canFeature } = useCan()
  // Tab action + the Proforma invoices feature (raise / cancel = create / cancel).
  const canEdit = can('sales', 'orders', 'edit') && canFeature('sales', 'orders', 'proforma', 'create')
  const canPrint = can('sales', 'orders', 'print') && canFeature('sales', 'orders', 'proforma', 'print')
  const canCancel = can('sales', 'orders', 'edit') && canFeature('sales', 'orders', 'proforma', 'cancel')
  const [rows, setRows] = useState<SalesProforma[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [issueFor, setIssueFor] = useState<number | null>(null)
  const [cancelId, setCancelId] = useState<number | null>(null)

  const load = () => salesProformaApi.list(order.id).then(setRows).catch((e) => setError(extractErrorMessages(e, 'Failed to load the proforma invoices.')))
  useEffect(() => { load() }, [order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const advances = order.billing_lines.filter((b) => b.milestone_type === 'advance' && b.status !== 'cancelled')
  const live = (bid: number) => rows.find((r) => r.billing_line_id === bid && r.status === 'issued')

  const issue = async () => {
    if (issueFor === null) return
    setBusy(true); setError('')
    try {
      await salesProformaApi.create(order.id, { billing_line_id: issueFor })
      setIssueFor(null); load()
    } catch (e) { setError(extractErrorMessages(e, 'Failed to issue the proforma invoice.')) } finally { setBusy(false) }
  }
  const cancel = async (id: number, reason: string) => {
    setBusy(true); setError('')
    try { await salesProformaApi.cancel(id, reason); load() } catch (e) { setError(extractErrorMessages(e, 'Failed to cancel the proforma invoice.')) } finally { setBusy(false) }
  }
  const openPdf = async (pi: SalesProforma) => {
    try {
      const blob = await salesProformaApi.pdf(pi.id)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (e) { setError(extractErrorMessages(e, 'Failed to open the PDF.')) }
  }

  if (!order.so_number) return null
  return (
    <div data-tour="so-proforma" style={sectionStyle}>
      <h2 style={h2Style}>Proforma invoices (advance requests)</h2>
      <ErrorBanner error={error} />
      {advances.length === 0 ? (
        <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>This order has no advance milestone in its billing plan, so no proforma invoice is needed.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {advances.map((b) => {
            const pi = live(b.id)
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.03)' }}>
                <span style={{ fontSize: 12.5 }}>{b.sequence}. {b.percent}% advance — {formatINR(b.amount)}</span>
                {pi ? <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 700 }}>{pi.pi_number}</span>
                  : canEdit && !['invoiced', 'settled'].includes(b.status) && (
                    <button type="button" data-tour="so-proforma-issue" disabled={busy} onClick={() => setIssueFor(b.id)} style={{ ...smallPrimaryBtnStyle }}>Issue proforma</button>
                  )}
              </div>
            )
          })}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>{['PI number', 'Date', 'Milestone', 'Taxable', 'GST', 'Total', 'Advance received', 'Status', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
            <tbody>
              {rows.map((pi) => (
                <tr key={pi.id}>
                  <td style={tdStyle}><strong>{pi.pi_number}</strong></td>
                  <td style={tdStyle}>{formatDate(pi.pi_date)}{pi.valid_until && <div style={{ fontSize: 11, color: '#78716c' }}>valid till {formatDate(pi.valid_until)}</div>}</td>
                  <td style={tdStyle}>{pi.milestone}</td>
                  <td style={tdStyle}>{formatINR(pi.taxable_amount)}</td>
                  <td style={tdStyle}>{formatINR(pi.cgst_amount + pi.sgst_amount + pi.igst_amount)}<div style={{ fontSize: 11, color: '#78716c' }}>{pi.interstate ? 'IGST' : 'CGST + SGST'} · PoS {pi.place_of_supply_state_code}</div></td>
                  <td style={tdStyle}>{formatINR(pi.total_amount)}</td>
                  <td style={tdStyle}>{formatINR(pi.received_amount)}{pi.status === 'issued' && pi.balance_amount > 0 && <div style={{ fontSize: 11, color: '#b45309' }}>{formatINR(pi.balance_amount)} due</div>}</td>
                  <td style={tdStyle}><Pill label={pi.status_label} hex={STATUS_HEX[pi.status] || '#64748B'} />{pi.cancel_reason && <div style={{ fontSize: 11, color: '#78716c' }}>{pi.cancel_reason}</div>}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {canPrint && <button type="button" onClick={() => openPdf(pi)} style={{ ...smallSecondaryBtnStyle, marginRight: 6 }}>PDF</button>}
                    {canCancel && pi.status === 'issued' && <button type="button" disabled={busy} onClick={() => setCancelId(pi.id)} style={{ ...smallDangerBtnStyle }}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.filter((pi) => pi.status !== 'cancelled').map((pi) => (
            <div key={pi.id} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#57534e' }}>{pi.pi_number} — Word document</div>
              <ManagedDocumentPanel entityType="sales_proforma" entityId={pi.id} revision={0} canModify={canEdit && pi.status === 'issued'}
                recordLabel="proforma invoice" downloadName={pi.pi_number.replace(/\//g, '-')} />
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={issueFor !== null} title="Issue proforma invoice?" danger={false} confirmLabel={busy ? 'Issuing…' : 'Issue'}
        message="A PI number is taken from the FY series and the advance (with GST by the order's place of supply) is printed on a Word document you can edit before sending. It doesn't post to the ledger."
        onConfirm={issue} onCancel={() => setIssueFor(null)} />
      <ReasonSheet open={cancelId !== null} title="Cancel proforma invoice" message="The customer may already hold this PI — give the reason. A new PI (new number) can be issued afterwards."
        placeholder="Reason (required)" confirmLabel="Cancel PI" requireValue
        onConfirm={(v) => { const id = cancelId; setCancelId(null); if (id !== null) cancel(id, v.trim()) }} onCancel={() => setCancelId(null)} />
    </div>
  )
}
