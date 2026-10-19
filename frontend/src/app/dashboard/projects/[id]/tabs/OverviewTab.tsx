'use client'

import { useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import ProjectForm, { formToPayload, projectToForm, validateProjectForm } from '@/components/projects/ProjectForm'
import {
  ErrorBanner, actionBtn, sectionStyle,
} from '@/components/projects/work/pmUi'
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

  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 3px' }}>{label}</p>
      <div style={{ fontSize: 13.5, color: TEXT.body }}>{value || '—'}</div>
    </div>
  )

  return (
    <div>
      {/* Details first. % complete lives in the header, handover dates in the header line. */}
      <div data-tour="pm-ov-details" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Project details</h2>
          {project.can_manage && can('projects', 'overview', 'edit') && !closed && (
            <button data-tour="pm-ov-edit-btn" type="button" onClick={() => { setForm(projectToForm(project)); setError(''); setEditing(true) }} style={actionBtn('secondary')}>Edit</button>
          )}
        </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {fact('Customer', project.client_name)}
          {fact('Project manager', project.project_manager_name)}
          {fact('Start date', formatDate(project.start_date))}
          {fact('Released', project.released_at ? `${formatDate(project.released_at)} by ${project.released_by_name}` : null)}
          {fact('Created by', project.created_by_name)}
          {project.closure_date && fact('Closed', `${formatDate(project.closure_date)} by ${project.closed_by_name}`)}
          <div style={{ gridColumn: '1 / -1' }}>{fact('Description / scope', project.description && <span style={{ whiteSpace: 'pre-wrap' }}>{project.description}</span>)}</div>
        </div>
      </div>
      {/* The closure panel was removed from open projects; a project closed
          earlier still shows its closure record (read-only). */}
      {project.status === 'closed' && <ClosurePanel project={project} onProjectUpdate={onProjectUpdate} />}
    </div>
  )
}
