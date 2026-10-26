'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { pmOngoingApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { PmTaskActivity } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { ErrorBanner, actionBtn, inputStyle, linkBtn, usePmFeature } from './pmUi'

const heading: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }

/** Remarks and attachments on one department task — or, with `subtaskId`,
 * on one of its sub-tasks — shown when its row is opened. The server says
 * who may write (can_write); everyone else reads. `onCounts` keeps the
 * row's counters current. */
export default function TaskActivity({ taskId, subtaskId, onCounts, compact = false, show = 'both' }: {
  taskId: number
  subtaskId?: number
  onCounts?: (remarks: number, files: number) => void
  compact?: boolean
  /** Only the remarks, or only the files (the task view's Comments / Files tabs). */
  show?: 'both' | 'remarks' | 'files'
}) {
  const { user } = useAuth()
  // Task › Comments / Files features (core/features/projects.py) on top of can_write.
  const pmf = usePmFeature()
  const seeRemarks = show !== 'files' && pmf('task_comments', 'view')
  const seeFiles = show !== 'remarks' && pmf('task_files', 'view')
  const [data, setData] = useState<PmTaskActivity | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = useCallback((d: PmTaskActivity) => { setData(d); onCounts?.(d.remarks.length, d.files.length) }, [onCounts])
  useEffect(() => {
    (subtaskId ? pmOngoingApi.subActivity(subtaskId) : pmOngoingApi.activity(taskId)).then((d: PmTaskActivity) => setData(d))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the remarks and files — open it again.')))
  }, [taskId, subtaskId])

  const call = async (fn: () => Promise<PmTaskActivity>, fallback: string) => {
    setBusy(true)
    setError('')
    try { apply(await fn()); return true } catch (err) { setError(extractErrorMessages(err, fallback)); return false } finally { setBusy(false) }
  }

  const addRemark = async () => {
    if (!text.trim()) { setError('Write the remark before saving.'); return }
    const body = text.trim()
    if (await call(() => (subtaskId ? pmOngoingApi.addSubRemark(subtaskId, body) : pmOngoingApi.addRemark(taskId, body)), 'Could not save the remark.')) setText('')
  }

  const upload = async (list: FileList | null) => {
    const files = Array.from(list || [])
    if (fileRef.current) fileRef.current.value = ''
    if (!files.length) return
    await call(() => (subtaskId ? pmOngoingApi.addSubFiles(subtaskId, files) : pmOngoingApi.addFiles(taskId, files)), 'Could not attach the file(s).')
  }

  if (!data) return error ? <ErrorBanner error={error} /> : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '6px 0' }}>Loading remarks and files…</p>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: seeRemarks && seeFiles ? 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' : '1fr', gap: 16, marginTop: compact ? 4 : 10 }}>
      {seeRemarks && <div style={{ minWidth: 0 }}>
        <p style={heading}>Remarks ({data.remarks.length})</p>
        {data.remarks.length === 0 && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 8px' }}>No remarks yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, maxHeight: 260, overflowY: 'auto' }}>
          {data.remarks.map((r) => (
            <div key={r.id} style={{ padding: '7px 10px', borderRadius: 10, background: r.user_id === user?.id ? 'rgba(99,102,241,0.07)' : '#fff', border: `1px solid ${BORDER.light}` }}>
              <div style={{ fontSize: 11.5, color: TEXT.muted }}><b style={{ color: TEXT.heading }}>{r.user_id === user?.id ? 'You' : r.user_name}</b> · {r.created_at ? formatDateTime(r.created_at) : ''}</div>
              <div style={{ fontSize: 13, color: TEXT.body, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.comment}</div>
            </div>
          ))}
        </div>
        {data.can_write && pmf('task_comments', 'create') && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a remark…"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addRemark() } }}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 44, fontFamily: 'inherit' }} />
            <button type="button" disabled={busy} onClick={addRemark} style={actionBtn('primary', busy)}>Save</button>
          </div>
        )}
      </div>}

      {seeFiles && <div style={{ minWidth: 0 }}>
        <p style={heading}>Attachments ({data.files.length})</p>
        {data.files.length === 0 && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 8px' }}>No files attached.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {data.files.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              {pmf('task_files', 'export') ? <button type="button" onClick={() => openAttachmentBlob(() => pmOngoingApi.fileBlob(f.id), f.file_name).catch(() => setError(`Could not open ${f.file_name} — it may have been removed from SharePoint.`))}
                style={{ ...linkBtn('#2563eb'), padding: 0, textAlign: 'left', whiteSpace: 'normal', wordBreak: 'break-all' }}>📎 {f.file_name}</button>
                : <span style={{ color: TEXT.body, wordBreak: 'break-all' }}>📎 {f.file_name}</span>}
              <span style={{ color: TEXT.muted, whiteSpace: 'nowrap' }}>· {f.uploaded_by_name || '—'}</span>
              {data.can_write && (f.uploaded_by_id === user?.id) && pmf('task_files', 'delete') && (
                <button type="button" disabled={busy} onClick={() => call(() => pmOngoingApi.deleteFile(f.id), `Could not remove ${f.file_name}.`)} style={linkBtn('#dc2626', busy)}>Remove</button>
              )}
            </div>
          ))}
        </div>
        {data.can_write && pmf('task_files', 'create') && (
          <>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={actionBtn('secondary', busy)}>{busy ? 'Working…' : 'Attach file'}</button>
          </>
        )}
      </div>}
      {error && <div style={{ gridColumn: '1 / -1' }}><ErrorBanner error={error} /></div>}
    </div>
  )
}
