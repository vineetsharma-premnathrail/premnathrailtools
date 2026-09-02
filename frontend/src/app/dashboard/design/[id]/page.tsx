'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { designApi } from '@/lib/api'
import { EngineeringDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'

const STATUS_HEX: Record<string, string> = {
  draft: '#94a3b8', under_review: '#f59e0b', approved: '#3b82f6', released: '#22c55e', superseded: '#78716c',
}
const NEXT_STATUS: Record<string, string[]> = {
  draft: ['under_review'],
  under_review: ['approved', 'draft'],
  approved: ['released', 'draft'],
  released: [],
  superseded: [],
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, cursor: 'pointer',
  background: 'transparent', color: TEXT.secondary, fontSize: 12.5, fontWeight: 600,
}

export default function DesignDocumentDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const params = useParams()
  const router = useRouter()
  const docId = Number(params.id)

  const [revisions, setRevisions] = useState<EngineeringDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setRevisions(await designApi.revisionHistory(docId))
    } catch {
      setError('Document not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && docId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, docId])

  const current = revisions.find((r) => r.id === docId) || revisions[0]

  const setStatus = async (status: string) => {
    if (!current) return
    setBusy(true)
    setError('')
    try {
      await designApi.updateStatus(current.id, status)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to update status.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !current) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!current) return null

  const statusColor = STATUS_HEX[current.status] || '#64748b'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{current.title}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor, textTransform: 'capitalize' }}>
              {current.status.replace('_', ' ')}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{current.project_label || 'No project'} · v{current.version} · {current.discipline}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/dashboard/design')} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
          {(NEXT_STATUS[current.status] || []).map((s) => (
            <button key={s} disabled={busy} onClick={() => setStatus(s)} style={ghostBtn}>
              Mark {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Current File</h2>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => designApi.getDocumentBlob(current.id)) }}
          style={{ fontSize: 13.5, color: TEXT.heading, textDecoration: 'none' }}
        >
          {current.filename}
        </a>
      </div>

      <div style={{ ...sectionStyle, overflow: 'auto' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Revision History</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              {['Version', 'Status', 'Uploaded By', 'Uploaded At', 'File'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {revisions.map((rev) => (
              <tr key={rev.id} style={{ borderTop: `1px solid ${BORDER.light}`, background: rev.id === current.id ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
                <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>v{rev.version}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{rev.status.replace('_', ' ')}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{rev.uploaded_by_name || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{rev.created_at ? new Date(rev.created_at).toLocaleString() : '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => designApi.getDocumentBlob(rev.id)) }}
                    style={{ color: TEXT.heading, textDecoration: 'none' }}
                  >
                    {rev.filename}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
