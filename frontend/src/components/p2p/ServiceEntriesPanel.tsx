'use client'

// Service entry sheets (SAP ML81N) on a PO: a service line (job work charges,
// AMC, calibration, consultancy) is never received into store stock — the
// person who got the service records what was done, and accepting the entry is
// what counts as received for the PO status and the vendor's invoice match.
import { useCallback, useEffect, useState } from 'react'
import { purchaseOrdersApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, RowCount, smallSecondaryBtnStyle, Pill } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

interface ServiceLine {
  po_item_id: number
  item_name: string
  item_code?: string | null
  unit?: string | null
  ordered_quantity: number
  accepted_quantity: number
  pending_entry_quantity: number
  open_quantity: number
}

interface ServiceEntry {
  id: number
  ses_number: string
  po_item_id: number
  item_name?: string | null
  unit?: string | null
  service_date: string
  period_from?: string | null
  period_to?: string | null
  quantity: number
  description?: string | null
  status: string
  created_by_name?: string | null
  accepted_by_name?: string | null
  cancel_reason?: string | null
}

const STATUS_LABELS: Record<string, string> = { draft: 'Awaiting acceptance', accepted: 'Accepted', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#d97706', accepted: '#16a34a', cancelled: '#6b7280' }

const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body }

export default function ServiceEntriesPanel({ poId, poOpen, onChanged }: { poId: number; poOpen: boolean; onChanged?: () => void }) {
  const { can, canFeature } = useCan()
  const [lines, setLines] = useState<ServiceLine[]>([])
  const [entries, setEntries] = useState<ServiceEntry[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lineId, setLineId] = useState('')
  const [qty, setQty] = useState('')
  const [serviceDate, setServiceDate] = useState('')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [description, setDescription] = useState('')
  const [accepting, setAccepting] = useState<ServiceEntry | null>(null)
  const [cancelling, setCancelling] = useState<ServiceEntry | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [recording, setRecording] = useState(false)
  const [sheetError, setSheetError] = useState('')

  const load = useCallback(() => {
    purchaseOrdersApi.listServiceEntries(poId)
      .then((d: { service_lines: ServiceLine[]; entries: ServiceEntry[] }) => { setLines(d.service_lines); setEntries(d.entries) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the service entries.').join(' ')))
  }, [poId])

  useEffect(() => { load() }, [load])

  const record = async () => {
    setSheetError('')
    if (!lineId) { setSheetError('Pick the service line this entry is for.'); return }
    if (!(Number(qty) > 0)) { setSheetError('Enter how much of the service was done — the quantity must be more than 0.'); return }
    setBusy(true)
    try {
      await purchaseOrdersApi.createServiceEntry(poId, {
        po_item_id: Number(lineId), quantity: Number(qty), service_date: serviceDate || null,
        period_from: periodFrom || null, period_to: periodTo || null, description: description.trim() || null,
      })
      setQty(''); setDescription(''); setPeriodFrom(''); setPeriodTo(''); setServiceDate('')
      setRecording(false)
      load(); onChanged?.()
    } catch (err: unknown) {
      setSheetError(extractErrorMessages(err, 'Could not record the service entry.').join(' '))
    } finally { setBusy(false) }
  }

  const accept = async () => {
    if (!accepting) return
    setBusy(true); setError('')
    try { await purchaseOrdersApi.acceptServiceEntry(accepting.id); load(); onChanged?.() }
    catch (err: unknown) { setError(extractErrorMessages(err, 'Could not accept the service entry.').join(' ')) }
    finally { setBusy(false); setAccepting(null) }
  }

  const cancel = async () => {
    if (!cancelling) return
    const reason = cancelReason.trim()
    if (!reason) { setSheetError('Write why the entry is being cancelled — it is kept on the PO history.'); return }
    setBusy(true); setSheetError('')
    try { await purchaseOrdersApi.cancelServiceEntry(cancelling.id, reason); setCancelling(null); load(); onChanged?.() }
    catch (err: unknown) { setSheetError(extractErrorMessages(err, 'Could not cancel the service entry.').join(' ')) }
    finally { setBusy(false) }
  }

  if (lines.length === 0 && entries.length === 0 && !error) return null
  const canCreate = poOpen && can('p2p', 'purchase_orders', 'create') && canFeature('p2p', 'purchase_orders', 'service_entries', 'create')
  const openLines = lines.filter((l) => l.open_quantity > 0)

  return (
    <div data-tour="pr-detail-service-entries" style={sectionStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Service Entries</h2>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
        Service lines are not received on a GRN or into store stock. Record what the vendor did; once accepted it counts as received and the
        vendor&apos;s bill is matched against it.
      </p>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      <div style={{ overflow: 'auto', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr>{['Service line', 'Ordered', 'Accepted', 'Awaiting acceptance', 'Open'].map((h, i) => (
              <th key={h} style={{ textAlign: h === 'Service line' ? 'left' : 'right', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}{i === 0 && <RowCount count={lines.length} />}</th>
            ))}</tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.po_item_id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                <td style={cell}>{l.item_code && <b>{l.item_code} — </b>}{l.item_name}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{l.ordered_quantity} {l.unit || ''}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{l.accepted_quantity}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{l.pending_entry_quantity}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{l.open_quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canCreate && openLines.length > 0 && (
        <button type="button" onClick={() => { setSheetError(''); setRecording(true) }} style={{ ...primaryBtnStyle, marginBottom: 16 }}>+ Record service entry</button>
      )}
      {recording && canCreate && (
        <FormSheet width={580} icon="tool" title="Record service entry" subtitle="What the vendor did — once accepted it counts as received and the vendor's bill is matched against it."
          onClose={() => { if (!busy) setRecording(false) }} busy={busy}
          footer={<>
            <button type="button" onClick={() => setRecording(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={record} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Record service entry'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {sheetError && <div style={errBox}>{sheetError}</div>}
            <SheetSection icon="tool" title="Service">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 260px' }}>
                  <label style={sheetLabel}>Service line <Req /></label>
                  <Select style={sheetInput} value={lineId} onChange={(e) => setLineId(e.target.value)}>
                    <option value="">— select —</option>
                    {openLines.map((l) => <option key={l.po_item_id} value={l.po_item_id}>{l.item_name} ({l.open_quantity} {l.unit || ''} open)</option>)}
                  </Select>
                </div>
                <div style={{ flex: '0 1 110px' }}>
                  <label style={sheetLabel}>Quantity <Req /></label>
                  <input type="number" style={sheetInput} value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>What was done</label>
              <input style={sheetInput} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Q3 AMC visit, calibration cert. no." />
            </SheetSection>
            <SheetSection icon="calendar" title="Date & Period">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Service date</label><DateField value={serviceDate} onChange={setServiceDate} /></div>
                <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Period from</label><DateField value={periodFrom} onChange={setPeriodFrom} /></div>
                <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Period to</label><DateField value={periodTo} onChange={setPeriodTo} /></div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {entries.length > 0 && (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>{['Entry No.', 'Service', 'Qty', 'Date / Period', 'Recorded By', 'Status', ''].map((h, i) => (
                <th key={h} style={{ textAlign: h === 'Qty' ? 'right' : 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>{h}{i === 0 && <RowCount count={entries.length} />}</th>
              ))}</tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                  <td style={{ ...cell, fontWeight: 700 }}>{e.ses_number}</td>
                  <td style={cell}>{e.item_name}{e.description ? <div style={{ fontSize: 12, color: TEXT.muted }}>{e.description}</div> : null}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{e.quantity != null ? Number(e.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '—'} {e.unit || ''}</td>
                  <td style={cell}>{formatDate(e.service_date)}{e.period_from || e.period_to ? <div style={{ fontSize: 12, color: TEXT.muted }}>{formatDate(e.period_from)} – {formatDate(e.period_to)}</div> : null}</td>
                  <td style={cell}>{e.created_by_name || '—'}{e.accepted_by_name ? <div style={{ fontSize: 12, color: TEXT.muted }}>Accepted by {e.accepted_by_name}</div> : null}</td>
                  <td style={cell}>
                    <Pill label={STATUS_LABELS[e.status] || e.status} hex={STATUS_HEX[e.status] || '#78716c'} />
                    {e.cancel_reason ? <div style={{ fontSize: 12, color: TEXT.muted }}>{e.cancel_reason}</div> : null}
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    {e.status === 'draft' && can('p2p', 'purchase_orders', 'approve') && canFeature('p2p', 'purchase_orders', 'service_entries', 'approve') && (
                      <button type="button" disabled={busy} onClick={() => setAccepting(e)} style={{ ...smallSecondaryBtnStyle, marginRight: 6 }}>Accept</button>
                    )}
                    {e.status !== 'cancelled' && can('p2p', 'purchase_orders', 'cancel') && canFeature('p2p', 'purchase_orders', 'service_entries', 'cancel') && (
                      <button type="button" disabled={busy} onClick={() => { setCancelReason(''); setSheetError(''); setCancelling(e) }} style={smallSecondaryBtnStyle}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!accepting}
        title="Accept service entry"
        message={accepting ? `Accept ${accepting.ses_number} (${accepting.quantity} ${accepting.unit || ''} of ${accepting.item_name})? It then counts as received on the PO and the vendor's bill is matched against it.` : ''}
        confirmLabel="Accept"
        onConfirm={accept}
        onCancel={() => setAccepting(null)}
      />
      {cancelling && (
        <FormSheet width={580} icon="x" iconColor="#dc2626" title="Cancel service entry" subtitle={`${cancelling.ses_number} · ${cancelling.quantity} ${cancelling.unit || ''} of ${cancelling.item_name || ''}`}
          onClose={() => { if (!busy) setCancelling(null) }} busy={busy}
          footer={<>
            <button type="button" onClick={() => setCancelling(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>
            <button type="button" onClick={cancel} disabled={busy} style={sheetBtn('primary', '#dc2626', busy)}><SheetIcon name="x" size={16} />{busy ? 'Cancelling…' : 'Cancel entry'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {sheetError && <div style={errBox}>{sheetError}</div>}
            <label style={sheetLabel}>Why is it being cancelled? <Req /></label>
            <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" autoFocus />
            <p style={sheetHint}>This is kept on the PO history.</p>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
