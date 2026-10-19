'use client'

import EmployeeProfileForm from '@/components/hr/employee/EmployeeProfileForm'

/** Add an employee with no work email / portal login (workshop, contract labour). */
export default function HrNewWorkerPage() {
  return <EmployeeProfileForm mode="new-worker" />
}
