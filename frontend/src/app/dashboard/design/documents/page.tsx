'use client'

import { primaryBtnStyle, chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { useDesignMe } from '@/components/design/useDesignMe'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', approved: 'Approved · awaiting customer', released: 'Released', revising: 'Released · Revising',
  obsolete: 'Obsolete', customer_rejected: 'Customer rejected',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891B2', released: '#16A34A', revising: '#0f766e', obsolete: '#DC2626',
  customer_rejected: '#B91C1C',
}
const OPEN_REV_LABELS: Record<string, string> = { draft: 'draft', in_review: 'in review', in_approval: 'in approval', approved: 'awaiting customer' }

const STATUS_TABS = [
  { key: 'draft,in_review,in_approval,approved,released,revising,customer_rejected', label: 'Active' },
  { key: 'released,revising', label: 'Released' },
  { key: 'in_review,in_approval', label: 'In Workflow' },
  { key: 'in_review', label: 'In Review' },
  { key: 'in_approval', label: 'In Approval' },
  { key: 'approved', label: 'Awaiting Customer' },
  { key: 'customer_rejected', label: 'Customer Rejected' },
  { key: 'draft', label: 'Draft' },
  { key: 'obsolete', label: 'Obsolete' },
  { key: '', label: 'All' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function DesignDocumentsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const searchParams = useSearchParams()
  const me = useDesignMe(isAuthorized)

  const initialStatus = searchParams.get('status')
  const [docs, setDocs] = useState<DesignDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState(initialStatus ?? STATUS_TABS[0].key)
  const [docType, setDocType] = useState('')
  const [discipline, setDiscipline] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (docType) params.document_type = docType
    if (discipline) params.discipline = discipline
    if (search.trim()) params.search = search.trim()
    const handle = setTimeout(() => {
      setLoading(true)
      designApi.listDocuments(params)
        .then((data) => { setDocs(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load design documents.')))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, statusTab, docType, discipline, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Document Register</h1>
        </div>
        {me && me.role !== 'viewer' && (
          <button
            data-tour="design-docs-new-btn"
            onClick={() => router.push('/dashboard/design/documents/new')}
            style={primaryBtnStyle}
          >
            + New Document
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div data-tour="design-docs-status-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => {
          const active = statusTab === t.key
          return (
            <button key={t.label} type="button" onClick={() => setStatusTab(t.key)} style={chipBtnStyle(active)}>
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="design-docs-search" style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200, maxWidth: 420 }} placeholder="Search by number, legacy number, title or description…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select data-tour="design-docs-type-filter" style={{ ...inputStyle, flex: '0 1 180px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="design-docs-discipline-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
          <option value="">All disciplines</option>
          {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <span style={{ fontSize: 12, color: TEXT.muted }}>{loading ? '' : `${docs.length} document${docs.length === 1 ? '' : 's'}`}</span>
      </div>

      <div data-tour="design-docs-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1260 }}>
          <thead>
            <tr>
              {['Doc Number', 'Title', 'Type', 'Discipline', 'Customer', 'Controlled Rev', 'Work in Progress', 'Owner', 'Status', ''].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={docs.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                No documents match these filters.{statusTab !== '' ? ' Try the “All” tab.' : ' Use + New Document to create one.'}
              </td></tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} onClick={() => router.push(recordPath('/dashboard/design/documents', d))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                    {d.doc_number}
                    {d.legacy_number && <div style={{ fontSize: 11.5, fontWeight: 400, color: TEXT.muted }}>old: {d.legacy_number}</div>}
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 320 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                    {(d.pm_project_label || d.erp_project_label) && (
                      <div style={{ fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.pm_project_label || d.erp_project_label}</div>
                    )}
                  </td>
                  <td style={cellStyle}>{DOC_TYPE_LABELS[d.document_type] || d.document_type}</td>
                  <td style={cellStyle}>{DISCIPLINE_LABELS[d.discipline] || d.discipline}</td>
                  <td style={{ ...cellStyle, maxWidth: 200 }}>
                    {d.customer_name ? (
                      <>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.customer_name}</div>
                        {d.customer_approval_required && <div style={{ fontSize: 11.5, color: TEXT.muted }}>approval required</div>}
                      </>
                    ) : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={cellStyle}>
                    {d.released_revision_label ? (
                      <><strong>{d.released_revision_label}</strong> <span style={{ color: TEXT.muted, fontSize: 12 }}>· {formatDate(d.released_at)}</span></>
                    ) : <span style={{ color: TEXT.muted }}>Not released</span>}
                  </td>
                  <td style={cellStyle}>
                    {d.open_revision_label ? (
                      <span>{d.open_revision_label} {OPEN_REV_LABELS[d.open_revision_status || ''] || ''}
                        {d.pending_with_name && <span style={{ color: TEXT.muted, fontSize: 12 }}> · with {d.pending_with_name}</span>}
                      </span>
                    ) : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={cellStyle}>{d.owner_name || '—'}</td>
                  <td style={cellStyle}>
                    <span style={pillStyle(STATUS_HEX[d.display_status])}>
                      {STATUS_LABELS[d.display_status] || d.display_status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(recordPath('/dashboard/design/documents', d))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
