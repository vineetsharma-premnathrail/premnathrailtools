'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'
import { sampleLeaveTypes } from '@/lib/hrPreviewSamples'

// Loaded on demand so the Role editor does not carry every previewable screen.
const EmployeeForm = dynamic(() => import('@/components/hr/employee/EmployeeProfileForm').then((m) => {
  const Form = m.default
  return function EmployeeFormPreview() { return <Form mode="new-worker" /> }
}), { ssr: false })
const EmployeeDetail = dynamic(() => import('@/app/dashboard/hr/employees/[id]/page'), { ssr: false })
const EmployeeList = dynamic(() => import('@/app/dashboard/hr/employees/page'), { ssr: false })
const LeaveForm = dynamic(() => import('@/components/hr/leave/LeaveApplyForm').then((m) => {
  const Form = m.default
  return function LeaveFormPreview() { return <Form types={sampleLeaveTypes} onSubmitted={() => {}} /> }
}), { ssr: false })
const LeaveLists = dynamic(() => import('@/app/dashboard/hr/leave/page'), { ssr: false })

/** HR screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const hrPreviews: PreviewScreens = {
  'hr:employees': { form: EmployeeForm, detail: EmployeeDetail, list: EmployeeList },
  'hr:leave': { form: LeaveForm, list: LeaveLists },
}
