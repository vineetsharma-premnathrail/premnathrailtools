'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi, vendorsApi } from '@/lib/api'
import { P2PRequest, ProcurementVendor, VendorItemMatch } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import FileUploadField from '@/components/shared/FileUploadField'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const textArea: React.CSSProperties = { ...sheetInput, minHeight: 60, resize: 'vertical' }

const VENDOR_SLOTS = [
  { tier: 'L1', label: 'L1 Vendor', required: true },
  { tier: 'L2', label: 'L2 Vendor', required: false },
  { tier: 'L3', label: 'L3 Vendor', required: false },
  { tier: 'L4', label: 'L4 Vendor', required: false },
] as const

interface VendorSlotState {
  file: File | null
  vendorId: number | null  // vendor master row (Procurement → Vendors)
  vendorName: string
  vendorContact: string
}

export default function NewRfqPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPrId = searchParams.get('pr_id')
  const { id: linkedPrId, error: linkError } = useRecordId(initialPrId)

  const { can } = useCan()
  const isPurchaseTeam = !!user?.apps?.includes('purchase')
  const canCreateRfq = can('p2p', 'rfq', 'create')

  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [prId, setPrId] = useState('')
  useEffect(() => { if (linkedPrId) setPrId(String(linkedPrId)) }, [linkedPrId])

  const [vendors, setVendors] = useState<Record<string, VendorSlotState>>({
    L1: { file: null, vendorId: null, vendorName: '', vendorContact: '' },
    L2: { file: null, vendorId: null, vendorName: '', vendorContact: '' },
    L3: { file: null, vendorId: null, vendorName: '', vendorContact: '' },
    L4: { file: null, vendorId: null, vendorName: '', vendorContact: '' },
  })
  const [vendorMaster, setVendorMaster] = useState<ProcurementVendor[]>([])
  const [suggestions, setSuggestions] = useState<{ vendor_id: number; vendor_name: string; items: string[]; total: number | null }[]>([])
  // Company standard terms (Procurement → Settings), editable for this RFQ.
  const [termsConditions, setTermsConditions] = useState('')

  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [comments, setComments] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryLeadTime, setDeliveryLeadTime] = useState('')
  const [lateDeliveryClause, setLateDeliveryClause] = useState('')
  const [requiresTechnicalEvaluation] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // the created draft (the API object — its id_ref builds the RFQ link)
  const [draftRfq, setDraftRfq] = useState<{ id: number } | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.list({ status: 'approved', limit: 500 }).then(setPrs).catch(() => {})
    vendorsApi.list({ status: 'active' }).then(setVendorMaster).catch(() => {})
    p2pApi.getSettings().then((s) => setTermsConditions(String(s.values.company_terms || ''))).catch(() => {})
  }, [isAuthorized])

  // Vendors whose catalog lists this PR's items — cheapest total first — to help pick L1..L4.
  useEffect(() => {
    const pr = prs.find((p) => String(p.id) === prId)
    // Matched by Item Master id (info records), never by item name.
    const buyLines = (pr?.items || []).filter((it) => it.fulfillment_status === 'sent_to_procurement' && it.store_item_id).slice(0, 8)
    const names = buyLines.map((it) => it.item_name)
    if (!names.length) { Promise.resolve().then(() => setSuggestions([])); return }
    let cancelled = false
    Promise.all(buyLines.map((it) => vendorsApi.forItem(it.store_item_id as number).catch(() => [] as VendorItemMatch[]))).then((lists) => {
      if (cancelled) return
      const byVendor = new Map<number, { vendor_id: number; vendor_name: string; items: string[]; total: number | null }>()
      lists.forEach((hits, i) => {
        const seen = new Set<number>()
        for (const h of hits) {
          if (seen.has(h.vendor_id)) continue
          seen.add(h.vendor_id)
          const row = byVendor.get(h.vendor_id) || { vendor_id: h.vendor_id, vendor_name: h.vendor_name, items: [], total: 0 }
          row.items.push(names[i])
          row.total = h.unit_price != null && row.total != null ? row.total + h.unit_price : null
          byVendor.set(h.vendor_id, row)
        }
      })
      setSuggestions([...byVendor.values()].sort((a, b) => b.items.length - a.items.length || (a.total ?? Infinity) - (b.total ?? Infinity)))
    })
    return () => { cancelled = true }
  }, [prId, prs])

  if (isLoading || !isAuthorized) return null
  if (!isPurchaseTeam) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Only the Purchase team can raise an RFQ.</p>
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/rfq" listLabel="Back to RFQs" /></div>)
  if (!canCreateRfq) return <p style={{ fontSize: 13, color: '#b91c1c' }}>You don&apos;t have &apos;Create&apos; permission on Procurement › R.F.Q. Ask an admin to add it to one of your roles in Organization › Role &amp; Permissions.</p>

  // Same readiness rule as the RFQ queue and the backend: no line still
  // awaiting its stock decision, and at least one line needs buying.
  const readyPrs = prs.filter((pr) =>
    !pr.items.some((it) => it.fulfillment_status === 'pending')
    && pr.items.some((it) => it.fulfillment_status === 'sent_to_procurement'))
  const selectedPr = prs.find((pr) => String(pr.id) === prId)
  const procureLines = (selectedPr?.items || [])
    .filter((it) => it.fulfillment_status === 'sent_to_procurement')
    .map((it) => ({ ...it, buyQty: it.quantity - (it.issued_qty || 0) }))
  const usedTiers = VENDOR_SLOTS.filter((s) => vendors[s.tier].file)
  const onlyL1 = usedTiers.length === 1 && !!vendors.L1.file
  const noAttachments = usedTiers.length === 0

  const updateVendor = (tier: string, patch: Partial<VendorSlotState>) => {
    setVendors((v) => ({ ...v, [tier]: { ...v[tier], ...patch } }))
  }

  const validate = (): string | null => {
    if (!prId) return 'Select a purchase request.'
    if (!vendors.L1.file) return 'The L1 Vendor quotation attachment is required.'
    if (!vendors.L1.vendorName.trim()) return 'Pick the L1 Vendor from the vendor master (add new vendors in Procurement → Vendors).'
    if (!vendors.L1.vendorContact.trim()) return 'L1 Vendor contact number is required.'
    for (const slot of VENDOR_SLOTS) {
      const v = vendors[slot.tier]
      if (v.file && !v.vendorName.trim()) return `${slot.label} name is required since a quotation is attached.`
    }
    if (onlyL1) {
      if (!singleQuotationReason.trim()) return 'Reason for single quotation is required when only L1 Vendor is attached.'
      if (!comments.trim()) return 'Comments are required when only L1 Vendor is attached.'
    }
    if (!paymentTerms.trim()) return 'Payment terms are required.'
    if (!deliveryLeadTime.trim()) return 'Delivery lead time is required.'
    if (!lateDeliveryClause.trim()) return 'Late delivery clause is required.'
    return null
  }

  const save = async () => {
    setError('')
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setBusy(true)
    try {
      // Reuse the draft from a prior failed attempt instead of minting a new
      // RFQ row each retry (a mid-flow failure — attachment upload, submit
      // validation — used to leave the already-created draft orphaned).
      const rfq = draftRfq ?? await rfqApi.create(Number(prId), requiresTechnicalEvaluation)
      if (!draftRfq) setDraftRfq(rfq)
      for (const slot of VENDOR_SLOTS) {
        const v = vendors[slot.tier]
        if (v.file) await rfqApi.uploadAttachments(rfq.id, [v.file], slot.tier, v.vendorName.trim(), v.vendorContact.trim() || undefined, v.vendorId || undefined)
      }
      await rfqApi.update(rfq.id, {
        single_quotation_reason: onlyL1 ? singleQuotationReason.trim() : undefined,
        comments: onlyL1 ? comments.trim() : undefined,
        payment_terms: paymentTerms.trim(),
        delivery_lead_time: deliveryLeadTime.trim(),
        late_delivery_clause: lateDeliveryClause.trim(),
        terms_conditions: termsConditions.trim() || undefined,
      })
      await rfqApi.submit(rfq.id)
      router.push(recordPath('/dashboard/p2p/rfq', rfq))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save RFQ.'))
    } finally {
      setBusy(false)
    }
  }

  const l1Master = vendorMaster.find((m) => m.id === vendors.L1.vendorId)

  return (
    <FormPage nav={<P2PNav />} icon="send" title="Raise RFQ" subtitle="Attach the vendor quotations (L1 = lowest) against an approved requisition and set the L1 vendor's commercial terms."
      onBack={() => router.push('/dashboard/p2p/rfq')} backTour="rfq-new-back"
      footer={<>
        <span style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#92400e' }}>
          <SheetIcon name="alert" size={15} color="#d97706" /><span><strong>Once saved, this RFQ is locked</strong> and cannot be edited.</span>
        </span>
        <button data-tour="rfq-new-cancel" type="button" disabled={busy} onClick={() => router.push('/dashboard/p2p/rfq')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="rfq-new-save" type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save RFQ'}</button>
      </>}>
      <MessageDialog open={!!error} variant="error" title="Cannot Save RFQ" message={error} onClose={() => setError('')} />
      <SheetColumns
        left={<>
          <SheetSection icon="doc" title="1. Purchase Requisition">
            <div data-tour="rfq-new-pr">
              <label style={sheetLabel}>Requisition <Req /></label>
              {initialPrId ? (
                <p style={{ fontSize: 14, fontWeight: 600, color: SHEET.INK, margin: 0 }}>
                  {selectedPr ? `${selectedPr.p2p_number} — ${selectedPr.category_label || selectedPr.category_code}` : 'Loading…'}
                </p>
              ) : (
                <SearchableSelect
                  value={prId}
                  onChange={setPrId}
                  options={readyPrs.map((pr) => ({ value: String(pr.id), label: `${pr.p2p_number} — ${pr.category_label || pr.category_code}` }))}
                  placeholder="Search Purchase Requisitions ready for RFQ…"
                />
              )}
            </div>
            {selectedPr && <p style={sheetHint}>{selectedPr.project_label || 'No project specified'}</p>}
            {procureLines.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: SHEET.SOFT, border: `1px solid ${SHEET.LINE}` }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: SHEET.MUTED, margin: '0 0 6px' }}>To Be Quoted</p>
                {procureLines.map((it) => (
                  <p key={it.id} style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 3px' }}>
                    {it.item_name} — <strong>{it.buyQty} {it.unit || ''}</strong>
                    {(it.issued_qty || 0) > 0 && <span style={{ color: SHEET.MUTED }}> (of {it.quantity}; {it.issued_qty} issued from stock)</span>}
                  </p>
                ))}
              </div>
            )}
          </SheetSection>

          <SheetSection icon="building" title="2. Supplier / Vendor Quotations">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {VENDOR_SLOTS.map((slot) => {
                const v = vendors[slot.tier]
                return (
                  <div key={slot.tier} style={{ borderRadius: 12, border: `1px solid ${SHEET.LINE}`, padding: 14, background: '#fff' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: SHEET.INK, margin: '0 0 10px' }}>
                      {slot.label} {slot.required ? <Req /> : <Optional />}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      <div data-tour="rfq-vendor-name" style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <label style={sheetLabel}>Vendor (from master){v.file && <> <Req /></>}</label>
                        <SearchableSelect
                          value={v.vendorId ? String(v.vendorId) : ''}
                          onChange={(val) => {
                            const m = vendorMaster.find((x) => String(x.id) === val)
                            updateVendor(slot.tier, m
                              ? { vendorId: m.id, vendorName: m.name, vendorContact: m.contact_phone || m.contact_email || v.vendorContact }
                              : { vendorId: null, vendorName: '', vendorContact: '' })
                          }}
                          options={vendorMaster.map((m) => ({ value: String(m.id), label: `${m.name} (${m.code})${m.city ? ` — ${m.city}` : ''}` }))}
                          placeholder={vendorMaster.length ? 'Search vendor…' : 'No vendors yet — add them in Vendors'}
                        />
                      </div>
                      <div data-tour="rfq-vendor-contact" style={{ flex: '0 1 170px', minWidth: 140 }}>
                        <label style={sheetLabel}>Contact Number{slot.required && <> <Req /></>}</label>
                        <input style={sheetInput} value={v.vendorContact} onChange={(e) => updateVendor(slot.tier, { vendorContact: e.target.value })} placeholder="Phone number" />
                      </div>
                      <div data-tour="rfq-vendor-file" style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <label style={sheetLabel}>Quotation{slot.required && <> <Req /></>}</label>
                        <FileUploadField
                          file={v.file}
                          onChange={(f) => updateVendor(slot.tier, { file: f })}
                          onRemove={v.file ? () => updateVendor(slot.tier, { file: null }) : undefined}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {noAttachments && (
              <p style={{ fontSize: 12, color: '#b45309', margin: '10px 0 0' }}>At least the L1 Vendor quotation must be attached.</p>
            )}
            {suggestions.length > 0 && (
              <div data-tour="rfq-vendor-suggestions" style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: '#eff6ff', border: '1px solid rgba(37,99,235,0.15)' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', margin: '0 0 6px' }}>Vendors whose catalog has these items (most items, then lowest catalog price first)</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {suggestions.slice(0, 8).map((sg) => (
                    <span key={sg.vendor_id} title={sg.items.join(', ')} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 9999, background: '#fff', border: '1px solid rgba(37,99,235,0.2)', color: '#1e3a8a' }}>
                      {sg.vendor_name} · {sg.items.length} item{sg.items.length === 1 ? '' : 's'}{sg.total != null ? ` · ₹${sg.total.toLocaleString()}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </SheetSection>
        </>}
        right={<>
          {onlyL1 && (
            <SheetSection icon="alert" title="Single Quotation" color="#d97706">
              <p style={{ ...sheetHint, margin: '0 0 12px' }}>Only L1 Vendor was attached — a reason and comments are required.</p>
              <label style={sheetLabel}>Reason for Single Quotation <Req /></label>
              <textarea data-tour="rfq-single-reason" style={textArea} value={singleQuotationReason} onChange={(e) => setSingleQuotationReason(e.target.value)} />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Comments <Req /></label>
              <textarea data-tour="rfq-single-comments" style={textArea} value={comments} onChange={(e) => setComments(e.target.value)} />
            </SheetSection>
          )}
          <SheetSection icon="rupee" title="3. L1 Vendor Commercial Terms">
            <label style={sheetLabel}>Payment Terms <Req /></label>
            <input data-tour="rfq-payment-terms" style={sheetInput} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 50% advance, 50% on delivery" />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Delivery Lead Time <Req /></label>
            <input data-tour="rfq-delivery-lead-time" style={sheetInput} value={deliveryLeadTime} onChange={(e) => setDeliveryLeadTime(e.target.value)} placeholder="e.g. 4 weeks" />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Late Delivery Clause <Req /></label>
            <textarea data-tour="rfq-late-delivery-clause" style={textArea} value={lateDeliveryClause} onChange={(e) => setLateDeliveryClause(e.target.value)} placeholder="Late delivery clause" />
          </SheetSection>
          <SheetSection icon="doc" title="Terms & Conditions (company)">
            <div data-tour="rfq-terms">
              <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={termsConditions} onChange={(e) => setTermsConditions(e.target.value)}
                placeholder="Company standard terms — set the default in Procurement → Settings" />
              {l1Master?.terms_conditions ? (
                <p style={{ ...sheetHint, whiteSpace: 'pre-wrap' }}><b>{l1Master.name}&apos;s own terms:</b> {l1Master.terms_conditions}</p>
              ) : null}
              <p style={sheetHint}>Both go onto the PO: the company terms first, then the vendor&apos;s.</p>
            </div>
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
