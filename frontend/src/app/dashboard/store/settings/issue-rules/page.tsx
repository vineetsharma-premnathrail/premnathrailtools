import { redirect } from 'next/navigation'

// Issue Rules were retired (2026-10-12): what each issue type asks for is a
// fixed standard (the New Issue form shows the right fields per type).
export default function OldIssueRulesLink() {
  redirect('/dashboard/store/settings')
}
