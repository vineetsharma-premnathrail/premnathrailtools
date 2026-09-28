'use client'

import { PmProject } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}>{value}</p>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.heading, margin: '0 0 12px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

export default function OverviewTab({ project }: { project: PmProject }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <Card title="Summary">
          <InfoRow label="Client" value={project.client_name || 'Not provided'} />
          <InfoRow label="Project Type" value={project.project_type || 'Not provided'} />
          <InfoRow label="Category" value={project.category || 'Not provided'} />
        </Card>
        <Card title="Timeline">
          <InfoRow label="Start Date" value={project.start_date || 'Not provided'} />
          <InfoRow label="End Date" value={project.end_date || 'Not provided'} />
          <InfoRow label="Status" value={project.status} />
          <InfoRow label="Priority" value={project.priority} />
        </Card>
        <Card title="People">
          <InfoRow label="Project Manager" value={project.project_manager_name || 'Not assigned'} />
          <InfoRow label="Sponsor" value={project.sponsor_name || 'Not assigned'} />
          <InfoRow label="Created By" value={project.created_by_name || 'Unknown'} />
        </Card>
      </div>

      {(project.description || project.scope_statement || project.objectives) && (
        <div style={cardStyle}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.heading, margin: '0 0 12px' }}>Scope</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {project.description && <InfoRow label="Description" value={project.description} />}
            {project.scope_statement && <InfoRow label="Scope Statement" value={project.scope_statement} />}
            {project.objectives && <InfoRow label="Objectives" value={project.objectives} />}
          </div>
        </div>
      )}

      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
        Richer cross-tab counts (tasks, issues, budget) will appear here as those tabs ship in later phases.
      </p>
    </div>
  )
}
