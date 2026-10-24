'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { PmProject, PmProjectDocument } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { ErrorBanner, AttachmentList, inputStyle, sectionStyle } from '@/components/projects/work/pmUi'

/** Every file of the project in one register: files attached on milestones
 * and tasks in Project Plan & Milestones (with the milestone, task and person
 * each came from), plus files uploaded on the project earlier and older WBS
 * evidence / chat files when they exist. Upload happens on the milestone or
 * task itself. */
export default function DocumentsTab({ project }: { project: PmProject }) {
  const { canDelete } = useCan()
  const [docs, setDocs] = useState<PmProjectDocument[]>([])
  const [toDelete, setToDelete] = useState<number | null>(null)
  const [dept, setDept] = useState('')
  const [milestone, setMilestone] = useState('')
  const [error, setError] = useState<string | string[]>('')

  const load = useCallback(() => {
    projectsApi.documents(project.id).then((d) => setDocs(Array.isArray(d) ? d : [])).catch((err) => setError(extractErrorMessages(err, 'Failed to load documents.')))
  }, [project.id])
  useEffect(() => { load() }, [load])

  const open = (id: number, name: string) =>
    openAttachmentBlob(() => projectsApi.documentBlob(project.id, id), name).catch(() => setError(`Could not open ${name}. Try again; if it keeps failing, the file may be missing in SharePoint.`))

  const src = (d: PmProjectDocument) => d.source || (d.task_id ? 'task' : d.message_id ? 'chat' : d.milestone_id ? 'evidence' : 'project')
  const depts = Array.from(new Set(docs.map((d) => d.department_name).filter(Boolean) as string[])).sort()
  const milestones = Array.from(new Map(docs.filter((d) => d.plan_milestone_id).map((d) => [String(d.plan_milestone_id), d.plan_milestone_title || ''])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
  const shown = docs.filter((d) => (!dept || d.department_name === dept) && (!milestone || String(d.plan_milestone_id) === milestone))
  const groups = [
    { key: 'task', title: 'Milestone & task documents', rows: shown.filter((d) => src(d) === 'task') },
    { key: 'project', title: 'Project documents', rows: dept || milestone ? [] : shown.filter((d) => src(d) === 'project') },
    { key: 'evidence', title: 'WBS evidence', rows: shown.filter((d) => src(d) === 'evidence') },
    { key: 'chat', title: 'Sent in WBS chats', rows: shown.filter((d) => src(d) === 'chat') },
  ]
  // "R&D · Step 1 GA drawing › Prepare BOM · title" — who it came from, at a glance.
  const where = (d: PmProjectDocument) => {
    if (d.plan_milestone_title) {
      // "Milestone: Design release › Task: Frame GA drawing"
      return [`Milestone: ${d.plan_milestone_title}`, d.plan_task_title ? `Task: ${d.plan_task_title}` : null,
        d.title && d.title !== d.file_name ? d.title : null].filter(Boolean).join(' › ')
    }
    const parts = [
      d.department_name,
      d.milestone_title ? `Step ${d.milestone_sequence ?? '?'} ${d.milestone_title}${d.task_title ? ` › ${d.task_title}` : ''}` : d.task_title,
      d.title && d.title !== d.file_name ? d.title : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : d.title
  }

  return (
    <div data-tour="pm-docs-section" style={sectionStyle}>
      <ErrorBanner error={error} />
      {(depts.length > 0 || milestones.length > 0) && (
        <div data-tour="pm-docs-dept-filter" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          {milestones.length > 0 && (
            <Select style={{ ...inputStyle, width: 240 }} value={milestone} onChange={(e) => setMilestone(e.target.value)}>
              <option value="">All milestones</option>
              {milestones.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </Select>
          )}
          {depts.length > 0 && (
            <Select style={{ ...inputStyle, width: 220 }} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          )}
          <span style={{ fontSize: 12.5, color: TEXT.muted }}>{shown.length} file(s)</span>
        </div>
      )}
      {/* Task documents always show; the other groups only exist on older projects — hide them when empty. */}
      {groups.filter((g) => g.key === 'task' || g.rows.length > 0).map((g) => (
        <div key={g.title} style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{g.title} ({g.rows.length})</p>
          {g.rows.length === 0 ? (
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No files yet — files attached on a milestone or task in Project Plan &amp; Milestones show up here.</p>
          ) : <AttachmentList
            files={g.rows.map((d) => ({ ...d, title: g.key === 'project' ? d.title : where(d) }))}
            onOpen={open}
            onDelete={g.title === 'Project documents' ? (id) => setToDelete(id) : undefined}
            canDelete={(f) => canDelete('projects', 'documents', f.uploaded_by_id ?? null)}
          />}
        </div>
      ))}
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this file?"
        message="The file is removed from the project and from SharePoint."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = toDelete!
          setToDelete(null)
          try { await projectsApi.deleteDocument(project.id, id); load() } catch (err) { setError(extractErrorMessages(err, 'Could not delete the file.')) }
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
