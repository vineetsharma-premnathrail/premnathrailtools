'use client'

import { HrEmployeeProfile } from '@/types'
import { TEXT } from '@/lib/theme'
import { DetailCard, DetailGroup, DetailRow } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'
import {
  sectionStyle, formatDate, titleCase, EMPLOYMENT_TYPE_LABELS, WORKER_TYPE_LABELS,
  RECORD_STATUS_LABELS, RECORD_STATUS_HEX, ATTENDANCE_POLICY_LABELS, PROBATION_STATUS_LABELS, LOGIN_STATUS_LABELS,
} from '@/components/hr/masters/masterUi'

/** "2 yrs 3 mo" since joining (to the exit date for someone who left). */
export function employeeTenure(p: HrEmployeeProfile): string | null {
  if (!p.date_of_joining) return null
  const start = new Date(p.date_of_joining + 'T00:00:00')
  const end = p.date_of_exit ? new Date(p.date_of_exit + 'T00:00:00') : new Date()
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (end.getDate() < start.getDate()) months -= 1
  if (months < 0) return null
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : '', !y && !m ? 'under a month' : ''].filter(Boolean).join(' ')
}

/** The employee summary under the name in a page header: what they do and
 * where (designation · department · plant), then the key facts on one line
 * (workforce ID · joined on + tenure · reporting manager). It shows on every
 * tab, so the Profile card below doesn't repeat these facts. */
export function EmployeeHeaderSummary({ p, extra }: { p: HrEmployeeProfile; extra?: React.ReactNode }) {
  const role = [p.designation_name, p.department_name, p.branch_name].filter(Boolean).join(' · ')
  const tenure = employeeTenure(p)
  const strong: React.CSSProperties = { color: TEXT.heading, fontWeight: 600 }
  const facts: React.ReactNode[] = []
  if (p.employee_code) facts.push(<>ID <span style={strong}>{p.employee_code}</span></>)
  facts.push(p.date_of_joining
    ? <>Joined <span style={strong}>{formatDate(p.date_of_joining)}</span>{tenure ? ` (${tenure})` : ''}</>
    : <>Joining date not set</>)
  if (p.reporting_manager_name) facts.push(<>{p.has_login === false ? 'Supervisor' : 'Reports to'} <span style={strong}>{p.reporting_manager_name}</span></>)
  if (extra) facts.push(extra)
  return (
    <>
      <p style={{ fontSize: 14, color: TEXT.secondary, margin: '0 0 4px' }}>{role || 'No designation or department set yet'}</p>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
        {facts.map((f, i) => <span key={i}>{i > 0 ? ' · ' : ''}{f}</span>)}
      </p>
    </>
  )
}

/** One titled block of rows inside the profile card; `action` sits right of the title. */
function Group({ title, tour, action, last, children }: { title: string; tour?: string; action?: React.ReactNode; last?: boolean; children: React.ReactNode }) {
  return (
    <div data-tour={tour}>
      <DetailGroup last={last}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '8px 0 2px' }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b', margin: 0 }}>{title}</p>
          {action}
        </div>
        {children}
      </DetailGroup>
    </div>
  )
}

const statusText = (s?: string | null) => (s ? titleCase(s.replace('_', ' ')) : '')

/** Read-only employee record: one card, grouped label–value rows in the same
 * order as the profile form. Name, designation, department, status and joining
 * date sit in the page header (EmployeeHeaderSummary). `audience="hr"` adds the
 * attendance setup and HR notes; `personalAction` puts an Edit button on the
 * personal-details group (My HR). */
export default function EmployeeProfileView({ p, audience, personalAction }: { p: HrEmployeeProfile; audience: 'hr' | 'self'; personalAction?: React.ReactNode }) {
  // HR › Employees features: how much of someone else's record a role sees
  // (the server blanks the same fields). An employee always sees their own.
  const { canFeature } = useCan()
  const see = (feature: 'personal' | 'statutory_ids' | 'hr_notes') => audience === 'self' || canFeature('hr', 'employees', feature, 'view')
  const seePersonal = see('personal')
  const seeStatutory = see('statutory_ids')
  const nonOffice = !!p.worker_type && p.worker_type !== 'office'
  const showCompliance = seeStatutory || nonOffice || audience === 'hr'
  const showContractor = p.worker_type === 'contract' || !!p.contractor_name
  const showContact = seePersonal || p.has_login !== false
  const exited = !!(p.date_of_exit || p.exit_reason)

  // The last group gets no divider under it.
  const order = [
    'employment', exited && 'exit', audience === 'hr' && 'attendance', showContractor && 'contractor',
    showContact && 'personal', seePersonal && 'emergency', showCompliance && 'compliance', audience === 'hr' && 'hr',
  ].filter(Boolean) as string[]
  const isLast = (k: string) => order[order.length - 1] === k

  return (
    <div style={{ marginBottom: 20 }}>
      {audience === 'hr' && p.record_status && p.record_status !== 'complete' && (
        <div style={{ ...sectionStyle, marginBottom: 16, padding: '14px 18px', borderLeft: `4px solid ${RECORD_STATUS_HEX[p.record_status] || '#64748B'}` }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>
            Record {RECORD_STATUS_LABELS[p.record_status] || p.record_status}
            {p.record_status === 'draft' ? ' — saved without the required-field checks.' : ' — some details are still missing.'}
          </p>
          {!!p.missing_fields?.length && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Missing: {p.missing_fields.join(', ')}</p>}
        </div>
      )}

      <DetailCard style={{ paddingTop: 10, marginBottom: 0 }}>
        <Group title="Employment" tour="hr-profile-employment" last={isLast('employment')}>
          <DetailRow label="Worker category">{WORKER_TYPE_LABELS[p.worker_type || 'office']}</DetailRow>
          <DetailRow label="Employment type">{EMPLOYMENT_TYPE_LABELS[p.employment_type || '']}</DetailRow>
          <DetailRow label="Grade">{p.grade_code ? `${p.grade_code} · ${p.grade_name}` : null}</DetailRow>
          <DetailRow label="Work location">{p.work_location || p.office_location}</DetailRow>
          <DetailRow label="Shift">{p.shift_name}</DetailRow>
          <DetailRow label="Probation">
            {PROBATION_STATUS_LABELS[p.probation_status || 'not_applicable'] + (p.probation_status === 'on_probation' && p.probation_end_date ? ` — ends ${formatDate(p.probation_end_date)}` : '')}
          </DetailRow>
          {p.confirmation_date && <DetailRow label="Confirmed on">{formatDate(p.confirmation_date)}</DetailRow>}
          {(p.contract_start_date || p.contract_end_date) && <DetailRow label="Contract period">{`${formatDate(p.contract_start_date)} → ${formatDate(p.contract_end_date)}`}</DetailRow>}
          {p.has_login !== false && <DetailRow label="Direct reports">{String(p.direct_reports_count || 0)}</DetailRow>}
        </Group>

        {exited && (
          <Group title="Exit" last={isLast('exit')}>
            <DetailRow label="Last working day">{p.date_of_exit ? formatDate(p.date_of_exit) : null}</DetailRow>
            <DetailRow label="Exit reason">{p.exit_reason}</DetailRow>
            {p.has_login === false && p.employment_status === 'exited' && <DetailRow label="Clearance">{p.exit_clearance_done ? 'Complete' : 'Pending'}</DetailRow>}
          </Group>
        )}

        {audience === 'hr' && (
          <Group title="Attendance setup" tour="hr-profile-attendance" last={isLast('attendance')}>
            <DetailRow label="Attendance policy">{ATTENDANCE_POLICY_LABELS[p.attendance_policy || '']}</DetailRow>
            <DetailRow label="Weekly off">{p.weekly_off ? p.weekly_off.split(',').map((d) => d[0].toUpperCase() + d.slice(1)).join(', ') : 'As per plant calendar'}</DetailRow>
            <DetailRow label="Overtime eligible">{p.ot_eligible === true ? 'Yes' : p.ot_eligible === false ? 'No' : 'Not set (treated as eligible)'}</DetailRow>
          </Group>
        )}

        {showContractor && (
          <Group title="Contractor" tour="hr-profile-contractor" last={isLast('contractor')}>
            <DetailRow label="Contractor company">{p.contractor_name}</DetailRow>
            <DetailRow label="Contractor worker ID">{p.contractor_worker_id}</DetailRow>
            <DetailRow label="Contact person">{[p.contractor_contact_person, p.contractor_contact_phone].filter(Boolean).join(' · ')}</DetailRow>
            <DetailRow label="Agreement / work order">{p.contractor_agreement_ref}</DetailRow>
            <DetailRow label="Verification">{p.contractor_verification ? titleCase(p.contractor_verification) : null}</DetailRow>
          </Group>
        )}

        {showContact && (
          <Group title="Contact & personal details" tour="hr-profile-personal" action={personalAction} last={isLast('personal')}>
            {p.has_login !== false && <DetailRow label="Work email">{p.email}</DetailRow>}
            {p.has_login !== false && <DetailRow label="Work phone">{p.phone}</DetailRow>}
            {seePersonal && <>
              <DetailRow label="Personal email">{p.personal_email}</DetailRow>
              <DetailRow label="Personal phone">{p.personal_phone}</DetailRow>
              <DetailRow label="Gender">{p.gender ? titleCase(p.gender) : null}</DetailRow>
              <DetailRow label="Date of birth">{p.date_of_birth ? formatDate(p.date_of_birth) : null}</DetailRow>
              <DetailRow label="Blood group">{p.blood_group}</DetailRow>
              <DetailRow label="Marital status">{p.marital_status ? titleCase(p.marital_status) : null}</DetailRow>
              <DetailRow label="Current address">{p.current_address}</DetailRow>
              <DetailRow label="Permanent address">
                {p.permanent_address && p.current_address && p.permanent_address.trim() === p.current_address.trim() ? 'Same as current address' : p.permanent_address}
              </DetailRow>
            </>}
          </Group>
        )}

        {seePersonal && (
          <Group title="Emergency contact" tour="hr-profile-emergency" last={isLast('emergency')}>
            <DetailRow label="Name">
              {p.emergency_contact_name ? `${p.emergency_contact_name}${p.emergency_contact_relation ? ` (${p.emergency_contact_relation})` : ''}` : null}
            </DetailRow>
            <DetailRow label="Phone">{p.emergency_contact_phone}</DetailRow>
          </Group>
        )}

        {showCompliance && (
          <Group title={seeStatutory ? 'Statutory IDs & compliance' : 'Compliance'} tour="hr-profile-statutory" last={isLast('compliance')}>
            {seeStatutory && <>
              <DetailRow label="PAN">{p.pan_number}</DetailRow>
              <DetailRow label="Aadhaar">{p.aadhaar_last4 ? `XXXX XXXX ${p.aadhaar_last4}` : null}</DetailRow>
              <DetailRow label="UAN (PF)">{p.uan_number}</DetailRow>
              <DetailRow label="ESIC number">{p.esic_number}</DetailRow>
            </>}
            {nonOffice && <DetailRow label="Safety induction">{[statusText(p.safety_induction_status), p.safety_induction_date ? formatDate(p.safety_induction_date) : ''].filter(Boolean).join(' · ')}</DetailRow>}
            {nonOffice && <DetailRow label="Medical clearance">{[statusText(p.medical_clearance_status), p.medical_fitness_date ? formatDate(p.medical_fitness_date) : ''].filter(Boolean).join(' · ')}</DetailRow>}
            {audience === 'hr' && <DetailRow label="Documents received">{String(p.documents_received?.length || 0)}</DetailRow>}
          </Group>
        )}

        {audience === 'hr' && (
          <Group title="HR notes & account" tour="hr-profile-hr-notes" last={isLast('hr')}>
            {p.has_login === false
              ? <>
                <DetailRow label="Portal account">{p.portal_access && p.work_email ? `Waiting for ${p.work_email} to sign in for the first time` : LOGIN_STATUS_LABELS[p.login_status || 'not_required']}</DetailRow>
                {p.portal_role_name && <DetailRow label="Application role">{p.portal_role_name}</DetailRow>}
              </>
              : <>
                <DetailRow label="Portal account">{p.is_active ? 'Active' : 'Deactivated'}</DetailRow>
                <DetailRow label="Org fields owned by">{p.has_profile ? (p.org_fields_locked ? 'HR (Azure sync will not overwrite)' : 'Azure AD sync') : null}</DetailRow>
                <DetailRow label="Department on user account">{p.user_department}</DetailRow>
                <DetailRow label="Designation on user account">{p.user_designation}</DetailRow>
              </>}
            {see('hr_notes') && <DetailRow label="HR remarks">{p.notes}</DetailRow>}
            <DetailRow label="Created">{p.created_at ? `${formatDate(p.created_at)}${p.created_by_name ? ` · ${p.created_by_name}` : ''}` : null}</DetailRow>
            <DetailRow label="Last updated">{p.updated_at ? `${formatDate(p.updated_at)}${p.updated_by_name ? ` · ${p.updated_by_name}` : ''}` : null}</DetailRow>
          </Group>
        )}
      </DetailCard>
    </div>
  )
}
