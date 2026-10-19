'use client'

// Design / Electrical / Hydraulic & Pneumatic › Requirements: the customer
// requirements the R&D head shared with this department for a feasibility
// reply. One component for all three departments; each page passes its Nav.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deptRequirementsApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { DeptRequirementRow, RndShareDepartment } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { Chip, shareBadge } from '@/components/rnd/RequirementDepartmentsTab'

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const headStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, textAlign: 'left' }

const FILTERS = [
  { key: 'open', label: 'Awaiting reply' },
  { key: 'responded', label: 'Replied' },
  { key: 'all', label: 'All' },
] as const

export default function DeptRequirementsList({ department, departmentLabel, moduleLabel }: { department: RndShareDepartment; departmentLabel: string; moduleLabel: string }) {
  const router = useRouter()
  const [rows, setRows] = useState<DeptRequirementRow[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('open')
  const [search, setSearch] = useState('')

  useEffect(() => {
    deptRequirementsApi.list(department)
      .then((d) => { setRows(d); setError('') })
      .catch((err) => { setRows([]); setError(extractErrorMessages(err, 'Could not load the requirements R&D shared with you.')) })
  }, [department])

  const all = rows || []
  const q = search.trim().toLowerCase()
  const shown = all.filter((r) =>
    (filter === 'all' || r.status === filter) &&
    (!q || [r.offer_number, r.universal_id, r.title, r.org_name, r.note].some((v) => (v || '').toLowerCase().includes(q))),
  )
  const open = all.filter((r) => r.status === 'open')
  const overdue = open.filter((r) => r.is_overdue).length

  return (
    <div>
      <div data-tour={`${department}-req-header`} style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>{moduleLabel}</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Requirements</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          Customer requirements the R&amp;D head shared with {departmentLabel} for your feasibility reply.
          {open.length > 0 && <> <strong style={{ color: '#2563EB' }}>{open.length}</strong> awaiting reply{overdue > 0 && <> (<strong style={{ color: '#DC2626' }}>{overdue} overdue</strong>)</>}.</>}
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input style={{ ...inputStyle, flex: '1 1 260px', maxWidth: 380 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search offer no., customer, product…" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} style={{
                padding: '6px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                color: active ? '#fff' : '#78716c', background: active ? '#FF7A45' : 'rgba(255,255,255,.55)',
                border: `1px solid ${active ? '#FF7A45' : 'rgba(0,0,0,0.08)'}`,
              }}>
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflowX: 'auto' }}>
        {rows === null ? (
          <p style={{ fontSize: 13, color: TEXT.muted, padding: 20, margin: 0 }}>Loading…</p>
        ) : shown.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, padding: 20, margin: 0 }}>
            {all.length === 0 ? `R&D hasn't shared any requirement with ${departmentLabel} yet.` : 'Nothing matches — clear the search or pick another filter.'}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={headStyle}>Requirement</th>
                <th style={headStyle}>Customer</th>
                <th style={headStyle}>R&amp;D asks</th>
                <th style={headStyle}>Reply by</th>
                <th style={headStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => router.push(recordPath(`/dashboard/${department}/requirements`, r))} style={{ cursor: 'pointer' }}>
                  <td style={cellStyle}>
                    <span style={{ fontWeight: 600, color: '#FF7A45' }}>{r.offer_number || r.universal_id}</span>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>{r.title}</p>
                  </td>
                  <td style={cellStyle}>{r.org_name || '—'}</td>
                  <td style={{ ...cellStyle, maxWidth: 320 }}>
                    <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.note}</span>
                    <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '2px 0 0' }}>{r.shared_by}, {formatDateTime(r.shared_at)}</p>
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap', color: r.is_overdue ? '#DC2626' : TEXT.body }}>{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td style={cellStyle}><Chip {...shareBadge(r)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
