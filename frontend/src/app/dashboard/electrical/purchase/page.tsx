'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalBomItem, ElectricalMeta } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import {
  inputStyle, thStyle, tdStyle, linkStyle, Pill, ErrorBanner, PROCUREMENT_LABELS, PROCUREMENT_HEX,
} from '@/components/electrical/shared'

// '' = the API default: every line still open (To Buy / PR Raised / Ordered).
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Still open (To Buy / PR Raised / Ordered)' },
  { value: 'required', label: 'To Buy' },
  { value: 'pr_raised', label: 'PR Raised' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'in_stock', label: 'In Stock' },
  { value: 'received', label: 'Received' },
  { value: 'issued', label: 'Issued' },
]

const chipStyle = (hex: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'baseline', gap: 8, padding: '8px 14px', borderRadius: 12,
  background: `${hex}14`, border: `1px solid ${hex}33`, color: hex,
})

const COLS = ['Job', 'Line #', 'Category', 'Description', 'Qty', 'Rating', 'Procurement', 'PR', '']

export default function ElectricalPurchaseRequirementsPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  const [rows, setRows] = useState<ElectricalBomItem[]>([])
  const [meta, setMeta] = useState<ElectricalMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    electricalApi.getMeta().then(setMeta).catch(() => setMeta(null))
  }, [isAuthorized])

  // Debounce the free-text search so each keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (status) params.procurement_status = status
    if (category) params.category = category
    if (search) params.search = search
    electricalApi.listPurchaseRequirements(params)
      .then((d) => { setRows(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the electrical purchase requirements. Refresh the page to try again.")))
      .finally(() => setLoading(false))
  }, [isAuthorized, status, category, search])

  const categoryLabel = (k: string) => meta?.component_categories?.[k] || k.replace(/_/g, ' ')
  const toBuy = rows.filter((r) => r.procurement_status === 'required').length
  const jobCount = new Set(rows.map((r) => r.job_id)).size
  const go = (r: ElectricalBomItem) => router.push(`/dashboard/electrical/jobs/${r.job_id}?tab=bom`)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Requirements</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            BOM lines that still need buying across every RRV job — the Purchase Requirement stage.
          </p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...inputStyle, width: 'auto', flex: '1 1 240px', minWidth: 200, maxWidth: 360 }}
          placeholder="Search description, make, part no. or job…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 280px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s.value || 'open'} value={s.value}>{s.label}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 200px' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(meta?.component_categories || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {!loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={chipStyle(toBuy ? '#DC2626' : '#16A34A')}>
            <strong style={{ fontSize: 18 }}>{toBuy}</strong>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{toBuy === 1 ? 'line' : 'lines'} to buy</span>
          </span>
          <span style={chipStyle('#2563EB')}>
            <strong style={{ fontSize: 18 }}>{rows.length}</strong>
            <span style={{ fontSize: 12, fontWeight: 600 }}>shown across {jobCount} {jobCount === 1 ? 'job' : 'jobs'}</span>
          </span>
          <span style={{ fontSize: 12.5, color: TEXT.muted }}>
            Raise the PR in Procurement from the job&apos;s BOM tab, then link it to the line.
          </span>
        </div>
      )}

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>{COLS.map((h, i) => <th key={`${h}-${i}`} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                  {!status && !category && !search
                    ? 'Nothing left to buy — every BOM line on open jobs is in stock, received or issued.'
                    : 'No BOM lines match these filters.'}
                </td>
              </tr>
            ) : rows.map((r) => (
              <tr key={r.id} onClick={() => go(r)} style={{ cursor: 'pointer' }}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.job_number || '—'}</div>
                  {r.job_title && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.job_title}</div>}
                </td>
                <td style={tdStyle}>{r.line_no}</td>
                <td style={tdStyle}>{categoryLabel(r.category)}</td>
                <td style={{ ...tdStyle, maxWidth: 340 }}>
                  {r.description}
                  {(r.make || r.part_number) && (
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[r.make, r.part_number].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.quantity} {r.uom}</td>
                <td style={tdStyle}>{r.rating || '—'}</td>
                <td style={tdStyle}><Pill value={r.procurement_status} labels={PROCUREMENT_LABELS} hex={PROCUREMENT_HEX} /></td>
                <td style={tdStyle}>
                  {r.p2p_number ? (
                    <>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.p2p_number}</div>
                      {r.p2p_status && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.p2p_status.replace(/_/g, ' ')}</div>}
                    </>
                  ) : '—'}
                </td>
                <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                  <span onClick={() => go(r)} style={linkStyle}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
