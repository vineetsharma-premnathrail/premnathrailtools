'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', released: 'Released', revising: 'Released · Revising', obsolete: 'Obsolete',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', released: '#16A34A', revising: '#0f766e', obsolete: '#DC2626',
}
const OPEN_REV_LABELS: Record<string, string> = { draft: 'draft', in_review: 'in review', in_approval: 'in approval' }

const STATUS_TABS = [
  { key: 'draft,in_review,in_approval,released,revising', label: 'Active' },
  { key: 'released,revising', label: 'Released' },
  { key: 'in_review,in_approval', label: 'In Workflow' },
  { key: 'in_review', label: 'In Review' },
  { key: 'in_approval', label: 'In Approval' },
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
        <button
          onClick={() => router.push('/dashboard/design/documents/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + New Document
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => {
          const active = statusTab === t.key
          return (
            <button key={t.label} type="button" onClick={() => setStatusTab(t.key)} style={{
              padding: '6px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? '#FF6A2A' : BORDER.normal}`, background: active ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,.6)',
              color: active ? '#FF6A2A' : TEXT.secondary,
            }}>
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200, maxWidth: 420 }} placeholder="Search by document number, title or description…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 180px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
          <option value="">All disciplines</option>
          {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={{ fontSize: 12, color: TEXT.muted }}>{loading ? '' : `${docs.length} document${docs.length === 1 ? '' : 's'}`}</span>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
          <thead>
            <tr>
              {['Doc Number', 'Title', 'Type', 'Discipline', 'Controlled Rev', 'Work in Progress', 'Owner', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                No documents match these filters.{statusTab !== '' && ' Try the “All” tab.'}
              </td></tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} onClick={() => router.push(`/dashboard/design/documents/${d.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{d.doc_number}</td>
                  <td style={{ ...cellStyle, maxWidth: 320 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                    {(d.pm_project_label || d.erp_project_label) && (
                      <div style={{ fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.pm_project_label || d.erp_project_label}</div>
                    )}
                  </td>
                  <td style={cellStyle}>{DOC_TYPE_LABELS[d.document_type] || d.document_type}</td>
                  <td style={cellStyle}>{DISCIPLINE_LABELS[d.discipline] || d.discipline}</td>
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
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[d.display_status]}1a`, color: STATUS_HEX[d.display_status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[d.display_status] || d.display_status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/design/documents/${d.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
