import { redirect } from 'next/navigation'

// Ongoing Projects was removed (2026-10-14): each user works only their own
// milestones and sub-tasks in Project Management › My Tasks. Old links and
// the per-module project-work redirects land there.
export default function OngoingProjectsRedirect() {
  redirect('/dashboard/projects/my-tasks')
}
