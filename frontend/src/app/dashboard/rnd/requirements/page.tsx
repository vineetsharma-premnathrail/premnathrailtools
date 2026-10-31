'use client'

import Select from '@/components/shared/Select'
import { RowCount, inputStyle as sharedInputStyle, Pill } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { REVISION_STATUS_HEX, REVISION_STATUS_LABEL, type RndRequirementRow } from '@/types/rndIntake'
import { priorityLabel, priorityTone } from '@/lib/priority'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND, CONTROL } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import { rndRequestBadge } from '@/components/crm/RndRequestBlock'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'

// Nothing picked = both. Clicking the picked one again clears it.
const SOURCE_RADIOS = [
  { value: 'inquiry', label: 'Inquiries only' },
  { value: 'tender', label: 'Tenders only' },
]

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

// Inbox of CRM requirements sent to R&D via "Send Technical Requirement to R&D": every one has an R&D ID
// (RDR-YYYY-NNNN), a revision per send, and a review state — R&D accepts it.
// Needs-my-review first, then R&D ID ascending (the server sorts the same way).
function sortRows(list: RndRequirementRow[]): RndRequirementRow[] {
  return [...list].sort((a, b) => Number(b.needs_my_review) - Number(a.needs_my_review) || (a.rd_number || '~').localeCompare(b.rd_number || '~', undefined, { numeric: true }))
}

export default function RndRequirementsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()

  const [rows, setRows] = useState<RndRequirementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  // '' = everyone's · 'review' = waiting for my accept / return · 'respond' = accepted, waiting for my response
  const [mine, setMine] = useState<'' | 'review' | 'respond'>('')

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      rndApi.listRequirements({ search: search.trim() || undefined, source: source || undefined, mine: mine === 'respond' ? true : undefined, needs_my_review: mine === 'review' ? true : undefined })
        .then((data) => { setRows(sortRows(data)); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load requirements sent from CRM.')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, search, source, mine])

  if (isLoading || !isAuthorized) return null

  const pendingResend = rows.filter((r) => r.edited_after_send).length
  const toReview = rows.filter((r) => r.needs_my_review).length
  const awaitingMe = rows.filter((r) => r.status === 'accepted' && r.rnd_request?.status === 'open' && (r.rnd_request.assigned_to_id == null ? r.can_respond : r.rnd_request.assigned_to_id === user?.id))
  const overdueMine = awaitingMe.filter((r) => r.rnd_request?.is_late).length

  return (
    <div>
      <RndNav />

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
        <Select data-tour="rnd-req-mine" style={{ ...inputStyle, flex: '0 1 200px' }} value={mine} onChange={(e) => setMine(e.target.value as '' | 'review' | 'respond')}>
          <option value="">Everyone&apos;s</option>
          <option value="review">Waiting for my review</option>
          <option value="respond">Awaiting my response</option>
        </Select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-req-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
          <thead>
            <tr>
              {['R&D ID', 'Revision', 'Status', 'Source', 'Customer', 'Product / Tender', 'Priority', 'R&D Response', 'BD Owner', 'Last Received'].map((h, hi) => (
                // Header text wraps instead of being cut with "…" by TableFit.
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'normal', textOverflow: 'clip', verticalAlign: 'bottom' }}>
                  {h}{hi === 0 && <RowCount count={rows.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || source || mine ? 'No requirements match your filters.' : 'No requirements yet — they arrive here when the business team sends a Technical Offer Request from CRM.'}
              </td></tr>
            ) : (
              rows.map((r) => {
                const href = recordPath(`/dashboard/rnd/requirements/${r.source}`, r, 'record_id')
                return (
                  <tr key={`${r.source}-${r.record_id}`} onClick={() => router.push(href)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 700, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                      {r.rd_number || '—'}
                      {r.needs_my_review && (
                        <span title="Waiting for you to accept it" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }}>
                          Review
                        </span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      {r.revision_code ? `R${r.revision_code.split('-R').pop()}` : '—'}
                      {r.edited_after_send && (
                        <span title="The requirement was edited in CRM after it was last sent to R&D — expect a re-send." style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(180,83,9,0.12)', color: '#B45309' }}>
                          Edited
                        </span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.status ? <Pill label={REVISION_STATUS_LABEL[r.status]} hex={REVISION_STATUS_HEX[r.status]} /> : '—'}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{r.source === 'inquiry' ? 'Inquiry' : 'Tender'}</span><br />
                      {r.universal_id}
                    </td>
                    <td style={cellStyle}>{r.org_name || '—'}</td>
                    <td style={cellStyle}>
                      {r.product || '—'}
                      {r.category && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.category}</div>}
                    </td>
                    <td style={cellStyle}>
                      {r.priority ? (
                        <Pill label={priorityLabel(r.priority)} hex={priorityTone(r.priority).color} />
                      ) : '—'}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      {r.rnd_request ? (() => {
                        const b = rndRequestBadge(r.rnd_request)
                        return (
                          <>
                            <Pill label={b.label} hex={b.hex} />
                            <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>
                              {r.rnd_request.assigned_to_id == null ? 'R&D team' : r.rnd_request.assigned_to_id === user?.id ? 'You' : r.rnd_request.assigned_to} · due {formatDate(r.rnd_request.due_date)}
                            </div>
                          </>
                        )
                      })() : <span style={{ fontSize: 12, color: TEXT.muted }}>Not assigned</span>}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.bd_owner || '—'}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      {formatDateTime(r.last_received_at || r.last_sent_at)}
                      {r.last_sent_by && <div style={{ fontSize: 11.5, color: TEXT.muted }}>by {r.last_sent_by}</div>}
                    </td>
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
