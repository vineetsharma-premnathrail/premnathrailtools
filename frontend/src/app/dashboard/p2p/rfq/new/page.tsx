'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi, vendorsApi } from '@/lib/api'
import { P2PRequest, MyLineRow, ProcurementVendor, VendorItemMatch } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import { rfqInvitesApi } from '@/lib/mmPurchasingApi'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { chipBtnStyle } from '@/components/shared/ui'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

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

  // Requisitions the buyer has lines to quote on (My Lines), the picked requisition in full, and the
  // buyer's own lines of it. Each buyer raises their own RFQ for their own lines (2026-10-31).
  const [prOptions, setPrOptions] = useState<{ id: number; p2p_number: string; purpose_label: string | null; lines: number }[]>([])
  const [prListError, setPrListError] = useState('')
  const [selectedPr, setSelectedPr] = useState<P2PRequest | null>(null)
  const [lineRows, setLineRows] = useState<MyLineRow[] | null>(null)  // null = My Lines could not be read
  const [loadingPr, setLoadingPr] = useState(false)
  const [prLoadError, setPrLoadError] = useState('')
  const [unticked, setUnticked] = useState<number[]>([])  // lines the buyer took off this RFQ (all ready lines start ticked)
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

  // Typed RFQ data survives a refresh / network failure (lib/formDraft.ts). Off for a PR-linked
  // form, and until the settings default quote date is in (else an untouched form looks changed).
  const [settingsReady, setSettingsReady] = useState(false)
  const draft = useFormDraft(initialPrId || !settingsReady ? null : 'p2p-rfq-new',
    { prId, pickedIds, unticked, quoteDueDate, singleQuotationReason, lateDeliveryClause, inviteMessage },
    (d) => {
      setPrId(d.prId || ''); setPickedIds(Array.isArray(d.pickedIds) ? d.pickedIds : [])
      setUnticked(Array.isArray(d.unticked) ? d.unticked : [])
      if (d.quoteDueDate) { dueDateTouched.current = true; setQuoteDueDate(d.quoteDueDate) }
      setSingleQuotationReason(d.singleQuotationReason || ''); setLateDeliveryClause(d.lateDeliveryClause || ''); setInviteMessage(d.inviteMessage || '')
    })

  useEffect(() => {
    if (!isAuthorized) return
    // Requisitions with at least one of the buyer's lines still to order (not "status = approved":
    // several buyers work one requisition, and it stays open while any line is open).
    p2pApi.myLines({ limit: 500 }).then((res) => {
      const byPr = new Map<number, { id: number; p2p_number: string; purpose_label: string | null; lines: number }>()
      for (const r of res.rows) {
        if (!(r.open_to_order > 0) || r.state !== 'to_quote') continue
        const cur = byPr.get(r.p2p_request_id) || { id: r.p2p_request_id, p2p_number: r.p2p_number, purpose_label: r.purpose_label, lines: 0 }
        cur.lines += 1
        byPr.set(r.p2p_request_id, cur)
      }
      setPrOptions([...byPr.values()].sort((a, b) => a.p2p_number.localeCompare(b.p2p_number, undefined, { numeric: true })))
    }).catch((err) => setPrListError(extractErrorMessages(err, 'Your requisitions with lines to quote could not be loaded. Reload the page; if it keeps failing, ask an admin to give your role Procurement › Requisitions › My Lines.').join(' ')))
    vendorsApi.list({ status: 'active' }).then(setVendorMaster).catch(() => {})
    p2pApi.getSettings().then((s) => {
      const days = Number(s.values?.rfq_quote_days)
      const min = Number(s.values?.rfq_min_vendors)
      if (Number.isFinite(min) && min > 0) setMinVendors(min)
      if (Number.isFinite(days) && days >= 0 && !dueDateTouched.current) setQuoteDueDate(addDays(days))
    }).catch(() => {}).finally(() => setSettingsReady(true))
  }, [isAuthorized])

  // The picked requisition in full, and My Lines' view of it (open quantity and stage per line).
  useEffect(() => {
    if (!isAuthorized || !prId) { Promise.resolve().then(() => { setSelectedPr(null); setLineRows(null); setPrLoadError('') }); return }
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) { setLoadingPr(true); setPrLoadError('') } })
    Promise.all([
      p2pApi.get(Number(prId)),
      p2pApi.myLines({ p2p_request_id: Number(prId), limit: 500 }).then((r) => r.rows).catch(() => null),
    ]).then(([pr, rows]) => {
      if (cancelled) return
      setSelectedPr(pr); setLineRows(rows)
    }).catch((err) => {
      if (!cancelled) { setSelectedPr(null); setLineRows(null); setPrLoadError(extractErrorMessages(err, 'The requisition could not be opened. Check that it still exists and that you have access to it.').join(' ')) }
    }).finally(() => { if (!cancelled) setLoadingPr(false) })
    return () => { cancelled = true }
  }, [isAuthorized, prId])

  // Vendors whose catalog lists this PR's items — most items, then cheapest total first.
  useEffect(() => {
    const pr = selectedPr
    // Matched by Item Master id (info records), never by item name.
    const buyLines = (pr?.items || []).filter((it) => it.fulfillment_status === 'sent_to_procurement' && it.store_item_id && (it.buyer_id ?? pr?.assigned_buyer_id) === user?.id).slice(0, 8)
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
  }, [selectedPr, user?.id])

  if (isLoading || !isAuthorized) return null
  if (!isPurchaseTeam) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Only the Purchase team can raise an RFQ.</p>
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/rfq" listLabel="Back to RFQs" /></div>)
  if (!canCreateRfq) return <p style={{ fontSize: 13, color: '#b91c1c' }}>You don&apos;t have &apos;Create&apos; permission on Procurement › R.F.Q. Ask an admin to add it to one of your roles in Organization › Role &amp; Permissions.</p>

  // The requisition's lines for this RFQ: the buyer's own lines that were sent to procurement and still have
  // quantity to order are ready (ticked by default). Other lines are listed with the reason they are not.
  // A line waiting for the stock check never blocks the others (backend rule, 2026-10-31).
  const rowById = new Map((lineRows || []).map((r) => [r.pr_item_id, r]))
  const lineList = (selectedPr?.items || [])
    .filter((it) => it.fulfillment_status !== 'stock_issued')
    .map((it) => {
      const row = rowById.get(it.id)
      const buyerId = it.buyer_id ?? selectedPr?.assigned_buyer_id
      const open = row ? row.open_to_order : Math.max(0, it.quantity - (it.issued_qty || 0) - (it.short_closed_qty || 0))
      let why: string | null = null
      if (it.fulfillment_status === 'pending') why = 'Waiting for the stock check'
      else if (buyerId !== user?.id) why = buyerId ? `Bought by ${it.buyer_name || selectedPr?.assigned_buyer_name || 'another buyer'}` : 'No buyer yet - ask the Purchase head to assign one'
      else if (!(open > 0)) why = 'Nothing left to order'
      else if (row && row.state !== 'to_quote') why = row.state_label
      return { it, open, why }
    })
  const readyLines = lineList.filter((l) => !l.why)
  const chosenLines = readyLines.filter((l) => !unticked.includes(l.it.id))
  const toggleLine = (id: number) => setUnticked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
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
    if (loadingPr || !selectedPr) return 'The requisition is still loading. Wait a moment and send again.'
    if (!readyLines.length) return 'None of your lines on this requisition is ready for an RFQ. See the reasons under Lines for this RFQ; lines still waiting for the stock check, or bought by another buyer, are not yours to quote.'
    if (!chosenLines.length) return 'Tick at least one line for this RFQ.'
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
      // The server reuses this buyer's open draft on the requisition (and replaces its lines with the
      // ticked ones), so a retry after a failed send never leaves a second RFQ.
      const rfq = await rfqApi.create(Number(prId), requiresTechnicalEvaluation, { pr_item_ids: chosenLines.map((l) => l.it.id) })
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
      draft.clear()
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
      {draft.restored && <div style={{ padding: '16px 24px 0' }}><DraftBanner draft={draft} style={{ marginBottom: 0 }} /></div>}
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
                  options={prOptions.map((pr) => ({ value: String(pr.id), label: `${pr.p2p_number}${pr.purpose_label ? ` — ${pr.purpose_label}` : ''} · ${pr.lines} line${pr.lines === 1 ? '' : 's'} to quote` }))}
                  placeholder="Search requisitions with lines for you to quote…"
                />
              )}
            </div>
            {!initialPrId && prListError && <p style={{ ...sheetHint, color: '#b91c1c' }}>{prListError}</p>}
            {!initialPrId && !prListError && prOptions.length === 0 && <p style={sheetHint}>None of your requisition lines is waiting for an RFQ. Lines appear here once an approved requisition is assigned to you and its stock check is done.</p>}
            {prLoadError && <p style={{ ...sheetHint, color: '#b91c1c' }}>{prLoadError}</p>}
            {selectedPr && <p style={sheetHint}>{selectedPr.project_label || 'No project specified'}</p>}
            {selectedPr && (
              <div data-tour="rfq-new-lines" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: SHEET.SOFT, border: `1px solid ${SHEET.LINE}` }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: SHEET.MUTED, margin: '0 0 6px' }}>Lines for this RFQ</p>
                {lineList.length === 0 && <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0 }}>This requisition has no lines to buy.</p>}
                {readyLines.map(({ it, open }) => (
                  <label key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: SHEET.BODY, margin: '0 0 6px', cursor: busy ? 'default' : 'pointer' }}>
                    <input type="checkbox" disabled={busy} checked={!unticked.includes(it.id)} onChange={() => toggleLine(it.id)} style={{ marginTop: 3 }} />
                    <span>
                      {it.item_code && <strong>{it.item_code} — </strong>}{it.item_name} — <strong>{open.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {it.unit || ''}</strong>
                      {((it.issued_qty || 0) > 0 || (it.short_closed_qty || 0) > 0) && (
                        <span style={{ color: SHEET.MUTED }}> (of {it.quantity}{(it.issued_qty || 0) > 0 ? `; ${it.issued_qty} issued from stock` : ''}{(it.short_closed_qty || 0) > 0 ? `; ${it.short_closed_qty} written off` : ''})</span>
                      )}
                    </span>
                  </label>
                ))}
                {lineList.filter((l) => l.why).map(({ it, why }) => (
                  <p key={it.id} style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '0 0 4px', paddingLeft: 24 }}>
                    {it.item_code && `${it.item_code} — `}{it.item_name}: {why}
                  </p>
                ))}
                {readyLines.length > 0 && <p style={{ ...sheetHint, margin: '6px 0 0' }}>Only the ticked lines go on this RFQ. Other buyers raise their own RFQ for their lines.</p>}
              </div>
            )}
            {loadingPr && <p style={sheetHint}>Loading the requisition…</p>}
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
                        style={{ ...chipBtnStyle(added), cursor: off ? 'default' : 'pointer', opacity: active ? 1 : 0.55 }}>
                        <SheetIcon name={added ? 'check' : 'plus'} size={12} />
                        {added ? 'Added' : 'Add'} · {sg.vendor_name} · {sg.items.length} item{sg.items.length === 1 ? '' : 's'}{sg.total != null ? ` · ₹${sg.total.toLocaleString('en-IN')}` : ''}
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
