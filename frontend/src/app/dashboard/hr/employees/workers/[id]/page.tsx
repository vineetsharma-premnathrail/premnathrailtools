'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrApi } from '@/lib/api'
import { HrEmployeeProfile, HrFormRules } from '@/types'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import EmployeeProfileView from '@/components/hr/employee/EmployeeProfileView'
import { extractErrorMessages } from '@/lib/validation'
import {
  sectionStyle, ErrorBanner, Avatar, StatusPill, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_HEX, WORKER_TYPE_LABELS, WORKER_TYPE_HEX,
} from '@/components/hr/masters/masterUi'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import JoiningDocumentsChecklist, { DocumentOwner, UploadFailedNotice } from '@/components/hr/employee/JoiningDocumentsChecklist'

/** An employee with no portal account (workshop / contract labour). Only the
 *  profile exists for them — leave, attendance and documents are tied to a
 *  portal account and aren't available yet. */
export default function HrWorkerDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const { can, canFeature } = useCan()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { id: idResolved, error: linkError } = useRecordId(params?.id)
  const id = idResolved ?? 0

  const [emp, setEmp] = useState<HrEmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [rules, setRules] = useState<HrFormRules | null>(null)
  const owner: DocumentOwner = useMemo(() => (id ? { kind: 'worker', id } : null), [id])

  useEffect(() => {
    if (!isAuthorized || !id) return
    Promise.all([hrApi.getWorker(id), hrApi.getWorkforceFormRules()])
      .then(([p, rl]) => { setEmp(p); setRules(rl); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load this employee.")))
      .finally(() => setLoading(false))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HrNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hr/employees" listLabel="Back to employees" /></div>)
  if (!id) return <div><HrNav /></div>

  const statusKey = emp?.employment_status || ''
  const wt = emp?.worker_type || 'factory'
  const subtitle = emp ? [emp.designation_name, emp.department_name, emp.branch_name].filter(Boolean).join(' · ') : ''

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
          {emp && <Avatar name={emp.name} url={null} id={emp.profile_id ?? undefined} size={52} />}
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              HR &amp; Administration · Employee{emp?.employee_code ? ` · ${emp.employee_code}` : ''}
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {emp?.name || (loading ? 'Loading…' : 'Employee')}
              {emp && <StatusPill label={EMPLOYMENT_STATUS_LABELS[statusKey] || statusKey} hex={EMPLOYMENT_STATUS_HEX[statusKey] || '#64748B'} />}
              {emp && <StatusPill label={WORKER_TYPE_LABELS[wt] || wt} hex={WORKER_TYPE_HEX[wt] || '#64748B'} />}
            </h1>
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
              {emp ? `${subtitle || 'No department or designation set'} · No portal login${emp.contractor_name ? ` · via ${emp.contractor_name}` : ''}` : ''}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {emp && can('hr', 'employees', 'edit') && (
            <button type="button" style={primaryBtnStyle} onClick={() => router.push(`/dashboard/hr/employees/workers/${params.id}/edit`)}>Edit Profile</button>
          )}
          <button onClick={() => router.push('/dashboard/hr/employees')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      <UploadFailedNotice />
      <ErrorBanner errors={error} />

      {emp && <EmployeeProfileView p={emp} audience="hr" />}

      {emp && rules && canFeature('hr', 'employees', 'documents', 'view') && (
        <div style={sectionStyle}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }}>Documents</p>
          <JoiningDocumentsChecklist
            rules={rules}
            ctx={{ worker_type: emp.worker_type || 'factory', employment_type: emp.employment_type, has_login: false }}
            owner={owner}
            staged={[]}
            onStage={() => { /* the record exists — files upload straight away */ }}
            onChanged={() => { hrApi.getWorker(id).then(setEmp).catch(() => { /* status refresh only */ }) }}
          />
        </div>
      )}
    </div>
  )
}
