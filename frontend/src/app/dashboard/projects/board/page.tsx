'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi } from '@/lib/api'
import { PmBoard } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { ErrorBanner, MILESTONE_HEX, MILESTONE_LABELS, PROJECT_HEX, PROJECT_LABELS, Pill, sectionStyle, tdStyle, thStyle } from '@/components/projects/work/pmUi'
import { recordPath } from '@/lib/recordRef'
import { RowCount } from '@/components/shared/ui'

// Projects × departments: each cell shows that department's milestones on the
// project, coloured by status, so management sees where every order stands.
export default function DepartmentBoardPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const [board, setBoard] = useState<PmBoard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (isAuthorized) projectsApi.board().then(setBoard).catch((err) => setError(extractErrorMessages(err, 'Failed to load the board.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Department Board</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Every live project against every department — red border means overdue, amber means at risk.</p>
      </div>
      <ErrorBanner error={error} />
      <div data-tour="pm-board-grid" style={sectionStyle}>
        {!board ? (!error && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>) : board.rows.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No live projects.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 260 + board.departments.length * 170 }}>
              <thead><tr>
                <th style={{ ...thStyle, left: 0, zIndex: 2, minWidth: 220 }}>Project<RowCount count={board.rows.length} /></th>
                {board.departments.map((d) => <th key={d.id} style={{ ...thStyle, minWidth: 160 }}>{d.name}</th>)}
              </tr></thead>
              <tbody>
                {board.rows.map((r) => (
                  <tr key={r.project.id}>
                    <td style={{ ...tdStyle, position: 'sticky', left: 0, background: '#fffaf5', zIndex: 1 }}>
                      <Link href={recordPath('/dashboard/projects', r.project)} style={{ fontWeight: 700, color: '#2563eb', textDecoration: 'none' }}>{r.project.project_code}</Link>
                      <div style={{ fontSize: 12, color: TEXT.muted, marginBottom: 4 }}>{r.project.name}</div>
                      <Pill value={r.project.status} labels={PROJECT_LABELS} hex={PROJECT_HEX} />
                    </td>
                    {board.departments.map((d) => {
                      const cells = r.cells[String(d.id)] || []
                      return (
                        <td key={d.id} style={tdStyle}>
                          {cells.length === 0 ? <span style={{ color: TEXT.muted }}>—</span> : cells.map((c) => {
                            const color = MILESTONE_HEX[c.status] || '#64748b'
                            return (
                              <Link key={c.id} href={recordPath('/dashboard/projects/milestones', c)} title={c.title} style={{
                                display: 'block', padding: '6px 8px', marginBottom: 4, borderRadius: 8, textDecoration: 'none',
                                background: `${color}14`, border: `1.5px solid ${c.is_overdue ? '#dc2626' : c.is_at_risk ? '#f59e0b' : `${color}33`}`,
                              }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color }}>{MILESTONE_LABELS[c.status]}{c.status !== 'achieved' ? ` · ${c.progress_percent}%` : ''}</span>
                                <div style={{ fontSize: 12, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{c.title}</div>
                                <div style={{ fontSize: 11, color: c.is_overdue ? '#dc2626' : TEXT.muted }}>{formatDate(c.target_date)}</div>
                              </Link>
                            )
                          })}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
