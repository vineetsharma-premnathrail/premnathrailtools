'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PmProject } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import OverviewTab from './tabs/OverviewTab'
import DetailsScopeTab from './tabs/DetailsScopeTab'
import ProjectHistoryTab from './tabs/ProjectHistoryTab'
import PlanningTab from './tabs/PlanningTab'
import TasksTab from './tabs/TasksTab'
import MilestonesTab from './tabs/MilestonesTab'
import ResourcesTab from './tabs/ResourcesTab'
import BudgetCostTab from './tabs/BudgetCostTab'
import DeliverablesTab from './tabs/DeliverablesTab'
import DocumentsTab from './tabs/DocumentsTab'
import IssuesTab from './tabs/IssuesTab'
import RisksTab from './tabs/RisksTab'
import ChangesTab from './tabs/ChangesTab'
import ApprovalsTab from './tabs/ApprovalsTab'

const TABS = [
  'Overview', 'Details & Scope', 'Planning', 'Tasks', 'Milestones', 'Budget & Cost', 'Resources',
  'Deliverables', 'Documents', 'Issues', 'Risks', 'Changes', 'Activities', 'Meetings & Communication',
  'Approvals', 'Reports', 'Project History', 'Closure',
] as const

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning', active: 'Active', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  planning: '#2563eb', active: '#16a34a', on_hold: '#f59e0b', completed: '#0d9488', cancelled: '#dc2626',
}
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}
const PRIORITY_HEX: Record<string, string> = {
  low: '#64748b', medium: '#2563eb', high: '#f59e0b', critical: '#dc2626',
}

function Pill({ value, labels, hex }: { value: string; labels: Record<string, string>; hex: Record<string, string> }) {
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function ProjectWorkspace({
  project,
  onProjectUpdate,
  onDeleted,
}: {
  project: PmProject
  onProjectUpdate: () => void
  onDeleted: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = (t: string | null): typeof TABS[number] =>
    (TABS as readonly string[]).includes(t || '') ? (t as typeof TABS[number]) : 'Overview'
  const [tab, setTab] = useState<typeof TABS[number]>(() => initialTab(searchParams.get('tab')))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: TEXT.muted, margin: '0 0 4px' }}>{project.project_code}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{project.name}</h1>
            <Pill value={project.status} labels={STATUS_LABELS} hex={STATUS_HEX} />
            <Pill value={project.priority} labels={PRIORITY_LABELS} hex={PRIORITY_HEX} />
          </div>
        </div>
        <button onClick={() => router.push('/dashboard/projects/all')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, flexWrap: 'wrap', padding: 4, borderRadius: 14, background: 'rgba(0,0,0,0.05)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '9px 14px', border: 'none', borderRadius: 10, whiteSpace: 'nowrap',
              background: tab === t ? '#fff' : 'transparent',
              boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
              color: tab === t ? '#6366f1' : '#78716c', fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
              transition: 'background .15s, box-shadow .15s, color .15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab project={project} />}
      {tab === 'Details & Scope' && <DetailsScopeTab project={project} onSaved={onProjectUpdate} onDeleted={onDeleted} />}
      {tab === 'Planning' && <PlanningTab projectId={project.id} />}
      {tab === 'Tasks' && <TasksTab projectId={project.id} />}
      {tab === 'Milestones' && <MilestonesTab projectId={project.id} />}
      {tab === 'Resources' && <ResourcesTab projectId={project.id} />}
      {tab === 'Budget & Cost' && <BudgetCostTab projectId={project.id} />}
      {tab === 'Deliverables' && <DeliverablesTab projectId={project.id} />}
      {tab === 'Documents' && <DocumentsTab projectId={project.id} />}
      {tab === 'Issues' && <IssuesTab projectId={project.id} />}
      {tab === 'Risks' && <RisksTab projectId={project.id} />}
      {tab === 'Changes' && <ChangesTab projectId={project.id} />}
      {tab === 'Approvals' && <ApprovalsTab projectId={project.id} />}
      {tab === 'Project History' && <ProjectHistoryTab projectId={project.id} />}
      {![
        'Overview', 'Details & Scope', 'Planning', 'Tasks', 'Milestones', 'Resources', 'Budget & Cost',
        'Deliverables', 'Documents', 'Issues', 'Risks', 'Changes', 'Approvals', 'Project History',
      ].includes(tab) && (
        <div style={{ ...sectionStyle, textAlign: 'center', padding: 48 }}>
          <p style={{ fontSize: 14, color: TEXT.muted, margin: 0 }}>{tab} is coming in a later phase.</p>
        </div>
      )}
    </div>
  )
}
