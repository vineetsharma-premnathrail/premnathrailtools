import { redirect } from 'next/navigation'

// Order Projects moved to Project Management (2026-10-23). Old links land there.
export default function OrderProjectsRedirect() {
  redirect('/dashboard/projects/order-projects')
}
