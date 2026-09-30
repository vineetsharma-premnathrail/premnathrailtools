'use client'

import { useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import HrNav from '@/components/hr/HrNav'
import DesignationsMaster from '@/components/hr/masters/DesignationsMaster'
import GradesMaster from '@/components/hr/masters/GradesMaster'
import ShiftsMaster from '@/components/hr/masters/ShiftsMaster'
import LeaveTypesMaster from '@/components/hr/masters/LeaveTypesMaster'
import ChecklistTemplatesMaster from '@/components/hr/masters/ChecklistTemplatesMaster'

const SECTIONS = [
  { key: 'designations', label: 'Designations' },
  { key: 'grades', label: 'Grades' },
  { key: 'shifts', label: 'Shifts' },
  { key: 'leave_types', label: 'Leave Types' },
  { key: 'checklists', label: 'Checklist Templates' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

export default function HrMastersPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const [active, setActive] = useState<SectionKey>('designations')

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          HR &amp; Administration
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Masters</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Designations, grades, shifts, leave types and lifecycle checklist templates.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {SECTIONS.map((s) => {
          const isActive = s.key === active
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(s.key)}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 14px',
                borderRadius: 9999,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                border: isActive ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)',
                background: isActive ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)',
                color: isActive ? '#e0521a' : '#57534e',
              }}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {active === 'designations' && <DesignationsMaster />}
      {active === 'grades' && <GradesMaster />}
      {active === 'shifts' && <ShiftsMaster />}
      {active === 'leave_types' && <LeaveTypesMaster />}
      {active === 'checklists' && <ChecklistTemplatesMaster />}
    </div>
  )
}
