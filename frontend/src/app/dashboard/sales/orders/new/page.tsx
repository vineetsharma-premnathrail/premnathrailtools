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
import { formatINR } from '@/components/sales/labels'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetColumns, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import OrderTermsFields, { OrderTerms } from '@/components/sales/OrderTermsFields'
import { LinesEditor, ScheduleEditor, BillingPlanEditor, emptyLine, syncVehicleRows, lineTotals } from '@/components/sales/OrderEditors'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

type Customer = { id: number; name: string; gst_number: string | null; state: string | null }
type Contact = { id: number; name: string; designation: string | null }

const TERM_KEYS = [
  'order_type', 'customer_po_number', 'customer_po_date', 'customer_po_received_date', 'loa_number', 'loa_date', 'contract_reference',
  'purchaser_name', 'paying_authority', 'price_basis', 'freight_terms', 'insurance_terms', 'payment_terms_label', 'inspection_agency',
  'third_party_inspection_required', 'ld_applicable', 'ld_rate_percent', 'ld_rate_period', 'ld_basis', 'ld_max_percent',
  'warranty_months_from_delivery', 'warranty_months_from_commissioning', 'warranty_rule', 'warranty_terms_text',
  'delivery_terms_text', 'special_conditions',
]

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

  const [customers, setCustomers] = useState<Customer[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [contactId, setContactId] = useState<number | null>(null)
  const [source, setSource] = useState<{ source_type: string; source_inquiry_id?: number; source_tender_id?: number; source_quotation_id?: number; label?: string; quotation?: string }>({ source_type: 'direct' })
  const [existing, setExisting] = useState<{ id: number; id_ref?: string; display_number: string } | null>(null)
  const [prefillNote, setPrefillNote] = useState('')
  const [terms, setTerms] = useState<OrderTerms>({ order_type: 'rrv_supply', price_basis: 'for_destination', ld_applicable: true })
  const [lines, setLines] = useState<SalesOrderLineInput[]>([emptyLine(1)])
  const [rows, setRows] = useState<SalesOrderScheduleInput[]>([])
  const [billing, setBilling] = useState<SalesBillingLineInput[]>([{ milestone_type: 'advance', percent: 20 }, { milestone_type: 'delivery', percent: 80 }])
  const [poFiles, setPoFiles] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  // Direct order: pick one of the customer's quotations to copy lines + terms from (its inquiry becomes the source).
  const [quotations, setQuotations] = useState<Awaited<ReturnType<typeof salesApi.customerQuotations>>>([])
  const [quotationId, setQuotationId] = useState<number | null>(null)
  const [quotLoading, setQuotLoading] = useState(false)
  const fromLink = !!(inquiryId || tenderId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prefill/defaults is a loose server payload
  function applyPrefill(p: Record<string, any>, fromQuotation = false) {
    const picked: OrderTerms = {}
    TERM_KEYS.forEach((k) => { if (p[k] !== undefined && p[k] !== null) picked[k] = p[k] })
    // Switching quotation: the previous quotation's terms must not linger.
    const cleared: OrderTerms = fromQuotation ? { payment_terms_label: '', delivery_terms_text: '', special_conditions: '' } : {}
    setTerms((t) => ({ ...t, ...cleared, ...picked }))
    if (p.customer_id) { setCustomerId(p.customer_id); setContactId(p.customer_contact_id || null) }
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
    salesApi.lookupCustomers().then(setCustomers).catch(() => setCustomers([]))
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
    if (!customerId || fromLink) { setQuotations([]); return }
    salesApi.customerQuotations(customerId).then(setQuotations).catch(() => setQuotations([]))
  }, [customerId, fromLink])

  async function pickQuotation(id: number | null) {
    setError('')
    setQuotationId(id)
    if (!id) {  // back to a plain direct order — lines and terms stay as they are for editing
      setSource({ source_type: 'direct' }); setExisting(null); setPrefillNote('')
      return
    }
    setQuotLoading(true)
    try {
      applyPrefill(await salesApi.prefill({ quotation: id }), true)
    } catch (err) {
      setQuotationId(null); setSource({ source_type: 'direct' })
      setError(extractErrorMessages(err, 'Could not copy the quotation into the order.'))
    } finally {
      setQuotLoading(false)
    }
  }

  const customerName = customers.find((c) => c.id === customerId)?.name || ''
  const updateLines = (next: SalesOrderLineInput[]) => { setLines(next); setRows((r) => syncVehicleRows(next, r, customerName)) }
  const grandTotal = lines.reduce((s, l) => s + lineTotals(l).total, 0)

  async function save() {
    setError('')
    if (!customerId) { setError('Pick the customer (CRM organisation) first.'); return }
    if (lines.some((l) => !l.description.trim())) { setError('Every line needs a description — use the wording from the customer\'s PO.'); return }
    setSaving(true)
    try {
      const so = await salesApi.createOrder({
        ...terms, customer_id: customerId, customer_contact_id: contactId, ...source,
        lines, schedule: rows, billing_plan: billing,
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

  return (
    <div>
      <FormPage
        tour="sales-form"
        nav={<SalesNav />}
        icon="cart"
        title="New Sales Order"
        subtitle={source.label ? `From ${source.label}${source.quotation ? ` · quotation ${source.quotation}` : ''}` : 'Direct order from a customer PO'}
        onBack={() => router.push('/dashboard/sales/orders')} backTour="sales-form-back"
        footer={<>
          <button type="button" onClick={() => router.push('/dashboard/sales/orders')} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          {canCreate && (
            <button data-tour="sales-form-save" type="button" disabled={saving || !!existing} onClick={save} style={sheetBtn('primary', SHEET.BLUE, saving || !!existing)}>
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

        <SheetColumns
          left={<>
            <SheetSection icon="building" title="Customer">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="sales-form-customer" style={{ flex: '1 1 300px', maxWidth: 480 }}>
                  <label style={sheetLabel}>Customer (CRM organisation) <Req /></label>
                  <SearchableSelect value={customerId ? String(customerId) : ''} onChange={(v) => {
                    setCustomerId(v ? Number(v) : null); setContactId(null)
                    if (quotationId) pickQuotation(null)  // a quotation belongs to one customer
                  }}
                    options={customers.map((c) => ({ value: String(c.id), label: `${c.name}${c.gst_number ? ` · ${c.gst_number}` : c.state ? ` · ${c.state}` : ''}` }))}
                    placeholder="Pick the customer…" />
                </div>
                <div style={{ flex: '0 1 280px', minWidth: 200 }}>
                  <label style={sheetLabel}>Contact person</label>
                  <Select style={sheetInput} value={contactId ?? ''} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">—</option>
                    {(customerId ? contacts : []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.designation ? ` (${c.designation})` : ''}</option>)}
                  </Select>
                </div>
              </div>
              {!fromLink && customerId && (
                <div data-tour="sales-form-quotation" style={{ marginTop: 12, maxWidth: 780 }}>
                  <label style={sheetLabel}>Quotation</label>
                  <SearchableSelect value={quotationId ? String(quotationId) : ''} onChange={(v) => pickQuotation(v ? Number(v) : null)}
                    options={quotations.map((q) => ({
                      value: String(q.id),
                      label: [q.quot_number || `#${q.id}`, q.inquiry_number, formatINR(q.net_value), q.status_label,
                        q.existing_order ? `${q.existing_order} already raised` : !q.order_received ? `inquiry at ${q.inquiry_stage}` : null,
                      ].filter(Boolean).join(' · '),
                    }))}
                    placeholder={quotations.length ? (quotLoading ? 'Copying…' : 'Pick a quotation to fill the order (optional)…') : 'No approved / sent quotation for this customer'} />
                  <p style={sheetHint}>
                    Picking a quotation copies its lines, prices, discount, payment / delivery terms and conditions, and links the order to its inquiry.
                    The inquiry must be at stage &quot;Order Received&quot; in CRM.
                  </p>
                </div>
              )}
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
            <SheetSection icon="rupee" title="Order Summary">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: SHEET.BODY }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Customer</span><b style={{ textAlign: 'right' }}>{customerName || '—'}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Lines</span><b>{lines.length}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Vehicles scheduled</span><b>{vehicles}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Billing plan</span><b style={{ color: Math.abs(billingSum - 100) < 0.001 ? '#16A34A' : '#DC2626' }}>{billingSum}%</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTop: `1px solid ${SHEET.LINE}`, fontSize: 14 }}>
                  <span>Order value (incl. GST)</span><b style={{ color: SHEET.INK }}>{formatINR(Math.round(grandTotal * 100) / 100)}</b>
                </div>
              </div>
            </SheetSection>
          </>}
        />

        <div data-tour="sales-form-lines" style={block}>
          <SheetSection icon="list" title="Lines">
            <LinesEditor lines={lines} onChange={updateLines} customerId={customerId} priceDate={(terms.customer_po_date as string) || null} />
          </SheetSection>
        </div>

        <div data-tour="sales-form-schedule" style={block}>
          <SheetSection icon="truck" title="Delivery schedule">
            <ScheduleEditor lines={lines} rows={rows} onChange={setRows} />
          </SheetSection>
        </div>

        <div data-tour="sales-form-billing" style={block}>
          <SheetSection icon="rupee" title="Billing plan">
            <BillingPlanEditor rows={billing} onChange={setBilling} grandTotal={grandTotal} />
          </SheetSection>
        </div>
      </FormPage>
    </div>
  )
}
