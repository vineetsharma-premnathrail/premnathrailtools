'use client'

import { HrEmployeeProfile } from '@/types'
import { TEXT } from '@/lib/theme'
import { InfoRow } from '@/components/shared/ui'
import { sectionStyle, formatDate, titleCase, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from '@/components/hr/masters/masterUi'

function v(x?: string | number | null): string {
  return x === null || x === undefined || x === '' ? '—' : String(x)
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ ...sectionStyle, marginBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>{title}</p>
        {action}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>{children}</div>
    </div>
  )
}

/** Read-only employee record. `audience="hr"` adds HR notes and the org-lock
 * setting; `personalAction` lets the My HR page put an Edit button on the
 * personal-details card. */
export default function EmployeeProfileView({ p, audience, personalAction }: { p: HrEmployeeProfile; audience: 'hr' | 'self'; personalAction?: React.ReactNode }) {
  const tenure = (() => {
    if (!p.date_of_joining) return null
    const start = new Date(p.date_of_joining + 'T00:00:00')
    const end = p.date_of_exit ? new Date(p.date_of_exit + 'T00:00:00') : new Date()
    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
    if (end.getDate() < start.getDate()) months -= 1
    if (months < 0) return null
    const y = Math.floor(months / 12)
    const m = months % 12
    return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : '', !y && !m ? 'under a month' : ''].filter(Boolean).join(' ')
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
      <Card title="Employment">
        <InfoRow label="Employee Code" value={v(p.employee_code)} />
        <InfoRow label="Department" value={v(p.department_name)} />
        <InfoRow label="Designation" value={v(p.designation_name)} />
        <InfoRow label="Grade" value={p.grade_code ? `${p.grade_code} · ${p.grade_name}` : '—'} />
        <InfoRow label="Plant" value={v(p.branch_name)} />
        <InfoRow label="Work Location" value={v(p.work_location || p.office_location)} />
        <InfoRow label="Shift" value={v(p.shift_name)} />
        <InfoRow label="Reporting Manager" value={v(p.reporting_manager_name)} />
        <InfoRow label="Date of Joining" value={p.date_of_joining ? `${formatDate(p.date_of_joining)}${tenure ? ` (${tenure})` : ''}` : '—'} />
        <InfoRow label="Employment Type" value={EMPLOYMENT_TYPE_LABELS[p.employment_type || ''] || '—'} />
        <InfoRow label="Status" value={EMPLOYMENT_STATUS_LABELS[p.employment_status || ''] || (p.has_profile ? '—' : 'No HR profile yet')} />
        {(p.probation_end_date || p.employment_status === 'probation') && <InfoRow label="Probation Ends" value={formatDate(p.probation_end_date)} />}
        {p.confirmation_date && <InfoRow label="Confirmed On" value={formatDate(p.confirmation_date)} />}
        {p.date_of_exit && <InfoRow label="Date of Exit" value={formatDate(p.date_of_exit)} />}
        {p.exit_reason && <InfoRow label="Exit Reason" value={p.exit_reason} />}
        <InfoRow label="Direct Reports" value={String(p.direct_reports_count || 0)} />
      </Card>

      <Card title="Personal Details" action={personalAction}>
        <InfoRow label="Work Email" value={p.email} />
        <InfoRow label="Work Phone" value={v(p.phone)} />
        <InfoRow label="Personal Email" value={v(p.personal_email)} />
        <InfoRow label="Personal Phone" value={v(p.personal_phone)} />
        <InfoRow label="Gender" value={titleCase(p.gender)} />
        <InfoRow label="Date of Birth" value={formatDate(p.date_of_birth)} />
        <InfoRow label="Blood Group" value={v(p.blood_group)} />
        <InfoRow label="Marital Status" value={titleCase(p.marital_status)} />
        <InfoRow label="Current Address" value={v(p.current_address)} />
        <InfoRow label="Permanent Address" value={v(p.permanent_address)} />
      </Card>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column' }}>
          <Card title="Emergency Contact" action={personalAction}>
            <InfoRow label="Name" value={v(p.emergency_contact_name)} />
            <InfoRow label="Relation" value={v(p.emergency_contact_relation)} />
            <InfoRow label="Phone" value={v(p.emergency_contact_phone)} />
          </Card>
        </div>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column' }}>
          <Card title="Statutory IDs">
            <InfoRow label="PAN" value={v(p.pan_number)} />
            <InfoRow label="Aadhaar" value={p.aadhaar_last4 ? `XXXX XXXX ${p.aadhaar_last4}` : '—'} />
            <InfoRow label="UAN (PF)" value={v(p.uan_number)} />
            <InfoRow label="ESIC No." value={v(p.esic_number)} />
          </Card>
        </div>
      </div>

      {audience === 'hr' && (
        <Card title="HR Notes & Settings">
          <InfoRow label="Org fields owned by" value={p.has_profile ? (p.org_fields_locked ? 'HR (Azure sync will not overwrite)' : 'Azure AD sync') : '—'} />
          <InfoRow label="Portal Account" value={p.is_active ? 'Active' : 'Deactivated'} />
          <InfoRow label="Department on User Account" value={v(p.user_department)} />
          <InfoRow label="Designation on User Account" value={v(p.user_designation)} />
          <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Notes" value={v(p.notes)} /></div>
        </Card>
      )}
    </div>
  )
}
