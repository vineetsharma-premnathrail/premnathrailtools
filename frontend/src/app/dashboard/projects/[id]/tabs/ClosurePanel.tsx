'use client'

import { useCallback, useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmClosure, PmProject } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { ErrorBanner, actionBtn, inputStyle, labelStyle, sectionStyle } from '@/components/projects/work/pmUi'

/** Project closure, shown on every open project
 * and kept on a closed project as its record: the checklist that gates
 * "Close project", the Final Project Report (Word document of record) and
 * the closure note, lessons learned and documents-archived confirmation. */
export default function ClosurePanel({ project, onProjectUpdate }: { project: PmProject; onProjectUpdate: () => void }) {
  const { can } = useCan()
  const [closure, setClosure] = useState<PmClosure | null>(null)
  const [note, setNote] = useState(project.closure_note || '')
  const [lessons, setLessons] = useState(project.lessons_learned || '')
  const [archived, setArchived] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const closed = project.status === 'closed'
  const canClose = !closed && project.can_manage && can('projects', 'overview', 'edit')

  const load = useCallback(() => {
    projectsApi.closure(project.id).then(setClosure).catch((err) => setError(extractErrorMessages(err, 'Could not load the closure checklist.')))
  }, [project.id])
  useEffect(() => { load() }, [load, project.status])

  const close = async () => {
    setConfirm(false)
    setBusy(true)
    setError('')
    try {
      await projectsApi.transition(project.id, { action: 'close', closure_note: note.trim(), lessons_learned: lessons.trim() || undefined, documents_archived: archived })
      onProjectUpdate()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not close the project.'))
      load()
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      await projectsApi.update(project.id, { closure_note: note.trim() || null, lessons_learned: lessons.trim() || null })
      setSaved('Saved — regenerate the Final Project Report to include them.')
      onProjectUpdate()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the closure note and lessons learned.'))
    } finally {
      setBusy(false)
    }
  }

  const tryClose = () => {
    const missing: string[] = []
    if (!note.trim()) missing.push('Closure note is required — final billing, retention, warranty start and anything still owed to the customer.')
    if (!archived) missing.push('Tick the box to confirm every project document is filed in the Documents tab.')
    if (missing.length) { setError(missing); return }
    setError('')
    setConfirm(true)
  }

  // The archive confirmation is given with the close itself.
  const blocking = (closure?.checks || []).filter((c) => c.required && !c.ok && c.key !== 'documents_archived')

  return (
    <div data-tour="pm-ov-closure" style={sectionStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Project closure</h2>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
        {closed
          ? `Closed ${formatDate(project.closure_date)} by ${project.closed_by_name || '—'}.`
          : 'When the work is handed over and billed: work through the checklist, prepare the Final Project Report, then close the project.'}
        {project.technically_completed_on && ` Technically complete since ${formatDate(project.technically_completed_on)}.`}
      </p>
      <ErrorBanner error={error} />

      <div data-tour="pm-closure-checklist" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {(closure?.checks || []).map((c) => {
          const color = c.ok ? '#16a34a' : c.required ? '#dc2626' : '#f59e0b'
          return (
            <div key={c.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,.55)' }}>
              <span style={{ fontWeight: 800, color, width: 16, flex: 'none' }}>{c.ok ? '✓' : c.required ? '✗' : '!'}</span>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{c.label}</span>
                {!c.required && <span style={{ fontSize: 11.5, color: TEXT.muted }}> (advisory)</span>}
                {c.key === 'documents_archived' && c.ok && project.documents_archived_at && (
                  <span style={{ fontSize: 12, color: TEXT.muted }}> — confirmed {formatDate(project.documents_archived_at)} by {project.documents_archived_by_name || '—'}</span>
                )}
                {!c.ok && c.detail && <div style={{ fontSize: 12, color: TEXT.secondary }}>{c.detail}</div>}
              </div>
            </div>
          )
        })}
      </div>

      <div data-tour="pm-closure-report" style={{ marginBottom: 16 }}>
        <p style={{ ...labelStyle, marginBottom: 8 }}>Final Project Report</p>
        <ManagedDocumentPanel
          entityType="pm_project_closure_report" entityId={project.id} revision={0}
          canModify={project.can_manage && can('projects', 'overview', 'edit') && !closed}
          recordLabel="project" downloadName={`Final-Project-Report-${project.project_code}`}
          onDocumentChange={() => load()}
        />
        {!closed && (
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }}>
            Built from the project data: details, schedule against the target handover, closure note and lessons learned. Write the closure note and lessons learned below and click Save notes first so they are included — finish the narrative in Word.
          </p>
        )}
      </div>

      {closed ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div><p style={labelStyle}>Closure note</p><div style={{ fontSize: 13.5, color: TEXT.body, whiteSpace: 'pre-wrap' }}>{project.closure_note || '—'}</div></div>
          <div><p style={labelStyle}>Lessons learned</p><div style={{ fontSize: 13.5, color: TEXT.body, whiteSpace: 'pre-wrap' }}>{project.lessons_learned || '—'}</div></div>
        </div>
      ) : canClose ? (
        <>
          <div data-tour="pm-closure-note" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Closure note *</label>
            <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Final invoice, retention released, warranty start date, anything still owed to the customer" />
          </div>
          <div data-tour="pm-closure-lessons" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Lessons learned</label>
            <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={lessons} onChange={(e) => setLessons(e.target.value)}
              placeholder="What went well, what to do differently on the next project" />
          </div>
          <label data-tour="pm-closure-archived" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Every project document — drawings, test reports, certificates, customer acceptance — is filed in the Documents tab.</span>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {saved && <span style={{ fontSize: 12, color: '#16a34a' }}>{saved}</span>}
            {blocking.length > 0 && <span style={{ fontSize: 12, color: '#dc2626' }}>Clear the ✗ items above to close.</span>}
            <button data-tour="pm-closure-save-btn" type="button" onClick={saveDraft} disabled={busy} style={actionBtn('secondary', busy)}>Save notes</button>
            <button data-tour="pm-closure-close-btn" type="button" onClick={tryClose} disabled={busy || blocking.length > 0} style={actionBtn('primary', busy || blocking.length > 0)}>
              {busy ? 'Closing…' : 'Close project'}
            </button>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirm}
        title="Close the project?"
        message={`Close ${project.project_code}? It becomes read-only: no changes to details or documents after this.`}
        confirmLabel="Close project"
        onConfirm={close}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}
