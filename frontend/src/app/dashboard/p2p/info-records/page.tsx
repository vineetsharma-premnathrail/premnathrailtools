'use client'

// Item Rates (SAP ME11 info records / ME01 source list / ME1P price history).
// Lookup first: search an Item Master item and see every vendor who quoted or
// supplied it — last PO rate, last quoted rate, rate contract, lead time,
// approved source — built from POs and quotations, nothing typed in first.
// Rate contracts and the approved-vendor list are the only manual entries,
// kept behind buttons. Old catalog lines typed by name are linked here once.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { storeApi, vendorsApi } from '@/lib/api'
import { InfoRecord, ItemOverview, ItemVendorRow, infoRecordsApi } from '@/lib/mmPurchasingApi'
import { StoreItem } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, RowCount, StatChip, Pill as SharedPill } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }
const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
const td: React.CSSProperties = { padding: '10px 8px', fontSize: 13, borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'middle', whiteSpace: 'nowrap' }
// One-row text longer than 25 characters is cut with "…" (full text in the title).
const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
const mutedInline: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted, marginLeft: 6 }
const sub: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted, marginTop: 2 }
const linkStyle: React.CSSProperties = { color: '#c2410c', fontWeight: 600, cursor: 'pointer', fontSize: 12.5 }
const GREEN = '#15803d'
const money = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
const ddmmyyyy = (d: string | null | undefined) => (d ? formatDate(d.slice(0, 10)) : '')
const qty = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const VENDOR_STATUS_LABEL: Record<string, string> = { inactive: 'Inactive', blocked: 'Blocked', pending: 'Pending approval', draft: 'Draft' }
const numTh: React.CSSProperties = { ...th, textAlign: 'right' }
const numTd: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const SOURCE_LABEL: Record<string, string> = { contract: 'rate contract', quote: 'quotation', last_po: 'last PO' }
type Opt = { value: string; label: string }
type ContractForm = { id?: number; vendor_id: string; unit_price: string; lead_time_days: string; min_order_qty: string; valid_from: string; valid_to: string }
const EMPTY_CONTRACT: ContractForm = { vendor_id: '', unit_price: '', lead_time_days: '', min_order_qty: '', valid_from: '', valid_to: '' }

/** Shared status pill, spaced from the text before it. */
function Pill({ text, hex }: { text: string; hex: string }) {
  return <span style={{ display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}><SharedPill label={text} hex={hex} /></span>
}

export default function ItemRatesPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const { can, canFeature } = useCan()
  // Vendors › Info records & source list (role editor); the Purchase desk without
  // Vendors › View reads them as a lookup and isn't governed by it.
  const seeInfoRecords = !can('p2p', 'vendors', 'view') || canFeature('p2p', 'vendors', 'info_records', 'view')
  const canEdit = can('p2p', 'vendors', 'edit') && canFeature('p2p', 'vendors', 'info_records', 'edit')
  const [items, setItems] = useState<StoreItem[]>([])
  const [vendors, setVendors] = useState<Opt[]>([])
  const [itemId, setItemId] = useState('')
  const [ov, setOv] = useState<ItemOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [unlinked, setUnlinked] = useState<InfoRecord[]>([])
  const [showUnlinked, setShowUnlinked] = useState(false)
  const [linkPick, setLinkPick] = useState<Record<number, string>>({})
  const [showHistory, setShowHistory] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [contract, setContract] = useState<ContractForm | null>(null)
  const [contractErr, setContractErr] = useState<string[]>([])
  const [showSources, setShowSources] = useState(false)
  const [src, setSrc] = useState({ vendor_id: '', valid_from: '', valid_to: '', is_fixed: false })
  const [removeSource, setRemoveSource] = useState<ItemVendorRow | null>(null)
  const [endContract, setEndContract] = useState<ItemVendorRow | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems({ status: 'active' }).then(setItems).catch(() => setItems([]))
    vendorsApi.list({ status: 'active' }).then((vs) => setVendors(vs.map((v) => ({ value: String(v.id), label: v.name })))).catch(() => setVendors([]))
    if (seeInfoRecords) infoRecordsApi.list({ unlinked: true, limit: 2000 }).then(setUnlinked).catch(() => setUnlinked([]))
  }, [isAuthorized, seeInfoRecords])

  const loadItem = useCallback(async () => {
    if (!itemId) return
    try {
      setOv(await infoRecordsApi.itemOverview(Number(itemId)))
      setError('')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the rates of this item.').join(' '))
    } finally {
      setLoading(false)
    }
  }, [itemId])
  useEffect(() => { Promise.resolve().then(loadItem) }, [loadItem])

  const itemOptions = useMemo(() => items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` })), [items])
  // Lowest last-PO and lowest valid quote get the green highlight.
  const lowest = useMemo(() => {
    const po = (ov?.vendors || []).map((v) => v.last_po?.unit_price).filter((x): x is number => x != null)
    const q = (ov?.vendors || []).filter((v) => v.last_quote?.valid_today).map((v) => v.last_quote?.net_price).filter((x): x is number => x != null)
    return { po: po.length ? Math.min(...po) : null, quote: q.length ? Math.min(...q) : null }
  }, [ov])

  if (isLoading || !isAuthorized) return null

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true); setError('')
    try { await fn(); await loadItem() } catch (err) { setError(extractErrorMessages(err, fallback).join(' ')) } finally { setBusy(false) }
  }
  const num = (v: string) => (v === '' ? null : Number(v))

  const openContract = (v?: ItemVendorRow) => {
    setContractErr([])
    const c = v?.contract
    setContract(c
      ? { id: c.id, vendor_id: String(v.vendor_id), unit_price: c.unit_price != null ? String(c.unit_price) : '', lead_time_days: c.lead_time_days != null ? String(c.lead_time_days) : '',
          min_order_qty: c.min_order_qty != null ? String(c.min_order_qty) : '', valid_from: c.valid_from || '', valid_to: c.valid_to || '' }
      // No contract yet: a vendor already bought from has an info record that
      // only mirrors the last PO — setting a rate edits that one.
      : { ...EMPTY_CONTRACT, id: v?.record_id ?? undefined, vendor_id: v?.vendor_id ? String(v.vendor_id) : '',
          unit_price: v?.current_rate != null ? String(v.current_rate) : '', lead_time_days: v?.lead_time_days != null ? String(v.lead_time_days) : '' })
  }
  const saveContract = async () => {
    if (!contract) return
    const problems: string[] = []
    if (!contract.vendor_id) problems.push('Pick the vendor.')
    if (!(Number(contract.unit_price) > 0)) problems.push('Enter the agreed rate.')
    if (problems.length) { setContractErr(problems); return }
    const payload = { unit_price: num(contract.unit_price), lead_time_days: num(contract.lead_time_days), min_order_qty: num(contract.min_order_qty),
      valid_from: contract.valid_from || null, valid_to: contract.valid_to || null }
    setBusy(true); setContractErr([])
    try {
      if (contract.id) await infoRecordsApi.update(contract.id, payload)
      else await infoRecordsApi.create({ ...payload, vendor_id: Number(contract.vendor_id), store_item_id: Number(itemId) })
      setContract(null)
      await loadItem()
    } catch (err) {
      setContractErr(extractErrorMessages(err, 'Could not save the rate contract.'))
    } finally {
      setBusy(false)
    }
  }

  const sources = (ov?.vendors || []).filter((v) => v.source)
  const s = ov?.summary

  return (
    <div>
      <P2PNav />
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Item Rates</h1>
        {itemId && ov && s && (
          <div data-tour="p2p-rates-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <StatChip label="Vendors" value={s.vendor_count} color="#3b82f6" />
            <StatChip label="Rate contracts" value={ov.vendors.filter((v) => v.contract).length} color="#ea580c" />
            <StatChip label="Approved vendors" value={sources.length} color="#16a34a" />
            <StatChip label="PO lines" value={ov.history.length} color="#ca8a04" />
          </div>
        )}
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {canEdit && itemId && ov && (
          <button type="button" data-tour="p2p-rates-add-btn" onClick={() => openContract()}
            style={{ ...primaryBtnStyle, fontSize: 13.5, fontWeight: 600, padding: '10px 14px', borderRadius: 10, background: '#ea580c', border: '1px solid #c2410c', color: '#fff', whiteSpace: 'nowrap' }}>
            + Rate contract
          </button>
        )}
        {canEdit && itemId && ov && (
          <button type="button" data-tour="p2p-rates-sources-btn" onClick={() => setShowSources(true)} style={secondaryBtnStyle}>Approved vendors ({sources.length})</button>
        )}
        <div data-tour="p2p-rates-item" style={{ marginLeft: 'auto', width: 420, maxWidth: '100%' }}>
          <SearchableSelect autoFocus ariaLabel="Item" value={itemId} onChange={(v) => { setOv(null); setLoading(!!v); setItemId(v) }} placeholder="Search item code / name…" options={itemOptions} />
        </div>
      </div>

      {!itemId && (
        <div style={{ ...card, textAlign: 'center', padding: '44px 20px' }}>
          <div aria-hidden style={{ width: 52, height: 52, margin: '0 auto 12px', borderRadius: 14, background: 'rgba(255,122,69,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SheetIcon name="search" size={26} color="#FF7A45" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading }}>Pick an item above to see suppliers, rates and the last price paid</div>
          <p style={{ fontSize: 13, color: '#5b6472', margin: '6px auto 0', maxWidth: 520 }}>
            {items.length ? `${items.length.toLocaleString('en-IN')} active items to choose from. ` : ''}Rates fill in automatically from approved POs and vendor quotations.
          </p>
        </div>
      )}

      {itemId && loading && !ov && <div style={{ ...card, color: TEXT.muted, fontSize: 13 }}>Loading…</div>}

      {itemId && ov && s && (
        <>
          <div data-tour="p2p-rates-summary" style={{ fontSize: 12.5, color: TEXT.muted, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
            <span><b style={{ color: TEXT.body }}>Last bought at</b> {s.last_po ? `${money(s.last_po.unit_price)} · ${s.last_po.vendor_name} · ${ddmmyyyy(s.last_po.po_date)} · ${s.last_po.po_number}` : 'never on an approved PO'}</span>
            <span><b style={{ color: TEXT.body }}>Best rate today</b> {s.best_current ? `${money(s.best_current.rate)} · ${s.best_current.vendor_name} · from ${SOURCE_LABEL[s.best_current.source]}` : 'no rate yet'}</span>
            {s.lowest_po_price != null && <span><b style={{ color: TEXT.body }}>PO rate range</b> {money(s.lowest_po_price)} – {money(s.highest_po_price)}{s.avg_po_price != null ? ` (average ${money(s.avg_po_price)})` : ''}</span>}
            <span>{s.has_source_list ? 'Approved-vendor list is ON' : 'Any vendor can be ordered from'}</span>
          </div>

          <div style={card}>
            <div style={{ marginBottom: 12 }}>
              <h2 style={h2}>Who supplies {ov.item_code} — {ov.item_name}</h2>
              <div style={sub}>Cheapest current rate first. Green = lowest PO rate / lowest valid quote.</div>
            </div>
            <div style={{ overflow: 'auto', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
              <table data-tour="p2p-rates-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Vendor', 'Rate today', 'Last PO', 'Last quotation', 'Rate contract', 'Lead time', ''].map((h, i) => <th key={h || 'actions'} data-fit-min={60} data-fit-cut={i === 0 ? '' : undefined} style={th}>{h}{i === 0 && <RowCount count={ov.vendors.length} />}</th>)}</tr></thead>
                <tbody>
                  {ov.vendors.length === 0 && (
                    <tr><td colSpan={7} style={{ ...td, color: TEXT.muted, padding: 20 }}>
                      No vendor has quoted or supplied this item yet. Rates appear here automatically once a vendor quotation is recorded on an RFQ
                      or a PO for this item is approved. Have an agreed rate already? Add it with <b>+ Rate contract</b>.
                    </td></tr>
                  )}
                  {ov.vendors.map((v) => {
                    const blocked = !!v.source?.is_blocked
                    return (
                      <tr key={`${v.vendor_id}-${v.vendor_name}`} style={{ opacity: blocked ? 0.55 : 1 }}>
                        <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>
                          <span title={`${v.vendor_name || ''}${v.po_count > 0 ? ` — ${v.po_count} approved PO${v.po_count > 1 ? 's' : ''}` : ''}`}>{clip(v.vendor_name)}</span>
                          {v.source?.is_fixed && <Pill text="Preferred" hex={GREEN} />}
                          {v.source && !v.source.is_fixed && !blocked && <Pill text="Approved" hex="#0891b2" />}
                          {blocked && <Pill text="Blocked" hex="#b91c1c" />}
                          {v.vendor_status && v.vendor_status !== 'active' && <Pill text={VENDOR_STATUS_LABEL[v.vendor_status] || v.vendor_status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} hex="#b45309" />}
                        </td>
                        <td style={td}>
                          <b>{money(v.current_rate)}</b>
                          {v.current_rate_source && <span style={mutedInline}>from {SOURCE_LABEL[v.current_rate_source]}</span>}
                        </td>
                        <td style={td}>
                          {v.last_po ? (
                            <>
                              <span style={{ fontWeight: 600, color: v.last_po.unit_price === lowest.po ? GREEN : TEXT.body }}>{money(v.last_po.unit_price)}</span>
                              <span style={mutedInline}>{ddmmyyyy(v.last_po.po_date)} · {v.last_po.po_number} · {qty(v.last_po.quantity)} {v.last_po.unit || ''}</span>
                            </>
                          ) : <span style={{ color: TEXT.muted }}>Never bought</span>}
                        </td>
                        <td style={td}>
                          {v.last_quote ? (
                            <>
                              <span title={v.last_quote.discount_pct ? `${money(v.last_quote.unit_price)} − ${v.last_quote.discount_pct}%` : undefined} style={{ fontWeight: 600, color: v.last_quote.valid_today && v.last_quote.net_price === lowest.quote ? GREEN : TEXT.body }}>{money(v.last_quote.net_price)}</span>
                              {v.last_quote.is_awarded && <Pill text="Awarded" hex={GREEN} />}
                              <span style={mutedInline}>
                                {v.last_quote.rfq_number}{v.last_quote.quote_date ? ` · ${ddmmyyyy(v.last_quote.quote_date)}` : ''}
                                {!v.last_quote.valid_today && <span style={{ color: '#b45309' }}> · expired {ddmmyyyy(v.last_quote.valid_until)}</span>}
                              </span>
                            </>
                          ) : <span style={{ color: TEXT.muted }}>No quote</span>}
                        </td>
                        <td style={td}>
                          {v.contract ? (
                            <>
                              <span style={{ fontWeight: 600 }}>{money(v.contract.unit_price)}</span>
                              {!v.contract.valid_today && <Pill text="Not valid today" hex="#b45309" />}
                              <span style={mutedInline}>
                                {v.contract.valid_from || v.contract.valid_to ? `${ddmmyyyy(v.contract.valid_from) || '…'} to ${ddmmyyyy(v.contract.valid_to) || '…'}` : 'No end date'}
                                {v.contract.min_order_qty ? ` · Min. order ${qty(v.contract.min_order_qty)}` : ''}
                              </span>
                            </>
                          ) : <span style={{ color: TEXT.muted }}>—</span>}
                        </td>
                        <td style={td}>{v.lead_time_days != null ? `${v.lead_time_days} days` : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canEdit && v.vendor_id && (
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              <button type="button" onClick={() => openContract(v)} style={smallSecondaryBtnStyle}>{v.contract ? 'Edit contract' : 'Fix rate'}</button>
                              {v.contract && <button type="button" onClick={() => setEndContract(v)} style={smallSecondaryBtnStyle}>End</button>}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={h2}>Purchase history ({ov.history.length} approved PO line{ov.history.length === 1 ? '' : 's'})</h2>
              {ov.history.length > 0 && <span onClick={() => setShowHistory((x) => !x)} style={linkStyle}>{showHistory ? 'Hide' : 'Show'}</span>}
            </div>
            {ov.history.length === 0 && <p style={{ ...sub, fontSize: 12.5, margin: '8px 0 0' }}>No approved PO for this item yet — each approved PO line for it will be listed here.</p>}
            {showHistory && ov.history.length > 0 && (
              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)', border: `1px solid ${BORDER.normal}`, borderRadius: 10, marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['PO Date', 'PO No.', 'Vendor', 'Qty', 'Rate', 'GST %', 'PR No.'].map((h, i) => <th key={h} data-fit-min={60} data-fit-cut={h === 'Vendor' ? '' : undefined} style={i >= 3 && i <= 5 ? numTh : th}>{h}{i === 0 && <RowCount count={ov.history.length} />}</th>)}</tr></thead>
                  <tbody>
                    {ov.history.map((r, i) => (
                      <tr key={`${r.po_id}-${i}`}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{ddmmyyyy(r.po_date) || '—'}</td>
                        <td style={td}>{r.po_number}{r.amendment_no ? ` (A${r.amendment_no})` : ''}</td>
                        <td style={td}><span title={r.vendor_name ?? undefined}>{clip(r.vendor_name)}</span></td>
                        <td style={numTd}>{qty(r.quantity)} {r.unit || ''}</td>
                        <td style={{ ...numTd, fontWeight: 600 }}>{money(r.unit_price)}</td>
                        <td style={numTd}>{r.tax_rate ?? '—'}</td>
                        <td style={td}>{r.p2p_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {unlinked.length > 0 && canEdit && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h2 style={h2}>Old vendor catalog lines to link ({unlinked.length})</h2>
              <div style={sub}>Typed by name before the Item Master — link each once to its item so its rate shows here. A link can&apos;t be changed later.</div>
            </div>
            <span onClick={() => setShowUnlinked((x) => !x)} style={linkStyle}>{showUnlinked ? 'Hide' : 'Show'}</span>
          </div>
          {showUnlinked && (
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)', border: `1px solid ${BORDER.normal}`, borderRadius: 10, marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Vendor', 'Catalog Item', 'Part Code', 'Price', 'Item Master Item', ''].map((h, i) => <th key={h || 'actions'} data-fit-min={60} data-fit-cut={i <= 1 ? '' : undefined} style={i === 3 ? numTh : th}>{h}{i === 0 && <RowCount count={unlinked.length} />}</th>)}</tr></thead>
                <tbody>
                  {unlinked.map((r) => (
                    <tr key={r.id}>
                      <td style={td}><span title={r.vendor_name ?? undefined}>{clip(r.vendor_name)}</span></td>
                      <td style={td}><span title={r.item_name}>{clip(r.item_name)}</span></td>
                      <td style={td}>{r.part_code || '—'}</td>
                      <td style={numTd}>{money(r.unit_price)}</td>
                      <td style={{ ...td, minWidth: 260 }}>
                        <SearchableSelect value={linkPick[r.id] || ''} onChange={(v) => setLinkPick((x) => ({ ...x, [r.id]: v }))} placeholder="Pick the item…" options={itemOptions} />
                      </td>
                      <td style={td}>
                        <button type="button" disabled={busy || !linkPick[r.id]} style={{ ...smallSecondaryBtnStyle, opacity: busy || !linkPick[r.id] ? 0.6 : 1 }} onClick={() => run(async () => {
                          await infoRecordsApi.link(r.id, Number(linkPick[r.id]))
                          setUnlinked((x) => x.filter((y) => y.id !== r.id))
                        }, 'Could not link the catalog line.')}>Link</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {contract && (
        <FormSheet width={580} icon="rupee" title={contract.id ? 'Edit rate contract' : 'Rate contract'}
          subtitle={`An agreed rate with a vendor (e.g. a yearly rate contract) for ${ov?.item_code || 'this item'}.`}
          onClose={() => { if (!busy) setContract(null) }} busy={busy}
          footer={<>
            <button type="button" onClick={() => setContract(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={saveContract} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {contractErr.length > 0 && <div style={errBox}>{contractErr.map((e, i) => <div key={i}>{e}</div>)}</div>}
            <SheetSection icon="building" title="Vendor">
              <label style={sheetLabel}>Vendor <Req /></label>
              {contract.id
                ? <div style={{ fontSize: 13.5, fontWeight: 600, color: SHEET.INK }}>{vendors.find((x) => x.value === contract.vendor_id)?.label || ov?.vendors.find((x) => String(x.vendor_id) === contract.vendor_id)?.vendor_name}</div>
                : <SearchableSelect value={contract.vendor_id} onChange={(v) => setContract((c) => c && { ...c, vendor_id: v })} options={vendors} placeholder="Vendor…" />}
            </SheetSection>
            <SheetSection icon="rupee" title="Rate & Terms">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 150px' }}><label style={sheetLabel}>Rate (₹) <Req /></label><input type="number" min="0" step="any" value={contract.unit_price} onChange={(e) => setContract((c) => c && { ...c, unit_price: e.target.value })} style={sheetInput} /></div>
                <div style={{ flex: '0 1 120px' }}><label style={sheetLabel}>Lead days</label><input type="number" min="0" value={contract.lead_time_days} onChange={(e) => setContract((c) => c && { ...c, lead_time_days: e.target.value })} style={sheetInput} /></div>
                <div style={{ flex: '0 1 110px' }}><label style={sheetLabel}>MOQ</label><input type="number" min="0" step="any" value={contract.min_order_qty} onChange={(e) => setContract((c) => c && { ...c, min_order_qty: e.target.value })} style={sheetInput} /></div>
              </div>
            </SheetSection>
            <SheetSection icon="calendar" title="Validity">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 160px' }}><label style={sheetLabel}>Valid from</label><DateField value={contract.valid_from} onChange={(v) => setContract((c) => c && { ...c, valid_from: v })} /></div>
                <div style={{ flex: '1 1 160px' }}><label style={sheetLabel}>Valid to</label><DateField value={contract.valid_to} onChange={(v) => setContract((c) => c && { ...c, valid_to: v })} /></div>
              </div>
              <p style={sheetHint}>While valid, POs to this vendor for {ov?.item_code} take this rate. Leave the dates empty for no end date.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {showSources && ov && (
        <FormSheet width={760} icon="shield" title={`Approved vendors — ${ov.item_code}`}
          subtitle="Optional. Once a vendor is listed, POs for this item can only go to a listed, unblocked vendor. Empty list = any vendor."
          onClose={() => { if (!busy) setShowSources(false) }} busy={busy}
          footer={<button type="button" onClick={() => setShowSources(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>}>
          <div style={{ padding: '20px 24px' }}>
            {error && <div style={errBox}>{error}</div>}
            <SheetSection icon="list" title="Approved list">
              <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr>{['Vendor', 'Valid', 'Preferred', 'Blocked', ''].map((h, i) => <th key={h} style={{ ...th, position: 'static', background: SHEET.SOFT }}>{h}{i === 0 && <RowCount count={sources.length} />}</th>)}</tr></thead>
                  <tbody>
                    {sources.length === 0 && <tr><td colSpan={5} style={{ ...td, color: TEXT.muted }}>No list — any vendor can be ordered from.</td></tr>}
                    {sources.map((v) => v.source && (
                      <tr key={v.source.id}>
                        <td style={td}>{v.vendor_name}{!v.source.valid_today && !v.source.is_blocked && <Pill text="Not valid today" hex="#b45309" />}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.source.valid_from || v.source.valid_to ? `${ddmmyyyy(v.source.valid_from) || '…'} to ${ddmmyyyy(v.source.valid_to) || '…'}` : 'No end date'}</td>
                        <td style={td}><input type="checkbox" checked={v.source.is_fixed} disabled={busy} onChange={(ev) => run(() => infoRecordsApi.updateSource(v.source!.id, { is_fixed: ev.target.checked }), 'Could not update the vendor.')} /></td>
                        <td style={td}><input type="checkbox" checked={v.source.is_blocked} disabled={busy} onChange={(ev) => run(() => infoRecordsApi.updateSource(v.source!.id, { is_blocked: ev.target.checked }), 'Could not update the vendor.')} /></td>
                        <td style={td}>{can('p2p', 'vendors', 'delete') && canFeature('p2p', 'vendors', 'info_records', 'delete') && <span style={{ ...linkStyle, color: '#b91c1c' }} onClick={() => setRemoveSource(v)}>Remove</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={sheetHint}>Preferred = first choice; Blocked = no new POs. Use it for critical items (e.g. RDSO-approved parts).</p>
            </SheetSection>
            <SheetSection icon="plus" title="Add vendor">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px', maxWidth: 280 }}><label style={sheetLabel}>Vendor <Req /></label><SearchableSelect value={src.vendor_id} onChange={(v) => setSrc((x) => ({ ...x, vendor_id: v }))} options={vendors} placeholder="Vendor…" /></div>
                <div style={{ flex: '0 1 150px' }}><label style={sheetLabel}>Valid from</label><DateField value={src.valid_from} onChange={(v) => setSrc((x) => ({ ...x, valid_from: v }))} /></div>
                <div style={{ flex: '0 1 150px' }}><label style={sheetLabel}>Valid to</label><DateField value={src.valid_to} onChange={(v) => setSrc((x) => ({ ...x, valid_to: v }))} /></div>
                <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 10, color: SHEET.BODY }}><input type="checkbox" checked={src.is_fixed} onChange={(e) => setSrc((x) => ({ ...x, is_fixed: e.target.checked }))} /> Preferred</label>
                <button type="button" disabled={busy || !src.vendor_id} style={sheetBtn('primary', SHEET.BLUE, busy || !src.vendor_id)} onClick={() => run(async () => {
                  await infoRecordsApi.addSource({ store_item_id: Number(itemId), vendor_id: Number(src.vendor_id), valid_from: src.valid_from || null, valid_to: src.valid_to || null, is_fixed: src.is_fixed })
                  setSrc({ vendor_id: '', valid_from: '', valid_to: '', is_fixed: false })
                }, 'Could not add the vendor to the approved list.')}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Add'}</button>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog open={!!removeSource} title="Remove from approved vendors?"
        message={`${removeSource?.vendor_name || ''} will no longer be an approved vendor for this item.`}
        onConfirm={() => { const v = removeSource; setRemoveSource(null); if (v?.source) run(() => infoRecordsApi.deleteSource(v.source!.id), 'Could not remove the vendor.') }}
        onCancel={() => setRemoveSource(null)} />
      <ConfirmDialog open={!!endContract} title="End this rate contract?"
        message={`POs to ${endContract?.vendor_name || ''} will stop taking the contract rate ${money(endContract?.contract?.unit_price)}; the last PO rate is proposed instead. Past POs are not changed.`}
        onConfirm={() => { const v = endContract; setEndContract(null); if (v?.contract) run(() => infoRecordsApi.update(v.contract!.id, { is_active: false }), 'Could not end the rate contract.') }}
        onCancel={() => setEndContract(null)} />
    </div>
  )
}
