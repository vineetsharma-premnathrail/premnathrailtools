'use client'

import { useState } from 'react'
import { rndApi } from '@/lib/api'
import { DirectoryUser, RndProjectDetail } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import { SHEET, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, tableStyle, thStyle, tdStyle, TableScroll, RowCount } from '@/components/shared/ui'

// Members tab of an R&D project: who leads it and who works on it.
// Leads hand out tasks and plan milestones; team members can be given tasks.
export default function RndProjectMembers({
  project, users, pickable, canEdit, onSaved,
}: {
  project: RndProjectDetail
  /** Full directory — used to show email / department of each member. */
  users: DirectoryUser[]
  /** People the current user may add (role's assign-to rule + people already on the project). */
  pickable: DirectoryUser[]
  canEdit: boolean
  onSaved: (p: RndProjectDetail) => void
}) {
  const currentLeads = project.lead_ids?.length ? project.lead_ids : project.lead_id ? [project.lead_id] : []
  const [editing, setEditing] = useState(false)
  const [leadIds, setLeadIds] = useState<number[]>(currentLeads)
  const [teamIds, setTeamIds] = useState<number[]>(project.team_member_ids || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const nameOf = (id: number) =>
    project.leads?.find((m) => m.id === id)?.name || project.team_members?.find((m) => m.id === id)?.name || users.find((u) => u.id === id)?.name || `User #${id}`
  const rows = [
    ...currentLeads.map((id) => ({ id, role: 'Project Lead' })),
    ...(project.team_member_ids || []).filter((id) => !currentLeads.includes(id)).map((id) => ({ id, role: 'Team Member' })),
  ]

  const start = () => { setError(''); setLeadIds(currentLeads); setTeamIds(project.team_member_ids || []); setEditing(true) }
  const save = async () => {
    setError('')
    setSaving(true)
    try {
      await rndApi.updateProject(project.id, { lead_ids: leadIds, team_member_ids: teamIds })
      onSaved(await rndApi.getProject(project.id))
      setEditing(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the project members. Check that each person still has an active account, then try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-tour="rnd-pd-members-tab" style={{ borderRadius: 18, background: '#fff', border: `1px solid ${SHEET.LINE}`, boxShadow: '0 4px 16px rgba(15,23,42,0.06)', padding: '22px 26px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: SHEET.INK, margin: 0 }}>Project Members</h2>
          <p style={{ ...sheetHint, margin: '4px 0 0' }}>Project Leads plan milestones and hand out tasks. Only people listed here can be given tasks on this project.</p>
        </div>
        {canEdit && !editing && <button type="button" onClick={start} style={smallSecondaryBtnStyle}>Edit members</button>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {editing ? (
        <div>
          <label style={sheetLabel}>Project Leads</label>
          <TeamMemberPicker users={pickable} value={leadIds} onChange={setLeadIds} excludeIds={teamIds} placeholder="Search name or email to add a project lead…" />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Team Members</label>
          <TeamMemberPicker users={pickable} value={teamIds} onChange={setTeamIds} excludeIds={leadIds} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => { setError(''); setEditing(false) }} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
            <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save members'}</button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No members yet{canEdit ? ' — use “Edit members” to add the project leads and team.' : '.'}</p>
      ) : (
        <TableScroll>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name<RowCount count={rows.length} /></th>
                <th style={thStyle}>Role on project</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Department</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const u = users.find((x) => x.id === r.id)
                return (
                  <tr key={`${r.role}-${r.id}`}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: SHEET.INK }}>{nameOf(r.id)}</td>
                    <td style={tdStyle}>{r.role}</td>
                    <td style={tdStyle}>{u?.email || '—'}</td>
                    <td style={tdStyle}>{u?.department || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  )
}
