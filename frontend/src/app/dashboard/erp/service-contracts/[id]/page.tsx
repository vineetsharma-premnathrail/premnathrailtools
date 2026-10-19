'use client'

// Service contract detail (VA43): terms, covered machines, entitlement use,
// approval, billing plan with "Raise invoice" per period, SRs on the contract,
// renew / cancel.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { useRecordId, recordPath } from '@/lib/recordRef'
import { serviceContractsApi, ServiceContract } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import ErpNav from '@/components/erp/ErpNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import ServiceContractForm, { CONTRACT_TYPE_LABELS, FREQUENCY_LABELS, contractToForm, formToPayload, ContractFormValue } from '@/components/erp/ServiceContractForm'
import { InfoRow, Section, dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { formatINR } from '@/components/sales/labels'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Pending approval', active: 'Active', expired: 'Expired', renewed: 'Renewed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', pending_approval: '#F59E0B', active: '#16A34A', expired: '#DC2626', renewed: '#2563eb', cancelled: '#a8a29e' }
const LINE_HEX: Record<string, string> = { planned: '#78716c', invoiced: '#16A34A', cancelled: '#a8a29e' }
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#57534e', borderTop: '1px solid rgba(0,0,0,0.05)' }

function Pill({ text, hex }: { text: string; hex: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{text}</span>
}

export default function ServiceContractDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const { can, canFeature } = useCan()
  // Features of Service Contracts (core/features/erp.py).
  const seeBilling = canFeature('erp', 'service_contracts', 'billing_plan', 'view')
  const canRaiseInvoice = canFeature('erp', 'service_contracts', 'billing_plan', 'create')
  const canRenew = canFeature('erp', 'service_contracts', 'renew', 'create')
  const seeSrs = canFeature('erp', 'service_contracts', 'service_requests', 'view')
  const router = useRouter()
  const ref = useParams().id as string
  const { id, error: linkError } = useRecordId(ref)
  const [c, setC] = useState<ServiceContract | null>(null)
  const [srs, setSrs] = useState<{ id: number; request_number: string; issue_title: string; status: string; is_chargeable: boolean | null; opened_at: string | null }[]>([])
  const [error, setError] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [askCancel, setAskCancel] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [askSubmit, setAskSubmit] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    serviceContractsApi.get(id).then((d) => { setC(d); setError([]) }).catch((e) => setError(extractErrorMessages(e, 'Could not load the contract.')))
    if (seeSrs) serviceContractsApi.serviceRequests(id).then(setSrs).catch(() => setSrs([]))
  }, [id, seeSrs])
  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div style={{ padding: 24 }}><ErpNav /><InvalidRecordLink message={linkError} listHref="/dashboard/erp/service-contracts" listLabel="Back to contracts" /></div>)

  const run = async (fn: () => Promise<ServiceContract | unknown>, fallback: string) => {
    setBusy(true)
    try { const r = await fn(); if (r && typeof r === 'object' && 'contract_number' in (r as object)) setC(r as ServiceContract); setError([]); load() }
    catch (e) { setError(extractErrorMessages(e, fallback)) }
    finally { setBusy(false) }
  }
  // Errors stay inside the edit popup so the user's changes aren't lost.
  const saveEdit = async (f: ContractFormValue) => {
    if (!c) return
    setBusy(true)
    try {
      setC(await serviceContractsApi.update(c.id, formToPayload(f)))
      setEditError([])
      setEditing(false)
      load()
    } catch (e) {
      setEditError(extractErrorMessages(e, 'Could not save the contract.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#1c1917' }}>{c ? c.contract_number : 'Service contract'} {c && <Pill text={STATUS_LABELS[c.status] || c.status} hex={STATUS_HEX[c.status] || '#78716c'} />}</h1>
          {c && <p style={{ fontSize: 13, color: '#78716c', margin: '4px 0 0' }}>{CONTRACT_TYPE_LABELS[c.contract_type]} · {c.customer_name}{c.title ? ` · ${c.title}` : ''}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {c?.status === 'draft' && can('erp', 'service_contracts', 'edit') && !editing && <button style={secondaryBtnStyle} onClick={() => { setEditError([]); setEditing(true) }}>Edit</button>}
          {c?.status === 'draft' && can('erp', 'service_contracts', 'submit') && <button style={primaryBtnStyle} disabled={busy} onClick={() => setAskSubmit(true)}>Send for approval</button>}
          {c && ['active', 'expired'].includes(c.status) && !c.renewed_by_id && canRenew && (
            <button style={primaryBtnStyle} disabled={busy} onClick={() => run(async () => { const n = await serviceContractsApi.renew(c.id); router.push(recordPath('/dashboard/erp/service-contracts', n)); return null }, 'Could not renew the contract.')}>Renew</button>
          )}
          {c && ['draft', 'pending_approval', 'active'].includes(c.status) && can('erp', 'service_contracts', 'cancel') && <button style={dangerBtnStyle} disabled={busy} onClick={() => setAskCancel(true)}>Cancel contract</button>}
          {c?.status === 'draft' && can('erp', 'service_contracts', 'delete') && <button style={dangerBtnStyle} disabled={busy} onClick={() => setAskDelete(true)}>Delete</button>}
          <button style={secondaryBtnStyle} onClick={() => router.push('/dashboard/erp/service-contracts')}>← Back</button>
        </div>
      </div>
      {error.length > 0 && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error.join(' ')}</div>}

      {c && editing && (
        <ServiceContractForm variant="sheet" title={`Edit ${c.contract_number}`} subtitle={`${c.customer_name} — only a draft can be changed.`}
          error={editError} initial={contractToForm(c)} saving={busy} onSave={saveEdit} onCancel={() => setEditing(false)} lockCustomer />
      )}

      {c && (
        <>
          <Section title="Contract" style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              <InfoRow label="Period" value={`${formatDate(c.start_date)} → ${formatDate(c.end_date)}`} />
              <InfoRow label="Value (taxable)" value={`${formatINR(c.contract_value)} + ${c.gst_rate}% GST`} />
              <InfoRow label="Billing" value={`${FREQUENCY_LABELS[c.billing_frequency]}${c.bill_in_advance ? ', in advance' : ', in arrears'}`} />
              <InfoRow label="Billed so far" value={formatINR(c.billed_amount)} />
              <InfoRow label="Visits" value={c.visits_included ? `${c.visits_used} used of ${c.visits_included}` : `${c.visits_used} used (unlimited)`} />
              <InfoRow label="Covers" value={[c.labour_covered && 'labour & visits', c.spares_covered && 'spares'].filter(Boolean).join(', ') || '—'} />
              <InfoRow label="SLA" value={c.sla_response_hours ? `respond ${c.sla_response_hours} h · resolve ${c.sla_resolution_hours || '—'} h` : '—'} />
              <InfoRow label="Customer PO" value={c.customer_po_number ? `${c.customer_po_number}${c.customer_po_date ? ` dt. ${formatDate(c.customer_po_date)}` : ''}` : '—'} />
              {c.renewed_from_number && <InfoRow label="Renewal of" value={c.renewed_from_number} />}
              {c.cancel_reason && <InfoRow label="Cancelled because" value={c.cancel_reason} />}
            </div>
            {c.terms && <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '12px 0 0' }}>{c.terms}</p>}
          </Section>

          {c.status !== 'draft' && <ApprovalPanel entityType="erp_service_contract" entityId={c.id} onChanged={() => load()} title="Approval" />}

          <Section title={`Covered machines (${c.machines.length})`} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {c.machines.map((m) => (
                <span key={m.project_id} onClick={() => router.push(recordPath('/dashboard/erp/projects', m, 'project_id'))}
                  style={{ fontSize: 12.5, padding: '6px 10px', borderRadius: 9999, border: '1px solid rgba(0,0,0,.1)', cursor: 'pointer', color: '#FF7A45', fontWeight: 600 }}>
                  {m.serial_number}{m.product_name || m.model_name ? ` · ${m.product_name || m.model_name}` : ''}
                </span>
              ))}
            </div>
          </Section>

          {seeBilling && <Section title="Billing plan" style={{ marginBottom: 16 }}>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['#', 'Period', 'Due', 'Amount', 'Status', 'Invoice', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {c.billing_lines.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#a8a29e' }}>No billing plan (zero contract value).</td></tr>}
                  {c.billing_lines.map((b) => (
                    <tr key={b.id}>
                      <td style={td}>{b.sequence}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(b.period_start)} → {formatDate(b.period_end)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(b.due_date)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatINR(b.amount)}</td>
                      <td style={td}><Pill text={b.status} hex={LINE_HEX[b.status] || '#78716c'} /></td>
                      <td style={td}>{b.invoice_number ? `${b.invoice_number} (${b.invoice_status})` : '—'}</td>
                      <td style={td}>
                        {b.status === 'planned' && ['active', 'expired', 'renewed'].includes(c.status) && canRaiseInvoice && (
                          <span onClick={() => !busy && run(() => serviceContractsApi.invoice(c.id, b.id), 'Could not raise the invoice.')} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>Raise invoice</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: '#78716c', margin: '10px 0 0' }}>Invoices are drafted in Finance › Sales; Finance approves and posts them. Due periods are drafted automatically every morning.</p>
          </Section>}

          {seeSrs && <Section title={`Service requests on this contract (${srs.length})`} style={{ marginBottom: 16 }}>
            {srs.length === 0 ? <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>No service requests yet.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['SR', 'Issue', 'Status', 'Charge', 'Opened'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {srs.map((s) => (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/erp/service-requests', s))}>
                      <td style={{ ...td, fontWeight: 600, color: '#FF7A45' }}>{s.request_number}</td>
                      <td style={td}>{s.issue_title}</td>
                      <td style={td}>{s.status.replace(/_/g, ' ')}</td>
                      <td style={td}>{s.is_chargeable ? 'Chargeable' : 'Covered'}</td>
                      <td style={td}>{formatDate(s.opened_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>}
        </>
      )}

      <ConfirmDialog open={askSubmit} title="Send for approval" danger={false} confirmLabel="Send"
        message={c ? `Send ${c.contract_number} (${formatINR(c.contract_value)}) for approval? It becomes active, and its machines covered, once approved.` : ''}
        onConfirm={() => { setAskSubmit(false); if (c) run(() => serviceContractsApi.submit(c.id), 'Could not send the contract for approval.') }}
        onCancel={() => setAskSubmit(false)} />
      <ReasonSheet open={askCancel} icon="x" title="Cancel contract" message="Why is the contract cancelled? Planned billing periods are cancelled; invoices already raised stay with Finance."
        placeholder="Reason" confirmLabel="Cancel contract" danger requireValue
        onConfirm={(reason) => { setAskCancel(false); if (c) run(() => serviceContractsApi.cancel(c.id, reason), 'Could not cancel the contract.') }}
        onCancel={() => setAskCancel(false)} />
      <ConfirmDialog open={askDelete} title="Delete draft" message={c ? `Delete draft ${c.contract_number}? This can't be undone.` : ''}
        onConfirm={() => { setAskDelete(false); if (c) run(async () => { await serviceContractsApi.remove(c.id); router.push('/dashboard/erp/service-contracts'); return null }, 'Could not delete the contract.') }}
        onCancel={() => setAskDelete(false)} />
    </div>
  )
}
