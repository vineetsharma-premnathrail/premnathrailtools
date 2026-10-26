'use client'

// "Create PO" view of Purchase Orders: requisitions whose RFQ is done, waiting
// for their PO — or with a PO still in draft. Old RFQs: the L1 vendor is chosen
// (CreatePODialog). Emailed RFQs: lines awarded on the quote comparison — one
// PO per awarded vendor (SplitPoDialog); still-quoting emailed RFQs are hidden.

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

const READY = new Set(['vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted'])
const th = PO_TH
const isInvite = (r: RFQ) => (r.invite_count || 0) > 0
const td = PO_TD
const NO_FILTERS = { stage: 'all', source: 'all' }

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
      .then((list: RFQ[]) => { if (!cancelled) setRfqs(list.filter((r) => r.status === 'locked' && READY.has(r.p2p_status || '') && (!isInvite(r) || (r.awarded_line_count || 0) > 0))) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the requisitions ready for a PO — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const vendorOf = (r: RFQ) => (isInvite(r) || (r.awarded_line_count || 0) > 0 ? (r.awarded_vendors || []).join(', ') : r.attachments.find((a) => a.vendor_tier === 'L1')?.vendor_name) || ''
  const q = search.trim().toLowerCase()
  const shown = rfqs.filter((r) =>
    (!q || [r.p2p_number, r.rfq_number, vendorOf(r)].some((x) => (x || '').toLowerCase().includes(q)))
    && (filters.stage === 'all' || (filters.stage === 'drafted') === (r.p2p_status === 'po_drafted'))
    && (filters.source === 'all' || (filters.source === 'awarded') === (isInvite(r) || (r.awarded_line_count || 0) > 0)))
  const activeFilterCount = [filters.stage, filters.source].filter((v) => v !== 'all').length
  const openFilters = () => { setDraft(filters); setShowFilters(true) }
  const applyFilters = () => { setFilters(draft); setShowFilters(false) }
  const clearFilters = () => { setFilters(NO_FILTERS); setDraft(NO_FILTERS); setShowFilters(false) }
  const draftedCount = shown.filter((r) => r.p2p_status === 'po_drafted').length

  return (
    <div>
      <div data-tour="po-ready-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <StatChip label="Waiting for a PO" value={shown.length} color="#3b82f6" />
        <StatChip label="Ready for PO" value={shown.length - draftedCount} color="#ea580c" />
        <StatChip label="Draft PO started" value={draftedCount} color="#ca8a04" />
        <StatChip label="Awarded on comparison" value={shown.filter((r) => isInvite(r) || (r.awarded_line_count || 0) > 0).length} color="#16a34a" />
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
            <label style={sheetLabel}>Stage</label>
            <Select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))} style={sheetInput} data-tour="po-ready-stage-filter">
              <option value="all">All Stages</option>
              <option value="ready">Ready for PO</option>
              <option value="drafted">Draft PO started</option>
            </Select>
          </div>
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
          <thead><tr>{['PR No.', 'RFQ No.', 'Lowest-price vendor', 'Other quotes received', 'Stage', ''].map((h, i) => <th key={h} data-fit-min={60} data-fit-cut={h === 'Lowest-price vendor' || h === 'Other quotes received' ? '' : undefined} style={th}>{h}{i === 0 && <RowCount count={shown.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rfqs.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Nothing is waiting for a PO. A purchase request appears here once its quotation request is closed with a vendor chosen, or its lines are awarded on the quote comparison.</td></tr>}
            {!loading && rfqs.length > 0 && shown.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>No requisition matches the search and filters — change or clear them.</td></tr>}
            {shown.map((r) => {
              // Awarded on the comparison (emailed RFQs, or an old RFQ awarded there) → one PO per awarded vendor.
              const invite = isInvite(r) || (r.awarded_line_count || 0) > 0
              const l1 = r.attachments.find((a) => a.vendor_tier === 'L1')
              const vendorCell = invite ? (r.awarded_vendors || []).join(', ') : l1?.vendor_name
              const others = invite ? (r.other_quoted_vendors || [])
                : [...new Set(r.attachments.filter((a) => a.vendor_tier !== 'L1' && a.vendor_name).map((a) => `${a.vendor_tier} ${a.vendor_name}`))]
              const drafted = r.p2p_status === 'po_drafted'
              const open = () => {
                if (drafted) router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', undefined, 'rfq'))
                else if (invite) setSplitFor(r)
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
                      <Pill label={drafted ? 'Draft PO started' : 'Ready for PO'} hex={drafted ? '#b45309' : '#2563eb'} />
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={open} style={{ ...smallSecondaryBtnStyle, whiteSpace: 'nowrap' }}>
                      {drafted ? 'Continue PO' : 'Create PO'}
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
