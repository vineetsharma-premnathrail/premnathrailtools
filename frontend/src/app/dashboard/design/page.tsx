'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi, p2pApi } from '@/lib/api'
import { EngineeringDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, BRAND } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import Checkbox from '@/components/Checkbox'

const DISCIPLINES = [
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'fluids', label: 'Fluids' },
  { value: 'rnd', label: 'R&D' },
]
const DOCUMENT_TYPES = [
  'ga_drawing', 'part_drawing', 'bom', 'ecn', 'spec_sheet',
  'wiring_diagram', 'panel_layout', 'cable_schedule',
  'circuit_diagram', 'datasheet', 'test_certificate', 'report',
]
const STATUS_HEX: Record<string, string> = {
  draft: '#94a3b8', under_review: '#f59e0b', approved: '#3b82f6', released: '#22c55e', superseded: '#78716c',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function DesignDocumentsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const [docs, setDocs] = useState<EngineeringDocument[]>([])
  const [projects, setProjects] = useState<{ id: number; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [disciplineFilter, setDisciplineFilter] = useState('')
  const [latestOnly, setLatestOnly] = useState(true)

  const [showUpload, setShowUpload] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [discipline, setDiscipline] = useState('mechanical')
  const [documentType, setDocumentType] = useState('ga_drawing')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setDocs(await designApi.listDocuments({ discipline: disciplineFilter || undefined, latest_only: latestOnly }))
    } catch {
      setError('Failed to load documents.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, disciplineFilter, latestOnly])

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.listProjects().then(setProjects).catch(() => {})
  }, [isAuthorized])

  const handleUpload = async () => {
    setError('')
    if (!projectId || !title.trim() || !file) { setError('Project, title, and file are required.'); return }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('project_id', projectId)
      form.append('discipline', discipline)
      form.append('document_type', documentType)
      form.append('title', title.trim())
      form.append('file', file)
      await designApi.upload(form)
      setShowUpload(false)
      setTitle(''); setFile(null)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to upload document.')
    } finally {
      setUploading(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Design Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Engineering Documents</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{docs.length} document(s)</p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          {showUpload ? 'Close' : '+ Upload Document'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {showUpload && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Upload Document</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Project *</label>
              <SearchableSelect
                value={projectId}
                onChange={setProjectId}
                options={projects.map((p) => ({ value: String(p.id), label: p.label }))}
                placeholder="Search project…"
              />
            </div>
            <div>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Base Frame GA" />
            </div>
            <div>
              <label style={labelStyle}>Discipline</label>
              <select style={inputStyle} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Document Type</label>
              <select style={inputStyle} value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>File *</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />
            </div>
          </div>
          <button disabled={uploading} onClick={handleUpload} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: uploading ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, maxWidth: 220 }} value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)}>
          <option value="">All Disciplines</option>
          {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary }}>
          <Checkbox checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
          Latest revision only
        </span>
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Title', 'Project', 'Discipline', 'Type', 'Version', 'Status', 'Uploaded By', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && docs.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No documents yet.</td></tr>
            )}
            {docs.map((doc) => (
              <tr key={doc.id} onClick={() => router.push(`/dashboard/design/${doc.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{doc.title}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{doc.project_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{doc.discipline}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{doc.document_type.replace(/_/g, ' ')}</td>
                <td style={{ padding: '12px 16px', fontSize: 13 }}>v{doc.version}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[doc.status]}1a`, color: STATUS_HEX[doc.status], whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                    {doc.status.replace('_', ' ')}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{doc.uploaded_by_name || '—'}</td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/design/${doc.id}`)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
