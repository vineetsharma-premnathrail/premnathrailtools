'use client'

// Lifecycle stage of a project: the pill plus, for the project manager /
// management, a Select to jump forward and a "Move to next stage" button.
// Moving back is for an admin or Partner only and asks for a reason
// (PromptDialog). Backend: POST /projects/{id}/stage — it audits the change and
// mirrors the stage to the machines linked to the project.
import { useState } from 'react'
import Select from '@/components/shared/Select'
import PromptDialog from '@/components/erp/PromptDialog'
import { projectsApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { extractErrorMessages } from '@/lib/validation'
import { PmProject } from '@/types'
import { LIFECYCLE_LABELS, LIFECYCLE_ORDER, StagePills, ErrorBanner, actionBtn, inputStyle } from '@/components/projects/work/pmUi'

export default function StageControl({ project, canMove, onChanged }: { project: PmProject; canMove: boolean; onChanged: () => void }) {
  const { user } = useAuth()
  const mayMoveBack = user?.role === 'admin' || !!user?.is_partner
  const current = (project.lifecycle_stage || 'planned') as typeof LIFECYCLE_ORDER[number]
  const idx = LIFECYCLE_ORDER.indexOf(current)
  const next = idx >= 0 && idx < LIFECYCLE_ORDER.length - 1 ? LIFECYCLE_ORDER[idx + 1] : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [backTo, setBackTo] = useState<string | null>(null)

  const move = async (stage: string, reason?: string) => {
    setBackTo(null)
    setBusy(true)
    setError('')
    try {
      await projectsApi.stage(project.id, { stage, reason: reason || undefined })
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not move ${project.project_code} to ${LIFECYCLE_LABELS[stage] || stage}. Check your connection and try again; only the project manager or management can move a stage forward.`))
    } finally {
      setBusy(false)
    }
  }

  const pick = (stage: string) => {
    if (!stage || stage === current) return
    if (LIFECYCLE_ORDER.indexOf(stage as typeof LIFECYCLE_ORDER[number]) < idx) setBackTo(stage)
    else move(stage)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <StagePills stage={project.lifecycle_stage} label={project.lifecycle_stage_label} status={project.status} />
        {canMove && (
          <>
            <Select aria-label="Set the project stage" style={{ ...inputStyle, width: 210 }} value={current} disabled={busy} onChange={(e) => pick(e.target.value)}>
              {LIFECYCLE_ORDER.map((k, i) => (
                <option key={k} value={k} disabled={i < idx && !mayMoveBack}>{LIFECYCLE_LABELS[k]}{i < idx && !mayMoveBack ? ' (admin / Partner only)' : ''}</option>
              ))}
            </Select>
            {next && <button type="button" disabled={busy} onClick={() => move(next)} style={actionBtn('primary', busy)}>{busy ? 'Moving…' : `Move to ${LIFECYCLE_LABELS[next]}`}</button>}
          </>
        )}
      </div>
      <ErrorBanner error={error} />
      <PromptDialog
        open={!!backTo}
        title={`Move back to ${backTo ? LIFECYCLE_LABELS[backTo] : ''}?`}
        message="Stages normally only move forward. Say why this project is going back — the reason is saved in its history and the machines linked to it follow the new stage."
        confirmLabel="Move back"
        requireValue
        onConfirm={(v) => backTo && move(backTo, v)}
        onCancel={() => setBackTo(null)}
      />
    </div>
  )
}
