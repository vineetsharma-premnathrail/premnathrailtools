'use client'

import { useEffect, useState } from 'react'
import Select from '@/components/shared/Select'
import { FiltersButton, FiltersSheet, PO_CREATE_BTN, PO_TD, PO_TH, clip } from '@/components/p2p/POTrackingShared'
import { FormSheet, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi } from '@/lib/api'
import { P2PRequest, RFQ } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordHref, recordPath } from '@/lib/recordRef'
import { RowCount, Pill, smallSecondaryBtnStyle, inputStyle, secondaryBtnStyle, StatChip } from '@/components/shared/ui'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden', marginBottom: 20,
}
const sectionScrollStyle: React.CSSProperties = { overflow: 'auto' }
const thStyle: React.CSSProperties = PO_TH
const tdStyle: React.CSSProperties = PO_TD

const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Closed - vendor chosen' }

export default function P2PRfqPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const { can } = useCan()
  // Starting an RFQ: the Purchase desk AND 'Create' on Procurement › R.F.Q.
  const isPurchaseTeam = !!user?.apps?.includes('purchase') && can('p2p', 'rfq', 'create')

  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ status: 'all', vendors: 'all' })
  const [draft, setDraft] = useState(filters)
  const [showFilters, setShowFilters] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [pickSearch, setPickSearch] = useState('')
  const [pickCategory, setPickCategory] = useState('all')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [prData, rfqData] = await Promise.all([
        p2pApi.list({ status: 'approved', limit: 1000 }),
        rfqApi.list({ limit: 1000 }),
      ])
      setPrs(prData)
      setRfqs(rfqData)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to load RFQ data.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const rfqPrIds = new Set(rfqs.map((r) => r.p2p_request_id))
  // A PR is only ready for an RFQ once every line has been decided (nothing
  // left 'pending' — those may still be issued from store stock) and at
  // least one line was actually sent to procurement. The backend enforces
  // the same rule on RFQ creation.
  const prsAwaitingRfq = prs.filter((pr) =>
    !rfqPrIds.has(pr.id)
    && !pr.items.some((it) => it.fulfillment_status === 'pending')
    && pr.items.some((it) => it.fulfillment_status === 'sent_to_procurement')
  )
  // + New RFQ popup: the requisitions waiting for quotations, narrowed by search and Category.
  const pq = pickSearch.trim().toLowerCase()
  const categories = [...new Set(prsAwaitingRfq.map((pr) => pr.category_label || pr.category_code || '').filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const pickList = prsAwaitingRfq.filter((pr) =>
    (!pq || [pr.p2p_number, pr.category_label, pr.category_code, pr.project_label].some((x) => (x || '').toLowerCase().includes(pq)))
    && (pickCategory === 'all' || (pr.category_label || pr.category_code) === pickCategory))
  const startRfq = (pr: P2PRequest) => router.push(recordHref('/dashboard/p2p/rfq/new', pr, 'id', undefined, 'pr_id'))

  const q = search.trim().toLowerCase()
  const has = (...v: (string | null | undefined)[]) => v.some((x) => (x || '').toLowerCase().includes(q))
  const shownRfqs = rfqs.filter((r) =>
    (!q || has(r.rfq_number, r.p2p_number))
    && (filters.status === 'all' || r.status === filters.status)
    && (filters.vendors === 'all' || (filters.vendors === 'single' ? !!r.is_single_quotation : !r.is_single_quotation)))
  const activeFilterCount = [filters.status, filters.vendors].filter((v) => v !== 'all').length
  const openFilters = () => { setDraft(filters); setShowFilters(true) }
  const applyFilters = () => { setFilters(draft); setShowFilters(false) }
  const clearFilters = () => { const none = { status: 'all', vendors: 'all' }; setFilters(none); setDraft(none); setShowFilters(false) }

  return (
    <div>
      <P2PNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Quotation requests (RFQ)</h1>
      <div data-tour="rfq-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 14 }}>
        <StatChip label="RFQs" value={shownRfqs.length} color="#3b82f6" />
        <StatChip label="Single vendor" value={shownRfqs.filter((r) => r.is_single_quotation).length} color="#ea580c" />
        <StatChip label="Draft" value={shownRfqs.filter((r) => r.status === 'draft').length} color="#ca8a04" />
        <StatChip label="Closed" value={shownRfqs.filter((r) => r.status === 'locked').length} color="#16a34a" />
      </div>

      <MessageDialog open={!!error} variant="error" title="Cannot Load RFQ Data" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {isPurchaseTeam && (
          <button type="button" data-tour="rfq-new-btn" onClick={() => { setPickSearch(''); setPickCategory('all'); setShowNew(true) }} style={PO_CREATE_BTN}>+ New RFQ</button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="RFQ#, PR#..." aria-label="Search quotation requests" data-tour="rfq-search"
            style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
          <FiltersButton count={activeFilterCount} onOpen={openFilters} tour="rfq-filter-btn" />
          {activeFilterCount > 0 && <button type="button" onClick={clearFilters} style={secondaryBtnStyle} data-tour="rfq-clear-btn">Clear</button>}
        </div>
      </div>

      {showFilters && (
        <FiltersSheet subtitle="Narrow the quotation requests, then press Apply." tour="rfq-filter-sheet" applyTour="rfq-apply-btn" onClose={() => setShowFilters(false)} onClear={clearFilters} onApply={applyFilters}>
          <div>
            <label style={sheetLabel}>RFQ status (requests sent)</label>
            <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} style={sheetInput} data-tour="rfq-status-filter">
              <option value="all">All Statuses</option>
              {Object.entries(RFQ_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div>
            <label style={sheetLabel}>Vendors (requests sent)</label>
            <Select value={draft.vendors} onChange={(e) => setDraft((d) => ({ ...d, vendors: e.target.value }))} style={sheetInput} data-tour="rfq-vendors-filter">
              <option value="all">One vendor or several</option>
              <option value="single">One vendor only</option>
              <option value="multi">Several vendors</option>
            </Select>
          </div>
        </FiltersSheet>
      )}

      {showNew && (
        <FormSheet icon="search" title="New RFQ" width={560} busy={false} onClose={() => setShowNew(false)} tour="rfq-new-sheet"
          footer={<button type="button" onClick={() => setShowNew(false)} style={sheetBtn('secondary', SHEET.INK)}>Close</button>}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} placeholder="PR#, category, project..." aria-label="Search purchase requests" data-tour="rfq-new-search"
                style={{ ...sheetInput, flex: '1 1 200px', width: 'auto' }} />
              <div style={{ flex: '1 1 180px' }}>
                <Select value={pickCategory} onChange={(e) => setPickCategory(e.target.value)} style={sheetInput} data-tour="rfq-category-filter">
                  <option value="all">All Categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            </div>
            <div style={sheetLabel}>Purchase requests waiting for quotations — pick one to start its RFQ</div>
            {loading && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>}
            {!loading && prsAwaitingRfq.length === 0 && (
              <div style={{ fontSize: 13, color: '#5b6472' }}>
                <div style={{ fontWeight: 600, color: TEXT.heading, marginBottom: 4 }}>Nothing to quote right now.</div>
                <div style={{ marginBottom: 12 }}>Approved requisitions with items to buy appear here, once every line&apos;s stock decision is made and at least one line is sent to procurement.</div>
                <button type="button" onClick={() => router.push('/dashboard/p2p')} style={smallSecondaryBtnStyle}>View requisitions</button>
              </div>
            )}
            {!loading && prsAwaitingRfq.length > 0 && pickList.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No purchase request matches the search and category — change them.</p>}
            {pickList.map((pr) => (
              <button key={pr.id} type="button" onClick={() => startRfq(pr)}
                style={{ ...secondaryBtnStyle, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%', height: 'auto', padding: '10px 12px', fontWeight: 400 }}>
                <span style={{ fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{pr.p2p_number}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={[pr.category_label || pr.category_code, pr.project_label].filter(Boolean).join(' · ')}>
                  {clip([pr.category_label || pr.category_code, pr.project_label].filter(Boolean).join(' · '), 50)}
                </span>
                <span style={{ whiteSpace: 'nowrap', fontSize: 12 }}>Required {formatDate(pr.required_date)}</span>
              </button>
            ))}
          </div>
        </FormSheet>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div data-tour="rfq-list-table" style={sectionStyle}>
       <div style={sectionScrollStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['RFQ No.', 'PR No.', 'Status', 'Vendors', 'Created On'].map((h, i) => <th key={h} data-fit-min={60} style={thStyle}>{h}{i === 0 && <RowCount count={shownRfqs.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rfqs.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No quotation requests yet — press + New RFQ to start one from an approved purchase request.</td></tr>
            )}
            {!loading && rfqs.length > 0 && shownRfqs.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No quotation request matches the search and filters — change or clear them.</td></tr>
            )}
            {shownRfqs.map((rfq) => (
              <tr key={rfq.id} onClick={() => router.push(recordPath('/dashboard/p2p/rfq', rfq))} style={{ borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{rfq.rfq_number}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{rfq.p2p_number || '—'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <Pill label={RFQ_STATUS_LABELS[rfq.status] ?? rfq.status} hex={RFQ_STATUS_HEX[rfq.status] ?? '#78716c'} />
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{rfq.is_single_quotation ? 'One vendor only' : 'Several vendors'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(rfq.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
       </div>
      </div>
      </div>
    </div>
  )
}
