'use client'

import Select from '@/components/shared/Select'
import { RowCount, inputStyle as sharedInputStyle, Pill } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { RndRequirement, RndTask } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import { rndRequestBadge } from '@/components/crm/RndRequestBlock'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'

const PRIORITY_HEX: Record<string, string> = { Urgent: '#DC2626', High: '#EA580C', Medium: '#2563EB', Low: '#78716c' }

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

// Inbox of CRM requirements sent to R&D via "Send Technical Requirement to R&D".
export default function RndRequirementsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()

  const [rows, setRows] = useState<RndRequirement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [mine, setMine] = useState(false)
  const [myTasks, setMyTasks] = useState<RndTask[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      rndApi.listRequirements({ search: search.trim() || undefined, source: source || undefined, mine: mine || undefined })
        .then((data) => { setRows(data); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load requirements sent from CRM.')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, search, source, mine])

  // Open tasks the R&D head gave me (and ones awaiting the head's check).
  useEffect(() => {
    if (!isAuthorized) return
    rndApi.myTasks().then(setMyTasks).catch(() => setMyTasks([]))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const pendingResend = rows.filter((r) => r.edited_after_send).length
  const awaitingMe = rows.filter((r) => r.rnd_request?.status === 'open' && (r.rnd_request.assigned_to_id == null ? r.can_respond : r.rnd_request.assigned_to_id === user?.id))
  const overdueMine = awaitingMe.filter((r) => r.rnd_request?.is_late).length

  return (
    <div>
      <RndNav />

      <div data-tour="rnd-req-header" style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          R&amp;D Module
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Requirements</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          Customer requirements sent from CRM as Technical Offer Requests.
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

      {myTasks.length > 0 && (
        <div data-tour="rnd-my-tasks" style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>
            My tasks ({myTasks.length})
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {myTasks.map((t) => (
              <div key={t.id} onClick={() => router.push(`${recordPath(`/dashboard/rnd/requirements/${t.source}`, t, 'record_id')}?tab=tasks`)}
                style={{ flex: '0 1 300px', minWidth: 240, cursor: 'pointer', padding: '12px 14px', borderRadius: 14, background: '#fff', border: `1px solid ${t.is_overdue ? 'rgba(220,38,38,0.35)' : 'rgba(0,0,0,0.07)'}`, boxShadow: '0 4px 14px rgba(15,23,42,0.06)' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{t.title}</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '3px 0 0' }}>{t.requirement_ref}{t.requirement_title ? ` · ${t.requirement_title}` : ''}</p>
                <p style={{ fontSize: 12, margin: '6px 0 0', color: t.is_overdue ? '#DC2626' : TEXT.body, fontWeight: t.is_overdue ? 700 : 500 }}>
                  {t.pending_approval ? 'Approval request waiting for a decision' : t.is_overdue ? `Overdue since ${formatDate(t.due_date)} — reason & new date required` : `Due ${formatDate(t.due_date)}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          data-tour="rnd-req-search"
          style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200 }}
          placeholder="Search by TOR no., inquiry/tender ID, product or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select data-tour="rnd-req-source" style={{ ...inputStyle, flex: '0 1 170px' }} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Inquiries &amp; Tenders</option>
          <option value="inquiry">Inquiries only</option>
          <option value="tender">Tenders only</option>
        </Select>
        <Select data-tour="rnd-req-mine" style={{ ...inputStyle, flex: '0 1 170px' }} value={mine ? 'mine' : ''} onChange={(e) => setMine(e.target.value === 'mine')}>
          <option value="">Everyone&apos;s</option>
          <option value="mine">Awaiting my response</option>
        </Select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-req-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1140 }}>
          <thead>
            <tr>
              {['TOR No.', 'Source', 'Customer', 'Product / Tender', 'Qty', 'Priority', 'R&D Response', 'BD Owner', 'Last Sent', 'Sends'].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
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
                const prioHex = PRIORITY_HEX[r.priority || ''] || '#78716c'
                return (
                  <tr key={`${r.source}-${r.record_id}`} onClick={() => router.push(href)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                      {r.offer_number || '—'}
                      {r.edited_after_send && (
                        <span title="The requirement was edited in CRM after it was last sent to R&D — expect a re-send." style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(180,83,9,0.12)', color: '#B45309' }}>
                          Edited
                        </span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{r.source === 'inquiry' ? 'Inquiry' : 'Tender'}</span><br />
                      {r.universal_id}
                    </td>
                    <td style={cellStyle}>{r.org_name || '—'}</td>
                    <td style={cellStyle}>
                      {r.product || '—'}
                      {r.category && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.category}</div>}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.quantity || '—'}</td>
                    <td style={cellStyle}>
                      {r.priority ? (
                        <Pill label={r.priority} hex={prioHex} />
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
                      {formatDateTime(r.last_sent_at)}
                      {r.last_sent_by && <div style={{ fontSize: 11.5, color: TEXT.muted }}>by {r.last_sent_by}</div>}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.send_count}</td>
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
