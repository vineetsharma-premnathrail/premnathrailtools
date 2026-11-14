'use client'

import FilterMenu from '@/components/shared/FilterMenu'
import { RowCount, inputStyle as sharedInputStyle } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { REVISION_STATUS_LABEL, type RndRequirementRow } from '@/types/rndIntake'
import { priorityLabel } from '@/lib/priority'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND, CONTROL } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import type { RndRequest } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleRequirements } from '@/lib/rndPreviewSamples'

// Nothing picked = both. Clicking the picked one again clears it.
const SOURCE_RADIOS = [
  { value: 'inquiry', label: 'Inquiries only' },
  { value: 'tender', label: 'Tenders only' },
]

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
// Header text wraps instead of being cut with "…" by TableFit.
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'normal', textOverflow: 'clip', verticalAlign: 'bottom' }
// Customer and Product wrap onto two lines (then "…") instead of being cut to one line by TableFit.
const WRAP_MIN_PX: Record<string, number> = { Customer: 150, 'Product / Tender': 170 }
// Short status words in the list — the row's colour strip already carries the state.
const SHORT_STATUS: Record<string, string> = {
  submitted: 'Awaiting review', accepted: 'Accepted', returned: 'Returned', responded: 'Responded', closed: 'Closed', superseded: 'Superseded',
}
// R&D Response in a few words, its text coloured by how it stands
// (the row background is kept for priority: Urgent = light red).
const RED = '#b91c1c', ORANGE = '#c2410c', GREEN = '#15803d', BLUE = '#1d4ed8', PURPLE = '#6d28d9', GREY = '#78716c'
const dayNo = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / 86400000)
const todayNo = () => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) }
function shortResponse(q: RndRequest): { text: string; color: string } {
  if (q.status === 'superseded') return { text: 'Re-sent', color: GREY }
  if (q.status === 'closed') return { text: 'Closed', color: GREY }
  if (q.status === 'withdrawn') return { text: 'Taken back', color: GREY }
  // Returned to BD: the work is with BD (fix and re-send), so no R&D due date runs.
  if (q.status === 'returned') return { text: 'With BD', color: GREY }
  if (q.status === 'responded') {
    const late = q.responded_at ? dayNo(q.responded_at) - dayNo(q.due_date) : 0
    return late > 0 ? { text: `Done · ${late}d late`, color: ORANGE } : { text: 'Done on time', color: GREEN }
  }
  if (q.queries && q.queries.length > 0) return { text: 'Query raised', color: PURPLE }
  const left = dayNo(q.due_date) - todayNo()
  if (left < 0) return { text: `${-left}d late`, color: RED }
  if (left === 0) return { text: 'Due today', color: ORANGE }
  return { text: `${left}d left`, color: left <= 2 ? ORANGE : BLUE }
}
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

const COLUMNS = ['R&D ID', 'Rev', 'Status', 'Source', 'Customer', 'Product / Tender', 'R&D Response', 'BD Owner', 'Last Received']
// Columns a role may hide (Role editor > R&D > Requirements > Visibility). R&D ID and Status always show.
const HIDEABLE: Record<string, string> = {
  Rev: 'revision', Source: 'source', Customer: 'customer', 'Product / Tender': 'product',
  'R&D Response': 'rnd_response', 'BD Owner': 'bd_owner', 'Last Received': 'last_received',
}

// Inbox of CRM requirements sent to R&D via "Send Technical Requirement to R&D": every one has an R&D ID
// (RDR-YYYY-NNNN), a revision per send, and a review state — R&D accepts it.
// Needs-my-review first, then R&D ID ascending (the server sorts the same way).
function sortRows(list: RndRequirementRow[]): RndRequirementRow[] {
  return [...list].sort((a, b) => Number(b.needs_my_review) - Number(a.needs_my_review) || (a.rd_number || '~').localeCompare(b.rd_number || '~', undefined, { numeric: true }))
}

export default function RndRequirementsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()
  const vis = useVisibility('rnd:requirements')

  const [rows, setRows] = useState<RndRequirementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  // '' = everyone's · 'review' = waiting for my accept / return · 'respond' = accepted, waiting for my response
  const [mine, setMine] = useState<'' | 'review' | 'respond'>('')

  useEffect(() => {
    if (!isAuthorized) return
    // Role editor preview: made-up rows, nothing is loaded.
    if (vis.preview) { setRows(sampleRequirements); setLoading(false); return }
    const t = setTimeout(() => {
      rndApi.listRequirements({ search: search.trim() || undefined, source: source || undefined, mine: mine === 'respond' ? true : undefined, needs_my_review: mine === 'review' ? true : undefined })
        .then((data) => { setRows(sortRows(data)); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load requirements sent from CRM.')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, search, source, mine, vis.preview])

  if (isLoading || !isAuthorized) return null
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const columns = COLUMNS.filter((h) => !HIDEABLE[h] || vis.preview || vis.showColumn('requirements', HIDEABLE[h]))

  const pendingResend = rows.filter((r) => r.edited_after_send).length
  const toReview = rows.filter((r) => r.needs_my_review).length
  const awaitingMe = rows.filter((r) => r.status === 'accepted' && r.rnd_request?.status === 'open' && (r.rnd_request.assigned_to_id == null ? r.can_respond : r.rnd_request.assigned_to_id === user?.id))
  const overdueMine = awaitingMe.filter((r) => r.rnd_request?.is_late).length

  return (
    <div>
      {!vis.preview && <RndNav />}

      <div data-tour="rnd-req-header" style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Requirements</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          Customer requirements sent from CRM, each with an R&amp;D ID and revisions — open one and accept it.
          {toReview > 0 && <> <strong style={{ color: '#2563EB' }}>{toReview}</strong> waiting for your review.</>}
          {awaitingMe.length > 0 && <> <strong style={{ color: '#2563EB' }}>{awaitingMe.length}</strong> awaiting your response{overdueMine > 0 && <> (<strong style={{ color: '#DC2626' }}>{overdueMine} overdue</strong>)</>}.</>}
          {pendingResend > 0 && <> <strong style={{ color: '#EA580C' }}>{pendingResend}</strong> edited in CRM since last sent.</>}
        </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          data-tour="rnd-req-search"
          style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200 }}
          placeholder="Search by R&D ID, inquiry/tender ID, product or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div data-tour="rnd-req-source" role="radiogroup" aria-label="Source" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {SOURCE_RADIOS.map((o) => {
            const on = source === o.value
            return (
              <label key={o.value} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: CONTROL.height, boxSizing: 'border-box', padding: '0 12px',
                borderRadius: 999, fontSize: CONTROL.fontSize, fontWeight: 600, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                border: `1.5px solid ${on ? BRAND.primaryHover : BORDER.normal}`, background: on ? BRAND.primarySoft : 'rgba(255,255,255,.7)', color: on ? BRAND.primaryActive : TEXT.body,
              }}>
                <input type="radio" name="rnd-req-source" value={o.value} checked={on} onChange={() => setSource(o.value)} onClick={() => { if (on) setSource('') }}
                  style={{ margin: 0, accentColor: BRAND.primaryHover, cursor: 'inherit' }} />
                {o.label}
              </label>
            )
          })}
        </div>
        <FilterMenu
          tourId="rnd-req-filter-btn"
          fields={[{ key: 'mine', label: 'Assigned', value: mine, allLabel: "Everyone's", options: [{ value: 'review', label: 'Waiting for my review' }, { value: 'respond', label: 'Awaiting my response' }] }]}
          onChange={(_k, v) => setMine(v as '' | 'review' | 'respond')}
          onClear={() => setMine('')}
        />
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-req-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
          <thead>
            <tr>
              {columns.map((h, hi) => HIDEABLE[h]
                ? <VisTh key={h} vis={vis} table="requirements" k={HIDEABLE[h]} style={thStyle}
                    {...(WRAP_MIN_PX[h] ? { 'data-fit-min': WRAP_MIN_PX[h], 'data-fit-cut': '' } : {})}>{h}</VisTh>
                : <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || source || mine ? 'No requirements match your filters.' : 'No requirements yet — they arrive here when the business team sends a Technical Offer Request from CRM.'}
              </td></tr>
            ) : (
              rows.map((r) => {
                const href = recordPath(`/dashboard/rnd/requirements/${r.source}`, r, 'record_id')
                // Left colour strip = where the requirement stands (R&D response state,
                // else the review status): red overdue, green responded, blue on track, grey closed.
                // Urgent requirements are tinted red across the whole row; Standard rows stay plain.
                const urgent = priorityLabel(r.priority) === 'Urgent'
                return (
                  <tr key={`${r.source}-${r.record_id}`} onClick={vis.preview ? undefined : () => router.push(href)} style={{ cursor: 'pointer', background: urgent ? 'rgba(220,38,38,0.06)' : undefined }}>
                    <td style={{ ...cellStyle, fontWeight: 700, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                      {r.rd_number || '—'}
                      {r.needs_my_review && (
                        <span title="Waiting for you to accept it" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }}>
                          Review
                        </span>
                      )}
                    </td>
                    <VisTd vis={vis} table="requirements" k="revision" style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      {r.revision_code ? `R${r.revision_code.split('-R').pop()}` : '—'}
                    </VisTd>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.status ? SHORT_STATUS[r.status] || REVISION_STATUS_LABEL[r.status] : '—'}</td>
                    <VisTd vis={vis} table="requirements" k="source" style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{r.source === 'inquiry' ? 'Inquiry' : 'Tender'}</span><br />
                      {r.universal_id}
                    </VisTd>
                    <VisTd vis={vis} table="requirements" k="customer" style={{ ...cellStyle, whiteSpace: 'normal' }} data-fit-clamp="" title={r.org_name || undefined}><div>{r.org_name || '—'}</div></VisTd>
                    <VisTd vis={vis} table="requirements" k="product" style={{ ...cellStyle, whiteSpace: 'normal' }} data-fit-clamp=""
                      title={[r.product, r.category].filter(Boolean).join(' — ') || undefined}>
                      <div>{r.product || '—'}</div>
                      {r.category && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.category}</div>}
                    </VisTd>
                    <VisTd vis={vis} table="requirements" k="rnd_response" style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      {r.rnd_request ? (
                        <>
                          {(() => { const st = shortResponse(r.rnd_request); return <div style={{ fontWeight: 600, color: st.color }}>{st.text}</div> })()}
                          <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>
                            {r.rnd_request.assigned_to_id == null ? 'Team' : r.rnd_request.assigned_to_id === user?.id ? 'You' : (r.rnd_request.assigned_to || '').split(' ')[0]} · {shortDate(r.rnd_request.due_date)}
                          </div>
                        </>
                      ) : <span style={{ fontSize: 12, color: TEXT.muted }}>Not assigned</span>}
                    </VisTd>
                    <VisTd vis={vis} table="requirements" k="bd_owner" style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.bd_owner || '—'}</VisTd>
                    <VisTd vis={vis} table="requirements" k="last_received" style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      {formatDateTime(r.last_received_at || r.last_sent_at)}
                      {r.last_sent_by && <div style={{ fontSize: 11.5, color: TEXT.muted }}>by {r.last_sent_by}</div>}
                    </VisTd>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
