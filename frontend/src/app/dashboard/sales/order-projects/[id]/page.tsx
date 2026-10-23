import { redirect } from 'next/navigation'

// Order Projects moved to Project Management (2026-10-23). Old record links
// keep their signed ref and land on the same project there.
export default async function OrderProjectRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/dashboard/projects/order-projects/${encodeURIComponent(id)}`)
}
