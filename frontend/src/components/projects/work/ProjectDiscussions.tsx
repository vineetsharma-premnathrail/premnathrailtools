'use client'

import Select from '@/components/shared/Select'
// The project's correspondence log for the project manager: every WBS team
// chat message, task comment and file a department sent, newest first, in
// one place — filter by department, WBS or kind. Items since your last
// visit are marked New (remembered per browser, a convenience only).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pmWorkApi, projectsApi } from '@/lib/api'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { PmCommItem, PmProjectDocument } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { DOC_TYPE_LABELS, ErrorBanner, actionBtn, inputStyle, sectionStyle } from './pmUi'
import { MentionText } from './PmChat'
import { smallSecondaryBtnStyle, pillStyle } from '@/components/shared/ui'

const KIND_LABELS: Record<PmCommItem['kind'], string> = { message: 'Milestone chat', comment: 'Task comment', file: 'File' }
const KIND_HEX: Record<PmCommItem['kind'], string> = { message: '#2563eb', comment: '#7c3aed', file: '#0f766e' }
const SOURCE_LABELS: Record<string, string> = { evidence: 'Milestone evidence', task: 'Task file', chat: 'Sent in chat', project: 'Project document' }

const seenKey = (projectId: number) => `pm-discussions-seen-${projectId}`
function readSeen(projectId: number): string | null {
  try { return localStorage.getItem(seenKey(projectId)) } catch { return null }
}
function writeSeen(projectId: number, iso: string) {
  try { localStorage.setItem(seenKey(projectId), iso) } catch { /* storage blocked — New badges just won't persist */ }
}

/** `limit` = compact card for the Overview (latest few, no filters). */
export default function ProjectDiscussions({ projectId, limit, onOpenAll }: { projectId: number; limit?: number; onOpenAll?: () => void }) {
  const router = useRouter()
  const compact = !!limit
  const [items, setItems] = useState<PmCommItem[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [dept, setDept] = useState('')
  const [wbs, setWbs] = useState('')
  const [kind, setKind] = useState('')
  const [onlyFiles, setOnlyFiles] = useState(false)
  // Last visit, read once — the full tab then marks everything as seen.
  const [seenBefore] = useState<string | null>(() => (typeof window === 'undefined' ? null : readSeen(projectId)))

  const load = useCallback(() => {
    projectsApi.communications(projectId)
      .then((d) => { setItems(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the discussions.')))
  }, [projectId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!compact && items) writeSeen(projectId, new Date().toISOString())
  }, [compact, items, projectId])

  const isNew = (x: PmCommItem) => !!x.created_at && (!seenBefore || x.created_at > seenBefore)
  const depts = useMemo(() => Array.from(new Set((items || []).map((x) => x.department_name).filter(Boolean) as string[])).sort(), [items])
  const wbsList = useMemo(() => {
    const m = new Map<number, string>()
    for (const x of items || []) if (x.milestone_id && (!dept || x.department_name === dept)) m.set(x.milestone_id, `Step ${x.milestone_sequence} · ${x.milestone_title}`)
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
  }, [items, dept])

  const openFile = (f: PmProjectDocument) => openAttachmentBlob(() => pmWorkApi.fileBlob(f.id), f.file_name)
    .catch(() => setError(`Could not open ${f.file_name} — it may have been removed from SharePoint.`))
  const openItem = (x: PmCommItem) => {
    if (x.task_id) router.push(recordPath('/dashboard/projects/tasks', { id: x.task_id }))
    else if (x.milestone_id) router.push(recordPath('/dashboard/projects/milestones', { id: x.milestone_id }))
  }

  if (!items) return <div style={sectionStyle}><ErrorBanner error={error} />{!error && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>}</div>

  const filtered = items.filter((x) => (!dept || x.department_name === dept) && (!wbs || String(x.milestone_id) === wbs)
    && (!kind || x.kind === kind) && (!onlyFiles || x.files.length > 0))
  const rows = compact ? items.slice(0, limit) : filtered
  const newCount = items.filter(isNew).length
  const fileCount = items.reduce((n, x) => n + x.files.length, 0)

  return (
    <div data-tour={compact ? 'pm-ov-latest' : 'pm-disc-section'} style={sectionStyle}>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
            {compact ? 'Latest from departments' : 'Discussions & files'}
            {newCount > 0 && <span style={{ ...pillStyle('#dc2626'), marginLeft: 8, color: '#fff', background: '#dc2626' }}>{newCount} new</span>}
          </h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>
            {compact ? 'What departments discussed and sent on this project.' : `${items.length} item(s) · ${fileCount} file(s) from every department's Milestone chat, task comments, evidence and task files. Newest first.`}
          </p>
        </div>
        {compact ? (onOpenAll && items.length > 0 && <button type="button" onClick={onOpenAll} style={actionBtn('secondary')}>Open all discussions</button>)
          : <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>↻ Refresh</button>}
      </div>

      {!compact && items.length > 0 && (
        <div data-tour="pm-disc-filters" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Select style={{ ...inputStyle, width: 190 }} value={dept} onChange={(e) => { setDept(e.target.value); setWbs('') }}>
            <option value="">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select style={{ ...inputStyle, width: 240 }} value={wbs} onChange={(e) => setWbs(e.target.value)}>
            <option value="">All milestones</option>
            {wbsList.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          <Select style={{ ...inputStyle, width: 160 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Chat, comments &amp; files</option>
            {(Object.keys(KIND_LABELS) as PmCommItem['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </Select>
          <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyFiles} onChange={(e) => setOnlyFiles(e.target.checked)} /> Only with files
          </label>
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
          {items.length === 0 ? 'Nothing yet. When a department chats in its milestone, comments on a task or attaches a drawing, it shows up here.' : 'Nothing matches these filters.'}
        </p>
      ) : rows.map((x) => (
        <div key={x.key} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          {/* ui-audit-ignore-next-line custom-pill — 8px "new" dot, not a pill */}
          <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 999, marginTop: 6, background: isNew(x) ? '#dc2626' : 'transparent' }} title={isNew(x) ? 'New since your last visit' : undefined} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <strong style={{ fontSize: 13, color: TEXT.heading }}>{x.user_name || '—'}</strong>
              {x.department_name && <span style={{ color: TEXT.secondary }}>{x.department_name}</span>}
              <span style={{ fontSize: 11, fontWeight: 700, color: KIND_HEX[x.kind], border: `1px solid ${KIND_HEX[x.kind]}40`, borderRadius: 999, padding: '1px 8px' }}>{KIND_LABELS[x.kind]}</span>
              <span style={{ color: TEXT.muted }}>{x.created_at ? formatDateTime(x.created_at) : ''}</span>
            </div>
            <button type="button" onClick={() => openItem(x)} style={{ background: 'none', border: 'none', padding: 0, margin: '2px 0', cursor: 'pointer', fontSize: 12, color: '#2563eb', textAlign: 'left' }}>
              {x.milestone_sequence ? `Step ${x.milestone_sequence} · ` : ''}{x.milestone_title || '—'}{x.task_title ? ` › ${x.task_title}` : ''}
            </button>
            {x.body && <p style={{ fontSize: 13, color: TEXT.body, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}><MentionText body={x.body} mentions={x.mentions} /></p>}
            {x.files.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {x.files.map((f) => (
                  <button key={f.id} type="button" onClick={() => openFile(f)} title={`${SOURCE_LABELS[f.source || ''] || 'File'} · ${DOC_TYPE_LABELS[f.doc_type] || f.doc_type}`}
                    style={{ ...smallSecondaryBtnStyle, color: TEXT.body }}>
                    📎 {f.file_name}
                    <span style={{ fontSize: 11, color: TEXT.muted }}>{SOURCE_LABELS[f.source || ''] || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
