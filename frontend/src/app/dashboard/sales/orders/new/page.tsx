'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesOrderLineInput, SalesOrderScheduleInput, SalesBillingLineInput } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import SearchableSelect from '@/components/erp/SearchableSelect'
import SalesNav from '@/components/sales/SalesNav'
import { ErrorBanner } from '@/components/sales/SalesUi'
import { formatMoney, ORDER_CATEGORY_LABELS } from '@/components/sales/labels'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetColumns, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import OrderTermsFields, { OrderTerms } from '@/components/sales/OrderTermsFields'
import { LinesEditor, ScheduleEditor, BillingPlanEditor, emptyLine, syncVehicleRows, lineTotals } from '@/components/sales/OrderEditors'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import CrmDocumentPicker from '@/components/sales/CrmDocumentPicker'

type Contact = { id: number; name: string; designation: string | null }

const TERM_KEYS = [
  'order_type', 'customer_po_number', 'customer_po_date', 'customer_po_received_date', 'contract_reference', 'currency',
  'purchaser_name', 'paying_authority', 'price_basis', 'freight_terms', 'insurance_terms', 'payment_terms_label', 'inspection_agency',
  'third_party_inspection_required', 'ld_applicable', 'ld_rate_percent', 'ld_rate_period', 'ld_basis', 'ld_max_percent',
  'warranty_months_from_delivery', 'warranty_months_from_commissioning', 'warranty_rule', 'warranty_terms_text',
  'delivery_terms_text', 'special_conditions',
]

// Step 1 of a new order. Only a New Project order gets a project (and its vehicle units)
// in Project Management when it is confirmed; Service and Rental orders don't.
const CATEGORY_HINTS: Record<string, string> = {
  new_project: 'New machines to design and build. A project with its vehicle units opens in Project Management when the order is approved.',
  service: 'Paid service work on one of our machines: pick the project / machine, then its service requests (SRs). No build project.',
  rental: 'A machine given on hire: pick the organisation it is rented to. No build project.',
}
type SourceKind = 'inquiry' | 'tender'

export default function NewSalesOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const router = useRouter()
  const { can } = useCan()
  const params = useSearchParams()
  // ?inquiry= / ?tender= carry signed record refs (lib/recordRef.ts).
  const inquiryLink = useRecordId(params.get('inquiry'))
  const tenderLink = useRecordId(params.get('tender'))
  const inquiryId = inquiryLink.id ?? undefined
  const tenderId = tenderLink.id ?? undefined
  const linkError = inquiryLink.error || tenderLink.error
  const linkLoading = inquiryLink.loading || tenderLink.loading

  const [category, setCategory] = useState<string | null>(null)
  const [sourceKind, setSourceKind] = useState<SourceKind>(params.get('tender') ? 'tender' : 'inquiry')
  const [sources, setSources] = useState<Awaited<ReturnType<typeof salesApi.orderSources>>>([])
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [customerName, setCustomerName] = useState('')
  // Service order: the machine and its SRs. Rental: the organisation, picked directly.
  const [machines, setMachines] = useState<Awaited<ReturnType<typeof salesApi.serviceMachines>>>([])
  const [machineId, setMachineId] = useState<number | null>(null)
  const [srs, setSrs] = useState<Awaited<ReturnType<typeof salesApi.serviceRequestsForMachine>>>([])
  const [srIds, setSrIds] = useState<number[]>([])
  const [orgs, setOrgs] = useState<{ id: number; name: string; gst_number: string | null; state: string | null }[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [contactId, setContactId] = useState<number | null>(null)
  const [source, setSource] = useState<{ source_type: string; source_inquiry_id?: number; source_tender_id?: number; source_quotation_id?: number; label?: string; quotation?: string }>({ source_type: 'direct' })
  const [existing, setExisting] = useState<{ id: number; id_ref?: string; display_number: string } | null>(null)
  const [prefillNote, setPrefillNote] = useState('')
  const [terms, setTerms] = useState<OrderTerms>({ order_type: 'road_rail_vehicle', currency: 'INR', price_basis: 'for_destination', ld_applicable: true })
  const [lines, setLines] = useState<SalesOrderLineInput[]>([emptyLine(1)])
  const [rows, setRows] = useState<SalesOrderScheduleInput[]>([])
  const [billing, setBilling] = useState<SalesBillingLineInput[]>([{ milestone_type: 'advance', percent: 20 }, { milestone_type: 'delivery', percent: 80 }])
  const [poFiles, setPoFiles] = useState<File[]>([])
  const [crmDocIds, setCrmDocIds] = useState<number[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const fromLink = !!(inquiryId || tenderId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prefill/defaults is a loose server payload
  function applyPrefill(p: Record<string, any>, switching = false) {
    const picked: OrderTerms = {}
    TERM_KEYS.forEach((k) => { if (p[k] !== undefined && p[k] !== null) picked[k] = p[k] })
    // Switching inquiry / tender: the previous one's terms must not linger.
    const cleared: OrderTerms = switching ? { payment_terms_label: '', delivery_terms_text: '', special_conditions: '', customer_po_number: '', purchaser_name: '' } : {}
    setTerms((t) => ({ ...t, ...cleared, ...picked }))
    if (p.customer_id) { setCustomerId(p.customer_id); setContactId(p.customer_contact_id || null); setCustomerName(p.customer_name || '') }
    setCrmDocIds([])
    if (p.source_type) setSource({ source_type: p.source_type, source_inquiry_id: p.source_inquiry_id, source_tender_id: p.source_tender_id, source_quotation_id: p.source_quotation_id, label: p.source_label, quotation: p.source_quotation_number })
    setExisting(p.existing_order || null)
    setPrefillNote(typeof p.note === 'string' ? p.note : '')
    if (Array.isArray(p.lines) && p.lines.length) {
      setLines(p.lines)
      setRows(syncVehicleRows(p.lines, [], p.customer_name || '').map((r) => ({ ...r, contract_delivery_date: p.required_delivery_date || null })))
    }
  }

  useEffect(() => {
    if (!isAuthorized || linkLoading) return
    if (fromLink) setSourceId(inquiryId || tenderId || null)
    salesApi.lookupAgencies().then(setAgencies).catch(() => setAgencies([]))
    const load = fromLink ? salesApi.prefill({ inquiry: inquiryId, tender: tenderId }) : salesApi.defaults()
    load.then((p) => applyPrefill(p)).catch((err) => setError(extractErrorMessages(err, 'Failed to load the order defaults.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyPrefill only calls state setters
  }, [isAuthorized, inquiryId, tenderId, linkLoading])

  useEffect(() => {
    if (!customerId) return
    salesApi.lookupContacts(customerId).then(setContacts).catch(() => setContacts([]))
  }, [customerId])

  useEffect(() => {
    if (!isAuthorized) return
    if (category === 'service' && !machines.length) {
      salesApi.serviceMachines().then(setMachines).catch((err) => setError(extractErrorMessages(err, 'Could not load the machines to pick from.')))
    }
    if (category === 'rental' && !orgs.length) {
      salesApi.lookupCustomers().then(setOrgs).catch((err) => setError(extractErrorMessages(err, 'Could not load the organisations to pick from.')))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load each list once, when its order type is picked
  }, [isAuthorized, category])

  // Switching the order type starts step 2 again (a New Project's inquiry isn't a Service order's machine).
  function pickCategory(k: string) {
    if (k === category) return
    setError(''); setMachineId(null); setSrs([]); setSrIds([])
    setCategory(k)
    // Opened from a CRM link: a New Project order keeps what the inquiry / tender filled in.
    if (fromLink && k === 'new_project' && (source.source_inquiry_id || source.source_tender_id)) return
    clearSource()
    setTerms((t) => ({ ...t, order_type: k === 'new_project' ? 'road_rail_vehicle' : 'other' }))
    setLines([{ ...emptyLine(1), line_type: k === 'new_project' ? 'rrv' : k === 'service' ? 'service' : 'other' }])
  }

  async function pickMachine(id: number | null) {
    setError(''); setMachineId(id); setSrs([]); setSrIds([])
    const m = machines.find((x) => x.id === id)
    setCustomerId(m ? m.customer_id : null); setCustomerName(m?.customer_name || ''); setContactId(null)
    if (!id) return
    try { setSrs(await salesApi.serviceRequestsForMachine(id)) }
    catch (err) { setError(extractErrorMessages(err, 'Could not load the service requests of this machine.')) }
  }

  function pickOrg(id: number | null) {
    setCustomerId(id); setCustomerName(orgs.find((o) => o.id === id)?.name || ''); setContactId(null)
  }

  useEffect(() => {
    if (!isAuthorized || category !== 'new_project') return
    setSources([])
    salesApi.orderSources(sourceKind).then(setSources)
      .catch((err) => setError(extractErrorMessages(err, `Could not load the CRM ${sourceKind === 'tender' ? 'tenders' : 'inquiries'} to pick from.`)))
  }, [isAuthorized, category, sourceKind])

  function clearSource() {
    setSourceId(null); setSource({ source_type: 'direct' }); setCustomerId(null); setCustomerName(''); setContactId(null)
    setCrmDocIds([]); setExisting(null); setPrefillNote(''); setLines([emptyLine(1)]); setRows([])
  }

  // Picking the CRM inquiry / tender fills the customer, contact, lines and terms from it.
  async function pickSource(id: number | null) {
    setError('')
    if (!id) { clearSource(); return }
    setSourceId(id)
    setSourceLoading(true)
    try {
      applyPrefill(await salesApi.prefill(sourceKind === 'tender' ? { tender: id } : { inquiry: id }), true)
    } catch (err) {
      clearSource()
      setError(extractErrorMessages(err, `Could not copy the ${sourceKind} into the order.`))
    } finally {
      setSourceLoading(false)
    }
  }

  const updateLines = (next: SalesOrderLineInput[]) => { setLines(next); setRows((r) => syncVehicleRows(next, r, customerName)) }
  const grandTotal = lines.reduce((s, l) => s + lineTotals(l).total, 0)

  async function save() {
    setError('')
    if (!category) { setError('Pick what this order is first: New Project, Service or Rental.'); return }
    if (category === 'new_project' && (!customerId || !(source.source_inquiry_id || source.source_tender_id))) {
      setError('Pick the CRM inquiry or tender this order comes from — the customer is filled from it.'); return
    }
    if (category === 'service' && (!machineId || !srIds.length)) {
      setError('Pick the project / machine and at least one of its service requests (SRs) this order bills for.'); return
    }
    if (category === 'rental' && !customerId) { setError('Pick the organisation the machine is rented to.'); return }
    if (lines.some((l) => !l.description.trim())) { setError('Every line needs a description — use the wording from the customer\'s PO.'); return }
    setSaving(true)
    try {
      const so = await salesApi.createOrder({
        ...terms, order_category: category, customer_id: customerId, customer_contact_id: contactId,
        ...(category === 'new_project' ? source : { source_type: 'direct' }),
        ...(category === 'service' ? { service_machine_id: machineId, service_request_ids: srIds } : {}),
        lines, schedule: rows, billing_plan: billing,
        crm_document_ids: source.source_inquiry_id || source.source_tender_id ? crmDocIds : [],
      })
      if (poFiles.length) {
        try { await salesApi.uploadAttachments('sales_order', so.id, poFiles, 'customer_po') } catch { /* upload failure shouldn't block record creation */ }
      }
      router.push(recordPath('/dashboard/sales/orders', so))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the sales order.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><SalesNav /><InvalidRecordLink message={linkError} listHref="/dashboard/sales/orders" listLabel="Back to sales orders" /></div>)
  if (linkLoading) return <div><SalesNav /></div>

  const canCreate = can('sales', 'orders', 'create')
  const vehicles = rows.filter((r) => lines.find((l) => l.line_number === r.line_number)?.line_type === 'rrv').length
  const billingSum = Math.round(billing.reduce((s, r) => s + (Number(r.percent) || 0), 0) * 1000) / 1000
  const block: React.CSSProperties = { padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }
  // The rest of the form opens once the order type and its CRM source are picked.
  const ready = category === 'new_project' ? !!(customerId && (source.source_inquiry_id || source.source_tender_id))
    : category === 'service' ? !!(customerId && machineId && srIds.length)
    : category === 'rental' ? !!customerId : false
  const kindWord = sourceKind === 'tender' ? 'tender' : 'inquiry'

  return (
    <div>
      <FormPage
        tour="sales-form"
        nav={<SalesNav />}
        icon="cart"
        title="New Sales Order"
        subtitle={[category && ORDER_CATEGORY_LABELS[category], source.label && `From ${source.label}${source.quotation ? ` · quotation ${source.quotation}` : ''}`].filter(Boolean).join(' · ') || 'Pick the order type, then the CRM inquiry or tender'}
        onBack={() => router.push('/dashboard/sales/orders')} backTour="sales-form-back"
        footer={<>
          <button type="button" onClick={() => router.push('/dashboard/sales/orders')} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          {canCreate && (
            <button data-tour="sales-form-save" type="button" disabled={saving || !!existing || !ready} onClick={save} style={sheetBtn('primary', SHEET.BLUE, saving || !!existing || !ready)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save draft'}
            </button>
          )}
        </>}
      >
        {(existing || prefillNote || (error && (!Array.isArray(error) || error.length > 0)) || !canCreate) && (
          <div style={{ padding: '16px 24px 0' }}>
            {!canCreate && (
              <ErrorBanner error="Creating sales orders needs 'Create' on Sales › Sales Orders — ask an admin to add it to your role (Organization › Role & Permissions)." />
            )}
            {existing && (
              <ErrorBanner error={[`This ${source.source_type === 'tender' ? 'tender' : 'inquiry'} already has ${existing.display_number}.`, 'Open that order instead — a repeat order is a new inquiry, and a quantity option is an amendment of the existing order.']} />
            )}
            {existing && <p style={{ marginTop: -8 }}><Link href={recordPath('/dashboard/sales/orders', existing)} style={{ color: '#FF6A2A', fontWeight: 600 }}>Open {existing.display_number} →</Link></p>}
            {prefillNote && (
              <div role="status" style={{ margin: '0 0 16px', padding: '10px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                background: prefillNote.startsWith('Prices copied from quotation') ? '#EFF6FF' : '#FFFBEB',
                border: `1px solid ${prefillNote.startsWith('Prices copied from quotation') ? '#BFDBFE' : '#FDE68A'}`,
                color: prefillNote.startsWith('Prices copied from quotation') ? '#1E40AF' : '#92400E' }}>
                {prefillNote}
              </div>
            )}
            <ErrorBanner error={error} />
          </div>
        )}

        <div data-tour="sales-form-category" style={{ padding: '20px 24px 4px' }}>
          <SheetSection icon="cart" title="1. What is this order?">
            <div role="radiogroup" aria-label="Order type" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {Object.entries(ORDER_CATEGORY_LABELS).map(([k, label]) => {
                const on = category === k
                return (
                  // ui-audit-ignore-next-line custom-button — a selection card (title + hint), not a pill button
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => pickCategory(k)}
                    style={{ flex: '1 1 220px', textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      border: `${on ? 2 : 1}px solid ${on ? SHEET.BLUE : SHEET.LINE}`, background: on ? '#EFF6FF' : '#fff' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: on ? SHEET.BLUE : SHEET.INK }}>{label}</div>
                    <div style={{ fontSize: 12, color: SHEET.MUTED, marginTop: 4, lineHeight: 1.45 }}>{CATEGORY_HINTS[k]}</div>
                  </button>
                )
              })}
            </div>
          </SheetSection>
        </div>

        {category === 'service' && (
          <div data-tour="sales-form-source" style={block}>
            <SheetSection icon="tool" title="2. Project / machine and its SRs">
              <div style={{ flex: '1 1 420px', maxWidth: 780 }}>
                <label style={sheetLabel}>Project / machine <Req /></label>
                <SearchableSelect value={machineId ? String(machineId) : ''} onChange={(v) => pickMachine(v ? Number(v) : null)}
                  options={machines.map((m) => ({ value: String(m.id), label: [m.label, m.project_code && m.project_code !== m.serial_number ? m.project_code : null].filter(Boolean).join(' · ') }))}
                  placeholder={machines.length ? 'Pick the machine (serial / project number)…' : 'No machine with a customer organisation in Service'} />
                <p style={sheetHint}>The customer is taken from the machine. A machine without a customer organisation isn&apos;t listed — set it in Service › Machines.</p>
              </div>
              {machineId && (
                <div style={{ marginTop: 12 }}>
                  <label style={sheetLabel}>Service requests (SRs) <Req /></label>
                  {!srs.length ? <p style={{ ...sheetHint, marginTop: 0 }}>This machine has no open service request — raise the SR in Service first.</p> : (
                    <div role="group" aria-label="Service requests" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {srs.map((r) => (
                        <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: r.existing_order ? SHEET.MUTED : SHEET.BODY }}>
                          <input type="checkbox" disabled={!!r.existing_order} checked={srIds.includes(r.id)}
                            onChange={(e) => setSrIds((ids) => e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))} />
                          <span><b>{r.request_number}</b> · {r.issue_title} · {r.status.replace(/_/g, ' ')}{r.existing_order ? ` · already on ${r.existing_order}` : ''}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </SheetSection>
          </div>
        )}

        {category === 'rental' && (
          <div data-tour="sales-form-source" style={block}>
            <SheetSection icon="building" title="2. Rented to">
              <div style={{ flex: '1 1 420px', maxWidth: 780 }}>
                <label style={sheetLabel}>Organisation <Req /></label>
                <SearchableSelect value={customerId ? String(customerId) : ''} onChange={(v) => pickOrg(v ? Number(v) : null)}
                  options={orgs.map((o) => ({ value: String(o.id), label: `${o.name}${o.gst_number ? ` · ${o.gst_number}` : o.state ? ` · ${o.state}` : ''}` }))}
                  placeholder="Pick the organisation the machine is rented to…" />
                <p style={sheetHint}>The CRM organisation that takes the machine on hire. Not in the list? Add it in CRM › Organisations first.</p>
              </div>
            </SheetSection>
          </div>
        )}

        {category === 'new_project' && (
          <div data-tour="sales-form-source" style={block}>
            <SheetSection icon="doc" title="2. Raised from (CRM)">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div role="radiogroup" aria-label="CRM record type" style={{ display: 'flex', gap: 6 }}>
                  {(['inquiry', 'tender'] as SourceKind[]).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={sourceKind === k} disabled={sourceLoading}
                      onClick={() => { if (k !== sourceKind) { clearSource(); setSourceKind(k) } }}
                      style={sheetBtn(sourceKind === k ? 'primary' : 'secondary', SHEET.BLUE, sourceLoading)}>
                      {k === 'inquiry' ? 'Inquiry' : 'Tender'}
                    </button>
                  ))}
                </div>
                <div style={{ flex: '1 1 420px', maxWidth: 780 }}>
                  <label style={sheetLabel}>{sourceKind === 'tender' ? 'Tender' : 'Inquiry'} <Req /></label>
                  <SearchableSelect value={sourceId ? String(sourceId) : ''} onChange={(v) => pickSource(v ? Number(v) : null)}
                    options={sources.map((r) => ({
                      value: String(r.id),
                      label: [r.number, r.customer_name, r.title, r.existing_order ? `${r.existing_order} already raised` : null].filter(Boolean).join(' · '),
                    }))}
                    placeholder={sourceLoading ? 'Copying…' : sources.length ? `Pick the ${kindWord}…`
                      : sourceKind === 'tender' ? 'No tender with LOA / order received' : 'No inquiry at status Order Received'} />
                </div>
              </div>
              <p style={sheetHint}>
                {sourceKind === 'tender'
                  ? 'Only tenders whose LOA / order is received are listed. Picking one fills the customer, PO / LOA number and purchaser.'
                  : 'Only inquiries at status "Order Received" in CRM are listed. Picking one fills the customer, contact, lines and prices from its accepted quotation.'}
              </p>
            </SheetSection>
          </div>
        )}

        {ready && <>
        <SheetColumns
          left={<>
            <SheetSection icon="building" title="Customer">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="sales-form-customer" style={{ flex: '1 1 300px', maxWidth: 480 }}>
                  <label style={sheetLabel}>Customer (CRM organisation)</label>
                  <div style={{ ...sheetInput, background: SHEET.SOFT, display: 'flex', alignItems: 'center' }}>{customerName || '—'}</div>
                </div>
                <div style={{ flex: '0 1 280px', minWidth: 200 }}>
                  <label style={sheetLabel}>Contact Person</label>
                  <Select style={sheetInput} value={contactId ?? ''} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">—</option>
                    {(customerId ? contacts : []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.designation ? ` (${c.designation})` : ''}</option>)}
                  </Select>
                </div>
              </div>
              <p style={sheetHint}>{category === 'service' ? 'Taken from the machine. To change it, pick another machine above.'
                : category === 'rental' ? 'The organisation picked above.'
                : `Taken from the ${kindWord}. To change the customer, pick another ${kindWord} above.`}</p>
              <p style={sheetHint}>The billing address and GSTIN are copied from the CRM organisation when the order is confirmed.</p>
            </SheetSection>
            <OrderTermsFields v={terms} set={(p) => setTerms((t) => ({ ...t, ...p }))} agencies={agencies} />
          </>}
          right={<>
            <div data-tour="sales-form-po-file">
              <SheetSection icon="clip" title="Customer PO / LOA document">
                <FileDropZone files={poFiles} onChange={setPoFiles} />
                <p style={sheetHint}>Required before the order can be submitted for approval. You can also add it later on the order&apos;s Documents tab.</p>
              </SheetSection>
            </div>
            {(source.source_inquiry_id || source.source_tender_id) && (
              <div data-tour="sales-form-crm-docs">
                <SheetSection icon="doc" title={`CRM documents to link${source.label ? ` — ${source.label}` : ''}`}>
                  <CrmDocumentPicker key={`${source.source_inquiry_id ?? ''}-${source.source_tender_id ?? ''}`}
                    inquiryId={source.source_inquiry_id} tenderId={source.source_tender_id} value={crmDocIds} onChange={setCrmDocIds} />
                </SheetSection>
              </div>
            )}
            <SheetSection icon="rupee" title="Order Summary">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: SHEET.BODY }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Customer</span><b style={{ textAlign: 'right' }}>{customerName || '—'}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Lines</span><b>{lines.length}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Vehicles scheduled</span><b>{vehicles}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Billing plan</span><b style={{ color: Math.abs(billingSum - 100) < 0.001 ? '#16A34A' : '#DC2626' }}>{billingSum}%</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTop: `1px solid ${SHEET.LINE}`, fontSize: 14 }}>
                  <span>Order value (incl. GST)</span><b style={{ color: SHEET.INK }}>{formatMoney(Math.round(grandTotal * 100) / 100, terms.currency as string)}</b>
                </div>
              </div>
            </SheetSection>
          </>}
        />

        <div data-tour="sales-form-lines" style={block}>
          <SheetSection icon="list" title="Lines">
            <LinesEditor lines={lines} onChange={updateLines} currency={terms.currency as string} customerId={customerId} priceDate={(terms.customer_po_date as string) || null} />
          </SheetSection>
        </div>

        <div data-tour="sales-form-schedule" style={block}>
          <SheetSection icon="truck" title="Delivery schedule">
            <ScheduleEditor lines={lines} rows={rows} onChange={setRows} />
          </SheetSection>
        </div>

        <div data-tour="sales-form-billing" style={block}>
          <SheetSection icon="rupee" title="Billing plan">
            <BillingPlanEditor rows={billing} onChange={setBilling} grandTotal={grandTotal} currency={terms.currency as string} />
          </SheetSection>
        </div>
        </>}
      </FormPage>
    </div>
  )
}
