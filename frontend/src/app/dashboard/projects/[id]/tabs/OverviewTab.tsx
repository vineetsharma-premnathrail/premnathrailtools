'use client'

import { useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import ProjectForm, { formToPayload, projectToForm, validateProjectForm } from '@/components/projects/ProjectForm'
import {
  ErrorBanner, HEALTH_HEX, HEALTH_LABELS, PROJECT_HEX, PROJECT_LABELS, ProgressBar, actionBtn,
} from '@/components/projects/work/pmUi'
import { DetailCard, DetailGroup, DetailRow, DetailSummary, Pill } from '@/components/shared/ui'
import { FormSheet, SHEET, SheetIcon, sheetBtn } from '@/components/shared/FormSheet'
import ClosurePanel from './ClosurePanel'

export default function OverviewTab({ project, onProjectUpdate }: { project: PmProject; onProjectUpdate: () => void }) {
  const { can } = useCan()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(projectToForm(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const closed = ['closed', 'cancelled'].includes(project.status)

  const save = async () => {
    const missing = validateProjectForm(form, true)
    if (missing.length) { setError(missing); return }
    setSaving(true)
    setError('')
    try {
      await projectsApi.update(project.id, formToPayload(form))
      setEditing(false)
      onProjectUpdate()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the project.'))
    } finally {
      setSaving(false)
    }
  }

  const canEdit = project.can_manage && can('projects', 'overview', 'edit') && !closed
  const next = project.next_milestone

  return (
    <div>
      {/* Same layout as R&D › Project › Overview: what the project is and its key
          facts on top, then every detail as label–value rows, in the order of the
          New Project form (basic information, timeline, ownership & scope). */}
      <DetailCard tour="pm-ov-details">
        <DetailSummary
          title={project.name}
          text={project.description || (canEdit ? 'No scope written yet — use Edit to describe what is being delivered.' : undefined)}
          meta={<>
            {project.status !== 'planning' && <Pill label={PROJECT_LABELS[project.status] || project.status} hex={PROJECT_HEX[project.status] || '#64748b'} />}
            <span>Client <strong style={{ color: SHEET.INK }}>{project.client_name || '—'}</strong></span>
            <span>·</span>
            <span>{formatDate(project.start_date)} → {formatDate(project.target_handover_date)}</span>
            <span>·</span>
            <span>PM <strong style={{ color: SHEET.INK }}>{project.project_manager_name || '—'}</strong></span>
            <span>·</span>
            <ProgressBar value={project.progress_percent} width={90} />
          </>}
          actions={canEdit ? (
            <button data-tour="pm-ov-edit-btn" type="button" onClick={() => { setForm(projectToForm(project)); setError(''); setEditing(true) }} style={actionBtn('secondary')}>Edit</button>
          ) : undefined}
        />
        {editing && (
          <FormSheet width={760} icon="edit" title="Edit Project" subtitle={`${project.project_code} · ${project.name}`} onClose={() => setEditing(false)} busy={saving}
            footer={<>
              <button data-tour="pm-proj-edit-cancel" type="button" onClick={() => setEditing(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
              <button data-tour="pm-proj-edit-save" type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save'}</button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={error} />
              <ProjectForm value={form} onChange={setForm} codeLocked={project.status !== 'planning'} isEdit />
            </div>
          </FormSheet>
        )}

        <DetailGroup title="Progress">
          <DetailRow label="Milestones achieved">
            {project.milestones_total > 0 ? `${project.milestones_achieved} of ${project.milestones_total}` : 'No milestones planned yet'}
          </DetailRow>
          <DetailRow label="Next milestone">
            {next ? (
              <span>
                {next.title}{next.department_name ? ` (${next.department_name})` : ''} — due {formatDate(next.target_date)}
                {next.is_overdue && <> <Pill label="Overdue" hex="#dc2626" /></>}
              </span>
            ) : null}
          </DetailRow>
          {project.current_departments.length > 0 && (
            <DetailRow label="Departments working now">{project.current_departments.join(', ')}</DetailRow>
          )}
          {project.forecast_date && project.forecast_date !== project.target_handover_date && (
            <DetailRow label="Forecast finish">{formatDate(project.forecast_date)}</DetailRow>
          )}
          {project.health && (
            <DetailRow label="Health"><Pill label={HEALTH_LABELS[project.health] || project.health} hex={HEALTH_HEX[project.health] || '#64748b'} /></DetailRow>
          )}
        </DetailGroup>

        <DetailGroup title="Record" last>
          {project.customer_po_ref && <DetailRow label="Customer PO">{project.customer_po_ref}</DetailRow>}
          <DetailRow label="Created by">{project.created_by_name ? `${project.created_by_name}${project.created_at ? ` on ${formatDate(project.created_at)}` : ''}` : null}</DetailRow>
          {project.released_at && <DetailRow label="Released">{`${formatDate(project.released_at)}${project.released_by_name ? ` by ${project.released_by_name}` : ''}`}</DetailRow>}
          {project.closure_date && <DetailRow label="Closed">{`${formatDate(project.closure_date)}${project.closed_by_name ? ` by ${project.closed_by_name}` : ''}`}</DetailRow>}
        </DetailGroup>
      </DetailCard>
      {/* The closure panel was removed from open projects; a project closed
          earlier still shows its closure record (read-only). */}
      {project.status === 'closed' && <ClosurePanel project={project} onProjectUpdate={onProjectUpdate} />}
    </div>
  )
}
