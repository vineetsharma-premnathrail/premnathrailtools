'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PmProject, PmProjectAction } from '@/types'
import { projectsApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'
import {
  ErrorBanner, Notice, PROJECT_HEX, PROJECT_LABELS, Pill, actionBtn, sectionStyle,
} from '@/components/projects/work/pmUi'
import OverviewTab from './tabs/OverviewTab'
import DocumentsTab from './tabs/DocumentsTab'
import TasksTab from './tabs/TasksTab'
import ProjectHistoryTab from './tabs/ProjectHistoryTab'

// WBS, Discussions and Activity Log were removed from the UI: a project is
// its details, its milestones, documents and history. Old ?tab= links open
// Overview; ?tab=Tasks (before the rename) opens Milestones.
const TABS = ['Overview', 'Milestones', 'Documents', 'History'] as const
const TAB_KEYS: Record<typeof TABS[number], string> = {
  Overview: 'overview', Milestones: 'overview', Documents: 'documents', History: 'project_history',
}

// Lifecycle buttons per status — management / the project manager only.
// Projects close from the closure panel on Overview. Resume / Release stay
// only for older projects left On hold or in Planning with WBS elements.
type ActionDef = { action: PmProjectAction; label: string; kind: 'primary' | 'secondary' | 'danger'; prompt?: string; confirm: string }
const ACTIONS: Record<string, ActionDef[]> = {
  on_hold: [
    { action: 'resume', label: 'Resume', kind: 'primary', confirm: 'Resume the project? Departments can work on their tasks again.' },
  ],
}

export default function ProjectWorkspace({ project, onProjectUpdate, onDeleted }: {
  project: PmProject
  onProjectUpdate: () => void
  onDeleted: () => void
}) {
  const router = useRouter()
  const params = useSearchParams()
  const asked = params.get('tab')
  const initial = ((asked === 'Tasks' ? 'Milestones' : asked) as typeof TABS[number]) || 'Overview'
  const { can, canDelete, canFeature } = useCan()
  // Milestones is a feature of Overview (core/features/projects.py: projects:overview.milestones).
  const visibleTabs = TABS.filter((t) => (t === 'Milestones' ? canFeature('projects', 'overview', 'milestones', 'view') : can('projects', TAB_KEYS[t], 'view')))
  const [chosen, setTab] = useState<typeof TABS[number]>(TABS.includes(initial) ? initial : 'Overview')
  const tab = visibleTabs.includes(chosen) ? chosen : visibleTabs[0]
  const [pending, setPending] = useState<ActionDef | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const run = async (def: ActionDef, text?: string) => {
    setPending(null)
    setBusy(true)
    setError('')
    try {
      await projectsApi.transition(project.id, {
        action: def.action,
        reason: text || undefined,
      })
      onProjectUpdate()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not ${def.label.toLowerCase()}.`))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirmDelete(false)
    try {
      await projectsApi.remove(project.id)
      onDeleted()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not delete the project.'))
    }
  }

  // Workflow authority (management / PM) AND Overview › Edit in the matrix.
  // Projects that got WBS elements before auto-release existed still sit in
  // Planning — only they get a Release button.
  const legacyRelease: ActionDef[] = project.status === 'planning' && project.milestones_total > 0
    ? [{ action: 'activate', label: 'Release project', kind: 'primary', confirm: 'Release the project? Every department WBS is sent to its department head, who can then create and assign tasks.' }]
    : []
  const actions = project.can_manage && can('projects', 'overview', 'edit') ? [...legacyRelease, ...(ACTIONS[project.status] || [])] : []
  const mayDelete = project.can_manage && canDelete('projects', 'all_projects', project.created_by_id ?? null)
  const showDelete = mayDelete && project.status === 'planning' && project.milestones_total === 0

  return (
    <div>
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, margin: '0 0 4px', letterSpacing: '.04em' }}>{project.project_code}</p>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>{project.name}</h1>
            <div data-tour="pm-proj-badges" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Planning only means "open" — nobody chose it, so no badge. */}
              {project.status !== 'planning' && <Pill value={project.status} labels={PROJECT_LABELS} hex={PROJECT_HEX} />}
              <span style={{ fontSize: 12.5, color: TEXT.secondary }}>
                {project.client_name} · PM {project.project_manager_name || '—'} · Handover {formatDate(project.target_handover_date)}
              </span>
            </div>
          </div>
          <button data-tour="pm-proj-back" type="button" onClick={() => router.push('/dashboard/projects/all')} style={secondaryBtnStyle}>← Back</button>
        </div>
        {(actions.length > 0 || showDelete) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {actions.map((a) => (
              <button key={a.action} data-tour={`pm-proj-action-${a.action}`} type="button" disabled={busy} onClick={() => setPending(a)} style={actionBtn(a.kind, busy)}>{a.label}</button>
            ))}
            {showDelete && (
              <button data-tour="pm-proj-delete" type="button" onClick={() => setConfirmDelete(true)} style={actionBtn('danger')}>Delete</button>
            )}
          </div>
        )}
        {project.status === 'technically_complete' && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="info">
              Every WBS is accepted. {project.can_manage ? 'Finish the closure checklist and the Final Project Report' : 'The project manager is closing the project'} — see Project closure on the{' '}
              <button type="button" onClick={() => setTab('Overview')} style={{ border: 'none', background: 'none', padding: 0, color: '#4f46e5', fontWeight: 600, cursor: 'pointer', fontSize: 'inherit' }}>Overview</button> tab.
            </Notice>
          </div>
        )}
        {project.status === 'on_hold' && project.hold_reason && <div style={{ marginTop: 12 }}><Notice tone="warn">On hold: {project.hold_reason}</Notice></div>}
        {project.status === 'cancelled' && project.cancel_reason && <div style={{ marginTop: 12 }}><Notice tone="bad">Cancelled: {project.cancel_reason}</Notice></div>}
        <ErrorBanner error={error} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {visibleTabs.map((t) => (
          <button key={t} data-tour={`pm-proj-tab-${t.toLowerCase().replace(' ', '-')}`} type="button" onClick={() => setTab(t)} style={{
            padding: '10px 16px', marginBottom: -1, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            color: tab === t ? '#6366f1' : '#78716c', borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
          }}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab project={project} onProjectUpdate={onProjectUpdate} />}
      {tab === 'Milestones' && <TasksTab project={project} />}
      {tab === 'Documents' && <DocumentsTab project={project} />}
      {tab === 'History' && <ProjectHistoryTab projectId={project.id} />}
      {!tab && <Notice tone="warn">You can see this project&apos;s header, but none of its tabs (Overview, Tasks, Documents, History). Ask an admin to add &apos;View&apos; on them to one of your roles in Organization › Role &amp; Permissions.</Notice>}

      <ConfirmDialog
        open={!!pending && !pending.prompt}
        title={pending?.label || ''}
        message={pending?.confirm || ''}
        confirmLabel={pending?.label}
        danger={pending?.kind === 'danger'}
        onConfirm={() => pending && run(pending)}
        onCancel={() => setPending(null)}
      />
      <PromptDialog
        open={!!pending?.prompt}
        title={pending?.label || ''}
        message={pending?.prompt}
        confirmLabel={pending?.label}
        danger={pending?.kind === 'danger'}
        requireValue
        onConfirm={(v) => pending && run(pending, v)}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this project?"
        message={`Delete ${project.project_code}? It has no WBS elements yet, so nothing else is lost.`}
        confirmLabel="Delete"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
