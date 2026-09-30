'use client'

import { useAuth } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import HrNav from '@/components/hr/HrNav'
import LeaveApprovals from '@/components/hr/approvals/LeaveApprovals'
import RegularizationApprovals from '@/components/hr/approvals/RegularizationApprovals'
import TravelApprovals from '@/components/hr/approvals/TravelApprovals'
import ExpenseApprovals from '@/components/hr/approvals/ExpenseApprovals'
import MyChecklistTasks from '@/components/hr/lifecycle/MyChecklistTasks'

// Everything waiting for the signed-in user's decision: requests from their
// direct reports (captured approver), plus — for HR users — requests with no
// approver. Each section loads its own data and renders nothing when empty.
export default function HrApprovalsPage() {
  // Self-service: any logged-in user (managers are not necessarily HR).
  const { user, isLoading } = useAuth()

  if (isLoading || !user) return null

  return (
    <div>
      <HrNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          HR &amp; Administration
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Approvals</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
          Leave, attendance corrections, travel and expense claims waiting for your decision, plus lifecycle checklist tasks assigned to you. Sections with nothing pending are hidden.
        </p>
      </div>

      <LeaveApprovals />
      <RegularizationApprovals />
      <TravelApprovals />
      <ExpenseApprovals />
      {/* Joining / exit / transfer checklist tasks assigned to me (IT, store, new manager…). */}
      <MyChecklistTasks />
    </div>
  )
}
