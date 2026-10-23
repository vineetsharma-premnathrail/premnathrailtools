'use client'

// ME47 / ME49 / ME21N on one RFQ:
// 1. Record each vendor's quote line by line (price, discount, GST, delivery days, make) plus freight / packing.
// 2. Comparison grid — landed unit cost per line (excl. GST), L1 per line and overall.
// 3. Award each line to a vendor (reason when not L1).
// 4. Send the awarded lines to Purchase Orders › Create PO — one draft PO per awarded vendor is created there.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi, vendorsApi } from '@/lib/api'
import { Comparison, LineQuotation, RfqInvites, RfqQuoteFile, mmQuotationsApi, rfqInvitesApi } from '@/lib/mmPurchasingApi'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { P2PRequest, RFQ } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
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
const money = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

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
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [reasons, setReasons] = useState<Record<number, string>>({})
  // Emailed RFQs: who was invited, the vendor's quotation files per recorded quote.
  const [invites, setInvites] = useState<RfqInvites | null>(null)
  const [quoteFiles, setQuoteFiles] = useState<Record<number, RfqQuoteFile[]>>({})
  const [attachingFor, setAttachingFor] = useState<number | null>(null)
  const [presetVendorId, setPresetVendorId] = useState('')
  const searchParams = useSearchParams()
  const vendorParam = searchParams?.get('vendor') || ''
  const vendorParamHandled = useRef(false)

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
      setPicks(Object.fromEntries(c.lines.map((l) => {
        const awarded = l.quotes.find((x) => x?.is_awarded)
        return [l.pr_item_id, String(awarded?.vendor_quotation_item_id ?? l.l1_vendor_quotation_item_id ?? '')]
      })))
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
  // Saved awards (from the server) vs the award picks on screen — the PO request is the saved awards.
  const savedAward = (l: Comparison['lines'][number]) => String(l.quotes.find((x) => x?.is_awarded)?.vendor_quotation_item_id ?? '')
  const awardedLines = cmp ? cmp.lines.filter((l) => savedAward(l)).length : 0
  const awardsUnsaved = !!cmp && cmp.lines.some((l) => (picks[l.pr_item_id] || '') !== savedAward(l))
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
    const awards = cmp.lines.filter((l) => picks[l.pr_item_id]).map((l) => ({
      pr_item_id: l.pr_item_id, vendor_quotation_item_id: Number(picks[l.pr_item_id]), reason: reasons[l.pr_item_id]?.trim() || undefined,
    }))
    if (!awards.length) { setError('Pick a vendor for at least one line.'); return }
    setBusy(true)
    try { setCmp(await mmQuotationsApi.award(rfqId, awards)); setError('') } catch (err) {
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
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Price every line per vendor, compare landed cost, award each line, then send the awards to Purchase Orders.</p>
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
                    <div style={{ fontSize: 12, color: TEXT.muted }}>{q.quote_ref || 'no ref'} · {q.items.length} line(s) · {money(q.quoted_price)} excl. GST{q.valid_until ? ` · valid till ${q.valid_until}` : ''}</div>
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
                    <th style={th}>Item</th><th style={th}>Qty</th><th style={th}>Last PO</th>
                    {cmp.vendors.map((v) => (
                      <th key={v.vendor_quotation_id} style={th}>
                        {v.vendor_name}{v.overall_rank ? ` (${v.overall_rank})` : ''}
                        {!v.eligible && <div style={{ color: '#b91c1c', textTransform: 'none' }}>{v.ineligible_reason}</div>}
                      </th>
                    ))}
                    <th style={th}>Award to</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.lines.map((l) => {
                    const picked = Number(picks[l.pr_item_id] || 0)
                    const notL1 = picked && picked !== l.l1_vendor_quotation_item_id
                    return (
                      <tr key={l.pr_item_id}>
                        <td style={td}>{l.item_code ? `${l.item_code} · ` : ''}{l.item_name}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.quantity} {l.unit || ''}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.last_po ? `${money(l.last_po.unit_price)} (${l.last_po.vendor_name})` : '—'}</td>
                        {l.quotes.map((c, i) => (
                          <td key={i} style={{ ...td, background: c?.rank === 'L1' ? 'rgba(22,163,74,0.07)' : undefined }}>
                            {c ? (
                              <>
                                <div><b>{money(c.landed_unit)}</b> landed {c.rank && <span style={{ fontSize: 11, fontWeight: 800, color: c.rank === 'L1' ? '#16a34a' : TEXT.muted }}>{c.rank}</span>}</div>
                                <div style={{ fontSize: 11, color: TEXT.muted }}>rate {money(c.unit_price)}{c.discount_pct ? ` −${c.discount_pct}%` : ''} · GST {c.gst_rate ?? 0}%{c.delivery_days != null ? ` · ${c.delivery_days} d` : ''}</div>
                                {c.is_awarded && <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>awarded</div>}
                              </>
                            ) : <span style={{ color: TEXT.muted }}>not quoted</span>}
                          </td>
                        ))}
                        <td style={{ ...td, minWidth: 220 }}>
                          <select value={picks[l.pr_item_id] || ''} disabled={!canAward} onChange={(e) => setPicks((s) => ({ ...s, [l.pr_item_id]: e.target.value }))} style={{ ...inputStyle, padding: '6px 8px' }}>
                            <option value="">—</option>
                            {l.quotes.map((c, i) => c && c.eligible && <option key={i} value={c.vendor_quotation_item_id}>{cmp.vendors[i].vendor_name} ({c.rank})</option>)}
                          </select>
                          {notL1 ? <input value={reasons[l.pr_item_id] || ''} onChange={(e) => setReasons((s) => ({ ...s, [l.pr_item_id]: e.target.value }))} placeholder="Why not L1? *" style={{ ...inputStyle, padding: '6px 8px', marginTop: 6 }} /> : null}
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total landed (excl. GST)</td>
                    {cmp.vendors.map((v) => <td key={v.vendor_quotation_id} style={{ ...td, fontWeight: 700 }}>{money(v.landed_total)}{!v.complete && <div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{v.lines_quoted}/{cmp.lines.length} lines</div>}</td>)}
                    <td style={td} />
                  </tr>
                </tbody>
              </table>
            </div>
            {canAward && cmp.lines.length > 0 && <button type="button" disabled={busy} style={{ ...primaryBtnStyle, marginTop: 12, opacity: busy ? 0.6 : 1 }} onClick={saveAwards}>Save awards</button>}
          </div>

          <div style={card}>
            <h2 style={h2}>3. Send to Purchase Orders</h2>
            {awardedLines === 0 ? (
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Award the lines (L1 is pre-selected) and save — then send them to Purchase Orders.</p>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
                  <b style={{ color: TEXT.heading }}>{awardedLines} line(s) awarded.</b> Awarded lines go to Purchase Orders › Create PO, where the PO for each vendor is created, priced and sent for approval.
                </p>
                {awardsUnsaved && <p style={{ fontSize: 12.5, color: '#b45309', margin: '0 0 10px' }}>You have changed the award picks — click Save awards first, so the saved awards are what goes to Purchase Orders.</p>}
                {canCreatePo
                  ? <button type="button" data-tour="rfq-cmp-send-to-po" disabled={awardsUnsaved || busy} style={{ ...primaryBtnStyle, opacity: awardsUnsaved || busy ? 0.6 : 1 }}
                      onClick={() => router.push('/dashboard/p2p/purchase-orders?view=create')}>Send to Purchase Orders →</button>
                  : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>The purchase team creates the PO(s) in Purchase Orders › Create PO — opening it needs Create access on Procurement › Purchase Orders.</p>}
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

type QLine = { unit_price: string; discount_pct: string; gst_rate: string; delivery_days: string; make_offered: string }

function QuoteDialog({ rfq, pr, quote, presetVendorId, onClose, onSaved }: {
  rfq: RFQ; pr: P2PRequest; quote: LineQuotation | null; presetVendorId?: string; onClose: () => void
  /** warning = the quote saved but the vendor's file didn't upload. */
  onSaved: (warning?: string) => void
}) {
  const buyLines = (pr.items || []).filter((i) => i.fulfillment_status !== 'stock_issued')
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
      gst_rate: q?.gst_rate != null ? String(q.gst_rate) : '18', delivery_days: q?.delivery_days != null ? String(q.delivery_days) : '', make_offered: q?.make_offered || '' }]
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
    const items = buyLines.filter((i) => Number(lines[i.id]?.unit_price) > 0).map((i) => ({
      pr_item_id: i.id, unit_price: Number(lines[i.id].unit_price),
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
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>{['Item', 'Qty', 'Unit price', 'Disc. %', 'GST %', 'Delivery (days)', 'Make offered'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
              <tbody>
                {buyLines.map((i) => (
                  <tr key={i.id}>
                    <td style={td}>{i.item_code ? `${i.item_code} · ` : ''}{i.item_name}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{i.quantity - (i.issued_qty || 0)} {i.unit || ''}</td>
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
          <p style={sheetHint}>Prices excl. GST. Landed cost on the comparison adds freight and packing, spread over the quoted lines.</p>
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
