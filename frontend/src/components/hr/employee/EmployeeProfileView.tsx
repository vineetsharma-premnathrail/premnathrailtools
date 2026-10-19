'use client'

import { HrEmployeeProfile } from '@/types'
import { TEXT } from '@/lib/theme'
import { InfoRow } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'
import {
  sectionStyle, formatDate, titleCase, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, WORKER_TYPE_LABELS,
  RECORD_STATUS_LABELS, RECORD_STATUS_HEX, ATTENDANCE_POLICY_LABELS, PROBATION_STATUS_LABELS, LOGIN_STATUS_LABELS,
} from '@/components/hr/masters/masterUi'

function v(x?: string | number | null): string {
  return x === null || x === undefined || x === '' ? '—' : String(x)
}

function Card({ title, children, action, tour }: { title: string; children: React.ReactNode; action?: React.ReactNode; tour?: string }) {
  return (
    <div data-tour={tour} style={{ ...sectionStyle, marginBottom: 0 }}>
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
  // HR › Employees features: how much of someone else's record a role sees
  // (the server blanks the same fields). An employee always sees their own.
  const { canFeature } = useCan()
  const see = (feature: 'personal' | 'statutory_ids' | 'hr_notes') => audience === 'self' || canFeature('hr', 'employees', feature, 'view')
  const seePersonal = see('personal')
  const seeStatutory = see('statutory_ids')
  const nonOffice = !!p.worker_type && p.worker_type !== 'office'
  const showComplianceCard = seeStatutory || nonOffice || audience === 'hr'
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
      {audience === 'hr' && p.record_status && p.record_status !== 'complete' && (
        <div style={{ ...sectionStyle, marginBottom: 0, borderLeft: `4px solid ${RECORD_STATUS_HEX[p.record_status] || '#64748B'}` }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>
            Record {RECORD_STATUS_LABELS[p.record_status] || p.record_status}
            {p.record_status === 'draft' ? ' — saved without the required-field checks.' : ' — some details are still missing.'}
          </p>
          {!!p.missing_fields?.length && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Missing: {p.missing_fields.join(', ')}</p>}
        </div>
      )}
      <Card title="Employment" tour="hr-profile-employment">
        <InfoRow label="Workforce ID" value={v(p.employee_code)} />
        <InfoRow label="Worker Category" value={WORKER_TYPE_LABELS[p.worker_type || 'office'] || '—'} />
        <InfoRow label="Department" value={v(p.department_name)} />
        <InfoRow label="Designation" value={v(p.designation_name)} />
        <InfoRow label="Grade" value={p.grade_code ? `${p.grade_code} · ${p.grade_name}` : '—'} />
        <InfoRow label="Plant" value={v(p.branch_name)} />
        <InfoRow label="Work Location" value={v(p.work_location || p.office_location)} />
        <InfoRow label="Shift" value={v(p.shift_name)} />
        <InfoRow label={p.has_login === false ? 'Supervisor / Manager' : 'Reporting Manager'} value={v(p.reporting_manager_name)} />
        <InfoRow label="Date of Joining" value={p.date_of_joining ? `${formatDate(p.date_of_joining)}${tenure ? ` (${tenure})` : ''}` : '—'} />
        <InfoRow label="Employment Type" value={EMPLOYMENT_TYPE_LABELS[p.employment_type || ''] || '—'} />
        <InfoRow label="Status" value={EMPLOYMENT_STATUS_LABELS[p.employment_status || ''] || (p.has_profile ? '—' : 'No HR profile yet')} />
        <InfoRow label="Probation" value={PROBATION_STATUS_LABELS[p.probation_status || 'not_applicable'] + (p.probation_status === 'on_probation' && p.probation_end_date ? ` — ends ${formatDate(p.probation_end_date)}` : '')} />
        {p.confirmation_date && <InfoRow label="Confirmed On" value={formatDate(p.confirmation_date)} />}
        {(p.contract_start_date || p.contract_end_date) && <InfoRow label="Contract Period" value={`${formatDate(p.contract_start_date)} → ${formatDate(p.contract_end_date)}`} />}
        {p.date_of_exit && <InfoRow label="Last Working Day" value={formatDate(p.date_of_exit)} />}
        {p.exit_reason && <InfoRow label="Exit Reason" value={p.exit_reason} />}
        {p.has_login === false && p.employment_status === 'exited' && <InfoRow label="Clearance" value={p.exit_clearance_done ? 'Complete' : 'Pending'} />}
        {p.has_login !== false && <InfoRow label="Direct Reports" value={String(p.direct_reports_count || 0)} />}
      </Card>

      {audience === 'hr' && (
        <Card title="Attendance" tour="hr-profile-attendance">
          <InfoRow label="Attendance Policy" value={ATTENDANCE_POLICY_LABELS[p.attendance_policy || ''] || '—'} />
          <InfoRow label="Weekly Off" value={p.weekly_off ? p.weekly_off.split(',').map((d) => d[0].toUpperCase() + d.slice(1)).join(', ') : 'Plant calendar'} />
          <InfoRow label="Overtime Eligible" value={p.ot_eligible === true ? 'Yes' : p.ot_eligible === false ? 'No' : 'Not set (eligible)'} />
        </Card>
      )}

      {(p.worker_type === 'contract' || p.contractor_name) && (
        <Card title="Contractor" tour="hr-profile-contractor">
          <InfoRow label="Contractor Company" value={v(p.contractor_name)} />
          <InfoRow label="Contractor Worker ID" value={v(p.contractor_worker_id)} />
          <InfoRow label="Contact Person" value={v(p.contractor_contact_person)} />
          <InfoRow label="Contact Number" value={v(p.contractor_contact_phone)} />
          <InfoRow label="Agreement / Work Order" value={v(p.contractor_agreement_ref)} />
          <InfoRow label="Verification" value={titleCase(p.contractor_verification)} />
        </Card>
      )}

      {(seePersonal || p.has_login !== false) && <Card title="Personal Details" action={personalAction} tour="hr-profile-personal">
        {p.has_login !== false && <InfoRow label="Work Email" value={v(p.email)} />}
        {p.has_login !== false && <InfoRow label="Work Phone" value={v(p.phone)} />}
        {seePersonal && <>
        <InfoRow label="Personal Email" value={v(p.personal_email)} />
        <InfoRow label="Personal Phone" value={v(p.personal_phone)} />
        <InfoRow label="Gender" value={titleCase(p.gender)} />
        <InfoRow label="Date of Birth" value={formatDate(p.date_of_birth)} />
        <InfoRow label="Blood Group" value={v(p.blood_group)} />
        <InfoRow label="Marital Status" value={titleCase(p.marital_status)} />
        <InfoRow label="Current Address" value={v(p.current_address)} />
        <InfoRow label="Permanent Address" value={v(p.permanent_address)} />
        </>}
      </Card>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {seePersonal && <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column' }}>
          <Card title="Emergency Contact" action={personalAction} tour="hr-profile-emergency">
            <InfoRow label="Name" value={v(p.emergency_contact_name)} />
            <InfoRow label="Relation" value={v(p.emergency_contact_relation)} />
            <InfoRow label="Phone" value={v(p.emergency_contact_phone)} />
          </Card>
        </div>}
        {showComplianceCard && <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column' }}>
          <Card title={seeStatutory ? 'Statutory IDs' : 'Compliance'} tour="hr-profile-statutory">
            {seeStatutory && <>
            <InfoRow label="PAN" value={v(p.pan_number)} />
            <InfoRow label="Aadhaar" value={p.aadhaar_last4 ? `XXXX XXXX ${p.aadhaar_last4}` : '—'} />
            <InfoRow label="UAN (PF)" value={v(p.uan_number)} />
            <InfoRow label="ESIC No." value={v(p.esic_number)} />
            </>}
            {p.worker_type && p.worker_type !== 'office' && <InfoRow label="Safety Induction" value={`${titleCase(p.safety_induction_status?.replace('_', ' '))}${p.safety_induction_date ? ` · ${formatDate(p.safety_induction_date)}` : ''}`} />}
            {p.worker_type && p.worker_type !== 'office' && <InfoRow label="Medical Clearance" value={`${titleCase(p.medical_clearance_status?.replace('_', ' '))}${p.medical_fitness_date ? ` · ${formatDate(p.medical_fitness_date)}` : ''}`} />}
            {audience === 'hr' && <InfoRow label="Documents Received" value={String(p.documents_received?.length || 0)} />}
          </Card>
        </div>}
      </div>

      {audience === 'hr' && (
        <Card title="HR Notes & Settings" tour="hr-profile-hr-notes">
          {p.has_login === false
            ? <>
              <InfoRow label="Portal Account" value={p.portal_access && p.work_email ? `Waiting for ${p.work_email} to sign in for the first time` : LOGIN_STATUS_LABELS[p.login_status || 'not_required']} />
              {p.portal_role_name && <InfoRow label="Application Role" value={p.portal_role_name} />}
            </>
            : <>
              <InfoRow label="Org fields owned by" value={p.has_profile ? (p.org_fields_locked ? 'HR (Azure sync will not overwrite)' : 'Azure AD sync') : '—'} />
              <InfoRow label="Portal Account" value={p.is_active ? 'Active' : 'Deactivated'} />
              <InfoRow label="Department on User Account" value={v(p.user_department)} />
              <InfoRow label="Designation on User Account" value={v(p.user_designation)} />
            </>}
          <InfoRow label="Created" value={`${formatDate(p.created_at)}${p.created_by_name ? ` · ${p.created_by_name}` : ''}`} />
          <InfoRow label="Last Updated" value={`${formatDate(p.updated_at)}${p.updated_by_name ? ` · ${p.updated_by_name}` : ''}`} />
          {see('hr_notes') && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="HR Remarks" value={v(p.notes)} /></div>}
        </Card>
      )}
    </div>
  )
}
