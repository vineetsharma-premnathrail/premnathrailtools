'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi, vendorsApi } from '@/lib/api'
import { P2PRequest, ProcurementVendor, VendorItemMatch } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import { rfqInvitesApi } from '@/lib/mmPurchasingApi'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const textArea: React.CSSProperties = { ...sheetInput, minHeight: 60, resize: 'vertical' }

/** Local-date ISO (yyyy-mm-dd) — what DateField and the backend use. */
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d) }

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

  const [vendorMaster, setVendorMaster] = useState<ProcurementVendor[]>([])
  const [pickedIds, setPickedIds] = useState<number[]>([])
  const [suggestions, setSuggestions] = useState<{ vendor_id: number; vendor_name: string; items: string[]; total: number | null }[]>([])

  // Procurement › Settings: default quote window and the minimum vendors to ask.
  const [minVendors, setMinVendors] = useState(3)
  const [quoteDueDate, setQuoteDueDate] = useState(() => addDays(3))
  const dueDateTouched = useRef(false)  // the buyer's own date wins over the settings default

  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [lateDeliveryClause, setLateDeliveryClause] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [requiresTechnicalEvaluation] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // the created draft (the API object — its id_ref builds the RFQ link)
  const [draftRfq, setDraftRfq] = useState<{ id: number } | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.list({ status: 'approved', limit: 500 }).then(setPrs).catch(() => {})
    vendorsApi.list({ status: 'active' }).then(setVendorMaster).catch(() => {})
    p2pApi.getSettings().then((s) => {
      const days = Number(s.values?.rfq_quote_days)
      const min = Number(s.values?.rfq_min_vendors)
      if (Number.isFinite(min) && min > 0) setMinVendors(min)
      if (Number.isFinite(days) && days >= 0 && !dueDateTouched.current) setQuoteDueDate(addDays(days))
    }).catch(() => {})
  }, [isAuthorized])

  // Vendors whose catalog lists this PR's items — most items, then cheapest total first.
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
  const picked = pickedIds
    .map((id) => vendorMaster.find((v) => v.id === id))
    .filter((v): v is ProcurementVendor => !!v)
  const missingEmail = picked.filter((v) => !(v.contact_email || '').trim())
  const limitedQuotation = picked.length < minVendors
  const vendorOptions = vendorMaster
    .filter((m) => !pickedIds.includes(m.id))
    .map((m) => ({ value: String(m.id), label: `${m.name} (${m.code})${m.city ? ` — ${m.city}` : ''}` }))

  const addVendor = (id: number) => setPickedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  const removeVendor = (id: number) => setPickedIds((ids) => ids.filter((x) => x !== id))

  const validate = (): string | null => {
    if (!prId) return 'Select the Purchase Requisition this RFQ is for.'
    if (!picked.length) return 'Pick at least one vendor to ask for a quotation (add new vendors in Procurement › Vendors).'
    if (missingEmail.length) return `No email in the vendor master for ${missingEmail.map((v) => v.name).join(', ')} — add it under Procurement › Vendors, or remove ${missingEmail.length === 1 ? 'that vendor' : 'those vendors'} from this RFQ.`
    if (!quoteDueDate) return 'Set the Quote by date — the last day vendors can send their quotation.'
    if (quoteDueDate < isoDate(new Date())) return 'The Quote by date is in the past — pick today or a later date.'
    if (!lateDeliveryClause.trim()) return 'Late delivery clause is required — write the penalty for late supply. It goes out in the RFQ email and is printed on the PO.'
    if (limitedQuotation && !singleQuotationReason.trim()) return `Only ${picked.length} vendor${picked.length === 1 ? '' : 's'} picked — Procurement › Settings asks for at least ${minVendors}. Add more vendors, or write the reason for a limited quotation.`
    return null
  }

  const save = async () => {
    setError('')
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setBusy(true)
    try {
      // Reuse the draft from a prior failed attempt instead of minting a new
      // RFQ row each retry (the backend also reuses an open draft for the PR).
      const rfq = draftRfq ?? await rfqApi.create(Number(prId), requiresTechnicalEvaluation)
      if (!draftRfq) setDraftRfq(rfq)
      const reason = limitedQuotation ? singleQuotationReason.trim() : ''
      await rfqApi.update(rfq.id, {
        single_quotation_reason: reason || null,
        comments: reason || null,
        late_delivery_clause: lateDeliveryClause.trim(),
      })
      await rfqInvitesApi.set(rfq.id, {
        vendor_ids: picked.map((v) => v.id),
        quote_due_date: quoteDueDate,
        invite_message: inviteMessage.trim() || null,
      })
      // Submit validates, locks the RFQ and emails every invited vendor.
      await rfqApi.submit(rfq.id)
      router.push(recordPath('/dashboard/p2p/rfq', rfq))
    } catch (err) {
      setError(extractErrorMessages(err, 'The RFQ could not be sent.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormPage nav={<P2PNav />} icon="send" title="Raise RFQ" subtitle="Pick the vendors to ask, set the quote-by date and terms — the RFQ is emailed to each vendor."
      onBack={() => router.push('/dashboard/p2p/rfq')} backTour="rfq-new-back"
      footer={<>
        <span style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#92400e' }}>
          <SheetIcon name="alert" size={15} color="#d97706" /><span><strong>Saving emails the RFQ to {picked.length} vendor{picked.length === 1 ? '' : 's'}</strong> and locks it.</span>
        </span>
        <button data-tour="rfq-new-cancel" type="button" disabled={busy} onClick={() => router.push('/dashboard/p2p/rfq')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="rfq-new-save" type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Sending…' : 'Send RFQ'}</button>
      </>}>
      <MessageDialog open={!!error} variant="error" title="Cannot Send RFQ" message={error} onClose={() => setError('')} />
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
          <SheetSection icon="users" title="2. Vendors to ask for a quotation">
            <div data-tour="rfq-vendors">
              <label style={sheetLabel}>Add vendor <Req /></label>
              <SearchableSelect
                value=""
                onChange={(val) => { if (val) addVendor(Number(val)) }}
                options={vendorOptions}
                placeholder={vendorMaster.length ? 'Search active vendors…' : 'No active vendors yet — add them in Procurement › Vendors'}
              />
              {picked.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {picked.map((v) => {
                    const email = (v.contact_email || '').trim()
                    return (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#fff', border: `1px solid ${email ? SHEET.LINE : 'rgba(185,28,28,0.35)'}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK, margin: 0 }}>{v.name} <span style={{ fontWeight: 400, color: SHEET.MUTED }}>({v.code})</span></p>
                          {email
                            ? <p style={{ fontSize: 12, color: SHEET.BODY, margin: '2px 0 0', overflowWrap: 'anywhere' }}>{email}</p>
                            : <p style={{ fontSize: 12, color: '#b91c1c', margin: '2px 0 0' }}>No email — add it in Procurement › Vendors</p>}
                        </div>
                        <button type="button" title={`Remove ${v.name}`} aria-label={`Remove ${v.name}`} disabled={busy} onClick={() => removeVendor(v.id)} style={sheetBtn('ghost', '#b91c1c', busy)}>
                          <SheetIcon name="x" size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#b45309', margin: '10px 0 0' }}>No vendors picked yet — Procurement › Settings asks for at least {minVendors}.</p>
              )}
              <p style={sheetHint}>The RFQ is emailed to each vendor. Their replies come to your mailbox — record them on the RFQ&apos;s comparison page.</p>
            </div>
            {suggestions.length > 0 && (
              <div data-tour="rfq-vendor-suggestions" style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: '#eff6ff', border: '1px solid rgba(37,99,235,0.15)' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', margin: '0 0 6px' }}>Vendors whose catalog has these items (most items, then lowest catalog price first)</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {suggestions.slice(0, 8).map((sg) => {
                    const added = pickedIds.includes(sg.vendor_id)
                    const active = vendorMaster.some((m) => m.id === sg.vendor_id)
                    const off = added || !active || busy
                    return (
                      <button key={sg.vendor_id} type="button" disabled={off} onClick={() => addVendor(sg.vendor_id)}
                        title={!active ? `${sg.vendor_name} is not Active in Procurement › Vendors` : sg.items.join(', ')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px', borderRadius: 9999, background: added ? '#dbeafe' : '#fff', border: '1px solid rgba(37,99,235,0.2)', color: '#1e3a8a', fontFamily: 'inherit', cursor: off ? 'default' : 'pointer', opacity: active ? 1 : 0.55 }}>
                        <SheetIcon name={added ? 'check' : 'plus'} size={12} />
                        {added ? 'Added' : 'Add'} · {sg.vendor_name} · {sg.items.length} item{sg.items.length === 1 ? '' : 's'}{sg.total != null ? ` · ₹${sg.total.toLocaleString()}` : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="calendar" title="3. Quote & terms">
            <div data-tour="rfq-quote-by">
              <label style={sheetLabel}>Quote by <Req /></label>
              <DateField value={quoteDueDate} onChange={(v) => { dueDateTouched.current = true; setQuoteDueDate(v) }} />
              <p style={sheetHint}>Last day for vendors to send their quotation.</p>
            </div>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Late Delivery Clause <Req /></label>
            <textarea data-tour="rfq-late-delivery-clause" style={textArea} value={lateDeliveryClause} onChange={(e) => setLateDeliveryClause(e.target.value)}
              placeholder="e.g. 0.5% of the order value per week of delay, max 10%" />
            <p style={sheetHint}>Sent in the RFQ email and printed on the PO.</p>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Note to vendors <Optional /></label>
            <textarea data-tour="rfq-invite-note" style={textArea} value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)}
              placeholder="e.g. Urgent — needed at site by 5 Nov" />
            {limitedQuotation && (
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid rgba(217,119,6,0.3)' }}>
                <p style={{ fontSize: 12, color: '#92400e', margin: '0 0 8px' }}>
                  Only {picked.length} vendor{picked.length === 1 ? '' : 's'} picked — Procurement › Settings asks for at least {minVendors}. Add more vendors, or write the reason.
                </p>
                <label style={sheetLabel}>Reason for a limited quotation <Req /></label>
                <textarea data-tour="rfq-single-reason" style={textArea} value={singleQuotationReason} onChange={(e) => setSingleQuotationReason(e.target.value)}
                  placeholder="e.g. Proprietary item — only the OEM supplies it" />
              </div>
            )}
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
