'use client'

// One RFQ (one buyer, an explicit set of requisition lines):
// 1. Record each vendor's quote line by line (price, discount, GST, delivery days, make, quantity the vendor can supply) plus freight / packing.
// 2. Comparison grid — landed unit cost per line (excl. GST), L1 per line and overall.
// 3. Award each line BY QUANTITY: a line can be split between vendors (reason when a vendor is not L1).
// 4. The PO is made in Tally per vendor and uploaded on the requisition (Upload PO) — POs aren't created in the portal.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi, vendorsApi } from '@/lib/api'
import { CompareCell, CompareLine, Comparison, LineQuotation, RfqInvites, RfqQuoteFile, mmQuotationsApi, rfqInvitesApi } from '@/lib/mmPurchasingApi'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { P2PRequest, RFQ } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, RowCount } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { formatDate } from '@/lib/format'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }
const cellInput: React.CSSProperties = { ...sheetInput, padding: '6px 8px' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const money = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
const fmtQty = (n: number | null | undefined) => (n == null ? '—' : Number(n.toFixed(3)).toLocaleString('en-IN'))
const EPS = 1e-6

type Opt = { value: string; label: string }
const QUOTE_FILE_ACCEPT = '.pdf,image/*,.doc,.docx,.xls,.xlsx'
// Emailed RFQs — invite quote status, per-page map (repo convention).
const WAIT_STATUS: Record<string, { label: string; hex: string }> = {
  waiting: { label: 'waiting', hex: '#d97706' }, overdue: { label: 'overdue', hex: '#dc2626' }, not_sent: { label: 'email not sent', hex: '#64748b' },
}
/** DD-MM-YYYY from an ISO date. */
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso
}
const fileLink: React.CSSProperties = { fontSize: 12, color: '#2563eb', cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left', wordBreak: 'break-all' }

export default function QuotationComparisonPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const params = useParams()
  const { id: rfqId, error: linkError } = useRecordId(params?.id as string)
  const { can, canFeature } = useCan()
  // R.F.Q › Quotation comparison + Vendor quotations (role editor) — both feed this page.
  const allowCmp = canFeature('p2p', 'rfq', 'comparison', 'view') && canFeature('p2p', 'rfq', 'vendor_quotes', 'view')
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [quotes, setQuotes] = useState<LineQuotation[]>([])
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<LineQuotation | 'new' | null>(null)
  // Award draft, keyed by the quote line (vendor_quotation_item_id): quantity typed per vendor cell, and the reason for a non-L1 vendor.
  const [qtys, setQtys] = useState<Record<number, string>>({})
  const [reasons, setReasons] = useState<Record<number, string>>({})
  // Emailed RFQs: who was invited, the vendor's quotation files per recorded quote.
  const [invites, setInvites] = useState<RfqInvites | null>(null)
  const [quoteFiles, setQuoteFiles] = useState<Record<number, RfqQuoteFile[]>>({})
  const [attachingFor, setAttachingFor] = useState<number | null>(null)
  const [presetVendorId, setPresetVendorId] = useState('')
  const searchParams = useSearchParams()
  const vendorParam = searchParams?.get('vendor') || ''
  const vendorParamHandled = useRef(false)

  // Saved awards fill the quantity boxes. A line with no award yet gets its whole open quantity on L1 as a starting point
  // (unsaved until "Save awards" is pressed); the buyer edits or splits it.
  const seedAwards = (c: Comparison) => {
    const q: Record<number, string> = {}
    const r: Record<number, string> = {}
    for (const l of c.lines) {
      const saved = l.quotes.filter((x): x is CompareCell => !!x && (x.awarded_qty ?? 0) > EPS)
      for (const x of saved) { q[x.vendor_quotation_item_id] = String(Number((x.awarded_qty ?? 0).toFixed(3))); if (x.award_reason) r[x.vendor_quotation_item_id] = x.award_reason }
      if (!saved.length && l.l1_vendor_quotation_item_id && (l.open_qty ?? l.quantity) > EPS) {
        const l1 = l.quotes.find((x) => x?.vendor_quotation_item_id === l.l1_vendor_quotation_item_id)
        q[l.l1_vendor_quotation_item_id] = String(Number(Math.min(l1?.quote_quantity ?? l.quantity, l.open_qty ?? l.quantity).toFixed(3)))
      }
    }
    setQtys(q)
    setReasons((old) => ({ ...r, ...old }))
  }

  const load = useCallback(async () => {
    if (!rfqId) return
    if (!allowCmp) {
      setError("Your role doesn't include R.F.Q › Quotation comparison and Vendor quotations (view), so this page can't be shown. Ask an admin to add them to your role (Organization › Roles).")
      return
    }
    try {
      const r: RFQ = await rfqApi.get(rfqId)
      const [p, q, c] = await Promise.all([p2pApi.get(r.p2p_request_id), mmQuotationsApi.list(rfqId), mmQuotationsApi.comparison(rfqId)])
      setRfq(r); setPr(p); setQuotes(q); setCmp(c)
      const problems: string[] = []
      try { setInvites(await rfqInvitesApi.list(rfqId)) } catch (err) {
        setInvites(null)
        problems.push(extractErrorMessages(err, 'Could not load the vendors this RFQ was emailed to.').join(' '))
      }
      const fileLists = await Promise.all(q.map((vq) => rfqInvitesApi.quoteFiles(rfqId, vq.id).then(
        (fs) => [vq.id, fs] as const,
        (err) => { problems.push(`${vq.vendor_name}: ${extractErrorMessages(err, 'could not load the quotation files.').join(' ')}`); return [vq.id, [] as RfqQuoteFile[]] as const },
      )))
      setQuoteFiles(Object.fromEntries(fileLists))
      seedAwards(c)
      setError(problems.join(' '))
    } catch (err) { setError(extractErrorMessages(err, 'Could not load the quotations of this RFQ — go back to the RFQ and open it again.').join(' ')) }
  }, [rfqId, allowCmp])
  useEffect(() => { if (isAuthorized) Promise.resolve().then(load) }, [isAuthorized, load])

  // From the RFQ's "Record quote" (?vendor=<id>): open the dialog for that vendor once, unless they've already quoted.
  useEffect(() => {
    if (vendorParamHandled.current || !vendorParam || !rfq || !pr || !cmp) return
    vendorParamHandled.current = true
    if (quotes.some((q) => String(q.vendor_id) === vendorParam)) return
    Promise.resolve().then(() => { setPresetVendorId(vendorParam); setEditing('new') })
  }, [vendorParam, rfq, pr, cmp, quotes])

  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/rfq" listLabel="Back to RFQs" /></div>)
  if (isLoading || !isAuthorized) return null

  const canEdit = can('p2p', 'rfq', 'edit')
  const canRecordQuote = canEdit && canFeature('p2p', 'rfq', 'vendor_quotes', 'create')
  const canAward = canEdit && canFeature('p2p', 'rfq', 'award', 'edit')
  const canExport = can('p2p', 'rfq', 'export') && canFeature('p2p', 'rfq', 'comparison', 'export')
    && (canEdit || canFeature('p2p', 'rfq', 'prices', 'view'))
  const canCreatePo = can('p2p', 'purchase_orders', 'create')
  const canAttachQuoteFile = canEdit && (canFeature('p2p', 'rfq', 'vendor_quotes', 'edit') || canFeature('p2p', 'rfq', 'vendor_quotes', 'create'))
  const inviteList = invites?.invites || []
  // Saved awards (from the server) vs the quantities on screen — the PO follows the saved awards.
  const cellsOf = (l: CompareLine) => l.quotes.filter((x): x is CompareCell => !!x)
  const wantQty = (c: CompareCell) => Math.max(0, Number(qtys[c.vendor_quotation_item_id]) || 0)
  const draftTotal = (l: CompareLine) => cellsOf(l).reduce((a, c) => a + wantQty(c), 0)
  const lineChanged = (l: CompareLine) => cellsOf(l).some((c) => Math.abs(wantQty(c) - (c.awarded_qty ?? 0)) > EPS)
  const awardedLines = cmp ? cmp.lines.filter((l) => (l.awarded_total ?? 0) > EPS).length : 0
  const awardsUnsaved = !!cmp && cmp.lines.some(lineChanged)
  const invitedQuoted = inviteList.filter((i) => i.quote_status === 'quoted').length
  const stillWaiting = inviteList.filter((i) => i.quote_status !== 'quoted')

  const openQuoteFile = (f: RfqQuoteFile) => {
    if (!rfqId) return
    openAttachmentBlob(() => rfqApi.getAttachmentBlob(rfqId, f.id), f.filename)
      .catch((err) => setError(extractErrorMessages(err, `Could not open ${f.filename}.`).join(' ')))
  }

  const attachQuoteFiles = async (q: LineQuotation, files: File[]) => {
    if (!rfqId || !files.length) return
    setAttachingFor(q.id)
    try {
      await rfqInvitesApi.uploadQuoteFiles(rfqId, q.id, files)
      const fs = await rfqInvitesApi.quoteFiles(rfqId, q.id)
      setQuoteFiles((s) => ({ ...s, [q.id]: fs }))
      setError('')
    } catch (err) {
      setError(`${q.vendor_name}: the quotation file didn't upload — ${extractErrorMessages(err, 'upload failed.').join(' ')}`)
    } finally { setAttachingFor(null) }
  }

  const saveAwards = async () => {
    if (!cmp || !rfqId) return
    // Per changed line: every vendor with a quantity (a split replaces the line's earlier split), and 0 for a vendor whose award is taken back.
    const awards: { pr_item_id: number; vendor_quotation_item_id: number; quantity: number; reason?: string }[] = []
    for (const l of cmp.lines.filter(lineChanged)) {
      for (const c of cellsOf(l)) {
        const want = wantQty(c)
        const had = c.awarded_qty ?? 0
        if (want > EPS) awards.push({ pr_item_id: l.pr_item_id, vendor_quotation_item_id: c.vendor_quotation_item_id, quantity: want, reason: reasons[c.vendor_quotation_item_id]?.trim() || undefined })
        else if (had > EPS) awards.push({ pr_item_id: l.pr_item_id, vendor_quotation_item_id: c.vendor_quotation_item_id, quantity: 0 })
      }
    }
    if (!awards.length) { setError('Nothing to save: enter a quantity for at least one vendor on a line, or change an award first.'); return }
    setBusy(true)
    try { const fresh = await mmQuotationsApi.award(rfqId, awards); setCmp(fresh); seedAwards(fresh); setError('') } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the awards.').join(' '))
    } finally { setBusy(false) }
  }

  const exportXlsx = async () => {
    if (!rfqId || !rfq) return
    try {
      const blob = await mmQuotationsApi.exportComparison(rfqId)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${rfq.rfq_number}_comparison.xlsx`
      a.click()
    } catch (err) { setError(extractErrorMessages(err, 'Could not export the comparison.').join(' ')) }
  }

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45', margin: '0 0 4px' }}>{pr?.p2p_number}{rfq ? ` · ${rfq.rfq_number}` : ''}</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Quotations &amp; Comparison</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Price every line per vendor, compare landed cost, then award each line by quantity (a line can be split between vendors). The PO per vendor is uploaded on the requisition.</p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => rfq && router.push(recordPath('/dashboard/p2p/rfq', rfq))}>← Back</button>
      </div>
      {error && <div style={errBox}>{error}</div>}

      {rfq && pr && cmp && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <h2 style={{ ...h2, margin: 0 }}>1. Vendor quotes</h2>
              {canRecordQuote && <button type="button" data-tour="rfq-cmp-record-quote" style={primaryBtnStyle} onClick={() => { setPresetVendorId(''); setEditing('new') }}>+ Record a quote</button>}
            </div>
            {inviteList.length > 0 && (
              <div data-tour="rfq-cmp-invite-summary" style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 10px' }}>
                Quotes recorded: <b style={{ color: TEXT.heading }}>{invitedQuoted} of {inviteList.length}</b> invited vendors · quote by <b style={{ color: TEXT.heading }}>{fmtDay(invites?.quote_due_date)}</b>
                {stillWaiting.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    Still waiting:{' '}
                    {stillWaiting.map((w, i) => {
                      const st = WAIT_STATUS[w.quote_status] || { label: w.quote_status, hex: '#64748b' }
                      return (
                        <span key={w.id}>
                          {i > 0 && ', '}
                          {canRecordQuote
                            ? <span style={{ color: '#2563eb', cursor: 'pointer' }} onClick={() => { setPresetVendorId(String(w.vendor_id)); setEditing('new') }}>{w.vendor_name}</span>
                            : w.vendor_name}
                          {' '}<span style={{ color: st.hex, fontSize: 11.5 }}>({st.label})</span>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            {quotes.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No line-level quotes yet. Record each vendor&apos;s quote — the vendor is picked from the vendor master.</p> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {quotes.map((q) => (
                  <div key={q.id} style={{ border: `1px solid ${BORDER.normal}`, borderRadius: 12, padding: '10px 12px', minWidth: 220 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{q.vendor_name}</div>
                    <div style={{ fontSize: 12, color: TEXT.muted }}>{q.quote_ref || 'no ref'} · {q.items.length} line(s) · {money(q.quoted_price)} excl. GST{q.valid_until ? ` · valid till ${formatDate(q.valid_until)}` : ''}</div>
                    {(quoteFiles[q.id] || []).map((f) => (
                      <div key={f.id}><button type="button" style={fileLink} onClick={() => openQuoteFile(f)} title="Open the vendor's quotation">📎 {f.filename}</button></div>
                    ))}
                    <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                      {canEdit && canFeature('p2p', 'rfq', 'vendor_quotes', 'edit') && <span style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }} onClick={() => setEditing(q)}>Edit</span>}
                      {canAttachQuoteFile && (
                        <label data-tour="rfq-cmp-attach-pdf" style={{ fontSize: 12, color: '#2563eb', cursor: attachingFor === q.id ? 'wait' : 'pointer' }}>
                          {attachingFor === q.id ? 'Uploading…' : (quoteFiles[q.id] || []).length ? 'Attach another file' : 'Attach PDF'}
                          <input type="file" multiple accept={QUOTE_FILE_ACCEPT} disabled={attachingFor !== null} style={{ display: 'none' }}
                            onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; attachQuoteFiles(q, fs) }} />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ ...h2, margin: 0 }}>2. Comparison &amp; award</h2>
              {canExport && <button type="button" style={secondaryBtnStyle} onClick={exportXlsx}>Export Excel</button>}
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>{cmp.basis} Best of lines total: <b>{money(cmp.best_of_lines_total)}</b></p>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 + cmp.vendors.length * 160 }}>
                <thead>
                  <tr>
                    <th style={th}>Item <RowCount count={cmp.lines.length} /></th><th style={{ ...th, textAlign: 'right' }}>To buy</th><th style={{ ...th, textAlign: 'right' }}>Last PO</th>
                    {cmp.vendors.map((v) => (
                      <th key={v.vendor_quotation_id} style={{ ...th, textAlign: 'right' }}>
                        {v.vendor_name}{v.overall_rank ? ` (${v.overall_rank})` : ''}
                        {!v.eligible && <div style={{ color: '#b91c1c', textTransform: 'none' }}>{v.ineligible_reason}</div>}
                      </th>
                    ))}
                    <th style={th}>Awarded</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.lines.map((l) => {
                    const total = draftTotal(l)
                    const over = total - l.quantity > EPS
                    const full = !over && Math.abs(total - l.quantity) <= EPS
                    const counterHex = over ? '#b91c1c' : full ? '#166534' : '#92400e'
                    const needReason = cellsOf(l).filter((c) => wantQty(c) > EPS && c.vendor_quotation_item_id !== l.l1_vendor_quotation_item_id)
                    return (
                      <tr key={l.pr_item_id}>
                        <td style={td}>{l.item_code ? `${l.item_code} · ` : ''}{l.item_name}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {fmtQty(l.quantity)} {l.unit || ''}
                          {l.open_qty != null && l.open_qty + EPS < l.quantity && <div style={{ fontSize: 11, color: TEXT.muted }}>{fmtQty(l.open_qty)} not yet ordered</div>}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>{l.last_po ? `${money(l.last_po.unit_price)} (${l.last_po.vendor_name})` : '—'}</td>
                        {l.quotes.map((c, i) => (
                          <td key={i} style={{ ...td, textAlign: 'right', background: c?.rank === 'L1' ? 'rgba(22,163,74,0.07)' : undefined }}>
                            {c ? (
                              <>
                                <div><b>{money(c.landed_unit)}</b> landed {c.rank && <span style={{ fontSize: 11, fontWeight: 800, color: c.rank === 'L1' ? '#16a34a' : TEXT.muted }}>{c.rank}</span>}</div>
                                <div style={{ fontSize: 11, color: TEXT.muted }}>rate {money(c.unit_price)}{c.discount_pct ? ` −${c.discount_pct}%` : ''} · GST {c.gst_rate ?? 0}%{c.delivery_days != null ? ` · ${c.delivery_days} d` : ''}</div>
                                {c.quote_quantity != null && c.quote_quantity + EPS < l.quantity && <div style={{ fontSize: 11, color: '#92400e' }}>can supply {fmtQty(c.quote_quantity)} of {fmtQty(l.quantity)}</div>}
                                {(c.awarded_qty ?? 0) > EPS && <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>awarded {fmtQty(c.awarded_qty)}</div>}
                                {canAward && c.eligible && (
                                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center', marginTop: 6 }}>
                                    <input type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                                      aria-label={`Quantity of ${l.item_name} to award to ${cmp.vendors[i].vendor_name}`}
                                      value={qtys[c.vendor_quotation_item_id] ?? ''} onChange={(e) => setQtys((s) => ({ ...s, [c.vendor_quotation_item_id]: e.target.value }))}
                                      style={{ ...cellInput, width: 84, textAlign: 'right' }} />
                                    <button type="button" title={`Give the whole quantity to ${cmp.vendors[i].vendor_name} (up to what they can supply) and clear the other vendors on this line`}
                                      onClick={() => setQtys((s) => {
                                        const next = { ...s }
                                        for (const o of cellsOf(l)) next[o.vendor_quotation_item_id] = ''
                                        next[c.vendor_quotation_item_id] = String(Number(Math.min(c.quote_quantity ?? l.quantity, l.open_qty ?? l.quantity).toFixed(3)))
                                        return next
                                      })}
                                      style={{ ...smallSecondaryBtnStyle, padding: '0 8px' }}>All</button>
                                  </div>
                                )}
                              </>
                            ) : <span style={{ color: TEXT.muted }}>not quoted</span>}
                          </td>
                        ))}
                        <td style={{ ...td, minWidth: 220 }}>
                          <div data-tour="rfq-cmp-award-counter" style={{ fontWeight: 700, color: counterHex, whiteSpace: 'nowrap' }} aria-live="polite">
                            Awarded {fmtQty(total)} / To buy {fmtQty(l.quantity)} {l.unit || ''}
                          </div>
                          {over && <div style={{ fontSize: 11.5, color: '#b91c1c' }}>{fmtQty(total - l.quantity)} too much: reduce an award.</div>}
                          {!over && !full && total > EPS && <div style={{ fontSize: 11.5, color: '#92400e' }}>{fmtQty(l.quantity - total)} still without a vendor</div>}
                          {lineChanged(l) && <div style={{ fontSize: 11.5, color: '#b45309' }}>not saved yet</div>}
                          {canAward && needReason.map((c) => {
                            const v = cmp.vendors.find((x) => x.vendor_quotation_id === c.vendor_quotation_id)
                            return (
                              <input key={c.vendor_quotation_item_id} value={reasons[c.vendor_quotation_item_id] || ''}
                                onChange={(e) => setReasons((s) => ({ ...s, [c.vendor_quotation_item_id]: e.target.value }))}
                                aria-label={`Why ${v?.vendor_name || 'this vendor'} and not L1`}
                                placeholder={`Why ${v?.vendor_name || 'this vendor'} (${c.rank || 'not L1'}), not L1? *`} style={{ ...cellInput, marginTop: 6 }} />
                            )
                          })}
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total landed (excl. GST)</td>
                    {cmp.vendors.map((v) => <td key={v.vendor_quotation_id} style={{ ...td, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(v.landed_total)}{!v.complete && <div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{v.lines_quoted}/{cmp.lines.length} lines</div>}</td>)}
                    <td style={td} />
                  </tr>
                </tbody>
              </table>
            </div>
            {canAward && cmp.lines.length > 0 && <button type="button" data-tour="rfq-cmp-save-awards" disabled={busy || !awardsUnsaved} style={{ ...primaryBtnStyle, marginTop: 12, opacity: busy || !awardsUnsaved ? 0.6 : 1 }} onClick={saveAwards}>{busy ? 'Saving…' : 'Save awards'}</button>}
          </div>

          <div style={card}>
            <h2 style={h2}>3. Upload the PO</h2>
            {awardedLines === 0 ? (
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Award the lines (L1 is filled in as a starting point) and save. Then make a PO in Tally for each awarded vendor and upload it on the requisition.</p>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
                  <b style={{ color: TEXT.heading }}>{awardedLines} line(s) awarded.</b> Make a PO in Tally for each awarded vendor, then upload each on the requisition (Upload PO). Each PO goes for approval on its own.
                </p>
                {awardsUnsaved && <p style={{ fontSize: 12.5, color: '#b45309', margin: '0 0 10px' }}>You have changed the award quantities. Click Save awards first, so the saved awards are what the PO follows.</p>}
                {canCreatePo && pr
                  ? <button type="button" data-tour="rfq-cmp-send-to-po" disabled={awardsUnsaved || busy} style={{ ...primaryBtnStyle, opacity: awardsUnsaved || busy ? 0.6 : 1 }}
                      onClick={() => router.push(recordPath('/dashboard/p2p', pr))}>Open requisition to upload PO →</button>
                  : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>The purchase team uploads the Tally PO on the requisition — that needs Create access on Procurement › Purchase Orders.</p>}
              </>
            )}
          </div>
        </>
      )}

      {editing && rfq && pr && <QuoteDialog rfq={rfq} pr={pr} quote={editing === 'new' ? null : editing} presetVendorId={editing === 'new' ? presetVendorId : ''}
        onClose={() => setEditing(null)}
        onSaved={(warning) => { setEditing(null); load().then(() => { if (warning) setError(warning) }) }} />}
    </div>
  )
}

type QLine = { unit_price: string; discount_pct: string; gst_rate: string; delivery_days: string; make_offered: string; can_supply: string }
/** A requisition line this RFQ asks quotes for, with the quantity asked. */
type AskLine = { id: number; item_code: string | null; item_name: string; unit: string | null; ask: number }

function QuoteDialog({ rfq, pr, quote, presetVendorId, onClose, onSaved }: {
  rfq: RFQ; pr: P2PRequest; quote: LineQuotation | null; presetVendorId?: string; onClose: () => void
  /** warning = the quote saved but the vendor's file didn't upload. */
  onSaved: (warning?: string) => void
}) {
  // Only the lines this RFQ asks for (an RFQ belongs to one buyer and a chosen set of lines). An old RFQ without a line list quotes the whole requisition.
  const rfqLines = (rfq.items || []).filter((i) => !i.withdrawn_at)
  const buyLines: AskLine[] = rfqLines.length
    ? rfqLines.map((i) => ({ id: i.pr_item_id, item_code: i.item_code, item_name: i.item_name || 'Item', unit: i.unit, ask: i.quantity }))
    : (pr.items || []).filter((i) => i.fulfillment_status !== 'stock_issued').map((i) => ({ id: i.id, item_code: i.item_code ?? null, item_name: i.item_name, unit: i.unit ?? null, ask: i.quantity - (i.issued_qty || 0) }))
  const [vendors, setVendors] = useState<Opt[]>([])
  const [vendorId, setVendorId] = useState(quote?.vendor_id ? String(quote.vendor_id) : (presetVendorId || ''))
  const [files, setFiles] = useState<File[]>([])
  const [ref, setRef] = useState(quote?.quote_ref || '')
  const [validUntil, setValidUntil] = useState(quote?.valid_until || '')
  const [freight, setFreight] = useState(quote?.freight_total != null ? String(quote.freight_total) : '')
  const [packing, setPacking] = useState(quote?.packing_total != null ? String(quote.packing_total) : '')
  const [payTerms, setPayTerms] = useState(quote?.payment_terms || '')
  const [lines, setLines] = useState<Record<number, QLine>>(() => Object.fromEntries(buyLines.map((i) => {
    const q = quote?.items.find((x) => x.pr_item_id === i.id)
    return [i.id, { unit_price: q ? String(q.unit_price) : '', discount_pct: q?.discount_pct != null ? String(q.discount_pct) : '',
      gst_rate: q?.gst_rate != null ? String(q.gst_rate) : '18', delivery_days: q?.delivery_days != null ? String(q.delivery_days) : '', make_offered: q?.make_offered || '',
      // Shown only when the vendor can supply less than the RFQ asks.
      can_supply: q?.quantity != null && q.quantity + EPS < i.ask ? String(Number(q.quantity.toFixed(3))) : '' }]
  })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)
  useEffect(() => {
    vendorsApi.list({ status: 'active' })
      .then((vs) => setVendors(vs.map((v) => ({ value: String(v.id), label: `${v.name}${v.code ? ` (${v.code})` : ''}` }))))
      .catch((err) => { setVendors([]); setError(extractErrorMessages(err, 'Could not load the vendor master.').join(' ')) })
  }, [])

  const save = async () => {
    if (!vendorId) { setError('Pick the vendor from the vendor master.'); return }
    for (const i of buyLines) {
      const cs = lines[i.id]?.can_supply.trim()
      if (Number(lines[i.id]?.unit_price) > 0 && cs) {
        const n = Number(cs)
        if (!Number.isFinite(n) || n <= 0) { setError(`${i.item_name}: "Can supply" must be more than 0. Leave it empty if the vendor quotes the full ${fmtQty(i.ask)} ${i.unit || ''}.`.replace('  ', ' ')); return }
        if (n - i.ask > EPS) { setError(`${i.item_name}: this RFQ asks for ${fmtQty(i.ask)} ${i.unit || ''}, so "Can supply" can be at most that. Enter ${fmtQty(i.ask)} or less.`.replace('  ', ' ')); return }
      }
    }
    const items = buyLines.filter((i) => Number(lines[i.id]?.unit_price) > 0).map((i) => ({
      pr_item_id: i.id, unit_price: Number(lines[i.id].unit_price),
      quantity: lines[i.id].can_supply.trim() ? Number(lines[i.id].can_supply) : null,
      discount_pct: lines[i.id].discount_pct === '' ? null : Number(lines[i.id].discount_pct),
      gst_rate: lines[i.id].gst_rate === '' ? null : Number(lines[i.id].gst_rate),
      delivery_days: lines[i.id].delivery_days === '' ? null : Number(lines[i.id].delivery_days),
      make_offered: lines[i.id].make_offered.trim() || null,
    }))
    if (!items.length) { setError('Enter a unit price for at least one line the vendor quoted (leave a line blank if not quoted).'); return }
    const payload = { vendor_id: Number(vendorId), quote_ref: ref.trim() || null, valid_until: validUntil || null,
      freight_total: freight === '' ? null : Number(freight), packing_total: packing === '' ? null : Number(packing), payment_terms: payTerms.trim() || null, items }
    setBusy(true); setError('')
    let vq: LineQuotation
    try {
      vq = quote ? await mmQuotationsApi.replace(rfq.id, quote.id, payload) : await mmQuotationsApi.add(rfq.id, payload)
    } catch (err) { setError(extractErrorMessages(err, 'Could not save the quote.').join(' ')); setBusy(false); return }
    // The quote is saved — a failed upload must not lose it.
    if (files.length) {
      try { await rfqInvitesApi.uploadQuoteFiles(rfq.id, vq.id, files) } catch (err) {
        onSaved(`Quote saved, but the PDF didn't upload: ${extractErrorMessages(err, 'upload failed.').join(' ')} Attach it again from the quote.`)
        return
      }
    }
    onSaved()
  }

  const set = (id: number, patch: Partial<QLine>) => setLines((s) => ({ ...s, [id]: { ...s[id], ...patch } }))

  return (
    <FormSheet icon="rupee" title={quote ? `Edit ${quote.vendor_name}'s quote` : 'Record a vendor quote'}
      subtitle={`${rfq.rfq_number} · price each line the vendor quoted — leave a line blank if it was not quoted.`}
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save quote'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={errBox}>{error}</div>}
        <SheetSection icon="building" title="Vendor & Terms">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 260px', maxWidth: 340 }}><label style={sheetLabel}>Vendor <Req /></label><SearchableSelect value={vendorId} onChange={setVendorId} options={vendors} placeholder="Search the vendor master…" /></div>
            <div style={{ flex: '0 1 160px' }}><label style={sheetLabel}>Quote ref.</label><input value={ref} onChange={(e) => setRef(e.target.value)} style={sheetInput} /></div>
            <div style={{ flex: '0 1 160px' }}><label style={sheetLabel}>Valid until</label><DateField value={validUntil} onChange={setValidUntil} /></div>
            <div style={{ flex: '0 1 120px' }}><label style={sheetLabel}>Freight</label><input type="number" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} style={sheetInput} /></div>
            <div style={{ flex: '0 1 120px' }}><label style={sheetLabel}>Packing</label><input type="number" min="0" value={packing} onChange={(e) => setPacking(e.target.value)} style={sheetInput} /></div>
            <div style={{ flex: '1 1 220px', maxWidth: 360 }}><label style={sheetLabel}>Payment terms</label><input value={payTerms} onChange={(e) => setPayTerms(e.target.value)} style={sheetInput} /></div>
          </div>
        </SheetSection>
        <SheetSection icon="list" title="Line prices">
          <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr>{['Item', 'Asked', 'Can supply', 'Unit price', 'Disc. %', 'GST %', 'Delivery (days)', 'Make offered'].map((h, i) => <th key={h} style={{ ...th, position: 'static' }}>{h}{i === 0 && <RowCount count={buyLines.length} />}</th>)}</tr></thead>
              <tbody>
                {buyLines.map((i) => (
                  <tr key={i.id}>
                    <td style={td}>{i.item_code ? `${i.item_code} · ` : ''}{i.item_name}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtQty(i.ask)} {i.unit || ''}</td>
                    <td style={{ ...td, width: 100 }}><input type="number" min="0" step="any" placeholder={fmtQty(i.ask)} aria-label={`Quantity the vendor can supply of ${i.item_name}`} value={lines[i.id].can_supply} onChange={(e) => set(i.id, { can_supply: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 120 }}><input type="number" min="0" step="0.01" value={lines[i.id].unit_price} onChange={(e) => set(i.id, { unit_price: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 80 }}><input type="number" min="0" max="99" value={lines[i.id].discount_pct} onChange={(e) => set(i.id, { discount_pct: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 80 }}><input type="number" min="0" max="100" value={lines[i.id].gst_rate} onChange={(e) => set(i.id, { gst_rate: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 100 }}><input type="number" min="0" value={lines[i.id].delivery_days} onChange={(e) => set(i.id, { delivery_days: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 160 }}><input value={lines[i.id].make_offered} onChange={(e) => set(i.id, { make_offered: e.target.value })} style={cellInput} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={sheetHint}>Prices excl. GST. Landed cost on the comparison adds freight and packing, spread over the quoted lines. Leave &quot;Can supply&quot; empty when the vendor quotes the full quantity asked; enter less when they can only supply part (the rest can be awarded to another vendor).</p>
        </SheetSection>
        <SheetSection icon="clip" title="Vendor's quotation (PDF)">
          <input data-tour="rfq-cmp-quote-file" type="file" multiple accept={QUOTE_FILE_ACCEPT} disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files || []))} style={{ fontSize: 13 }} />
          {files.length > 0 && <p style={{ ...sheetHint, color: SHEET.INK }}>{files.map((f) => f.name).join(', ')}</p>}
          <p style={sheetHint}>Attach the quotation the vendor emailed back{quote ? ' (added to the files already on this quote)' : ''} — it is kept with the quote as proof of the rates.</p>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
