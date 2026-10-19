'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrApi } from '@/lib/api'
import { HrEmployeeProfile } from '@/types'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import EmployeeProfileView from '@/components/hr/employee/EmployeeProfileView'
import EmployeeDocumentsTab from '@/components/hr/employee/EmployeeDocumentsTab'
import EmployeeLifecycleTab from '@/components/hr/employee/EmployeeLifecycleTab'
import EmployeeLeaveTab from '@/components/hr/employee/EmployeeLeaveTab'
import EmployeeAttendanceTab from '@/components/hr/employee/EmployeeAttendanceTab'
import EmployeeAssetsTab from '@/components/hr/employee/EmployeeAssetsTab'
import EmployeeAssignmentTab from '@/components/hr/employee/EmployeeAssignmentTab'
import { extractErrorMessages } from '@/lib/validation'
import { sectionStyle, ErrorBanner, Avatar, StatusPill, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_HEX } from '@/components/hr/masters/masterUi'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { UploadFailedNotice } from '@/components/hr/employee/JoiningDocumentsChecklist'

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'assignment', label: 'Assignment history' },
  { key: 'documents', label: 'Documents' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'leave', label: 'Leave' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'assets', label: 'Assets' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default function HrEmployeeDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const { can, canFeature } = useCan()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { id: idResolved, error: linkError } = useRecordId(params?.id)
  const id = idResolved ?? 0

  const [emp, setEmp] = useState<HrEmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [tab, setTab] = useState<TabKey>('profile')

  // remember the tab in the URL (?tab=documents) so a refresh/back keeps it
  // Record sub-tabs a role may not get (Organization › Role & Permissions ›
  // HR › Employees features); Profile is the base view.
  const tabs = TABS.filter((t) => t.key === 'profile' || canFeature('hr', 'employees', t.key, 'view'))
  const tabAllowed = (t: string) => tabs.some((x) => x.key === t)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && tabAllowed(t)) setTab(t as TabKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const switchTab = (t: TabKey) => {
    setTab(t)
    const url = new URL(window.location.href)
    if (t === 'profile') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  useEffect(() => {
    if (!isAuthorized || !id) return
    setLoading(true)
    hrApi.getEmployee(id)
      .then((p) => { setEmp(p); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load this employee.")))
      .finally(() => setLoading(false))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HrNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hr/employees" listLabel="Back to employees" /></div>)
  if (!id) return <div><HrNav /></div>

  const statusKey = emp?.employment_status || ''
  const subtitle = emp ? [emp.designation_name, emp.department_name, emp.branch_name].filter(Boolean).join(' · ') : ''

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
          {emp && <Avatar name={emp.name} url={emp.profile_photo_url} id={emp.user_id ?? undefined} size={52} />}
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              HR &amp; Administration · Employee{emp?.employee_code ? ` · ${emp.employee_code}` : ''}
            </p>
            <h1 data-tour="hr-emp-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {emp?.name || (loading ? 'Loading…' : 'Employee')}
              {emp && (emp.has_profile
                ? <StatusPill label={EMPLOYMENT_STATUS_LABELS[statusKey] || statusKey} hex={EMPLOYMENT_STATUS_HEX[statusKey] || '#64748B'} />
                : <StatusPill label="No HR profile" hex="#D97706" />)}
              {emp && !emp.is_active && <StatusPill label="Account deactivated" hex="#64748B" />}
            </h1>
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{emp ? `${subtitle || 'No department or designation set'} · ${emp.email}` : ''}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {emp && can('hr', 'employees', emp.has_profile ? 'edit' : 'create') && (
            <button type="button" data-tour="hr-emp-edit-btn" style={primaryBtnStyle} onClick={() => router.push(`/dashboard/hr/employees/${params.id}/edit`)}>
              {emp.has_profile ? 'Edit Profile' : 'Create HR Profile'}
            </button>
          )}
          <button data-tour="hr-emp-back-btn" onClick={() => router.push('/dashboard/hr/employees')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      <UploadFailedNotice />
      <ErrorBanner errors={error} />

      {emp && (
        <>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.08)', marginBottom: 18, flexWrap: 'wrap' }}>
            {tabs.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  data-tour={`hr-emp-tab-${t.key}`}
                  onClick={() => switchTab(t.key)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '9px 14px', fontSize: 13, fontWeight: 600,
                    color: active ? '#E85A1F' : TEXT.muted, borderBottom: active ? '2px solid #FF7A45' : '2px solid transparent', marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {tab === 'profile' && (
            <>
              {!emp.has_profile && (
                <div style={{ ...sectionStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>No HR profile yet</h3>
                    <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
                      Only the details synced from Azure are shown below. Create the HR profile to record employee code, grade, shift, employment type, statutory IDs and emergency contact.
                    </p>
                  </div>
                  {can('hr', 'employees', 'create') && <button type="button" style={primaryBtnStyle} onClick={() => router.push(`/dashboard/hr/employees/${params.id}/edit`)}>Create HR Profile</button>}
                </div>
              )}
              <EmployeeProfileView p={emp} audience="hr" />
            </>
          )}
          {tab === 'assignment' && tabAllowed('assignment') && <EmployeeAssignmentTab userId={id} />}
          {tab === 'documents' && tabAllowed('documents') && <EmployeeDocumentsTab userId={id} />}
          {tab === 'lifecycle' && tabAllowed('lifecycle') && <EmployeeLifecycleTab userId={id} userRef={params.id} />}
          {tab === 'leave' && tabAllowed('leave') && <EmployeeLeaveTab userId={id} />}
          {tab === 'attendance' && tabAllowed('attendance') && <EmployeeAttendanceTab userId={id} />}
          {tab === 'assets' && tabAllowed('assets') && <EmployeeAssetsTab userId={id} />}
        </>
      )}
    </div>
  )
}
