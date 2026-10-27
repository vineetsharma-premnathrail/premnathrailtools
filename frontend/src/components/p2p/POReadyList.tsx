'use client'

// "Create PO" view of Purchase Orders: only RFQs that are finished (locked) with
// vendors chosen — lines awarded on the quote comparison (one PO per awarded
// vendor, SplitPoDialog) or a vendor selected on an older RFQ (CreatePODialog).
// Requisitions still quoting or evaluating are hidden, and so is one whose draft
// PO already exists (open that draft from Tracking). Every row says "Create PO".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { rfqApi } from '@/lib/api'
import { RFQ } from '@/types'
import SplitPoDialog from '@/components/p2p/SplitPoDialog'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref } from '@/lib/recordRef'
import { RowCount, smallSecondaryBtnStyle, Pill, StatChip, inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import Select from '@/components/shared/Select'
import { sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { FiltersButton, FiltersSheet, PO_CARD, PO_TD, PO_TH, clip, clip2 } from '@/components/p2p/POTrackingShared'

const th = PO_TH
const td = PO_TD
const NO_FILTERS = { source: 'all' }
const isAwarded = (r: RFQ) => (r.awarded_line_count || 0) > 0
const isReady = (r: RFQ) => r.status === 'locked' && (isAwarded(r) || r.p2p_status === 'vendor_selected') && r.p2p_status !== 'po_drafted'

export default function POReadyList({ onCreate, lead }: { onCreate?: (rfqId: number) => void; lead?: React.ReactNode }) {
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [splitFor, setSplitFor] = useState<RFQ | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [draft, setDraft] = useState(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    let cancelled = false
    rfqApi.list({ limit: 1000 })
      .then((list: RFQ[]) => { if (!cancelled) setRfqs(list.filter(isReady)) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the requisitions ready for a PO — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const vendorOf = (r: RFQ) => (isAwarded(r) ? (r.awarded_vendors || []).join(', ') : r.attachments.find((a) => a.vendor_tier === 'L1')?.vendor_name) || ''
  const q = search.trim().toLowerCase()
  const shown = rfqs.filter((r) =>
    (!q || [r.p2p_number, r.rfq_number, vendorOf(r)].some((x) => (x || '').toLowerCase().includes(q)))
    && (filters.source === 'all' || (filters.source === 'awarded') === isAwarded(r)))
  const activeFilterCount = [filters.source].filter((v) => v !== 'all').length
  const openFilters = () => { setDraft(filters); setShowFilters(true) }
  const applyFilters = () => { setFilters(draft); setShowFilters(false) }
  const clearFilters = () => { setFilters(NO_FILTERS); setDraft(NO_FILTERS); setShowFilters(false) }

  return (
    <div>
      <div data-tour="po-ready-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <StatChip label="Ready for PO" value={shown.length} color="#ea580c" />
        <StatChip label="Awarded on comparison" value={shown.filter(isAwarded).length} color="#16a34a" />
        <StatChip label="Lowest-price vendor chosen" value={shown.filter((r) => !isAwarded(r)).length} color="#3b82f6" />
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {lead}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PR#, RFQ#, vendor..." aria-label="Search requisitions waiting for a PO" data-tour="po-ready-search"
            style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
          <FiltersButton count={activeFilterCount} onOpen={openFilters} tour="po-ready-filter-btn" />
          {activeFilterCount > 0 && <button type="button" onClick={clearFilters} style={secondaryBtnStyle} data-tour="po-ready-clear-btn">Clear</button>}
        </div>
      </div>
      {showFilters && (
        <FiltersSheet subtitle="Narrow the requisitions waiting for a PO, then press Apply." tour="po-ready-filter-sheet" applyTour="po-ready-apply-btn" onClose={() => setShowFilters(false)} onClear={clearFilters} onApply={applyFilters}>
          <div>
            <label style={sheetLabel}>Vendor chosen by</label>
            <Select value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))} style={sheetInput} data-tour="po-ready-source-filter">
              <option value="all">Any</option>
              <option value="awarded">Awarded on the quote comparison</option>
              <option value="lowest">Lowest-price vendor</option>
            </Select>
          </div>
        </FiltersSheet>
      )}
      <div data-tour="po-ready-table" style={{ ...PO_CARD, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['PR No.', 'RFQ No.', 'Vendor', 'Other quotes received', 'Stage', ''].map((h, i) => <th key={h} data-fit-min={60} data-fit-cut={h === 'Vendor' || h === 'Other quotes received' ? '' : undefined} style={th}>{h}{i === 0 && <RowCount count={shown.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rfqs.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Nothing is waiting for a PO. A purchase request appears here once its quotation request is closed and a vendor is chosen, or its lines are awarded on the quote comparison. Receipts the store took before a PO are under Before PO.</td></tr>}
            {!loading && rfqs.length > 0 && shown.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>No requisition matches the search and filters — change or clear them.</td></tr>}
            {shown.map((r) => {
              // Awarded on the comparison (emailed RFQs, or an old RFQ awarded there) → one PO per awarded vendor.
              const invite = isAwarded(r)
              const l1 = r.attachments.find((a) => a.vendor_tier === 'L1')
              const vendorCell = invite ? (r.awarded_vendors || []).join(', ') : l1?.vendor_name
              const others = invite ? (r.other_quoted_vendors || [])
                : [...new Set(r.attachments.filter((a) => a.vendor_tier !== 'L1' && a.vendor_name).map((a) => `${a.vendor_tier} ${a.vendor_name}`))]
              const open = () => {
                if (invite) setSplitFor(r)
                else if (onCreate) onCreate(r.id)
                else router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', undefined, 'rfq'))
              }
              return (
                <tr key={r.id} onClick={open} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.p2p_number || `#${r.p2p_request_id}`}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.rfq_number}</td>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }} title={vendorCell ? `${vendorCell}${invite ? ' (awarded)' : ''}` : undefined}>
                    {clip(vendorCell)}
                  </td>
                  <td data-fit-clamp style={{ ...td, fontSize: 12 }}>
                    <div title={others.join(', ') || undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip2(others.join(', '))}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                      {invite && <Pill label={`Awarded — ${r.awarded_line_count} line${r.awarded_line_count === 1 ? '' : 's'}`} hex="#15803d" />}
                      <Pill label="Ready for PO" hex="#2563eb" />
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={open} style={{ ...smallSecondaryBtnStyle, whiteSpace: 'nowrap' }}>
                      Create PO
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {splitFor && <SplitPoDialog rfq={splitFor} onClose={() => setSplitFor(null)} onDone={(poRow) => {
        const r = splitFor
        setSplitFor(null)
        router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', { po: poRow ? (poRow as { id_ref?: string }).id_ref : undefined }, 'rfq'))
      }} />}
    </div>
  )
}
