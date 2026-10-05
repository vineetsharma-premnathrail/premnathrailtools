'use client'

import DocTypeSettings from '@/components/store/DocTypeSettings'

export default function StoreIssueTypesPage() {
  return (
    <DocTypeSettings
      kind="issue"
      title="Issue Types"
      noun="issue type"
      intro="Why material was issued (Production, Maintenance, Project…). Picked on every Material Issue, used for consumption reports."
    />
  )
}
