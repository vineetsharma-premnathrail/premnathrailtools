'use client'

import { useCallback, useEffect, useState } from 'react'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAttachment } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { useAuth } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { DOC_TYPE_LABELS } from '@/components/maintenance/labels'

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

function formatSize(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** List / upload / open / delete files on a maintenance asset, request or
 * work order. Files live in SharePoint; bytes are always fetched through the
 * backend's /content proxy, never the raw SharePoint URL. */
export default function MaintenanceAttachments({
  entityType,
  entityId,
  canUpload = true,
  defaultDocType = 'other',
}: {
  entityType: 'asset' | 'request' | 'work_order'
  entityId: number
  canUpload?: boolean
  defaultDocType?: string
}) {
  const { user } = useAuth()
  const [items, setItems] = useState<MaintenanceAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [files, setFiles] = useState<File[]>([])
  const [docType, setDocType] = useState(defaultDocType)
  const [uploading, setUploading] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<MaintenanceAttachment | null>(null)

  const load = useCallback(() => {
    maintenanceApi.listAttachments(entityType, entityId)
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load attachments.')))
      .finally(() => setLoading(false))
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])

  const upload = async () => {
    if (!files.length) return
    setError('')
    setUploading(true)
    try {
      await maintenanceApi.uploadAttachments(entityType, entityId, files, docType)
      setFiles([])
      setInputKey((k) => k + 1)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const open = async (a: MaintenanceAttachment) => {
    setError('')
    try {
      const isInline = (a.content_type || '').startsWith('image/') || a.content_type === 'application/pdf'
      await openAttachmentBlob(() => maintenanceApi.getAttachmentContent(a.id), isInline ? undefined : a.filename)
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't open ${a.filename}.`))
    }
  }

  const confirmDelete = async () => {
    const a = pendingDelete
    setPendingDelete(null)
    if (!a) return
    setError('')
    try {
      await maintenanceApi.deleteAttachment(a.id)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't delete ${a.filename}.`))
    }
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No files attached yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${BORDER.light}`, flexWrap: 'wrap' }}>
              <span onClick={() => open(a)} style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', flex: '1 1 200px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.filename}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.secondary }}>{DOC_TYPE_LABELS[a.doc_type] || a.doc_type}</span>
              <span style={{ fontSize: 12, color: TEXT.muted }}>{formatSize(a.size)}</span>
              <span style={{ fontSize: 12, color: TEXT.muted }}>{a.created_by_name || ''} · {formatDateTime(a.created_at)}</span>
              {(user?.role === 'admin' || user?.id === a.created_by_id) && (
                <span onClick={() => setPendingDelete(a)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Delete</span>
              )}
            </div>
          ))}
        </div>
      )}

      {canUpload && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <select style={{ ...inputStyle, flex: '0 1 160px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input key={inputKey} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setFiles(Array.from(e.target.files || []))} style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 360 }} />
          <button type="button" onClick={upload} disabled={!files.length || uploading}
            style={{ ...secondaryBtnStyle, opacity: !files.length || uploading ? 0.6 : 1, cursor: !files.length || uploading ? 'not-allowed' : 'pointer' }}>
            {uploading ? 'Uploading…' : `Upload${files.length ? ` (${files.length})` : ''}`}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete attachment?"
        message={pendingDelete ? `${pendingDelete.filename} will be removed from this record.` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
