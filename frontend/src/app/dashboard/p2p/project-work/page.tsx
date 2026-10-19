import { redirect } from 'next/navigation'

// Ongoing Projects lives in one place for every department (2026-10-12) —
// this old per-module link forwards there, keeping an opened project (?id=).
export default async function OldOngoingProjectsLink({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await searchParams
  redirect(typeof id === 'string' && id ? `/dashboard/ongoing-projects?id=${encodeURIComponent(id)}` : '/dashboard/ongoing-projects')
}
